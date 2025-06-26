import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
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

console.log('🔥 MercadoPago SDK v2 configured');

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://www.cartaoquiroferreira.com.br',
    'https://cartaoquiroferreira.com.br'
  ],
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// 🔥 CREATE ALL TABLES IF NOT EXISTS
const createTables = async () => {
  try {
    console.log('🔄 Creating database tables...');

    // 1. Users table (existing - enhanced)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) UNIQUE NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        birth_date DATE,
        address TEXT,
        address_number VARCHAR(20),
        address_complement VARCHAR(100),
        neighborhood VARCHAR(100),
        city VARCHAR(100),
        state VARCHAR(2),
        password_hash VARCHAR(255),
        roles TEXT[] DEFAULT '{}',
        percentage INTEGER DEFAULT 50,
        category_id INTEGER,
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_expiry TIMESTAMP,
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Service Categories table (existing)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Services table (existing)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        base_price DECIMAL(10,2) NOT NULL,
        category_id INTEGER REFERENCES service_categories(id),
        is_base_service BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. Dependents table (existing)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dependents (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) UNIQUE NOT NULL,
        birth_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. Consultations table (existing - enhanced)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id),
        dependent_id INTEGER REFERENCES dependents(id),
        professional_id INTEGER REFERENCES users(id) NOT NULL,
        service_id INTEGER REFERENCES services(id),
        value DECIMAL(10,2) NOT NULL,
        date TIMESTAMP NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🔥 NEW TABLES FOR AGENDA SYSTEM

    // 6. Professional Patients (linking table)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_patients (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        notes TEXT,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(professional_id, patient_id)
      )
    `);

    // 7. Schedule Configuration
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_configs (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 8. Appointments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        medical_record TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 9. Blocked Times
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_times (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        reason VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🔥 AGENDA PAYMENTS (separate from convenio payments)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_payments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL DEFAULT 49.90,
        status VARCHAR(20) DEFAULT 'pending',
        payment_id VARCHAR(255),
        preference_id VARCHAR(255),
        payment_method VARCHAR(50),
        payment_date TIMESTAMP,
        period_start DATE,
        period_end DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 10. Agenda Subscriptions Status
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        status VARCHAR(20) DEFAULT 'inactive',
        expires_at TIMESTAMP,
        last_payment_id INTEGER REFERENCES agenda_payments(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_cpf ON users(cpf);
      CREATE INDEX IF NOT EXISTS idx_users_roles ON users USING GIN(roles);
      CREATE INDEX IF NOT EXISTS idx_consultations_professional ON consultations(professional_id);
      CREATE INDEX IF NOT EXISTS idx_consultations_date ON consultations(date);
      CREATE INDEX IF NOT EXISTS idx_appointments_professional ON appointments(professional_id);
      CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
      CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
      CREATE INDEX IF NOT EXISTS idx_agenda_payments_professional ON agenda_payments(professional_id);
      CREATE INDEX IF NOT EXISTS idx_agenda_subscriptions_professional ON agenda_subscriptions(professional_id);
    `);

    console.log('✅ All database tables created successfully');

    // Insert default service categories if they don't exist
    const categoriesResult = await pool.query('SELECT COUNT(*) FROM service_categories');
    if (parseInt(categoriesResult.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO service_categories (name, description) VALUES
        ('Fisioterapia', 'Serviços de fisioterapia e reabilitação'),
        ('Psicologia', 'Atendimento psicológico e terapias'),
        ('Nutrição', 'Consultas nutricionais e acompanhamento'),
        ('Odontologia', 'Serviços odontológicos'),
        ('Medicina', 'Consultas médicas gerais e especializadas')
      `);
      console.log('✅ Default service categories inserted');
    }

    // Insert default services if they don't exist
    const servicesResult = await pool.query('SELECT COUNT(*) FROM services');
    if (parseInt(servicesResult.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO services (name, description, base_price, category_id, is_base_service) VALUES
        ('Consulta Fisioterapia', 'Consulta inicial de fisioterapia', 80.00, 1, true),
        ('Sessão Fisioterapia', 'Sessão de fisioterapia', 60.00, 1, false),
        ('Consulta Psicológica', 'Consulta psicológica individual', 120.00, 2, true),
        ('Consulta Nutricional', 'Consulta com nutricionista', 100.00, 3, true),
        ('Consulta Odontológica', 'Consulta odontológica', 90.00, 4, true),
        ('Consulta Médica', 'Consulta médica geral', 150.00, 5, true)
      `);
      console.log('✅ Default services inserted');
    }

  } catch (error) {
    console.error('❌ Error creating tables:', error);
    throw error;
  }
};

// Initialize database
createTables();

// 🔥 AGENDA ROUTES

// Get subscription status
app.get('/api/agenda/subscription-status', authenticate, async (req, res) => {
  try {
    const professionalId = req.user.id;

    // Check if user has professional role
    if (!req.user.roles.includes('professional')) {
      return res.status(403).json({ message: 'Acesso negado - apenas profissionais' });
    }

    // Get or create subscription record
    let subscription = await pool.query(
      'SELECT * FROM agenda_subscriptions WHERE professional_id = $1',
      [professionalId]
    );

    if (subscription.rows.length === 0) {
      // Create initial subscription record
      await pool.query(
        'INSERT INTO agenda_subscriptions (professional_id, status) VALUES ($1, $2)',
        [professionalId, 'inactive']
      );
      
      subscription = await pool.query(
        'SELECT * FROM agenda_subscriptions WHERE professional_id = $1',
        [professionalId]
      );
    }

    const sub = subscription.rows[0];
    const now = new Date();
    const expiresAt = sub.expires_at ? new Date(sub.expires_at) : null;
    
    let status = sub.status;
    let canUseAgenda = false;
    let daysRemaining = 0;

    if (expiresAt && expiresAt > now) {
      status = 'active';
      canUseAgenda = true;
      daysRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    } else if (expiresAt && expiresAt <= now) {
      status = 'expired';
      // Update status in database
      await pool.query(
        'UPDATE agenda_subscriptions SET status = $1 WHERE professional_id = $2',
        ['expired', professionalId]
      );
    }

    // Get last payment info
    const lastPayment = await pool.query(
      'SELECT * FROM agenda_payments WHERE professional_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
      [professionalId, 'paid']
    );

    res.json({
      status,
      expires_at: sub.expires_at,
      days_remaining: daysRemaining,
      can_use_agenda: canUseAgenda,
      last_payment: lastPayment.rows[0]?.payment_date || null
    });

  } catch (error) {
    console.error('Error getting subscription status:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Create agenda subscription payment
app.post('/api/agenda/create-subscription-payment', authenticate, async (req, res) => {
  try {
    const professionalId = req.user.id;

    // Check if user has professional role
    if (!req.user.roles.includes('professional')) {
      return res.status(403).json({ message: 'Acesso negado - apenas profissionais' });
    }

    console.log('🔄 Creating agenda subscription payment for professional:', professionalId);

    // Create payment record
    const paymentResult = await pool.query(
      `INSERT INTO agenda_payments (professional_id, amount, status) 
       VALUES ($1, $2, $3) RETURNING id`,
      [professionalId, 49.90, 'pending']
    );

    const paymentId = paymentResult.rows[0].id;

    // Create MercadoPago preference using SDK v2
    const preference = new Preference(client);
    
    const preferenceData = {
      items: [
        {
          title: 'Assinatura Agenda Profissional - Quiro Ferreira',
          description: 'Acesso completo à agenda profissional por 30 dias',
          quantity: 1,
          unit_price: 49.90,
          currency_id: 'BRL'
        }
      ],
      payer: {
        name: req.user.name,
        email: req.user.email || 'contato@quiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=pending`
      },
      auto_return: 'approved',
      external_reference: `agenda_${paymentId}`,
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/agenda/webhook`
    };

    console.log('🔄 Creating preference with data:', preferenceData);

    const response = await preference.create({ body: preferenceData });
    
    console.log('✅ Preference created:', response);

    // Update payment record with preference ID
    await pool.query(
      'UPDATE agenda_payments SET preference_id = $1 WHERE id = $2',
      [response.id, paymentId]
    );

    res.json({
      id: response.id,
      init_point: response.init_point,
      sandbox_init_point: response.sandbox_init_point
    });

  } catch (error) {
    console.error('❌ Error creating agenda payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento da agenda' });
  }
});

// Agenda payment webhook
app.post('/api/agenda/webhook', async (req, res) => {
  try {
    console.log('🔔 Agenda webhook received:', req.body);

    const { type, data } = req.body;

    if (type === 'payment') {
      const paymentId = data.id;
      
      // Get payment info from MercadoPago using SDK v2
      const payment = new Payment(client);
      const paymentInfo = await payment.get({ id: paymentId });
      
      console.log('💰 Payment info:', paymentInfo);

      if (paymentInfo.status === 'approved') {
        const externalReference = paymentInfo.external_reference;
        
        if (externalReference && externalReference.startsWith('agenda_')) {
          const agendaPaymentId = externalReference.replace('agenda_', '');
          
          // Update payment status
          const updateResult = await pool.query(
            `UPDATE agenda_payments 
             SET status = $1, payment_id = $2, payment_method = $3, payment_date = $4,
                 period_start = CURRENT_DATE, period_end = CURRENT_DATE + INTERVAL '30 days'
             WHERE id = $5 RETURNING professional_id`,
            ['paid', paymentId, paymentInfo.payment_method_id, new Date(), agendaPaymentId]
          );

          if (updateResult.rows.length > 0) {
            const professionalId = updateResult.rows[0].professional_id;
            
            // Update or create subscription
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 30);
            
            await pool.query(
              `INSERT INTO agenda_subscriptions (professional_id, status, expires_at, last_payment_id)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (professional_id) 
               DO UPDATE SET status = $2, expires_at = $3, last_payment_id = $4, updated_at = CURRENT_TIMESTAMP`,
              ['active', expiresAt, agendaPaymentId, professionalId]
            );

            console.log('✅ Agenda subscription activated for professional:', professionalId);
          }
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error processing agenda webhook:', error);
    res.status(500).send('Error');
  }
});

// Get schedule configuration
app.get('/api/agenda/schedule-config', authenticate, async (req, res) => {
  try {
    const professionalId = req.user.id;

    // Check subscription
    const subscription = await pool.query(
      'SELECT * FROM agenda_subscriptions WHERE professional_id = $1 AND status = $2 AND expires_at > CURRENT_TIMESTAMP',
      [professionalId, 'active']
    );

    if (subscription.rows.length === 0) {
      return res.status(403).json({ message: 'Assinatura da agenda necessária' });
    }

    const config = await pool.query(
      'SELECT * FROM schedule_configs WHERE professional_id = $1',
      [professionalId]
    );

    if (config.rows.length === 0) {
      // Create default config
      const defaultConfig = await pool.query(
        `INSERT INTO schedule_configs (professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
         wednesday_start, wednesday_end, thursday_start, thursday_end, friday_start, friday_end)
         VALUES ($1, '08:00', '18:00', '08:00', '18:00', '08:00', '18:00', '08:00', '18:00', '08:00', '18:00')
         RETURNING *`,
        [professionalId]
      );
      return res.json(defaultConfig.rows[0]);
    }

    res.json(config.rows[0]);
  } catch (error) {
    console.error('Error getting schedule config:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Update schedule configuration
app.put('/api/agenda/schedule-config', authenticate, async (req, res) => {
  try {
    const professionalId = req.user.id;
    const config = req.body;

    // Check subscription
    const subscription = await pool.query(
      'SELECT * FROM agenda_subscriptions WHERE professional_id = $1 AND status = $2 AND expires_at > CURRENT_TIMESTAMP',
      [professionalId, 'active']
    );

    if (subscription.rows.length === 0) {
      return res.status(403).json({ message: 'Assinatura da agenda necessária' });
    }

    const result = await pool.query(
      `INSERT INTO schedule_configs (professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
       wednesday_start, wednesday_end, thursday_start, thursday_end, friday_start, friday_end,
       saturday_start, saturday_end, sunday_start, sunday_end, slot_duration, break_start, break_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (professional_id) 
       DO UPDATE SET 
         monday_start = $2, monday_end = $3, tuesday_start = $4, tuesday_end = $5,
         wednesday_start = $6, wednesday_end = $7, thursday_start = $8, thursday_end = $9,
         friday_start = $10, friday_end = $11, saturday_start = $12, saturday_end = $13,
         sunday_start = $14, sunday_end = $15, slot_duration = $16, break_start = $17, break_end = $18,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        professionalId, config.monday_start, config.monday_end, config.tuesday_start, config.tuesday_end,
        config.wednesday_start, config.wednesday_end, config.thursday_start, config.thursday_end,
        config.friday_start, config.friday_end, config.saturday_start, config.saturday_end,
        config.sunday_start, config.sunday_end, config.slot_duration || 30, config.break_start, config.break_end
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating schedule config:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get professional's patients
app.get('/api/agenda/patients', authenticate, async (req, res) => {
  try {
    const professionalId = req.user.id;

    // Check subscription
    const subscription = await pool.query(
      'SELECT * FROM agenda_subscriptions WHERE professional_id = $1 AND status = $2 AND expires_at > CURRENT_TIMESTAMP',
      [professionalId, 'active']
    );

    if (subscription.rows.length === 0) {
      return res.status(403).json({ message: 'Assinatura da agenda necessária' });
    }

    // Get linked patients (both convenio and particular)
    const patients = await pool.query(
      `SELECT u.*, pp.notes, pp.linked_at,
              CASE WHEN 'client' = ANY(u.roles) THEN true ELSE false END as is_convenio_patient
       FROM users u
       INNER JOIN professional_patients pp ON u.id = pp.patient_id
       WHERE pp.professional_id = $1
       ORDER BY u.name`,
      [professionalId]
    );

    res.json(patients.rows);
  } catch (error) {
    console.error('Error getting patients:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Add new patient
app.post('/api/agenda/patients', authenticate, async (req, res) => {
  try {
    const professionalId = req.user.id;
    const { name, cpf, email, phone, birth_date, address, address_number, address_complement, neighborhood, city, state, notes } = req.body;

    // Check subscription
    const subscription = await pool.query(
      'SELECT * FROM agenda_subscriptions WHERE professional_id = $1 AND status = $2 AND expires_at > CURRENT_TIMESTAMP',
      [professionalId, 'active']
    );

    if (subscription.rows.length === 0) {
      return res.status(403).json({ message: 'Assinatura da agenda necessária' });
    }

    // Validate required fields
    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }

    // Clean CPF
    const cleanCpf = cpf.replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      return res.status(400).json({ message: 'CPF deve ter 11 dígitos' });
    }

    // Check if patient already exists
    let patient = await pool.query('SELECT * FROM users WHERE cpf = $1', [cleanCpf]);

    let patientId;
    if (patient.rows.length > 0) {
      // Patient exists, check if already linked
      patientId = patient.rows[0].id;
      
      const existingLink = await pool.query(
        'SELECT * FROM professional_patients WHERE professional_id = $1 AND patient_id = $2',
        [professionalId, patientId]
      );

      if (existingLink.rows.length > 0) {
        return res.status(400).json({ message: 'Paciente já está vinculado a você' });
      }
    } else {
      // Create new patient (particular - no password, no roles)
      const newPatient = await pool.query(
        `INSERT INTO users (name, cpf, email, phone, birth_date, address, address_number, 
         address_complement, neighborhood, city, state, roles)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [name, cleanCpf, email, phone, birth_date, address, address_number, 
         address_complement, neighborhood, city, state, []]
      );
      
      patientId = newPatient.rows[0].id;
    }

    // Link patient to professional
    await pool.query(
      'INSERT INTO professional_patients (professional_id, patient_id, notes) VALUES ($1, $2, $3)',
      [professionalId, patientId, notes]
    );

    // Return the linked patient data
    const linkedPatient = await pool.query(
      `SELECT u.*, pp.notes, pp.linked_at,
              CASE WHEN 'client' = ANY(u.roles) THEN true ELSE false END as is_convenio_patient
       FROM users u
       INNER JOIN professional_patients pp ON u.id = pp.patient_id
       WHERE pp.professional_id = $1 AND u.id = $2`,
      [professionalId, patientId]
    );

    res.status(201).json(linkedPatient.rows[0]);
  } catch (error) {
    console.error('Error adding patient:', error);
    if (error.code === '23505') {
      res.status(400).json({ message: 'CPF já cadastrado no sistema' });
    } else {
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
});

// Update patient notes
app.put('/api/agenda/patients/:id', authenticate, async (req, res) => {
  try {
    const professionalId = req.user.id;
    const patientId = req.params.id;
    const { notes } = req.body;

    // Check subscription
    const subscription = await pool.query(
      'SELECT * FROM agenda_subscriptions WHERE professional_id = $1 AND status = $2 AND expires_at > CURRENT_TIMESTAMP',
      [professionalId, 'active']
    );

    if (subscription.rows.length === 0) {
      return res.status(403).json({ message: 'Assinatura da agenda necessária' });
    }

    // Update notes
    await pool.query(
      'UPDATE professional_patients SET notes = $1 WHERE professional_id = $2 AND patient_id = $3',
      [notes, professionalId, patientId]
    );

    res.json({ message: 'Observações atualizadas com sucesso' });
  } catch (error) {
    console.error('Error updating patient notes:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get appointments
app.get('/api/agenda/appointments', authenticate, async (req, res) => {
  try {
    const professionalId = req.user.id;
    const { start_date, end_date } = req.query;

    // Check subscription
    const subscription = await pool.query(
      'SELECT * FROM agenda_subscriptions WHERE professional_id = $1 AND status = $2 AND expires_at > CURRENT_TIMESTAMP',
      [professionalId, 'active']
    );

    if (subscription.rows.length === 0) {
      return res.status(403).json({ message: 'Assinatura da agenda necessária' });
    }

    let query = `
      SELECT a.*, u.name as patient_name, u.phone as patient_phone,
             CASE WHEN 'client' = ANY(u.roles) THEN true ELSE false END as is_convenio_patient
      FROM appointments a
      INNER JOIN users u ON a.patient_id = u.id
      WHERE a.professional_id = $1
    `;
    
    const params = [professionalId];

    if (start_date && end_date) {
      query += ' AND a.date >= $2 AND a.date <= $3';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY a.date';

    const appointments = await pool.query(query, params);
    res.json(appointments.rows);
  } catch (error) {
    console.error('Error getting appointments:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Create appointment
app.post('/api/agenda/appointments', authenticate, async (req, res) => {
  try {
    const professionalId = req.user.id;
    const { patient_id, date, notes } = req.body;

    // Check subscription
    const subscription = await pool.query(
      'SELECT * FROM agenda_subscriptions WHERE professional_id = $1 AND status = $2 AND expires_at > CURRENT_TIMESTAMP',
      [professionalId, 'active']
    );

    if (subscription.rows.length === 0) {
      return res.status(403).json({ message: 'Assinatura da agenda necessária' });
    }

    // Validate required fields
    if (!patient_id || !date) {
      return res.status(400).json({ message: 'Paciente e data são obrigatórios' });
    }

    // Check if patient is linked to professional
    const patientLink = await pool.query(
      'SELECT * FROM professional_patients WHERE professional_id = $1 AND patient_id = $2',
      [professionalId, patient_id]
    );

    if (patientLink.rows.length === 0) {
      return res.status(400).json({ message: 'Paciente não está vinculado a você' });
    }

    // Check for conflicts
    const conflictCheck = await pool.query(
      'SELECT * FROM appointments WHERE professional_id = $1 AND date = $2 AND status != $3',
      [professionalId, date, 'cancelled']
    );

    if (conflictCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Já existe um agendamento neste horário' });
    }

    // Create appointment
    const appointment = await pool.query(
      'INSERT INTO appointments (professional_id, patient_id, date, notes) VALUES ($1, $2, $3, $4) RETURNING *',
      [professionalId, patient_id, date, notes]
    );

    res.status(201).json(appointment.rows[0]);
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Update appointment status
app.put('/api/agenda/appointments/:id', authenticate, async (req, res) => {
  try {
    const professionalId = req.user.id;
    const appointmentId = req.params.id;
    const { status, notes, medical_record } = req.body;

    // Check subscription
    const subscription = await pool.query(
      'SELECT * FROM agenda_subscriptions WHERE professional_id = $1 AND status = $2 AND expires_at > CURRENT_TIMESTAMP',
      [professionalId, 'active']
    );

    if (subscription.rows.length === 0) {
      return res.status(403).json({ message: 'Assinatura da agenda necessária' });
    }

    // Update appointment
    const appointment = await pool.query(
      `UPDATE appointments 
       SET status = COALESCE($1, status), notes = COALESCE($2, notes), 
           medical_record = COALESCE($3, medical_record), updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND professional_id = $5 RETURNING *`,
      [status, notes, medical_record, appointmentId, professionalId]
    );

    if (appointment.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    res.json(appointment.rows[0]);
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔥 EXISTING ROUTES (keeping all existing functionality)

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, password
    } = req.body;

    if (!name || !cpf || !password) {
      return res.status(400).json({ message: 'Nome, CPF e senha são obrigatórios' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      return res.status(400).json({ message: 'CPF deve ter 11 dígitos' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cleanCpf]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, cpf, email, phone, birth_date, address, address_number, 
       address_complement, neighborhood, city, state, password_hash, roles, subscription_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id, name, cpf, roles`,
      [name, cleanCpf, email, phone, birth_date, address, address_number,
       address_complement, neighborhood, city, state, hashedPassword, ['client'], 'pending']
    );

    const user = result.rows[0];

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      user: { id: user.id, name: user.name, cpf: user.cpf, roles: user.roles }
    });
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

    const cleanCpf = cpf.replace(/\D/g, '');
    const result = await pool.query('SELECT * FROM users WHERE cpf = $1', [cleanCpf]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      return res.status(401).json({ message: 'Usuário não possui senha cadastrada' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    const userData = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: user.roles || []
    };

    const needsRoleSelection = userData.roles.length > 1;

    res.json({
      message: 'Login realizado com sucesso',
      user: userData,
      needsRoleSelection
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/select-role', async (req, res) => {
  try {
    const { userId, role } = req.body;

    if (!userId || !role) {
      return res.status(400).json({ message: 'ID do usuário e role são obrigatórios' });
    }

    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];

    if (!user.roles || !user.roles.includes(role)) {
      return res.status(400).json({ message: 'Role não autorizada para este usuário' });
    }

    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    const userData = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: user.roles,
      currentRole: role
    };

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({
      message: 'Role selecionada com sucesso',
      token,
      user: userData
    });
  } catch (error) {
    console.error('Role selection error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/switch-role', authenticate, async (req, res) => {
  try {
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ message: 'Role é obrigatória' });
    }

    if (!req.user.roles || !req.user.roles.includes(role)) {
      return res.status(400).json({ message: 'Role não autorizada para este usuário' });
    }

    const token = jwt.sign(
      { id: req.user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    const userData = {
      id: req.user.id,
      name: req.user.name,
      cpf: req.user.cpf,
      roles: req.user.roles,
      currentRole: role
    };

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({
      message: 'Role alterada com sucesso',
      token,
      user: userData
    });
  } catch (error) {
    console.error('Role switch error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout realizado com sucesso' });
});

// User routes
app.get('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, cpf, email, phone, birth_date, address, address_number, 
             address_complement, neighborhood, city, state, roles, percentage, 
             category_id, subscription_status, subscription_expiry, created_at
      FROM users 
      ORDER BY name
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
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const result = await pool.query(`
      SELECT id, name, cpf, email, phone, birth_date, address, address_number, 
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
      return res.status(400).json({ message: 'Campos obrigatórios: nome, CPF, senha e pelo menos uma role' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      return res.status(400).json({ message: 'CPF deve ter 11 dígitos' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cleanCpf]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, cpf, email, phone, birth_date, address, address_number, 
       address_complement, neighborhood, city, state, password_hash, roles, percentage, category_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [name, cleanCpf, email, phone, birth_date, address, address_number,
       address_complement, neighborhood, city, state, hashedPassword, roles, percentage, category_id]
    );

    const user = result.rows[0];
    delete user.password_hash;

    res.status(201).json(user);
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
      address_complement, neighborhood, city, state, roles, percentage, category_id
    } = req.body;

    if (!name || !roles || roles.length === 0) {
      return res.status(400).json({ message: 'Nome e pelo menos uma role são obrigatórios' });
    }

    const result = await pool.query(
      `UPDATE users SET 
       name = $1, email = $2, phone = $3, birth_date = $4, address = $5, 
       address_number = $6, address_complement = $7, neighborhood = $8, 
       city = $9, state = $10, roles = $11, percentage = $12, category_id = $13,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $14 RETURNING *`,
      [name, email, phone, birth_date, address, address_number,
       address_complement, neighborhood, city, state, roles, percentage, category_id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];
    delete user.password_hash;

    res.json(user);
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

    const result = await pool.query(
      `UPDATE users SET 
       subscription_status = 'active', 
       subscription_expiry = $1,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [expiry_date, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json({ message: 'Cliente ativado com sucesso' });
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
      return res.status(400).json({ message: 'Nome é obrigatório' });
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

    if (!name || !base_price) {
      return res.status(400).json({ message: 'Nome e preço base são obrigatórios' });
    }

    const result = await pool.query(
      'INSERT INTO services (name, description, base_price, category_id, is_base_service) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, description, base_price, category_id, is_base_service || false]
    );

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

    if (!name || !base_price) {
      return res.status(400).json({ message: 'Nome e preço base são obrigatórios' });
    }

    const result = await pool.query(
      'UPDATE services SET name = $1, description = $2, base_price = $3, category_id = $4, is_base_service = $5 WHERE id = $6 RETURNING *',
      [name, description, base_price, category_id, is_base_service || false, serviceId]
    );

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

// Professionals routes
app.get('/api/professionals', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.phone, u.roles, u.address, u.address_number, 
             u.address_complement, u.neighborhood, u.city, u.state, u.photo_url,
             sc.name as category_name
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE 'professional' = ANY(u.roles)
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
    let query = `
      SELECT c.*, u.name as professional_name, s.name as service_name,
             COALESCE(d.name, client.name) as client_name,
             CASE WHEN c.dependent_id IS NOT NULL THEN true ELSE false END as is_dependent
      FROM consultations c
      INNER JOIN users u ON c.professional_id = u.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users client ON c.client_id = client.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
    `;

    const params = [];

    if (req.user.currentRole === 'client') {
      query += ' WHERE c.client_id = $1 OR c.dependent_id IN (SELECT id FROM dependents WHERE client_id = $1)';
      params.push(req.user.id);
    } else if (req.user.currentRole === 'professional') {
      query += ' WHERE c.professional_id = $1';
      params.push(req.user.id);
    }

    query += ' ORDER BY c.date DESC';

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
      return res.status(400).json({ message: 'Todos os campos são obrigatórios' });
    }

    const result = await pool.query(
      'INSERT INTO consultations (client_id, dependent_id, professional_id, service_id, value, date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [client_id, dependent_id, professional_id, service_id, value, date]
    );

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

    if (req.user.currentRole !== 'admin' && req.user.id !== parseInt(clientId)) {
      return res.status(403).json({ message: 'Acesso negado' });
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

    const cleanCpf = cpf.replace(/\D/g, '');

    const result = await pool.query(`
      SELECT d.*, u.name as client_name, u.subscription_status as client_subscription_status
      FROM dependents d
      INNER JOIN users u ON d.client_id = u.id
      WHERE d.cpf = $1
    `, [cleanCpf]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/dependents', authenticate, async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;

    if (req.user.currentRole !== 'admin' && req.user.id !== client_id) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    if (!client_id || !name || !cpf) {
      return res.status(400).json({ message: 'ID do cliente, nome e CPF são obrigatórios' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      return res.status(400).json({ message: 'CPF deve ter 11 dígitos' });
    }

    const existingDependent = await pool.query('SELECT id FROM dependents WHERE cpf = $1', [cleanCpf]);
    if (existingDependent.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado como dependente' });
    }

    const result = await pool.query(
      'INSERT INTO dependents (client_id, name, cpf, birth_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [client_id, name, cleanCpf, birth_date]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const dependentId = req.params.id;
    const { name, birth_date } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Nome é obrigatório' });
    }

    const dependent = await pool.query('SELECT client_id FROM dependents WHERE id = $1', [dependentId]);
    if (dependent.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    if (req.user.currentRole !== 'admin' && req.user.id !== dependent.rows[0].client_id) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const result = await pool.query(
      'UPDATE dependents SET name = $1, birth_date = $2 WHERE id = $3 RETURNING *',
      [name, birth_date, dependentId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.delete('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const dependentId = req.params.id;

    const dependent = await pool.query('SELECT client_id FROM dependents WHERE id = $1', [dependentId]);
    if (dependent.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    if (req.user.currentRole !== 'admin' && req.user.id !== dependent.rows[0].client_id) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    await pool.query('DELETE FROM dependents WHERE id = $1', [dependentId]);

    res.json({ message: 'Dependente excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Client lookup routes
app.get('/api/clients/lookup', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    const result = await pool.query(`
      SELECT id, name, cpf, subscription_status
      FROM users 
      WHERE cpf = $1 AND 'client' = ANY(roles)
    `, [cleanCpf]);

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
      return res.status(400).json({ message: 'Data inicial e final são obrigatórias' });
    }

    const revenueByProfessional = await pool.query(`
      SELECT 
        u.name as professional_name,
        u.percentage as professional_percentage,
        SUM(c.value) as revenue,
        COUNT(c.id) as consultation_count,
        SUM(c.value * u.percentage / 100) as professional_payment,
        SUM(c.value * (100 - u.percentage) / 100) as clinic_revenue
      FROM consultations c
      INNER JOIN users u ON c.professional_id = u.id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY u.id, u.name, u.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    const revenueByService = await pool.query(`
      SELECT 
        s.name as service_name,
        SUM(c.value) as revenue,
        COUNT(c.id) as consultation_count
      FROM consultations c
      INNER JOIN services s ON c.service_id = s.id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY s.id, s.name
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    const totalRevenue = await pool.query(`
      SELECT SUM(value) as total_revenue
      FROM consultations
      WHERE date >= $1 AND date <= $2
    `, [start_date, end_date]);

    res.json({
      total_revenue: parseFloat(totalRevenue.rows[0].total_revenue || 0),
      revenue_by_professional: revenueByProfessional.rows.map(row => ({
        ...row,
        revenue: parseFloat(row.revenue),
        professional_payment: parseFloat(row.professional_payment),
        clinic_revenue: parseFloat(row.clinic_revenue)
      })),
      revenue_by_service: revenueByService.rows.map(row => ({
        ...row,
        revenue: parseFloat(row.revenue)
      }))
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
      return res.status(400).json({ message: 'Data inicial e final são obrigatórias' });
    }

    const summary = await pool.query(`
      SELECT 
        u.percentage as professional_percentage,
        SUM(c.value) as total_revenue,
        COUNT(c.id) as consultation_count,
        SUM(c.value * (100 - u.percentage) / 100) as amount_to_pay
      FROM consultations c
      INNER JOIN users u ON c.professional_id = u.id
      WHERE c.professional_id = $1 AND c.date >= $2 AND c.date <= $3
      GROUP BY u.percentage
    `, [professionalId, start_date, end_date]);

    const consultations = await pool.query(`
      SELECT 
        c.date,
        COALESCE(d.name, client.name) as client_name,
        s.name as service_name,
        c.value as total_value,
        c.value * (100 - u.percentage) / 100 as amount_to_pay
      FROM consultations c
      INNER JOIN users u ON c.professional_id = u.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users client ON c.client_id = client.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE c.professional_id = $1 AND c.date >= $2 AND c.date <= $3
      ORDER BY c.date DESC
    `, [professionalId, start_date, end_date]);

    const summaryData = summary.rows[0] || {
      professional_percentage: 50,
      total_revenue: 0,
      consultation_count: 0,
      amount_to_pay: 0
    };

    res.json({
      summary: {
        professional_percentage: parseInt(summaryData.professional_percentage),
        total_revenue: parseFloat(summaryData.total_revenue),
        consultation_count: parseInt(summaryData.consultation_count),
        amount_to_pay: parseFloat(summaryData.amount_to_pay)
      },
      consultations: consultations.rows.map(row => ({
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

      // Update user's photo_url
      await pool.query(
        'UPDATE users SET photo_url = $1 WHERE id = $2',
        [imageUrl, req.user.id]
      );

      res.json({
        message: 'Imagem enviada com sucesso',
        imageUrl: imageUrl
      });
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔥 EXISTING PAYMENT ROUTES (keeping all existing functionality)

// Create subscription payment (for clients)
app.post('/api/create-subscription', authenticate, async (req, res) => {
  try {
    const { user_id, dependent_ids } = req.body;
    
    if (req.user.currentRole !== 'client' && req.user.id !== user_id) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const dependentCount = dependent_ids ? dependent_ids.length : 0;
    const totalAmount = 250 + (dependentCount * 50);

    const preference = new Preference(client);
    
    const preferenceData = {
      items: [
        {
          title: 'Assinatura Cartão Quiro Ferreira',
          description: `Assinatura mensal - Titular + ${dependentCount} dependente(s)`,
          quantity: 1,
          unit_price: totalAmount,
          currency_id: 'BRL'
        }
      ],
      payer: {
        name: req.user.name,
        email: req.user.email || 'contato@quiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=pending`
      },
      auto_return: 'approved',
      external_reference: `subscription_${user_id}`,
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhook`
    };

    const response = await preference.create({ body: preferenceData });

    res.json({
      id: response.id,
      init_point: response.init_point,
      sandbox_init_point: response.sandbox_init_point
    });

  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ message: 'Erro ao criar assinatura' });
  }
});

// Create professional payment
app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }

    const preference = new Preference(client);
    
    const preferenceData = {
      items: [
        {
          title: 'Repasse ao Convênio Quiro Ferreira',
          description: 'Pagamento de repasse mensal ao convênio',
          quantity: 1,
          unit_price: amount,
          currency_id: 'BRL'
        }
      ],
      payer: {
        name: req.user.name,
        email: req.user.email || 'contato@quiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=pending`
      },
      auto_return: 'approved',
      external_reference: `professional_${req.user.id}_${Date.now()}`,
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/professional/webhook`
    };

    const response = await preference.create({ body: preferenceData });

    res.json({
      id: response.id,
      init_point: response.init_point,
      sandbox_init_point: response.sandbox_init_point
    });

  } catch (error) {
    console.error('Error creating professional payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

// Webhook for client subscriptions
app.post('/api/webhook', async (req, res) => {
  try {
    console.log('Webhook received:', req.body);

    const { type, data } = req.body;

    if (type === 'payment') {
      const paymentId = data.id;
      
      const payment = new Payment(client);
      const paymentInfo = await payment.get({ id: paymentId });
      
      console.log('Payment info:', paymentInfo);

      if (paymentInfo.status === 'approved') {
        const externalReference = paymentInfo.external_reference;
        
        if (externalReference && externalReference.startsWith('subscription_')) {
          const userId = externalReference.replace('subscription_', '');
          
          const expiryDate = new Date();
          expiryDate.setMonth(expiryDate.getMonth() + 1);
          
          await pool.query(
            'UPDATE users SET subscription_status = $1, subscription_expiry = $2 WHERE id = $3',
            ['active', expiryDate, userId]
          );

          console.log('Subscription activated for user:', userId);
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Error');
  }
});

// Webhook for professional payments
app.post('/api/professional/webhook', async (req, res) => {
  try {
    console.log('Professional webhook received:', req.body);

    const { type, data } = req.body;

    if (type === 'payment') {
      const paymentId = data.id;
      
      const payment = new Payment(client);
      const paymentInfo = await payment.get({ id: paymentId });
      
      console.log('Professional payment info:', paymentInfo);

      if (paymentInfo.status === 'approved') {
        console.log('Professional payment approved:', paymentInfo.external_reference);
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing professional webhook:', error);
    res.status(500).send('Error');
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔥 MercadoPago SDK v2 ready`);
  console.log(`📅 Agenda system enabled`);
});