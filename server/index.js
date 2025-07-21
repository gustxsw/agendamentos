import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pool } from './db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticate, authorize } from './middleware/auth.js';
import uploadMiddleware from './middleware/upload.js';
import handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import htmlPdf from 'html-pdf-node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration - Allow all origins for development
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));

app.use(express.json());
app.use(cookieParser());

// Serve static files
app.use(express.static(path.join(__dirname, '../dist')));

// Initialize database tables
const initializeTables = async () => {
  try {
    console.log('🔄 Initializing database tables...');
    
    // Create users table with roles array
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
        password VARCHAR(255) NOT NULL,
        roles TEXT[] DEFAULT '{}',
        percentage INTEGER DEFAULT 50,
        category_id INTEGER,
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_expiry TIMESTAMP,
        photo_url TEXT,
        signature_url TEXT,
        professional_registration VARCHAR(100),
        professional_type VARCHAR(20) DEFAULT 'convenio',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create service categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create services table
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

    // Create dependents table
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

    // Create consultations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id),
        dependent_id INTEGER REFERENCES dependents(id),
        professional_id INTEGER REFERENCES users(id) NOT NULL,
        service_id INTEGER REFERENCES services(id) NOT NULL,
        value DECIMAL(10,2) NOT NULL,
        date TIMESTAMP NOT NULL,
        notes TEXT,
        location_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create agenda patients table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_patients (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        birth_date DATE,
        address TEXT,
        address_number VARCHAR(20),
        address_complement VARCHAR(100),
        neighborhood VARCHAR(100),
        city VARCHAR(100),
        state VARCHAR(2),
        notes TEXT,
        is_convenio_patient BOOLEAN DEFAULT false,
        is_archived BOOLEAN DEFAULT false,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create agenda appointments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES agenda_patients(id) ON DELETE CASCADE,
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        location_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create professional locations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_locations (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        clinic_name VARCHAR(255) NOT NULL,
        address TEXT NOT NULL,
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

    // Create medical records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INTEGER,
        patient_id INTEGER,
        professional_id INTEGER REFERENCES users(id) NOT NULL,
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

    // Create agenda subscription payments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_subscription_payments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        expires_at TIMESTAMP,
        payment_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default categories if they don't exist
    const categoriesResult = await pool.query('SELECT COUNT(*) FROM service_categories');
    if (parseInt(categoriesResult.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO service_categories (name, description) VALUES
        ('Fisioterapia', 'Serviços de fisioterapia e reabilitação'),
        ('Quiropraxia', 'Tratamentos quiropráticos'),
        ('Massoterapia', 'Massagens terapêuticas'),
        ('Acupuntura', 'Tratamentos com acupuntura'),
        ('Pilates', 'Aulas e sessões de pilates'),
        ('Psicologia', 'Atendimento psicológico'),
        ('Nutrição', 'Consultas nutricionais')
      `);
    }

    // Insert default services if they don't exist
    const servicesResult = await pool.query('SELECT COUNT(*) FROM services');
    if (parseInt(servicesResult.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO services (name, description, base_price, category_id, is_base_service) VALUES
        ('Consulta Fisioterapia', 'Consulta inicial de fisioterapia', 80.00, 1, true),
        ('Sessão Fisioterapia', 'Sessão de fisioterapia', 60.00, 1, false),
        ('Consulta Quiropraxia', 'Consulta quiropráxica', 100.00, 2, true),
        ('Ajuste Quiroprático', 'Ajuste da coluna vertebral', 80.00, 2, false),
        ('Massagem Relaxante', 'Massagem para relaxamento', 70.00, 3, true),
        ('Massagem Terapêutica', 'Massagem para tratamento', 80.00, 3, false),
        ('Sessão Acupuntura', 'Sessão de acupuntura', 90.00, 4, true),
        ('Aula Pilates', 'Aula individual de pilates', 60.00, 5, true),
        ('Consulta Psicológica', 'Sessão de psicoterapia', 120.00, 6, true),
        ('Consulta Nutricional', 'Consulta com nutricionista', 100.00, 7, true)
      `);
    }

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
};

// Initialize tables on startup
initializeTables();

// Auth routes
app.post('/api/auth/login', async (req, res) => {
  try {
    const { cpf, password } = req.body;

    if (!cpf || !password) {
      return res.status(400).json({ message: 'CPF e senha são obrigatórios' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    const result = await pool.query(
      'SELECT id, name, cpf, roles, password FROM users WHERE cpf = $1',
      [cleanCpf]
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

    res.json({
      user: {
        id: user.id,
        name: user.name,
        roles: userRoles
      },
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

    const result = await pool.query(
      'SELECT id, name, cpf, roles FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];
    const userRoles = user.roles || [];

    if (!userRoles.includes(role)) {
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

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        roles: userRoles,
        currentRole: role
      }
    });
  } catch (error) {
    console.error('Role selection error:', error);
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

    if (!/^\d{11}$/.test(cleanCpf)) {
      return res.status(400).json({ message: 'CPF deve conter 11 dígitos numéricos' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cleanCpf]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password, roles
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, name, cpf, roles
    `, [
      name, cleanCpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, hashedPassword, ['client']
    ]);

    const user = result.rows[0];

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      user: {
        id: user.id,
        name: user.name,
        roles: user.roles || ['client']
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

// Users routes
app.get('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.*, sc.name as category_name 
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/users/:id/activate', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { expiry_date } = req.body;

    if (!expiry_date) {
      return res.status(400).json({ message: 'Data de expiração é obrigatória' });
    }

    await pool.query(`
      UPDATE users 
      SET subscription_status = 'active', subscription_expiry = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [expiry_date, id]);

    res.json({ message: 'Cliente ativado com sucesso' });
  } catch (error) {
    console.error('Error activating client:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Service categories routes
app.get('/api/service-categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM service_categories ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching categories:', error);
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

// Professionals routes
app.get('/api/professionals', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.*, sc.name as category_name 
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

// Clients lookup routes
app.get('/api/clients/lookup/:cpf', authenticate, async (req, res) => {
  try {
    const { cpf } = req.params;
    const cleanCpf = cpf.replace(/\D/g, '');

    const result = await pool.query(`
      SELECT id, name, cpf, subscription_status, subscription_expiry
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

// Dependents routes
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;
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

app.get('/api/dependents/lookup/:cpf', authenticate, async (req, res) => {
  try {
    const { cpf } = req.params;
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

app.post('/api/dependents', authenticate, async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;

    if (!client_id || !name || !cpf) {
      return res.status(400).json({ message: 'Client ID, nome e CPF são obrigatórios' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    const existingDependent = await pool.query('SELECT id FROM dependents WHERE cpf = $1', [cleanCpf]);
    if (existingDependent.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado como dependente' });
    }

    const result = await pool.query(`
      INSERT INTO dependents (client_id, name, cpf, birth_date)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [client_id, name, cleanCpf, birth_date]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Consultations routes
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query = '';
    let params = [];

    if (req.user.currentRole === 'client') {
      // For clients, show their consultations and dependents' consultations
      query = `
        SELECT c.*, s.name as service_name, u.name as professional_name,
               COALESCE(d.name, u2.name) as client_name,
               CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users u ON c.professional_id = u.id
        LEFT JOIN users u2 ON c.client_id = u2.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE c.client_id = $1 OR d.client_id = $1
        ORDER BY c.date DESC
      `;
      params = [req.user.id];
    } else if (req.user.currentRole === 'professional') {
      // For professionals, show their consultations and completed appointments
      query = `
        SELECT * FROM (
          SELECT c.id, c.date, c.value, s.name as service_name, u.name as professional_name,
                 COALESCE(d.name, u2.name) as client_name,
                 CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent
          FROM consultations c
          JOIN services s ON c.service_id = s.id
          JOIN users u ON c.professional_id = u.id
          LEFT JOIN users u2 ON c.client_id = u2.id
          LEFT JOIN dependents d ON c.dependent_id = d.id
          WHERE c.professional_id = $1
          
          UNION ALL
          
          SELECT aa.id, aa.date, 0 as value, 'Agendamento' as service_name, u.name as professional_name,
                 ap.name as client_name, false as is_dependent
          FROM agenda_appointments aa
          JOIN agenda_patients ap ON aa.patient_id = ap.id
          JOIN users u ON aa.professional_id = u.id
          WHERE aa.professional_id = $1 AND aa.status = 'completed'
        ) combined_results
        ORDER BY date DESC
      `;
      params = [req.user.id];
    } else {
      // For admin, show all consultations
      query = `
        SELECT c.*, s.name as service_name, u.name as professional_name,
               COALESCE(d.name, u2.name) as client_name,
               CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users u ON c.professional_id = u.id
        LEFT JOIN users u2 ON c.client_id = u2.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        ORDER BY c.date DESC
      `;
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching consultations:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/consultations', authenticate, async (req, res) => {
  try {
    const { client_id, dependent_id, professional_id, service_id, value, date, notes, location_id } = req.body;

    if (!service_id || !value || !date) {
      return res.status(400).json({ message: 'Serviço, valor e data são obrigatórios' });
    }

    if (!client_id && !dependent_id) {
      return res.status(400).json({ message: 'Cliente ou dependente deve ser especificado' });
    }

    const finalProfessionalId = professional_id || req.user.id;

    const result = await pool.query(`
      INSERT INTO consultations (client_id, dependent_id, professional_id, service_id, value, date, notes, location_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [client_id, dependent_id, finalProfessionalId, service_id, value, date, notes, location_id]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating consultation:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Agenda routes
app.get('/api/agenda/subscription-status', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM agenda_subscription_payments 
      WHERE professional_id = $1 AND status = 'approved' AND expires_at > NOW()
      ORDER BY expires_at DESC LIMIT 1
    `, [req.user.id]);

    if (result.rows.length > 0) {
      const subscription = result.rows[0];
      const expiresAt = new Date(subscription.expires_at);
      const now = new Date();
      const daysRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

      res.json({
        status: 'active',
        expires_at: subscription.expires_at,
        days_remaining: Math.max(0, daysRemaining),
        can_use_agenda: true,
        last_payment: subscription.created_at
      });
    } else {
      res.json({
        status: 'inactive',
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: false
      });
    }
  } catch (error) {
    console.error('Error checking subscription status:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/agenda/patients', authenticate, async (req, res) => {
  try {
    const includeArchived = req.query.include_archived === 'true';
    
    let query = `
      SELECT * FROM agenda_patients 
      WHERE professional_id = $1
    `;
    
    if (!includeArchived) {
      query += ' AND is_archived = false';
    }
    
    query += ' ORDER BY name';

    const result = await pool.query(query, [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching agenda patients:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/agenda/patients/lookup/:cpf', authenticate, async (req, res) => {
  try {
    const { cpf } = req.params;
    const cleanCpf = cpf.replace(/\D/g, '');

    const result = await pool.query(`
      SELECT * FROM agenda_patients 
      WHERE cpf = $1 AND professional_id = $2 AND is_archived = false
    `, [cleanCpf, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up agenda patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/agenda/patients', authenticate, async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, notes
    } = req.body;

    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');
    const cleanPhone = phone ? phone.replace(/\D/g, '') : null;

    const result = await pool.query(`
      INSERT INTO agenda_patients (
        professional_id, name, cpf, email, phone, birth_date, address,
        address_number, address_complement, neighborhood, city, state, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      req.user.id, name, cleanCpf, email, cleanPhone, birth_date, address,
      address_number, address_complement, neighborhood, city, state, notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating agenda patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/agenda/appointments', authenticate, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        aa.id, aa.date, aa.status, aa.notes,
        ap.id as patient_id, ap.name as patient_name, ap.phone as patient_phone,
        ap.is_convenio_patient,
        u.id as professional_id, u.name as professional_name
      FROM agenda_appointments aa
      JOIN agenda_patients ap ON aa.patient_id = ap.id
      JOIN users u ON aa.professional_id = u.id
      WHERE aa.professional_id = $1
    `;

    const params = [req.user.id];

    if (start_date && end_date) {
      query += ' AND aa.date BETWEEN $2 AND $3';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY aa.date';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/agenda/appointments', authenticate, async (req, res) => {
  try {
    const { patient_id, date, notes, status = 'scheduled' } = req.body;

    if (!patient_id || !date) {
      return res.status(400).json({ message: 'Paciente e data são obrigatórios' });
    }

    const result = await pool.query(`
      INSERT INTO agenda_appointments (professional_id, patient_id, date, status, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [req.user.id, patient_id, date, status, notes]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Professional locations routes
app.get('/api/professional-locations', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM professional_locations 
      WHERE professional_id = $1 
      ORDER BY is_main DESC, clinic_name
    `, [req.user.id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching professional locations:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/professional-locations', authenticate, async (req, res) => {
  try {
    const {
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main
    } = req.body;

    if (!clinic_name || !address || !address_number || !neighborhood || !city || !state) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }

    // If this is set as main, unset other main locations
    if (is_main) {
      await pool.query(
        'UPDATE professional_locations SET is_main = false WHERE professional_id = $1',
        [req.user.id]
      );
    }

    const result = await pool.query(`
      INSERT INTO professional_locations (
        professional_id, clinic_name, address, address_number, address_complement,
        neighborhood, city, state, phone, is_main
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      req.user.id, clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating professional location:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Medical records routes
app.get('/api/medical-records/patient/:patientId', authenticate, async (req, res) => {
  try {
    const { patientId } = req.params;

    const result = await pool.query(`
      SELECT mr.*, 
             COALESCE(ap.name, d.name, u.name) as patient_name,
             COALESCE(ap.cpf, d.cpf, u.cpf) as patient_cpf,
             c.date as consultation_date,
             s.name as service_name,
             prof.name as professional_name,
             prof.professional_registration
      FROM medical_records mr
      LEFT JOIN consultations c ON mr.consultation_id = c.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users prof ON mr.professional_id = prof.id
      LEFT JOIN agenda_patients ap ON mr.patient_id = ap.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN users u ON c.client_id = u.id
      WHERE (mr.patient_id = $1 OR c.client_id = $1 OR c.dependent_id = $1)
        AND mr.professional_id = $2
      ORDER BY mr.created_at DESC
    `, [patientId, req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching medical records:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/medical-records', authenticate, async (req, res) => {
  try {
    const {
      patient_id, chief_complaint, anamnesis, physical_examination,
      diagnosis, treatment_plan, clinical_evolution, internal_notes
    } = req.body;

    if (!patient_id) {
      return res.status(400).json({ message: 'ID do paciente é obrigatório' });
    }

    const result = await pool.query(`
      INSERT INTO medical_records (
        patient_id, professional_id, chief_complaint, anamnesis,
        physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      patient_id, req.user.id, chief_complaint, anamnesis,
      physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating medical record:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Reports routes
app.get('/api/reports/professional-revenue', authenticate, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Get professional percentage
    const profResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [req.user.id]
    );

    const professionalPercentage = profResult.rows[0]?.percentage || 50;

    // Get consultations
    const consultationsResult = await pool.query(`
      SELECT c.*, s.name as service_name,
             COALESCE(d.name, u.name) as client_name
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE c.professional_id = $1 
        AND c.date BETWEEN $2 AND $3
      ORDER BY c.date DESC
    `, [req.user.id, start_date, end_date]);

    const consultations = consultationsResult.rows.map(consultation => ({
      date: consultation.date,
      client_name: consultation.client_name,
      service_name: consultation.service_name,
      total_value: parseFloat(consultation.value),
      amount_to_pay: parseFloat(consultation.value) * (100 - professionalPercentage) / 100
    }));

    const totalRevenue = consultations.reduce((sum, c) => sum + c.total_value, 0);
    const totalAmountToPay = consultations.reduce((sum, c) => sum + c.amount_to_pay, 0);

    const summary = {
      professional_percentage: professionalPercentage,
      total_revenue: totalRevenue,
      consultation_count: consultations.length,
      amount_to_pay: totalAmountToPay
    };

    res.json({ summary, consultations });
  } catch (error) {
    console.error('Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/reports/professional-consultations', authenticate, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Get professional percentage
    const profResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [req.user.id]
    );

    const professionalPercentage = profResult.rows[0]?.percentage || 50;

    // Get consultations with medical records info
    const consultationsResult = await pool.query(`
      SELECT c.*, s.name as service_name,
             COALESCE(d.name, u.name) as patient_name,
             CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_convenio_patient,
             CASE WHEN mr.id IS NOT NULL THEN true ELSE false END as has_medical_record
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN medical_records mr ON c.id = mr.consultation_id
      WHERE c.professional_id = $1 
        AND c.date BETWEEN $2 AND $3
      ORDER BY c.date DESC
    `, [req.user.id, start_date, end_date]);

    const consultations = consultationsResult.rows.map(consultation => ({
      id: consultation.id,
      consultation_id: consultation.id,
      date: consultation.date,
      patient_name: consultation.patient_name,
      service_name: consultation.service_name,
      total_value: parseFloat(consultation.value),
      amount_to_pay: consultation.is_convenio_patient ? 
        parseFloat(consultation.value) * (100 - professionalPercentage) / 100 : 0,
      is_convenio_patient: consultation.is_convenio_patient,
      has_medical_record: consultation.has_medical_record
    }));

    // Calculate summary
    const totalConsultations = consultations.length;
    const convenioConsultations = consultations.filter(c => c.is_convenio_patient).length;
    const particularConsultations = totalConsultations - convenioConsultations;
    const totalRevenue = consultations.reduce((sum, c) => sum + c.total_value, 0);
    const convenioRevenue = consultations.filter(c => c.is_convenio_patient).reduce((sum, c) => sum + c.total_value, 0);
    const particularRevenue = totalRevenue - convenioRevenue;
    const amountToPay = consultations.reduce((sum, c) => sum + c.amount_to_pay, 0);

    const summary = {
      total_consultations: totalConsultations,
      convenio_consultations: convenioConsultations,
      particular_consultations: particularConsultations,
      total_revenue: totalRevenue,
      convenio_revenue: convenioRevenue,
      particular_revenue: particularRevenue,
      amount_to_pay: amountToPay
    };

    res.json({ summary, consultations });
  } catch (error) {
    console.error('Error generating professional consultations report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Upload image route
app.post('/api/upload-image', authenticate, uploadMiddleware.processUpload('image'), async (req, res) => {
  try {
    if (!req.cloudinaryResult) {
      return res.status(400).json({ message: 'Nenhuma imagem foi enviada' });
    }

    // Update user's photo_url
    await pool.query(
      'UPDATE users SET photo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [req.cloudinaryResult.secure_url, req.user.id]
    );

    res.json({
      message: 'Imagem enviada com sucesso',
      imageUrl: req.cloudinaryResult.secure_url
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Signature route
app.post('/api/professional/signature', authenticate, async (req, res) => {
  try {
    const { signature_url } = req.body;

    if (!signature_url) {
      return res.status(400).json({ message: 'URL da assinatura é obrigatória' });
    }

    await pool.query(
      'UPDATE users SET signature_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [signature_url, req.user.id]
    );

    res.json({ message: 'Assinatura salva com sucesso' });
  } catch (error) {
    console.error('Error saving signature:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Password change route
app.put('/api/users/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Senha atual e nova senha são obrigatórias' });
    }

    // Get current user
    const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0];

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Senha atual incorreta' });
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedNewPassword, req.user.id]
    );

    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Clinic routes
app.get('/api/clinic/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.*, sc.name as category_name 
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE 'professional' = ANY(u.roles)
      ORDER BY u.name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic professionals:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/clinic/patients', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ap.*, u.name as professional_name, u.id as professional_id
      FROM agenda_patients ap
      JOIN users u ON ap.professional_id = u.id
      WHERE ap.is_archived = false
      ORDER BY ap.name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic patients:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/clinic/consultations', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { client_id, dependent_id, professional_id, service_id, value, date, notes } = req.body;

    if (!professional_id || !service_id || !value || !date) {
      return res.status(400).json({ message: 'Profissional, serviço, valor e data são obrigatórios' });
    }

    if (!client_id && !dependent_id) {
      return res.status(400).json({ message: 'Cliente ou dependente deve ser especificado' });
    }

    const result = await pool.query(`
      INSERT INTO consultations (client_id, dependent_id, professional_id, service_id, value, date, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [client_id, dependent_id, professional_id, service_id, value, date, notes]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating clinic consultation:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Catch-all handler: send back React's index.html file for any non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`🔗 API: http://localhost:${PORT}/api`);
});