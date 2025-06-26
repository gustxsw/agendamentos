import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { authenticate, authorize } from './middleware/auth.js';
import createUpload from './middleware/upload.js';
import mercadopago from 'mercadopago';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configure MercadoPago
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://www.cartaoquiroferreira.com.br', 'https://cartaoquiroferreira.com.br']
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// 🔥 CREATE ALL AGENDA TABLES ON STARTUP
const createAgendaTables = async () => {
  try {
    console.log('🔄 Creating agenda system tables...');

    // Professional schedule configuration
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
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(professional_id)
      )
    `);

    // Link patients to professionals (many-to-many)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_patients (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(professional_id, patient_id)
      )
    `);

    // Appointments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date TIMESTAMPTZ NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled')),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Blocked time slots
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_times (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date TIMESTAMPTZ NOT NULL,
        reason VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Medical records/prontuários
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        diagnosis TEXT,
        treatment TEXT,
        observations TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(appointment_id)
      )
    `);

    // Agenda subscriptions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired')),
        expires_at TIMESTAMPTZ NOT NULL,
        payment_id INTEGER,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Agenda payments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_payments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        subscription_id INTEGER REFERENCES agenda_subscriptions(id),
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
        mp_preference_id VARCHAR(255),
        mp_payment_id VARCHAR(255),
        external_reference VARCHAR(255),
        payment_data JSONB,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_appointments_professional_date ON appointments(professional_id, date);
      CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
      CREATE INDEX IF NOT EXISTS idx_blocked_times_professional_date ON blocked_times(professional_id, date);
      CREATE INDEX IF NOT EXISTS idx_professional_patients_professional ON professional_patients(professional_id);
      CREATE INDEX IF NOT EXISTS idx_professional_patients_patient ON professional_patients(patient_id);
      CREATE INDEX IF NOT EXISTS idx_agenda_subscriptions_professional ON agenda_subscriptions(professional_id);
      CREATE INDEX IF NOT EXISTS idx_agenda_payments_professional ON agenda_payments(professional_id);
    `);

    console.log('✅ Agenda system tables created successfully');
  } catch (error) {
    console.error('❌ Error creating agenda tables:', error);
  }
};

// Initialize database tables
createAgendaTables();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Auth routes
app.post('/api/auth/login', async (req, res) => {
  try {
    const { cpf, password } = req.body;

    const result = await pool.query(
      'SELECT id, name, cpf, roles, password FROM users WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    const userRoles = user.roles || [];
    const needsRoleSelection = userRoles.length > 1;

    const userData = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: userRoles
    };

    res.json({
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
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    const userData = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: user.roles,
      currentRole: role
    };

    res.json({
      user: userData,
      token
    });
  } catch (error) {
    console.error('Role selection error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/switch-role', authenticate, async (req, res) => {
  try {
    const { role } = req.body;

    const result = await pool.query(
      'SELECT id, name, cpf, roles FROM users WHERE id = $1',
      [req.user.id]
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
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    const userData = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: user.roles,
      currentRole: role
    };

    res.json({
      user: userData,
      token
    });
  } catch (error) {
    console.error('Role switch error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, password
    } = req.body;

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password, roles,
        subscription_status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
      RETURNING id, name, cpf, roles
    `, [
      name, cpf.replace(/\D/g, ''), email, phone?.replace(/\D/g, ''),
      birth_date, address, address_number, address_complement,
      neighborhood, city, state, hashedPassword, ['client'], 'pending'
    ]);

    const user = result.rows[0];

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        roles: user.roles
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === '23505') {
      res.status(400).json({ message: 'CPF já cadastrado' });
    } else {
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout realizado com sucesso' });
});

// 🔥 AGENDA ROUTES

// Check subscription status middleware
const checkAgendaSubscription = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT * FROM agenda_subscriptions 
      WHERE professional_id = $1 AND status = 'active' AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC 
      LIMIT 1
    `, [req.user.id]);

    req.hasActiveSubscription = result.rows.length > 0;
    req.subscription = result.rows[0] || null;
    next();
  } catch (error) {
    console.error('Error checking subscription:', error);
    res.status(500).json({ message: 'Erro ao verificar assinatura' });
  }
};

// Get professional's schedule configuration
app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM professional_schedules WHERE professional_id = $1',
      [req.user.id]
    );

    res.json(result.rows[0] || {
      professional_id: req.user.id,
      monday_start: null,
      monday_end: null,
      tuesday_start: null,
      tuesday_end: null,
      wednesday_start: null,
      wednesday_end: null,
      thursday_start: null,
      thursday_end: null,
      friday_start: null,
      friday_end: null,
      saturday_start: null,
      saturday_end: null,
      sunday_start: null,
      sunday_end: null,
      slot_duration: 30,
      break_start: null,
      break_end: null
    });
  } catch (error) {
    console.error('Error fetching schedule config:', error);
    res.status(500).json({ message: 'Erro ao carregar configuração da agenda' });
  }
});

// Update professional's schedule configuration
app.put('/api/agenda/schedule-config', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  if (!req.hasActiveSubscription) {
    return res.status(403).json({ message: 'Assinatura da agenda necessária para esta funcionalidade' });
  }

  try {
    const {
      monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end, slot_duration, break_start, break_end
    } = req.body;

    const result = await pool.query(`
      INSERT INTO professional_schedules (
        professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
        wednesday_start, wednesday_end, thursday_start, thursday_end,
        friday_start, friday_end, saturday_start, saturday_end,
        sunday_start, sunday_end, slot_duration, break_start, break_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (professional_id) 
      DO UPDATE SET
        monday_start = $2, monday_end = $3, tuesday_start = $4, tuesday_end = $5,
        wednesday_start = $6, wednesday_end = $7, thursday_start = $8, thursday_end = $9,
        friday_start = $10, friday_end = $11, saturday_start = $12, saturday_end = $13,
        sunday_start = $14, sunday_end = $15, slot_duration = $16, break_start = $17, break_end = $18,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      req.user.id, monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end, slot_duration, break_start, break_end
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating schedule config:', error);
    res.status(500).json({ message: 'Erro ao atualizar configuração da agenda' });
  }
});

// Get professional's patients
app.get('/api/agenda/patients', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  if (!req.hasActiveSubscription) {
    return res.status(403).json({ message: 'Assinatura da agenda necessária para esta funcionalidade' });
  }

  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.cpf, u.email, u.phone, u.birth_date, u.address,
             u.address_number, u.address_complement, u.neighborhood, u.city, u.state,
             pp.created_at as linked_at, pp.notes,
             CASE WHEN u.roles IS NOT NULL THEN true ELSE false END as is_convenio_patient
      FROM professional_patients pp
      JOIN users u ON pp.patient_id = u.id
      WHERE pp.professional_id = $1
      ORDER BY u.name
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ message: 'Erro ao carregar pacientes' });
  }
});

// Add new patient (particular)
app.post('/api/agenda/patients', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  if (!req.hasActiveSubscription) {
    return res.status(403).json({ message: 'Assinatura da agenda necessária para esta funcionalidade' });
  }

  try {
    const {
      name, cpf, email, phone, birth_date, address,
      address_number, address_complement, neighborhood, city, state, notes
    } = req.body;

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id, name, roles FROM users WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
    );

    let patientId;

    if (existingUser.rows.length > 0) {
      // User exists, check if already linked to this professional
      const existingLink = await pool.query(
        'SELECT id FROM professional_patients WHERE professional_id = $1 AND patient_id = $2',
        [req.user.id, existingUser.rows[0].id]
      );

      if (existingLink.rows.length > 0) {
        return res.status(400).json({ 
          message: 'Este paciente já está vinculado à sua agenda',
          existingPatient: existingUser.rows[0]
        });
      }

      patientId = existingUser.rows[0].id;
      
      // Link existing user to professional
      await pool.query(
        'INSERT INTO professional_patients (professional_id, patient_id, notes) VALUES ($1, $2, $3)',
        [req.user.id, patientId, notes]
      );
    } else {
      // Create new patient (without roles - particular patient)
      const newPatient = await pool.query(`
        INSERT INTO users (name, cpf, email, phone, birth_date, address, address_number, 
                          address_complement, neighborhood, city, state)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `, [
        name, cpf.replace(/\D/g, ''), email || null, phone?.replace(/\D/g, '') || null,
        birth_date || null, address || null, address_number || null,
        address_complement || null, neighborhood || null, city || null, state || null
      ]);

      patientId = newPatient.rows[0].id;

      // Link new patient to professional
      await pool.query(
        'INSERT INTO professional_patients (professional_id, patient_id, notes) VALUES ($1, $2, $3)',
        [req.user.id, patientId, notes]
      );
    }

    // Return the complete patient data
    const patientData = await pool.query(`
      SELECT u.id, u.name, u.cpf, u.email, u.phone, u.birth_date, u.address,
             u.address_number, u.address_complement, u.neighborhood, u.city, u.state,
             pp.created_at as linked_at, pp.notes,
             CASE WHEN u.roles IS NOT NULL THEN true ELSE false END as is_convenio_patient
      FROM professional_patients pp
      JOIN users u ON pp.patient_id = u.id
      WHERE pp.professional_id = $1 AND pp.patient_id = $2
    `, [req.user.id, patientId]);

    res.status(201).json(patientData.rows[0]);
  } catch (error) {
    console.error('Error adding patient:', error);
    if (error.code === '23505') {
      res.status(400).json({ message: 'CPF já cadastrado no sistema' });
    } else {
      res.status(500).json({ message: 'Erro ao adicionar paciente' });
    }
  }
});

// Update patient notes
app.put('/api/agenda/patients/:patientId', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  if (!req.hasActiveSubscription) {
    return res.status(403).json({ message: 'Assinatura da agenda necessária para esta funcionalidade' });
  }

  try {
    const { notes } = req.body;
    
    const result = await pool.query(
      'UPDATE professional_patients SET notes = $1, updated_at = CURRENT_TIMESTAMP WHERE professional_id = $2 AND patient_id = $3 RETURNING *',
      [notes, req.user.id, req.params.patientId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating patient:', error);
    res.status(500).json({ message: 'Erro ao atualizar paciente' });
  }
});

// Get appointments for a date range
app.get('/api/agenda/appointments', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  if (!req.hasActiveSubscription) {
    return res.status(403).json({ message: 'Assinatura da agenda necessária para esta funcionalidade' });
  }

  try {
    const { start_date, end_date } = req.query;
    
    const result = await pool.query(`
      SELECT a.id, a.date, a.status, a.notes, a.created_at,
             u.id as patient_id, u.name as patient_name, u.phone as patient_phone,
             CASE WHEN u.roles IS NOT NULL THEN true ELSE false END as is_convenio_patient
      FROM appointments a
      JOIN users u ON a.patient_id = u.id
      WHERE a.professional_id = $1 
        AND a.date >= $2 
        AND a.date <= $3
      ORDER BY a.date
    `, [req.user.id, start_date, end_date]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro ao carregar agendamentos' });
  }
});

// Create new appointment
app.post('/api/agenda/appointments', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  if (!req.hasActiveSubscription) {
    return res.status(403).json({ message: 'Assinatura da agenda necessária para esta funcionalidade' });
  }

  try {
    const { patient_id, date, notes } = req.body;

    // Verify patient is linked to this professional
    const patientLink = await pool.query(
      'SELECT id FROM professional_patients WHERE professional_id = $1 AND patient_id = $2',
      [req.user.id, patient_id]
    );

    if (patientLink.rows.length === 0) {
      return res.status(400).json({ message: 'Paciente não está vinculado à sua agenda' });
    }

    // Check for conflicts
    const conflict = await pool.query(
      'SELECT id FROM appointments WHERE professional_id = $1 AND date = $2 AND status != $3',
      [req.user.id, date, 'cancelled']
    );

    if (conflict.rows.length > 0) {
      return res.status(400).json({ message: 'Já existe um agendamento neste horário' });
    }

    const result = await pool.query(`
      INSERT INTO appointments (professional_id, patient_id, date, status, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [req.user.id, patient_id, date, 'scheduled', notes]);

    // Get complete appointment data
    const appointmentData = await pool.query(`
      SELECT a.id, a.date, a.status, a.notes, a.created_at,
             u.id as patient_id, u.name as patient_name, u.phone as patient_phone,
             CASE WHEN u.roles IS NOT NULL THEN true ELSE false END as is_convenio_patient
      FROM appointments a
      JOIN users u ON a.patient_id = u.id
      WHERE a.id = $1
    `, [result.rows[0].id]);

    res.status(201).json(appointmentData.rows[0]);
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erro ao criar agendamento' });
  }
});

// Update appointment
app.put('/api/agenda/appointments/:appointmentId', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  if (!req.hasActiveSubscription) {
    return res.status(403).json({ message: 'Assinatura da agenda necessária para esta funcionalidade' });
  }

  try {
    const { date, status, notes } = req.body;
    
    // Check if appointment belongs to this professional
    const appointment = await pool.query(
      'SELECT id FROM appointments WHERE id = $1 AND professional_id = $2',
      [req.params.appointmentId, req.user.id]
    );

    if (appointment.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    // If changing date, check for conflicts
    if (date) {
      const conflict = await pool.query(
        'SELECT id FROM appointments WHERE professional_id = $1 AND date = $2 AND status != $3 AND id != $4',
        [req.user.id, date, 'cancelled', req.params.appointmentId]
      );

      if (conflict.rows.length > 0) {
        return res.status(400).json({ message: 'Já existe um agendamento neste horário' });
      }
    }

    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (date) {
      updateFields.push(`date = $${paramCount++}`);
      updateValues.push(date);
    }
    if (status) {
      updateFields.push(`status = $${paramCount++}`);
      updateValues.push(status);
    }
    if (notes !== undefined) {
      updateFields.push(`notes = $${paramCount++}`);
      updateValues.push(notes);
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(req.params.appointmentId);

    const result = await pool.query(`
      UPDATE appointments 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `, updateValues);

    // Get complete appointment data
    const appointmentData = await pool.query(`
      SELECT a.id, a.date, a.status, a.notes, a.created_at,
             u.id as patient_id, u.name as patient_name, u.phone as patient_phone,
             CASE WHEN u.roles IS NOT NULL THEN true ELSE false END as is_convenio_patient
      FROM appointments a
      JOIN users u ON a.patient_id = u.id
      WHERE a.id = $1
    `, [req.params.appointmentId]);

    res.json(appointmentData.rows[0]);
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ message: 'Erro ao atualizar agendamento' });
  }
});

// Cancel appointment
app.delete('/api/agenda/appointments/:appointmentId', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  if (!req.hasActiveSubscription) {
    return res.status(403).json({ message: 'Assinatura da agenda necessária para esta funcionalidade' });
  }

  try {
    const result = await pool.query(
      'UPDATE appointments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND professional_id = $3 RETURNING *',
      ['cancelled', req.params.appointmentId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    res.json({ message: 'Agendamento cancelado com sucesso' });
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    res.status(500).json({ message: 'Erro ao cancelar agendamento' });
  }
});

// Get blocked times
app.get('/api/agenda/blocked-times', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  if (!req.hasActiveSubscription) {
    return res.status(403).json({ message: 'Assinatura da agenda necessária para esta funcionalidade' });
  }

  try {
    const { start_date, end_date } = req.query;
    
    const result = await pool.query(`
      SELECT * FROM blocked_times 
      WHERE professional_id = $1 
        AND date >= $2 
        AND date <= $3
      ORDER BY date
    `, [req.user.id, start_date, end_date]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching blocked times:', error);
    res.status(500).json({ message: 'Erro ao carregar horários bloqueados' });
  }
});

// Create blocked time
app.post('/api/agenda/blocked-times', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  if (!req.hasActiveSubscription) {
    return res.status(403).json({ message: 'Assinatura da agenda necessária para esta funcionalidade' });
  }

  try {
    const { date, reason } = req.body;

    const result = await pool.query(`
      INSERT INTO blocked_times (professional_id, date, reason)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.user.id, date, reason]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating blocked time:', error);
    res.status(500).json({ message: 'Erro ao bloquear horário' });
  }
});

// Delete blocked time
app.delete('/api/agenda/blocked-times/:blockedTimeId', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  if (!req.hasActiveSubscription) {
    return res.status(403).json({ message: 'Assinatura da agenda necessária para esta funcionalidade' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM blocked_times WHERE id = $1 AND professional_id = $2 RETURNING *',
      [req.params.blockedTimeId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Horário bloqueado não encontrado' });
    }

    res.json({ message: 'Horário desbloqueado com sucesso' });
  } catch (error) {
    console.error('Error deleting blocked time:', error);
    res.status(500).json({ message: 'Erro ao desbloquear horário' });
  }
});

// Get patient history
app.get('/api/agenda/patients/:patientId/history', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  if (!req.hasActiveSubscription) {
    return res.status(403).json({ message: 'Assinatura da agenda necessária para esta funcionalidade' });
  }

  try {
    // Verify patient is linked to this professional
    const patientLink = await pool.query(
      'SELECT id FROM professional_patients WHERE professional_id = $1 AND patient_id = $2',
      [req.user.id, req.params.patientId]
    );

    if (patientLink.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    const result = await pool.query(`
      SELECT a.id, a.date, a.status, a.notes, a.created_at,
             pr.diagnosis, pr.treatment, pr.observations
      FROM appointments a
      LEFT JOIN medical_records pr ON a.id = pr.appointment_id
      WHERE a.professional_id = $1 AND a.patient_id = $2
      ORDER BY a.date DESC
    `, [req.user.id, req.params.patientId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching patient history:', error);
    res.status(500).json({ message: 'Erro ao carregar histórico do paciente' });
  }
});

// Create/Update medical record
app.post('/api/agenda/appointments/:appointmentId/medical-record', authenticate, authorize(['professional']), checkAgendaSubscription, async (req, res) => {
  if (!req.hasActiveSubscription) {
    return res.status(403).json({ message: 'Assinatura da agenda necessária para esta funcionalidade' });
  }

  try {
    const { diagnosis, treatment, observations } = req.body;

    // Verify appointment belongs to this professional
    const appointment = await pool.query(
      'SELECT id FROM appointments WHERE id = $1 AND professional_id = $2',
      [req.params.appointmentId, req.user.id]
    );

    if (appointment.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    const result = await pool.query(`
      INSERT INTO medical_records (appointment_id, professional_id, diagnosis, treatment, observations)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (appointment_id) 
      DO UPDATE SET
        diagnosis = $3, treatment = $4, observations = $5, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [req.params.appointmentId, req.user.id, diagnosis, treatment, observations]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving medical record:', error);
    res.status(500).json({ message: 'Erro ao salvar prontuário' });
  }
});

// 🔥 AGENDA SUBSCRIPTION & PAYMENT ROUTES

// Get professional's agenda subscription status
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM agenda_subscriptions 
      WHERE professional_id = $1 
      ORDER BY created_at DESC 
      LIMIT 1
    `, [req.user.id]);

    const subscription = result.rows[0];
    
    if (!subscription) {
      return res.json({
        status: 'inactive',
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: false
      });
    }

    const now = new Date();
    const expiresAt = new Date(subscription.expires_at);
    const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
    const canUseAgenda = subscription.status === 'active' && expiresAt > now;

    res.json({
      status: subscription.status,
      expires_at: subscription.expires_at,
      days_remaining: daysRemaining,
      can_use_agenda: canUseAgenda,
      last_payment: subscription.created_at
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ message: 'Erro ao verificar status da assinatura' });
  }
});

// Get payment history
app.get('/api/agenda/payment-history', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ap.*, as_sub.expires_at
      FROM agenda_payments ap
      LEFT JOIN agenda_subscriptions as_sub ON ap.subscription_id = as_sub.id
      WHERE ap.professional_id = $1
      ORDER BY ap.created_at DESC
      LIMIT 10
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ message: 'Erro ao carregar histórico de pagamentos' });
  }
});

// Create agenda subscription payment
app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const amount = 49.90; // Fixed monthly price for agenda access

    // Get professional data
    const professionalResult = await pool.query(
      'SELECT name, email FROM users WHERE id = $1',
      [professionalId]
    );

    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }

    const professional = professionalResult.rows[0];

    // Create preference for MercadoPago
    const preference = {
      items: [
        {
          title: 'Assinatura Agenda Quiro Ferreira - Mensal',
          description: 'Acesso completo à agenda profissional por 30 dias',
          unit_price: amount,
          quantity: 1,
          currency_id: 'BRL',
        }
      ],
      payer: {
        name: professional.name,
        email: professional.email || `professional${professionalId}@quiroferreira.com.br`,
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=pending`,
      },
      auto_return: 'approved',
      external_reference: `agenda_${professionalId}_${Date.now()}`,
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/agenda/payment-webhook`,
      statement_descriptor: 'QUIRO FERREIRA AGENDA',
    };

    const response = await mercadopago.preferences.create(preference);

    // Save payment record as pending
    const paymentResult = await pool.query(`
      INSERT INTO agenda_payments (professional_id, amount, status, mp_preference_id, external_reference)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [professionalId, amount, 'pending', response.body.id, preference.external_reference]);

    res.json({
      payment_id: paymentResult.rows[0].id,
      preference_id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point,
    });
  } catch (error) {
    console.error('Error creating agenda subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento da assinatura' });
  }
});

// Webhook for agenda payment notifications
app.post('/api/agenda/payment-webhook', async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === 'payment') {
      const paymentId = data.id;
      
      // Get payment details from MercadoPago
      const payment = await mercadopago.payment.findById(paymentId);
      const paymentData = payment.body;

      console.log('📧 Agenda payment webhook received:', {
        id: paymentId,
        status: paymentData.status,
        external_reference: paymentData.external_reference
      });

      if (paymentData.external_reference && paymentData.external_reference.startsWith('agenda_')) {
        // Update payment status in database
        const updateResult = await pool.query(`
          UPDATE agenda_payments 
          SET status = $1, mp_payment_id = $2, payment_data = $3, updated_at = CURRENT_TIMESTAMP
          WHERE external_reference = $4
          RETURNING *
        `, [
          paymentData.status,
          paymentId,
          JSON.stringify(paymentData),
          paymentData.external_reference
        ]);

        if (updateResult.rows.length > 0 && paymentData.status === 'approved') {
          const payment = updateResult.rows[0];
          
          // Create or extend subscription
          const now = new Date();
          const expiresAt = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days

          const subscriptionResult = await pool.query(`
            INSERT INTO agenda_subscriptions (professional_id, status, expires_at, payment_id)
            VALUES ($1, $2, $3, $4)
            RETURNING *
          `, [payment.professional_id, 'active', expiresAt, payment.id]);

          // Update payment with subscription reference
          await pool.query(`
            UPDATE agenda_payments 
            SET subscription_id = $1
            WHERE id = $2
          `, [subscriptionResult.rows[0].id, payment.id]);

          console.log('✅ Agenda subscription activated for professional:', payment.professional_id);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing agenda payment webhook:', error);
    res.status(500).json({ message: 'Erro ao processar webhook' });
  }
});

// 🔥 EXISTING ROUTES (keeping all original functionality)

// Users routes
app.get('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, cpf, email, phone, birth_date, address, address_number, 
             address_complement, neighborhood, city, state, roles, percentage, 
             category_id, subscription_status, subscription_expiry, created_at
      FROM users 
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Erro ao carregar usuários' });
  }
});

app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, cpf, email, phone, birth_date, address, address_number, address_complement, neighborhood, city, state, roles, percentage, category_id, subscription_status, subscription_expiry, photo_url FROM users WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Erro ao carregar usuário' });
  }
});

app.post('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, password, roles,
      percentage, category_id
    } = req.body;

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE cpf = $1',
      [cpf]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password, roles,
        percentage, category_id, subscription_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, name, cpf, email, phone, birth_date, address, address_number,
                address_complement, neighborhood, city, state, roles, percentage,
                category_id, subscription_status, created_at
    `, [
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, hashedPassword, roles,
      percentage, category_id, roles.includes('client') ? 'pending' : null
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating user:', error);
    if (error.code === '23505') {
      res.status(400).json({ message: 'CPF já cadastrado' });
    } else {
      res.status(500).json({ message: 'Erro ao criar usuário' });
    }
  }
});

app.put('/api/users/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const {
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles,
      percentage, category_id
    } = req.body;

    const result = await pool.query(`
      UPDATE users SET
        name = $1, email = $2, phone = $3, birth_date = $4, address = $5,
        address_number = $6, address_complement = $7, neighborhood = $8,
        city = $9, state = $10, roles = $11, percentage = $12, category_id = $13
      WHERE id = $14
      RETURNING id, name, cpf, email, phone, birth_date, address, address_number,
                address_complement, neighborhood, city, state, roles, percentage,
                category_id, subscription_status, created_at
    `, [
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles,
      percentage, category_id, req.params.id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Erro ao atualizar usuário' });
  }
});

app.put('/api/users/:id/activate', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { expiry_date } = req.body;

    const result = await pool.query(`
      UPDATE users SET
        subscription_status = 'active',
        subscription_expiry = $1
      WHERE id = $2
      RETURNING id, name, subscription_status, subscription_expiry
    `, [expiry_date, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error activating user:', error);
    res.status(500).json({ message: 'Erro ao ativar usuário' });
  }
});

app.delete('/api/users/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json({ message: 'Usuário excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Erro ao excluir usuário' });
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
    res.status(500).json({ message: 'Erro ao carregar serviços' });
  }
});

app.post('/api/services', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description, base_price, category_id, is_base_service } = req.body;

    const result = await pool.query(`
      INSERT INTO services (name, description, base_price, category_id, is_base_service)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, description, base_price, category_id, is_base_service]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ message: 'Erro ao criar serviço' });
  }
});

app.put('/api/services/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description, base_price, category_id, is_base_service } = req.body;

    const result = await pool.query(`
      UPDATE services SET
        name = $1, description = $2, base_price = $3, category_id = $4, is_base_service = $5
      WHERE id = $6
      RETURNING *
    `, [name, description, base_price, category_id, is_base_service, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({ message: 'Erro ao atualizar serviço' });
  }
});

app.delete('/api/services/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM services WHERE id = $1 RETURNING id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }

    res.json({ message: 'Serviço excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ message: 'Erro ao excluir serviço' });
  }
});

// Service categories routes
app.get('/api/service-categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM service_categories ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching service categories:', error);
    res.status(500).json({ message: 'Erro ao carregar categorias' });
  }
});

app.post('/api/service-categories', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description } = req.body;

    const result = await pool.query(`
      INSERT INTO service_categories (name, description)
      VALUES ($1, $2)
      RETURNING *
    `, [name, description]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating service category:', error);
    res.status(500).json({ message: 'Erro ao criar categoria' });
  }
});

// Consultations routes
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query = `
      SELECT c.*, s.name as service_name, 
             u_prof.name as professional_name,
             COALESCE(u_client.name, u_dep.name) as client_name,
             CASE WHEN c.dependent_id IS NOT NULL THEN true ELSE false END as is_dependent
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      JOIN users u_prof ON c.professional_id = u_prof.id
      LEFT JOIN users u_client ON c.client_id = u_client.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN users u_dep ON d.client_id = u_dep.id
    `;
    
    const params = [];
    
    if (req.user.currentRole === 'client') {
      query += ' WHERE (c.client_id = $1 OR d.client_id = $1)';
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
    res.status(500).json({ message: 'Erro ao carregar consultas' });
  }
});

app.post('/api/consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { client_id, dependent_id, service_id, value, date } = req.body;

    const result = await pool.query(`
      INSERT INTO consultations (client_id, dependent_id, professional_id, service_id, value, date)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [client_id, dependent_id, req.user.id, service_id, value, date]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating consultation:', error);
    res.status(500).json({ message: 'Erro ao registrar consulta' });
  }
});

// Dependents routes
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    if (req.user.currentRole === 'client' && req.user.id !== parseInt(req.params.clientId)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const result = await pool.query(
      'SELECT * FROM dependents WHERE client_id = $1 ORDER BY name',
      [req.params.clientId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dependents:', error);
    res.status(500).json({ message: 'Erro ao carregar dependentes' });
  }
});

app.get('/api/dependents/lookup', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.query;

    const result = await pool.query(`
      SELECT d.*, u.name as client_name, u.subscription_status as client_subscription_status
      FROM dependents d
      JOIN users u ON d.client_id = u.id
      WHERE d.cpf = $1
    `, [cpf.replace(/\D/g, '')]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up dependent:', error);
    res.status(500).json({ message: 'Erro ao buscar dependente' });
  }
});

app.post('/api/dependents', authenticate, async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;

    if (req.user.currentRole === 'client' && req.user.id !== client_id) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const result = await pool.query(`
      INSERT INTO dependents (client_id, name, cpf, birth_date)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [client_id, name, cpf.replace(/\D/g, ''), birth_date]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating dependent:', error);
    if (error.code === '23505') {
      res.status(400).json({ message: 'CPF já cadastrado' });
    } else {
      res.status(500).json({ message: 'Erro ao criar dependente' });
    }
  }
});

app.put('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const { name, birth_date } = req.body;

    const dependent = await pool.query(
      'SELECT client_id FROM dependents WHERE id = $1',
      [req.params.id]
    );

    if (dependent.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    if (req.user.currentRole === 'client' && req.user.id !== dependent.rows[0].client_id) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const result = await pool.query(`
      UPDATE dependents SET name = $1, birth_date = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [name, birth_date, req.params.id]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating dependent:', error);
    res.status(500).json({ message: 'Erro ao atualizar dependente' });
  }
});

app.delete('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const dependent = await pool.query(
      'SELECT client_id FROM dependents WHERE id = $1',
      [req.params.id]
    );

    if (dependent.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    if (req.user.currentRole === 'client' && req.user.id !== dependent.rows[0].client_id) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    await pool.query('DELETE FROM dependents WHERE id = $1', [req.params.id]);
    res.json({ message: 'Dependente excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting dependent:', error);
    res.status(500).json({ message: 'Erro ao excluir dependente' });
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
      WHERE u.roles @> '["professional"]'
      ORDER BY u.name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching professionals:', error);
    res.status(500).json({ message: 'Erro ao carregar profissionais' });
  }
});

// Clients lookup route
app.get('/api/clients/lookup', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.query;

    const result = await pool.query(
      'SELECT id, name, cpf, subscription_status FROM users WHERE cpf = $1 AND roles @> \'["client"]\'',
      [cpf.replace(/\D/g, '')]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up client:', error);
    res.status(500).json({ message: 'Erro ao buscar cliente' });
  }
});

// Reports routes
app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    const result = await pool.query(`
      SELECT 
        SUM(c.value) as total_revenue,
        COUNT(c.id) as total_consultations,
        u.name as professional_name,
        u.percentage as professional_percentage,
        SUM(c.value) as revenue,
        COUNT(c.id) as consultation_count,
        SUM(c.value * (u.percentage / 100.0)) as professional_payment,
        SUM(c.value * ((100 - u.percentage) / 100.0)) as clinic_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY u.id, u.name, u.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    const totalRevenue = await pool.query(`
      SELECT SUM(value) as total_revenue
      FROM consultations
      WHERE date >= $1 AND date <= $2
    `, [start_date, end_date]);

    const serviceRevenue = await pool.query(`
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

    res.json({
      total_revenue: totalRevenue.rows[0]?.total_revenue || 0,
      revenue_by_professional: result.rows,
      revenue_by_service: serviceRevenue.rows
    });
  } catch (error) {
    console.error('Error generating revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

app.get('/api/reports/professional-revenue', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    const summary = await pool.query(`
      SELECT 
        u.percentage as professional_percentage,
        SUM(c.value) as total_revenue,
        COUNT(c.id) as consultation_count,
        SUM(c.value * ((100 - u.percentage) / 100.0)) as amount_to_pay
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.professional_id = $1 AND c.date >= $2 AND c.date <= $3
      GROUP BY u.percentage
    `, [req.user.id, start_date, end_date]);

    const consultations = await pool.query(`
      SELECT 
        c.date,
        COALESCE(u_client.name, u_dep.name) as client_name,
        s.name as service_name,
        c.value as total_value,
        c.value * ((100 - u_prof.percentage) / 100.0) as amount_to_pay
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      JOIN users u_prof ON c.professional_id = u_prof.id
      LEFT JOIN users u_client ON c.client_id = u_client.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN users u_dep ON d.client_id = u_dep.id
      WHERE c.professional_id = $1 AND c.date >= $2 AND c.date <= $3
      ORDER BY c.date DESC
    `, [req.user.id, start_date, end_date]);

    res.json({
      summary: summary.rows[0] || {
        professional_percentage: 50,
        total_revenue: 0,
        consultation_count: 0,
        amount_to_pay: 0
      },
      consultations: consultations.rows
    });
  } catch (error) {
    console.error('Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

// Payment routes (existing)
app.post('/api/create-subscription', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { user_id, dependent_ids } = req.body;
    const basePrice = 250;
    const dependentPrice = 50;
    const totalAmount = basePrice + (dependent_ids.length * dependentPrice);

    const userResult = await pool.query(
      'SELECT name, email FROM users WHERE id = $1',
      [user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = userResult.rows[0];

    const preference = {
      items: [
        {
          title: 'Assinatura Convênio Quiro Ferreira',
          description: `Titular + ${dependent_ids.length} dependente(s)`,
          unit_price: totalAmount,
          quantity: 1,
          currency_id: 'BRL',
        }
      ],
      payer: {
        name: user.name,
        email: user.email || `user${user_id}@quiroferreira.com.br`,
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=pending`,
      },
      auto_return: 'approved',
      external_reference: `subscription_${user_id}_${Date.now()}`,
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/webhook`,
    };

    const response = await mercadopago.preferences.create(preference);

    res.json({
      preference_id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point,
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ message: 'Erro ao criar assinatura' });
  }
});

app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { amount } = req.body;
    const professionalId = req.user.id;

    const professionalResult = await pool.query(
      'SELECT name, email FROM users WHERE id = $1',
      [professionalId]
    );

    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }

    const professional = professionalResult.rows[0];

    const preference = {
      items: [
        {
          title: 'Repasse Convênio Quiro Ferreira',
          description: 'Pagamento de repasse ao convênio',
          unit_price: amount,
          quantity: 1,
          currency_id: 'BRL',
        }
      ],
      payer: {
        name: professional.name,
        email: professional.email || `professional${professionalId}@quiroferreira.com.br`,
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=pending`,
      },
      auto_return: 'approved',
      external_reference: `professional_payment_${professionalId}_${Date.now()}`,
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/webhook`,
    };

    const response = await mercadopago.preferences.create(preference);

    res.json({
      preference_id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point,
    });
  } catch (error) {
    console.error('Error creating professional payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

app.post('/api/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === 'payment') {
      const paymentId = data.id;
      const payment = await mercadopago.payment.findById(paymentId);
      const paymentData = payment.body;

      console.log('Webhook received:', {
        id: paymentId,
        status: paymentData.status,
        external_reference: paymentData.external_reference
      });

      if (paymentData.status === 'approved' && paymentData.external_reference) {
        if (paymentData.external_reference.startsWith('subscription_')) {
          const userId = paymentData.external_reference.split('_')[1];
          
          const expiryDate = new Date();
          expiryDate.setMonth(expiryDate.getMonth() + 1);

          await pool.query(`
            UPDATE users SET 
              subscription_status = 'active',
              subscription_expiry = $1
            WHERE id = $2
          `, [expiryDate, userId]);

          console.log('Subscription activated for user:', userId);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ message: 'Erro ao processar webhook' });
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
        return res.status(400).json({ message: 'Nenhum arquivo enviado' });
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
    res.status(500).json({ message: 'Erro ao fazer upload da imagem' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 API URL: http://localhost:${PORT}`);
});