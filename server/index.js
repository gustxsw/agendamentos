import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { pool } from "./db.js";
import { authenticate, authorize } from "./middleware/auth.js";
import createUpload from "./middleware/upload.js";
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 🔥 MERCADO PAGO SDK V2 CONFIGURATION
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: {
    timeout: 5000,
    idempotencyKey: 'abc'
  }
});

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://www.cartaoquiroferreira.com.br',
    'https://cartaoquiroferreira.com.br'
  ],
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

// 🔥 CREATE ALL AGENDA TABLES ON STARTUP
const createAgendaTables = async () => {
  try {
    console.log('🔄 Creating agenda tables...');

    // Professional schedules table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_schedules (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        monday_start TIME,
        monday_end TIME,
        tuesday_start TIME,
        tuesday_end TIME,
        wednesday_start TIME,
        wednesday_end TIME,
        thursday_start TIME,
        thursday_end TIME,
        friday_start TIME,
        friday_end TIME,
        saturday_start TIME,
        saturday_end TIME,
        sunday_start TIME,
        sunday_end TIME,
        slot_duration INTEGER DEFAULT 30,
        break_start TIME,
        break_end TIME,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(professional_id)
      )
    `);

    // Professional patients relationship table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_patients (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        notes TEXT,
        linked_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(professional_id, patient_id)
      )
    `);

    // Appointments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date TIMESTAMPTZ NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Blocked times table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_times (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ NOT NULL,
        reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Medical records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        diagnosis TEXT,
        treatment TEXT,
        observations TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Agenda subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(professional_id)
      )
    `);

    // Agenda payments table (separate from convenio payments)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_payments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        mp_payment_id VARCHAR(255),
        mp_preference_id VARCHAR(255),
        payment_date TIMESTAMPTZ,
        period_start TIMESTAMPTZ,
        period_end TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_appointments_professional_date 
      ON appointments(professional_id, date);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_professional_patients_professional 
      ON professional_patients(professional_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_agenda_payments_professional 
      ON agenda_payments(professional_id);
    `);

    console.log('✅ Agenda tables created successfully');
  } catch (error) {
    console.error('❌ Error creating agenda tables:', error);
  }
};

// Initialize agenda tables
createAgendaTables();

// 🔥 MIDDLEWARE TO CHECK AGENDA SUBSCRIPTION
const checkAgendaSubscription = async (req, res, next) => {
  try {
    const professionalId = req.user.id;

    const result = await pool.query(`
      SELECT 
        status,
        expires_at,
        CASE 
          WHEN status = 'active' AND expires_at > NOW() THEN true
          ELSE false
        END as can_use_agenda,
        CASE 
          WHEN expires_at IS NOT NULL THEN EXTRACT(DAY FROM expires_at - NOW())::INTEGER
          ELSE 0
        END as days_remaining
      FROM agenda_subscriptions 
      WHERE professional_id = $1
    `, [professionalId]);

    if (result.rows.length === 0) {
      // Create initial subscription record
      await pool.query(`
        INSERT INTO agenda_subscriptions (professional_id, status)
        VALUES ($1, 'pending')
        ON CONFLICT (professional_id) DO NOTHING
      `, [professionalId]);

      return res.status(403).json({
        message: 'Assinatura da agenda necessária',
        subscription_status: {
          status: 'pending',
          can_use_agenda: false,
          days_remaining: 0
        }
      });
    }

    const subscription = result.rows[0];

    if (!subscription.can_use_agenda) {
      return res.status(403).json({
        message: 'Assinatura da agenda expirada ou inativa',
        subscription_status: subscription
      });
    }

    req.subscription = subscription;
    next();
  } catch (error) {
    console.error('Error checking agenda subscription:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
};

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const {
      name,
      cpf,
      email,
      phone,
      birth_date,
      address,
      address_number,
      address_complement,
      neighborhood,
      city,
      state,
      password,
    } = req.body;

    if (!name || !cpf || !password) {
      return res.status(400).json({ message: 'Nome, CPF e senha são obrigatórios' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cpf]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, password, roles,
        subscription_status, subscription_expiry
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) 
      RETURNING id, name, cpf, roles`,
      [
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, hashedPassword, ['client'],
        'pending', null
      ]
    );

    const user = result.rows[0];
    res.status(201).json({ user });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { cpf, password } = req.body;

    if (!cpf || !password) {
      return res.status(400).json({ message: 'CPF e senha são obrigatórios' });
    }

    const result = await pool.query(
      'SELECT id, name, cpf, password, roles FROM users WHERE cpf = $1',
      [cpf]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    const userResponse = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: user.roles || []
    };

    const needsRoleSelection = user.roles && user.roles.length > 1;

    res.json({ user: userResponse, needsRoleSelection });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/select-role', async (req, res) => {
  try {
    const { userId, role } = req.body;

    const result = await pool.query(
      'SELECT id, name, cpf, roles FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];

    if (!user.roles || !user.roles.includes(role)) {
      return res.status(403).json({ message: 'Role não autorizada para este usuário' });
    }

    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    const userResponse = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: user.roles,
      currentRole: role
    };

    res.json({ user: userResponse, token });
  } catch (error) {
    console.error('Role selection error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/switch-role', authenticate, async (req, res) => {
  try {
    const { role } = req.body;
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT id, name, cpf, roles FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];

    if (!user.roles || !user.roles.includes(role)) {
      return res.status(403).json({ message: 'Role não autorizada para este usuário' });
    }

    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    const userResponse = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: user.roles,
      currentRole: role
    };

    res.json({ user: userResponse, token });
  } catch (error) {
    console.error('Role switch error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout realizado com sucesso' });
});

// 🔥 AGENDA ROUTES

// Get subscription status
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;

    const result = await pool.query(`
      SELECT 
        status,
        expires_at,
        CASE 
          WHEN status = 'active' AND expires_at > NOW() THEN true
          ELSE false
        END as can_use_agenda,
        CASE 
          WHEN expires_at IS NOT NULL THEN EXTRACT(DAY FROM expires_at - NOW())::INTEGER
          ELSE 0
        END as days_remaining,
        (SELECT payment_date FROM agenda_payments 
         WHERE professional_id = $1 AND status = 'approved' 
         ORDER BY payment_date DESC LIMIT 1) as last_payment
      FROM agenda_subscriptions 
      WHERE professional_id = $1
    `, [professionalId]);

    if (result.rows.length === 0) {
      // Create initial subscription record
      await pool.query(`
        INSERT INTO agenda_subscriptions (professional_id, status)
        VALUES ($1, 'pending')
      `, [professionalId]);

      return res.json({
        status: 'pending',
        expires_at: null,
        can_use_agenda: false,
        days_remaining: 0,
        last_payment: null
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting subscription status:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔥 CREATE AGENDA SUBSCRIPTION PAYMENT (SDK V2)
app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const amount = 49.90; // Fixed monthly price

    // Get user info
    const userResult = await pool.query(
      'SELECT name, email FROM users WHERE id = $1',
      [professionalId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = userResult.rows[0];

    // 🔥 USING MERCADO PAGO SDK V2
    const preference = new Preference(client);

    const preferenceData = {
      items: [
        {
          id: `agenda-subscription-${professionalId}`,
          title: 'Assinatura Agenda Profissional - Quiro Ferreira',
          description: 'Acesso completo à agenda profissional por 30 dias',
          quantity: 1,
          unit_price: amount,
          currency_id: 'BRL'
        }
      ],
      payer: {
        name: user.name,
        email: user.email || `professional${professionalId}@quiroferreira.com.br`
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=pending`
      },
      auto_return: 'approved',
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/agenda/webhook`,
      external_reference: `agenda-${professionalId}-${Date.now()}`,
      statement_descriptor: 'QUIRO FERREIRA',
      metadata: {
        professional_id: professionalId,
        subscription_type: 'agenda_monthly'
      }
    };

    const response = await preference.create({ body: preferenceData });

    // Save payment record
    await pool.query(`
      INSERT INTO agenda_payments (
        professional_id, amount, status, mp_preference_id
      ) VALUES ($1, $2, 'pending', $3)
    `, [professionalId, amount, response.id]);

    console.log('✅ Agenda payment preference created:', response.id);

    res.json({
      preference_id: response.id,
      init_point: response.init_point,
      sandbox_init_point: response.sandbox_init_point
    });

  } catch (error) {
    console.error('❌ Error creating agenda payment:', error);
    res.status(500).json({ 
      message: 'Erro ao criar pagamento',
      error: error.message 
    });
  }
});

// 🔥 AGENDA WEBHOOK (SDK V2)
app.post('/api/agenda/webhook', async (req, res) => {
  try {
    console.log('🔔 Agenda webhook received:', req.body);

    const { type, data } = req.body;

    if (type === 'payment') {
      const paymentId = data.id;

      // 🔥 USING MERCADO PAGO SDK V2
      const payment = new Payment(client);
      const paymentInfo = await payment.get({ id: paymentId });

      console.log('💰 Payment info:', paymentInfo);

      if (paymentInfo.status === 'approved') {
        const externalReference = paymentInfo.external_reference;
        
        if (externalReference && externalReference.startsWith('agenda-')) {
          const professionalId = externalReference.split('-')[1];

          // Update payment record
          await pool.query(`
            UPDATE agenda_payments 
            SET status = 'approved', 
                mp_payment_id = $1,
                payment_date = NOW(),
                period_start = NOW(),
                period_end = NOW() + INTERVAL '30 days'
            WHERE professional_id = $2 AND status = 'pending'
          `, [paymentId, professionalId]);

          // Update subscription
          await pool.query(`
            INSERT INTO agenda_subscriptions (professional_id, status, expires_at)
            VALUES ($1, 'active', NOW() + INTERVAL '30 days')
            ON CONFLICT (professional_id) 
            DO UPDATE SET 
              status = 'active',
              expires_at = NOW() + INTERVAL '30 days',
              updated_at = NOW()
          `, [professionalId]);

          console.log(`✅ Agenda subscription activated for professional ${professionalId}`);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Agenda webhook error:', error);
    res.status(500).json({ message: 'Erro no webhook' });
  }
});

// Get schedule configuration
app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  try {
    const professionalId = req.user.id;

    const result = await pool.query(
      'SELECT * FROM professional_schedules WHERE professional_id = $1',
      [professionalId]
    );

    if (result.rows.length === 0) {
      // Create default schedule
      const defaultSchedule = await pool.query(`
        INSERT INTO professional_schedules (
          professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
          wednesday_start, wednesday_end, thursday_start, thursday_end,
          friday_start, friday_end, slot_duration
        ) VALUES ($1, '08:00', '18:00', '08:00', '18:00', '08:00', '18:00', 
                  '08:00', '18:00', '08:00', '18:00', 30)
        RETURNING *
      `, [professionalId]);

      return res.json(defaultSchedule.rows[0]);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting schedule config:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Update schedule configuration
app.put('/api/agenda/schedule-config', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  try {
    const professionalId = req.user.id;
    const scheduleData = req.body;

    const result = await pool.query(`
      UPDATE professional_schedules SET
        monday_start = $2, monday_end = $3,
        tuesday_start = $4, tuesday_end = $5,
        wednesday_start = $6, wednesday_end = $7,
        thursday_start = $8, thursday_end = $9,
        friday_start = $10, friday_end = $11,
        saturday_start = $12, saturday_end = $13,
        sunday_start = $14, sunday_end = $15,
        slot_duration = $16,
        break_start = $17, break_end = $18,
        updated_at = NOW()
      WHERE professional_id = $1
      RETURNING *
    `, [
      professionalId,
      scheduleData.monday_start, scheduleData.monday_end,
      scheduleData.tuesday_start, scheduleData.tuesday_end,
      scheduleData.wednesday_start, scheduleData.wednesday_end,
      scheduleData.thursday_start, scheduleData.thursday_end,
      scheduleData.friday_start, scheduleData.friday_end,
      scheduleData.saturday_start, scheduleData.saturday_end,
      scheduleData.sunday_start, scheduleData.sunday_end,
      scheduleData.slot_duration || 30,
      scheduleData.break_start, scheduleData.break_end
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating schedule config:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get professional patients
app.get('/api/agenda/patients', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  try {
    const professionalId = req.user.id;

    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.cpf, u.email, u.phone, u.birth_date,
        u.address, u.address_number, u.address_complement,
        u.neighborhood, u.city, u.state,
        pp.notes, pp.linked_at,
        CASE WHEN u.roles && ARRAY['client'] THEN true ELSE false END as is_convenio_patient
      FROM professional_patients pp
      JOIN users u ON pp.patient_id = u.id
      WHERE pp.professional_id = $1
      ORDER BY u.name
    `, [professionalId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting patients:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Add new patient
app.post('/api/agenda/patients', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  try {
    const professionalId = req.user.id;
    const {
      name, cpf, email, phone, birth_date,
      address, address_number, address_complement,
      neighborhood, city, state, notes
    } = req.body;

    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }

    // Check if patient already exists
    let patientResult = await pool.query('SELECT id FROM users WHERE cpf = $1', [cpf]);
    let patientId;

    if (patientResult.rows.length > 0) {
      // Patient exists, just link to professional
      patientId = patientResult.rows[0].id;

      // Check if already linked
      const linkResult = await pool.query(
        'SELECT id FROM professional_patients WHERE professional_id = $1 AND patient_id = $2',
        [professionalId, patientId]
      );

      if (linkResult.rows.length > 0) {
        return res.status(400).json({ message: 'Paciente já vinculado a este profissional' });
      }
    } else {
      // Create new patient (without password - particular patient)
      const newPatientResult = await pool.query(`
        INSERT INTO users (
          name, cpf, email, phone, birth_date, address, address_number,
          address_complement, neighborhood, city, state, roles
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `, [
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, []
      ]);

      patientId = newPatientResult.rows[0].id;
    }

    // Link patient to professional
    await pool.query(`
      INSERT INTO professional_patients (professional_id, patient_id, notes)
      VALUES ($1, $2, $3)
    `, [professionalId, patientId, notes]);

    // Return the linked patient data
    const linkedPatientResult = await pool.query(`
      SELECT 
        u.id, u.name, u.cpf, u.email, u.phone, u.birth_date,
        u.address, u.address_number, u.address_complement,
        u.neighborhood, u.city, u.state,
        pp.notes, pp.linked_at,
        CASE WHEN u.roles && ARRAY['client'] THEN true ELSE false END as is_convenio_patient
      FROM professional_patients pp
      JOIN users u ON pp.patient_id = u.id
      WHERE pp.professional_id = $1 AND pp.patient_id = $2
    `, [professionalId, patientId]);

    res.status(201).json(linkedPatientResult.rows[0]);
  } catch (error) {
    console.error('Error adding patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Update patient notes
app.put('/api/agenda/patients/:patientId', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  try {
    const professionalId = req.user.id;
    const patientId = req.params.patientId;
    const { notes } = req.body;

    await pool.query(`
      UPDATE professional_patients 
      SET notes = $1
      WHERE professional_id = $2 AND patient_id = $3
    `, [notes, professionalId, patientId]);

    res.json({ message: 'Observações atualizadas com sucesso' });
  } catch (error) {
    console.error('Error updating patient notes:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get appointments
app.get('/api/agenda/appointments', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  try {
    const professionalId = req.user.id;
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        a.id, a.date, a.status, a.notes,
        u.id as patient_id, u.name as patient_name, u.phone as patient_phone,
        CASE WHEN u.roles && ARRAY['client'] THEN true ELSE false END as is_convenio_patient
      FROM appointments a
      JOIN users u ON a.patient_id = u.id
      WHERE a.professional_id = $1
    `;

    const params = [professionalId];

    if (start_date && end_date) {
      query += ` AND a.date >= $2 AND a.date <= $3`;
      params.push(start_date, end_date);
    }

    query += ` ORDER BY a.date`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting appointments:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Create appointment
app.post('/api/agenda/appointments', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  try {
    const professionalId = req.user.id;
    const { patient_id, date, notes } = req.body;

    // Check for conflicts
    const conflictResult = await pool.query(`
      SELECT id FROM appointments 
      WHERE professional_id = $1 AND date = $2 AND status != 'cancelled'
    `, [professionalId, date]);

    if (conflictResult.rows.length > 0) {
      return res.status(400).json({ message: 'Já existe um agendamento neste horário' });
    }

    // Verify patient is linked to professional
    const linkResult = await pool.query(`
      SELECT id FROM professional_patients 
      WHERE professional_id = $1 AND patient_id = $2
    `, [professionalId, patient_id]);

    if (linkResult.rows.length === 0) {
      return res.status(400).json({ message: 'Paciente não vinculado a este profissional' });
    }

    const result = await pool.query(`
      INSERT INTO appointments (professional_id, patient_id, date, notes)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [professionalId, patient_id, date, notes]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Update appointment status
app.put('/api/agenda/appointments/:appointmentId', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  try {
    const professionalId = req.user.id;
    const appointmentId = req.params.appointmentId;
    const { status, notes } = req.body;

    const result = await pool.query(`
      UPDATE appointments 
      SET status = $1, notes = $2, updated_at = NOW()
      WHERE id = $3 AND professional_id = $4
      RETURNING *
    `, [status, notes, appointmentId, professionalId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Existing routes (users, services, consultations, etc.)
app.get('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, roles, percentage,
        category_id, subscription_status, subscription_expiry, created_at
      FROM users 
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Users can only access their own data, unless they're admin
    if (req.user.currentRole !== 'admin' && req.user.id !== parseInt(userId)) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }

    const result = await pool.query(`
      SELECT 
        id, name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, roles, percentage,
        category_id, subscription_status, subscription_expiry, photo_url, created_at
      FROM users 
      WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, password, roles,
      percentage, category_id
    } = req.body;

    if (!name || !cpf || !password || !roles || roles.length === 0) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cpf]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password, roles,
        percentage, category_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id, name, cpf, email, roles
    `, [
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, hashedPassword, roles,
      percentage, category_id
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/users/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const userId = req.params.id;
    const {
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles,
      percentage, category_id
    } = req.body;

    if (!name || !roles || roles.length === 0) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }

    const result = await pool.query(`
      UPDATE users SET
        name = $1, email = $2, phone = $3, birth_date = $4,
        address = $5, address_number = $6, address_complement = $7,
        neighborhood = $8, city = $9, state = $10, roles = $11,
        percentage = $12, category_id = $13
      WHERE id = $14
      RETURNING id, name, cpf, email, roles
    `, [
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles,
      percentage, category_id, userId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/users/:id/activate', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const userId = req.params.id;
    const { expiry_date } = req.body;

    if (!expiry_date) {
      return res.status(400).json({ message: 'Data de expiração é obrigatória' });
    }

    const result = await pool.query(`
      UPDATE users 
      SET subscription_status = 'active', subscription_expiry = $1
      WHERE id = $2
      RETURNING id, name, subscription_status, subscription_expiry
    `, [expiry_date, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error activating user:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.delete('/api/users/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const userId = req.params.id;

    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json({ message: 'Usuário excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Service categories routes
app.get('/api/service-categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM service_categories ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching service categories:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/service-categories', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Nome da categoria é obrigatório' });
    }

    const result = await pool.query(
      'INSERT INTO service_categories (name, description) VALUES ($1, $2) RETURNING *',
      [name, description]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating service category:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Services routes
app.get('/api/services', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, sc.name as category_name 
      FROM services s
      LEFT JOIN service_categories sc ON s.category_id = sc.id
      ORDER BY s.name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/services', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description, base_price, category_id, is_base_service } = req.body;

    if (!name || !description || !base_price) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }

    const result = await pool.query(`
      INSERT INTO services (name, description, base_price, category_id, is_base_service)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, description, base_price, category_id, is_base_service || false]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/services/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const serviceId = req.params.id;
    const { name, description, base_price, category_id, is_base_service } = req.body;

    const result = await pool.query(`
      UPDATE services 
      SET name = $1, description = $2, base_price = $3, category_id = $4, is_base_service = $5
      WHERE id = $6
      RETURNING *
    `, [name, description, base_price, category_id, is_base_service, serviceId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.delete('/api/services/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const serviceId = req.params.id;

    const result = await pool.query('DELETE FROM services WHERE id = $1 RETURNING id', [serviceId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }

    res.json({ message: 'Serviço excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Professionals route
app.get('/api/professionals', authenticate, authorize(['client']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.email, u.phone, u.address, u.address_number,
        u.address_complement, u.neighborhood, u.city, u.state, u.photo_url,
        sc.name as category_name
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE u.roles && ARRAY['professional']
      ORDER BY u.name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching professionals:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Consultations routes
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query;
    let params;

    if (req.user.currentRole === 'client') {
      // Client sees their own consultations and dependents' consultations
      query = `
        SELECT 
          c.id, c.date, c.value,
          s.name as service_name,
          u_prof.name as professional_name,
          COALESCE(u_client.name, d.name) as client_name,
          CASE WHEN c.dependent_id IS NOT NULL THEN true ELSE false END as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users u_prof ON c.professional_id = u_prof.id
        LEFT JOIN users u_client ON c.client_id = u_client.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE c.client_id = $1 OR c.dependent_id IN (
          SELECT id FROM dependents WHERE client_id = $1
        )
        ORDER BY c.date DESC
      `;
      params = [req.user.id];
    } else if (req.user.currentRole === 'professional') {
      // Professional sees their own consultations
      query = `
        SELECT 
          c.id, c.date, c.value,
          s.name as service_name,
          u_prof.name as professional_name,
          COALESCE(u_client.name, d.name) as client_name,
          CASE WHEN c.dependent_id IS NOT NULL THEN true ELSE false END as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users u_prof ON c.professional_id = u_prof.id
        LEFT JOIN users u_client ON c.client_id = u_client.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE c.professional_id = $1
        ORDER BY c.date DESC
      `;
      params = [req.user.id];
    } else {
      // Admin sees all consultations
      query = `
        SELECT 
          c.id, c.date, c.value,
          s.name as service_name,
          u_prof.name as professional_name,
          COALESCE(u_client.name, d.name) as client_name,
          CASE WHEN c.dependent_id IS NOT NULL THEN true ELSE false END as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users u_prof ON c.professional_id = u_prof.id
        LEFT JOIN users u_client ON c.client_id = u_client.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        ORDER BY c.date DESC
      `;
      params = [];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching consultations:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { client_id, dependent_id, service_id, value, date } = req.body;
    const professional_id = req.user.id;

    if ((!client_id && !dependent_id) || !service_id || !value || !date) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }

    const result = await pool.query(`
      INSERT INTO consultations (client_id, dependent_id, professional_id, service_id, value, date)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [client_id, dependent_id, professional_id, service_id, value, date]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating consultation:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Dependents routes
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const clientId = req.params.clientId;

    // Verify access
    if (req.user.currentRole === 'client' && req.user.id !== parseInt(clientId)) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }

    const result = await pool.query(
      'SELECT * FROM dependents WHERE client_id = $1 ORDER BY name',
      [clientId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dependents:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/dependents/lookup', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }

    const result = await pool.query(`
      SELECT 
        d.*,
        u.name as client_name,
        u.subscription_status as client_subscription_status
      FROM dependents d
      JOIN users u ON d.client_id = u.id
      WHERE d.cpf = $1
    `, [cpf]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/dependents', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;

    // Verify client can only add dependents to themselves
    if (req.user.currentRole === 'client' && req.user.id !== client_id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }

    if (!client_id || !name || !cpf) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }

    // Check if CPF already exists
    const existingDependent = await pool.query(
      'SELECT id FROM dependents WHERE cpf = $1',
      [cpf]
    );

    if (existingDependent.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado como dependente' });
    }

    const result = await pool.query(`
      INSERT INTO dependents (client_id, name, cpf, birth_date)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [client_id, name, cpf, birth_date]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/dependents/:id', authenticate, authorize(['client']), async (req, res) => {
  try {
    const dependentId = req.params.id;
    const { name, birth_date } = req.body;

    // Verify client owns this dependent
    if (req.user.currentRole === 'client') {
      const ownershipCheck = await pool.query(
        'SELECT id FROM dependents WHERE id = $1 AND client_id = $2',
        [dependentId, req.user.id]
      );

      if (ownershipCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Acesso não autorizado' });
      }
    }

    const result = await pool.query(`
      UPDATE dependents 
      SET name = $1, birth_date = $2
      WHERE id = $3
      RETURNING *
    `, [name, birth_date, dependentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.delete('/api/dependents/:id', authenticate, authorize(['client']), async (req, res) => {
  try {
    const dependentId = req.params.id;

    // Verify client owns this dependent
    if (req.user.currentRole === 'client') {
      const ownershipCheck = await pool.query(
        'SELECT id FROM dependents WHERE id = $1 AND client_id = $2',
        [dependentId, req.user.id]
      );

      if (ownershipCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Acesso não autorizado' });
      }
    }

    const result = await pool.query(
      'DELETE FROM dependents WHERE id = $1 RETURNING id',
      [dependentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    res.json({ message: 'Dependente excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Client lookup route
app.get('/api/clients/lookup', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }

    const result = await pool.query(`
      SELECT id, name, cpf, subscription_status
      FROM users 
      WHERE cpf = $1 AND roles && ARRAY['client']
    `, [cpf]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up client:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Reports routes
app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Revenue by professional
    const professionalRevenueResult = await pool.query(`
      SELECT 
        u.name as professional_name,
        u.percentage as professional_percentage,
        SUM(c.value) as revenue,
        COUNT(c.id) as consultation_count,
        SUM(c.value * u.percentage / 100) as professional_payment,
        SUM(c.value * (100 - u.percentage) / 100) as clinic_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY u.id, u.name, u.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    // Revenue by service
    const serviceRevenueResult = await pool.query(`
      SELECT 
        s.name as service_name,
        SUM(c.value) as revenue,
        COUNT(c.id) as consultation_count
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY s.id, s.name
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    // Total revenue
    const totalRevenueResult = await pool.query(`
      SELECT SUM(value) as total_revenue
      FROM consultations
      WHERE date >= $1 AND date <= $2
    `, [start_date, end_date]);

    res.json({
      total_revenue: totalRevenueResult.rows[0].total_revenue || 0,
      revenue_by_professional: professionalRevenueResult.rows,
      revenue_by_service: serviceRevenueResult.rows
    });
  } catch (error) {
    console.error('Error generating revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/reports/professional-revenue', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const professionalId = req.user.id;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Get professional percentage
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [professionalId]
    );

    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }

    const professionalPercentage = professionalResult.rows[0].percentage || 50;

    // Get consultations summary
    const summaryResult = await pool.query(`
      SELECT 
        COUNT(c.id) as consultation_count,
        SUM(c.value) as total_revenue,
        SUM(c.value * (100 - $3) / 100) as amount_to_pay
      FROM consultations c
      WHERE c.professional_id = $1 AND c.date >= $2 AND c.date <= $4
    `, [professionalId, start_date, professionalPercentage, end_date]);

    // Get individual consultations
    const consultationsResult = await pool.query(`
      SELECT 
        c.date,
        COALESCE(u_client.name, d.name) as client_name,
        s.name as service_name,
        c.value as total_value,
        (c.value * (100 - $3) / 100) as amount_to_pay
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      LEFT JOIN users u_client ON c.client_id = u_client.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE c.professional_id = $1 AND c.date >= $2 AND c.date <= $4
      ORDER BY c.date DESC
    `, [professionalId, start_date, professionalPercentage, end_date]);

    const summary = summaryResult.rows[0];

    res.json({
      summary: {
        professional_percentage: professionalPercentage,
        total_revenue: parseFloat(summary.total_revenue || 0),
        consultation_count: parseInt(summary.consultation_count || 0),
        amount_to_pay: parseFloat(summary.amount_to_pay || 0)
      },
      consultations: consultationsResult.rows.map(row => ({
        ...row,
        total_value: parseFloat(row.total_value),
        amount_to_pay: parseFloat(row.amount_to_pay)
      }))
    });
  } catch (error) {
    console.error('Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔥 EXISTING MERCADO PAGO ROUTES (CONVENIO) - UPDATED TO SDK V2

// Create subscription payment for clients
app.post('/api/create-subscription', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { user_id, dependent_ids } = req.body;
    const userId = req.user.id;

    if (userId !== user_id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }

    // Get user info
    const userResult = await pool.query(
      'SELECT name, email FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = userResult.rows[0];

    // Calculate amount (R$250 for titular + R$50 per dependent)
    const dependentCount = dependent_ids ? dependent_ids.length : 0;
    const amount = 250 + (dependentCount * 50);

    // 🔥 USING MERCADO PAGO SDK V2
    const preference = new Preference(client);

    const items = [
      {
        id: `subscription-titular-${userId}`,
        title: 'Cartão Quiro Ferreira - Titular',
        description: 'Assinatura mensal do cartão de convênio - Titular',
        quantity: 1,
        unit_price: 250,
        currency_id: 'BRL'
      }
    ];

    if (dependentCount > 0) {
      items.push({
        id: `subscription-dependents-${userId}`,
        title: `Cartão Quiro Ferreira - ${dependentCount} Dependente(s)`,
        description: `Assinatura mensal do cartão de convênio - ${dependentCount} dependente(s)`,
        quantity: dependentCount,
        unit_price: 50,
        currency_id: 'BRL'
      });
    }

    const preferenceData = {
      items: items,
      payer: {
        name: user.name,
        email: user.email || `user${userId}@quiroferreira.com.br`
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=pending`
      },
      auto_return: 'approved',
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhook`,
      external_reference: `subscription-${userId}-${Date.now()}`,
      statement_descriptor: 'QUIRO FERREIRA',
      metadata: {
        user_id: userId,
        dependent_count: dependentCount,
        subscription_type: 'monthly'
      }
    };

    const response = await preference.create({ body: preferenceData });

    console.log('✅ Subscription payment preference created:', response.id);

    res.json({
      preference_id: response.id,
      init_point: response.init_point,
      sandbox_init_point: response.sandbox_init_point
    });

  } catch (error) {
    console.error('❌ Error creating subscription payment:', error);
    res.status(500).json({ 
      message: 'Erro ao criar pagamento',
      error: error.message 
    });
  }
});

// Create professional payment
app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { amount } = req.body;
    const professionalId = req.user.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }

    // Get professional info
    const userResult = await pool.query(
      'SELECT name, email FROM users WHERE id = $1',
      [professionalId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }

    const user = userResult.rows[0];

    // 🔥 USING MERCADO PAGO SDK V2
    const preference = new Preference(client);

    const preferenceData = {
      items: [
        {
          id: `professional-payment-${professionalId}`,
          title: 'Repasse ao Convênio Quiro Ferreira',
          description: 'Pagamento de repasse referente às consultas realizadas',
          quantity: 1,
          unit_price: amount,
          currency_id: 'BRL'
        }
      ],
      payer: {
        name: user.name,
        email: user.email || `professional${professionalId}@quiroferreira.com.br`
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=pending`
      },
      auto_return: 'approved',
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/professional/webhook`,
      external_reference: `professional-${professionalId}-${Date.now()}`,
      statement_descriptor: 'QUIRO FERREIRA',
      metadata: {
        professional_id: professionalId,
        payment_type: 'professional_fee'
      }
    };

    const response = await preference.create({ body: preferenceData });

    console.log('✅ Professional payment preference created:', response.id);

    res.json({
      preference_id: response.id,
      init_point: response.init_point,
      sandbox_init_point: response.sandbox_init_point
    });

  } catch (error) {
    console.error('❌ Error creating professional payment:', error);
    res.status(500).json({ 
      message: 'Erro ao criar pagamento',
      error: error.message 
    });
  }
});

// 🔥 CONVENIO WEBHOOK (SDK V2)
app.post('/api/webhook', async (req, res) => {
  try {
    console.log('🔔 Convenio webhook received:', req.body);

    const { type, data } = req.body;

    if (type === 'payment') {
      const paymentId = data.id;

      // 🔥 USING MERCADO PAGO SDK V2
      const payment = new Payment(client);
      const paymentInfo = await payment.get({ id: paymentId });

      console.log('💰 Payment info:', paymentInfo);

      if (paymentInfo.status === 'approved') {
        const externalReference = paymentInfo.external_reference;
        
        if (externalReference && externalReference.startsWith('subscription-')) {
          const userId = externalReference.split('-')[1];

          // Update user subscription
          await pool.query(`
            UPDATE users 
            SET subscription_status = 'active', 
                subscription_expiry = NOW() + INTERVAL '30 days'
            WHERE id = $1
          `, [userId]);

          console.log(`✅ Subscription activated for user ${userId}`);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Convenio webhook error:', error);
    res.status(500).json({ message: 'Erro no webhook' });
  }
});

// Professional webhook
app.post('/api/professional/webhook', async (req, res) => {
  try {
    console.log('🔔 Professional webhook received:', req.body);

    const { type, data } = req.body;

    if (type === 'payment') {
      const paymentId = data.id;

      // 🔥 USING MERCADO PAGO SDK V2
      const payment = new Payment(client);
      const paymentInfo = await payment.get({ id: paymentId });

      console.log('💰 Professional payment info:', paymentInfo);

      if (paymentInfo.status === 'approved') {
        const externalReference = paymentInfo.external_reference;
        
        if (externalReference && externalReference.startsWith('professional-')) {
          const professionalId = externalReference.split('-')[1];
          console.log(`✅ Professional payment processed for ${professionalId}`);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Professional webhook error:', error);
    res.status(500).json({ message: 'Erro no webhook' });
  }
});

// Image upload route
app.post('/api/upload-image', authenticate, async (req, res) => {
  try {
    const upload = createUpload();
    
    upload.single('image')(req, res, async (err) => {
      if (err) {
        console.error('Upload error:', err);
        return res.status(400).json({ message: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'Nenhuma imagem foi enviada' });
      }

      const imageUrl = req.file.path;
      const userId = req.user.id;

      // Update user photo URL
      await pool.query(
        'UPDATE users SET photo_url = $1 WHERE id = $2',
        [imageUrl, userId]
      );

      console.log('✅ Image uploaded successfully:', imageUrl);

      res.json({
        message: 'Imagem enviada com sucesso',
        imageUrl: imageUrl
      });
    });
  } catch (error) {
    console.error('Error in upload route:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    mercadopago_sdk: 'v2'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔥 Mercado Pago SDK v2 configured`);
  console.log(`📅 Agenda system ready`);
});