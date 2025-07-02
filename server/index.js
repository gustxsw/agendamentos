import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { authenticate, authorize } from './middleware/auth.js';
import createUpload from './middleware/upload.js';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import multer from 'multer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://www.cartaoquiroferreira.com.br',
      'https://cartaoquiroferreira.com.br'
    ];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Initialize MercadoPago
let mercadopago;
try {
  if (process.env.MP_ACCESS_TOKEN) {
    mercadopago = new MercadoPagoConfig({
      accessToken: process.env.MP_ACCESS_TOKEN,
      options: {
        timeout: 5000,
        idempotencyKey: 'abc'
      }
    });
    console.log('✅ MercadoPago initialized successfully');
  } else {
    console.warn('⚠️ MercadoPago access token not found');
  }
} catch (error) {
  console.error('❌ Error initializing MercadoPago:', error);
}

// Create tables
const createTables = async () => {
  try {
    console.log('🔄 Creating database tables...');

    // Service Categories
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Services
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

    // Users table with all necessary columns
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) UNIQUE NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        birth_date DATE,
        address VARCHAR(255),
        address_number VARCHAR(20),
        address_complement VARCHAR(100),
        neighborhood VARCHAR(100),
        city VARCHAR(100),
        state VARCHAR(2),
        password_hash VARCHAR(255) NOT NULL,
        roles TEXT[] DEFAULT ARRAY['client'],
        percentage INTEGER,
        category_id INTEGER REFERENCES service_categories(id),
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_expiry TIMESTAMP,
        photo_url TEXT,
        professional_registration VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Dependents
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dependents (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) UNIQUE NOT NULL,
        birth_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Consultations
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id),
        dependent_id INTEGER REFERENCES dependents(id),
        professional_id INTEGER NOT NULL REFERENCES users(id),
        service_id INTEGER NOT NULL REFERENCES services(id),
        value DECIMAL(10,2) NOT NULL,
        date TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT check_client_or_dependent CHECK (
          (client_id IS NOT NULL AND dependent_id IS NULL) OR 
          (client_id IS NULL AND dependent_id IS NOT NULL)
        )
      )
    `);

    // Professional Locations
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_locations (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        clinic_name VARCHAR(255) NOT NULL,
        address VARCHAR(255) NOT NULL,
        address_number VARCHAR(20) NOT NULL,
        address_complement VARCHAR(100),
        neighborhood VARCHAR(100) NOT NULL,
        city VARCHAR(100) NOT NULL,
        state VARCHAR(2) NOT NULL,
        phone VARCHAR(20),
        is_main BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Schedule Configurations
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_configs (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(professional_id)
      )
    `);

    // Professional Patients (for agenda)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_patients (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        birth_date DATE,
        address VARCHAR(255),
        address_number VARCHAR(20),
        address_complement VARCHAR(100),
        neighborhood VARCHAR(100),
        city VARCHAR(100),
        state VARCHAR(2),
        notes TEXT,
        is_convenio_patient BOOLEAN DEFAULT false,
        is_archived BOOLEAN DEFAULT false,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(professional_id, cpf)
      )
    `);

    // Appointments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER NOT NULL REFERENCES professional_patients(id) ON DELETE CASCADE,
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Medical Records
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INTEGER REFERENCES consultations(id),
        patient_id INTEGER REFERENCES professional_patients(id),
        professional_id INTEGER NOT NULL REFERENCES users(id),
        chief_complaint TEXT,
        anamnesis TEXT,
        physical_examination TEXT,
        diagnosis TEXT,
        treatment_plan TEXT,
        clinical_evolution TEXT,
        internal_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Agenda Subscriptions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        expires_at TIMESTAMP,
        payment_id VARCHAR(255),
        amount DECIMAL(10,2) DEFAULT 49.90,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ All tables created successfully');

    // Insert default data
    await insertDefaultData();

  } catch (error) {
    console.error('❌ Error creating tables:', error);
  }
};

// Insert default data
const insertDefaultData = async () => {
  try {
    // Check if categories exist
    const categoriesResult = await pool.query('SELECT COUNT(*) FROM service_categories');
    if (parseInt(categoriesResult.rows[0].count) === 0) {
      console.log('🔄 Inserting default categories...');
      
      await pool.query(`
        INSERT INTO service_categories (name, description) VALUES
        ('Fisioterapia', 'Serviços de fisioterapia e reabilitação'),
        ('Quiropraxia', 'Tratamentos quiropráticos'),
        ('Massoterapia', 'Massagens terapêuticas'),
        ('Acupuntura', 'Tratamentos com acupuntura'),
        ('Pilates', 'Aulas e sessões de pilates')
      `);
    }

    // Check if services exist
    const servicesResult = await pool.query('SELECT COUNT(*) FROM services');
    if (parseInt(servicesResult.rows[0].count) === 0) {
      console.log('🔄 Inserting default services...');
      
      await pool.query(`
        INSERT INTO services (name, description, base_price, category_id, is_base_service) VALUES
        ('Consulta Fisioterapêutica', 'Avaliação e tratamento fisioterapêutico', 80.00, 1, true),
        ('Sessão de Quiropraxia', 'Ajuste quiroprático completo', 120.00, 2, true),
        ('Massagem Relaxante', 'Massagem para relaxamento muscular', 60.00, 3, false),
        ('Sessão de Acupuntura', 'Tratamento com acupuntura', 90.00, 4, true),
        ('Aula de Pilates', 'Sessão individual de pilates', 70.00, 5, false)
      `);
    }

    // Check if admin user exists
    const adminResult = await pool.query("SELECT COUNT(*) FROM users WHERE 'admin' = ANY(roles)");
    if (parseInt(adminResult.rows[0].count) === 0) {
      console.log('🔄 Creating default admin user...');
      
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(`
        INSERT INTO users (name, cpf, password_hash, roles) VALUES
        ('Administrador', '00000000000', $1, ARRAY['admin'])
      `, [hashedPassword]);
    }

    console.log('✅ Default data inserted successfully');
  } catch (error) {
    console.error('❌ Error inserting default data:', error);
  }
};

// Initialize database
createTables();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Auth routes
app.post('/api/auth/login', async (req, res) => {
  try {
    const { cpf, password } = req.body;

    if (!cpf || !password) {
      return res.status(400).json({ message: 'CPF e senha são obrigatórios' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');
    
    const result = await pool.query(
      'SELECT id, name, cpf, roles, password_hash FROM users WHERE cpf = $1',
      [cleanCpf]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    const userData = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: user.roles || ['client']
    };

    res.json({ user: userData });
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
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({ user: userData, token });
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
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({ user: userData, token });
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

    if (!name || !cpf || !password) {
      return res.status(400).json({ message: 'Nome, CPF e senha são obrigatórios' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    if (cleanCpf.length !== 11) {
      return res.status(400).json({ message: 'CPF deve conter 11 dígitos' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cleanCpf]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'CPF já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password_hash, roles
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ARRAY['client'])
      RETURNING id, name, cpf, roles
    `, [
      name, cleanCpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, hashedPassword
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
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout realizado com sucesso' });
});

// Agenda routes
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;

    const result = await pool.query(`
      SELECT status, expires_at, created_at
      FROM agenda_subscriptions 
      WHERE professional_id = $1 
      ORDER BY created_at DESC 
      LIMIT 1
    `, [professionalId]);

    if (result.rows.length === 0) {
      return res.json({
        status: 'none',
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: false
      });
    }

    const subscription = result.rows[0];
    const now = new Date();
    const expiresAt = subscription.expires_at ? new Date(subscription.expires_at) : null;
    
    let canUseAgenda = false;
    let daysRemaining = 0;

    if (subscription.status === 'active' && expiresAt && expiresAt > now) {
      canUseAgenda = true;
      daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    res.json({
      status: subscription.status,
      expires_at: subscription.expires_at,
      days_remaining: daysRemaining,
      can_use_agenda: canUseAgenda
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;

    const result = await pool.query(`
      SELECT * FROM schedule_configs WHERE professional_id = $1
    `, [professionalId]);

    if (result.rows.length === 0) {
      return res.json(null);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching schedule config:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const {
      monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end, slot_duration, break_start, break_end
    } = req.body;

    console.log('🔄 Saving schedule config for professional:', professionalId);
    console.log('📅 Config data:', req.body);

    const result = await pool.query(`
      INSERT INTO schedule_configs (
        professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
        wednesday_start, wednesday_end, thursday_start, thursday_end,
        friday_start, friday_end, saturday_start, saturday_end,
        sunday_start, sunday_end, slot_duration, break_start, break_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (professional_id) 
      DO UPDATE SET
        monday_start = EXCLUDED.monday_start,
        monday_end = EXCLUDED.monday_end,
        tuesday_start = EXCLUDED.tuesday_start,
        tuesday_end = EXCLUDED.tuesday_end,
        wednesday_start = EXCLUDED.wednesday_start,
        wednesday_end = EXCLUDED.wednesday_end,
        thursday_start = EXCLUDED.thursday_start,
        thursday_end = EXCLUDED.thursday_end,
        friday_start = EXCLUDED.friday_start,
        friday_end = EXCLUDED.friday_end,
        saturday_start = EXCLUDED.saturday_start,
        saturday_end = EXCLUDED.saturday_end,
        sunday_start = EXCLUDED.sunday_start,
        sunday_end = EXCLUDED.sunday_end,
        slot_duration = EXCLUDED.slot_duration,
        break_start = EXCLUDED.break_start,
        break_end = EXCLUDED.break_end,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      professionalId, monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end, slot_duration, break_start, break_end
    ]);

    console.log('✅ Schedule config saved successfully');
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error saving schedule config:', error);
    res.status(500).json({ message: 'Erro ao salvar configuração de horários' });
  }
});

app.get('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const includeArchived = req.query.include_archived === 'true';

    let query = `
      SELECT pp.*, 
             CASE WHEN pp.is_convenio_patient THEN true ELSE false END as is_convenio_patient
      FROM professional_patients pp
      WHERE pp.professional_id = $1
    `;

    if (!includeArchived) {
      query += ' AND pp.is_archived = false';
    }

    query += ' ORDER BY pp.name';

    const result = await pool.query(query, [professionalId]);

    // Also get convenio patients (users with client role and active subscription)
    const convenioResult = await pool.query(`
      SELECT u.id, u.name, u.cpf, u.phone, u.birth_date,
             u.address, u.address_number, u.address_complement,
             u.neighborhood, u.city, u.state,
             u.subscription_status,
             true as is_convenio_patient,
             false as is_archived,
             u.created_at as linked_at,
             '' as notes
      FROM users u
      WHERE 'client' = ANY(u.roles) 
      AND u.subscription_status = 'active'
      ORDER BY u.name
    `);

    const allPatients = [
      ...result.rows,
      ...convenioResult.rows.map(row => ({
        ...row,
        linked_at: row.linked_at
      }))
    ];

    res.json(allPatients);
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, notes
    } = req.body;

    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    const result = await pool.query(`
      INSERT INTO professional_patients (
        professional_id, name, cpf, email, phone, birth_date,
        address, address_number, address_complement, neighborhood,
        city, state, notes, is_convenio_patient
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false)
      RETURNING *
    `, [
      professionalId, name, cleanCpf, email, phone, birth_date,
      address, address_number, address_complement, neighborhood,
      city, state, notes
    ]);

    console.log('✅ Patient created successfully');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error creating patient:', error);
    if (error.code === '23505') {
      res.status(409).json({ message: 'Paciente já cadastrado para este profissional' });
    } else {
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
});

app.get('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const { start_date, end_date } = req.query;

    console.log('🔄 Fetching appointments for professional:', professionalId);
    console.log('📅 Date range:', { start_date, end_date });

    let query = `
      SELECT a.*, 
             pp.name as patient_name,
             pp.phone as patient_phone,
             pp.is_convenio_patient
      FROM appointments a
      JOIN professional_patients pp ON a.patient_id = pp.id
      WHERE a.professional_id = $1
    `;

    const params = [professionalId];

    if (start_date && end_date) {
      query += ' AND a.date >= $2 AND a.date <= $3';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY a.date';

    const result = await pool.query(query, params);

    console.log('✅ Found appointments:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const { patient_id, date, status = 'scheduled', notes } = req.body;

    console.log('🔄 Creating appointment:', {
      professionalId,
      patient_id,
      date,
      status,
      notes
    });

    if (!patient_id || !date) {
      return res.status(400).json({ message: 'ID do paciente e data são obrigatórios' });
    }

    // Verify patient belongs to this professional
    const patientCheck = await pool.query(
      'SELECT id FROM professional_patients WHERE id = $1 AND professional_id = $2',
      [patient_id, professionalId]
    );

    if (patientCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    const result = await pool.query(`
      INSERT INTO appointments (professional_id, patient_id, date, status, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [professionalId, patient_id, date, status, notes]);

    console.log('✅ Appointment created successfully:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error creating appointment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/agenda/appointments/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const appointmentId = req.params.id;
    const { status, notes, date } = req.body;

    console.log('🔄 Updating appointment:', appointmentId, req.body);

    // Verify appointment belongs to this professional
    const appointmentCheck = await pool.query(
      'SELECT id FROM appointments WHERE id = $1 AND professional_id = $2',
      [appointmentId, professionalId]
    );

    if (appointmentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    let query = 'UPDATE appointments SET updated_at = CURRENT_TIMESTAMP';
    const params = [];
    let paramCount = 0;

    if (status !== undefined) {
      paramCount++;
      query += `, status = $${paramCount}`;
      params.push(status);
    }

    if (notes !== undefined) {
      paramCount++;
      query += `, notes = $${paramCount}`;
      params.push(notes);
    }

    if (date !== undefined) {
      paramCount++;
      query += `, date = $${paramCount}`;
      params.push(date);
    }

    paramCount++;
    query += ` WHERE id = $${paramCount} AND professional_id = $${paramCount + 1} RETURNING *`;
    params.push(appointmentId, professionalId);

    const result = await pool.query(query, params);

    console.log('✅ Appointment updated successfully');
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error updating appointment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.delete('/api/agenda/appointments/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const appointmentId = req.params.id;

    console.log('🔄 Deleting appointment:', appointmentId);

    const result = await pool.query(
      'DELETE FROM appointments WHERE id = $1 AND professional_id = $2 RETURNING id',
      [appointmentId, professionalId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    console.log('✅ Appointment deleted successfully');
    res.json({ message: 'Agendamento excluído com sucesso' });
  } catch (error) {
    console.error('❌ Error deleting appointment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Agenda subscription payment
app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    if (!mercadopago) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }

    const professionalId = req.user.id;
    const amount = 49.90;

    console.log('🔄 Creating agenda subscription payment for professional:', professionalId);

    const preference = new Preference(mercadopago);

    const preferenceData = {
      items: [
        {
          title: 'Assinatura Agenda Profissional - Quiro Ferreira',
          description: 'Acesso completo à agenda profissional por 30 dias',
          quantity: 1,
          unit_price: amount,
          currency_id: 'BRL'
        }
      ],
      payer: {
        email: 'professional@quiroferreira.com.br'
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/agenda/payment/success`,
        failure: `${req.protocol}://${req.get('host')}/agenda/payment/failure`,
        pending: `${req.protocol}://${req.get('host')}/agenda/payment/pending`
      },
      auto_return: 'approved',
      external_reference: `agenda_${professionalId}_${Date.now()}`,
      notification_url: `${req.protocol}://${req.get('host')}/api/agenda/payment-webhook`
    };

    const result = await preference.create({ body: preferenceData });

    console.log('✅ Agenda payment preference created:', result.id);

    res.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error('❌ Error creating agenda payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento da agenda' });
  }
});

// Other existing routes...
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
    
    const result = await pool.query(`
      SELECT id, name, cpf, email, phone, birth_date, address, address_number,
             address_complement, neighborhood, city, state, roles, percentage,
             category_id, subscription_status, subscription_expiry, photo_url,
             professional_registration, created_at
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

// Service categories
app.get('/api/service-categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM service_categories ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching service categories:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Services
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
    res.status(500).json({ message: 'Erro internal do servidor' });
  }
});

// Consultations
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query = `
      SELECT c.*, 
             COALESCE(u.name, d.name) as client_name,
             s.name as service_name,
             prof.name as professional_name,
             CASE WHEN c.dependent_id IS NOT NULL THEN true ELSE false END as is_dependent
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN services s ON c.service_id = s.id
      JOIN users prof ON c.professional_id = prof.id
    `;

    const params = [];

    // Filter by role
    if (req.user.currentRole === 'professional') {
      query += ' WHERE c.professional_id = $1';
      params.push(req.user.id);
    } else if (req.user.currentRole === 'client') {
      query += ' WHERE (c.client_id = $1 OR c.dependent_id IN (SELECT id FROM dependents WHERE client_id = $1))';
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

    if ((!client_id && !dependent_id) || (client_id && dependent_id)) {
      return res.status(400).json({ message: 'Deve ser especificado apenas client_id OU dependent_id' });
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

// Dependents
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const clientId = req.params.clientId;
    
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

app.get('/api/dependents/lookup', authenticate, async (req, res) => {
  try {
    const { cpf } = req.query;
    
    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    const result = await pool.query(`
      SELECT d.*, u.name as client_name, u.subscription_status as client_subscription_status
      FROM dependents d
      JOIN users u ON d.client_id = u.id
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

// Clients lookup
app.get('/api/clients/lookup', authenticate, async (req, res) => {
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

// Professionals
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

// Reports
app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Revenue by professional
    const professionalRevenueResult = await pool.query(`
      SELECT 
        prof.name as professional_name,
        prof.percentage as professional_percentage,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue,
        SUM(c.value * prof.percentage / 100) as professional_payment,
        SUM(c.value * (100 - prof.percentage) / 100) as clinic_revenue
      FROM consultations c
      JOIN users prof ON c.professional_id = prof.id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY prof.id, prof.name, prof.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    // Revenue by service
    const serviceRevenueResult = await pool.query(`
      SELECT 
        s.name as service_name,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY s.id, s.name
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    // Total revenue
    const totalRevenueResult = await pool.query(`
      SELECT SUM(c.value) as total_revenue
      FROM consultations c
      WHERE c.date >= $1 AND c.date <= $2
    `, [start_date, end_date]);

    res.json({
      total_revenue: parseFloat(totalRevenueResult.rows[0].total_revenue || 0),
      revenue_by_professional: professionalRevenueResult.rows.map(row => ({
        ...row,
        revenue: parseFloat(row.revenue),
        professional_payment: parseFloat(row.professional_payment),
        clinic_revenue: parseFloat(row.clinic_revenue)
      })),
      revenue_by_service: serviceRevenueResult.rows.map(row => ({
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
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Get professional percentage
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [professionalId]
    );

    const percentage = professionalResult.rows[0]?.percentage || 50;

    // Get consultations for the period
    const consultationsResult = await pool.query(`
      SELECT c.*, 
             COALESCE(u.name, d.name) as client_name,
             s.name as service_name
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN services s ON c.service_id = s.id
      WHERE c.professional_id = $1 AND c.date >= $2 AND c.date <= $3
      ORDER BY c.date DESC
    `, [professionalId, start_date, end_date]);

    const consultations = consultationsResult.rows.map(row => ({
      ...row,
      total_value: parseFloat(row.value),
      amount_to_pay: parseFloat(row.value) * (100 - percentage) / 100
    }));

    const summary = {
      professional_percentage: percentage,
      consultation_count: consultations.length,
      total_revenue: consultations.reduce((sum, c) => sum + c.total_value, 0),
      amount_to_pay: consultations.reduce((sum, c) => sum + c.amount_to_pay, 0)
    };

    res.json({ summary, consultations });
  } catch (error) {
    console.error('Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;