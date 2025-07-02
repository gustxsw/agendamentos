import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { pool } from './db.js';
import { authenticate, authorize } from './middleware/auth.js';
import createUpload from './middleware/upload.js';
import multer from 'multer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 🔥 MERCADO PAGO SDK V2 CONFIGURATION
let mercadopago;
try {
  const { MercadoPagoConfig, Preference } = await import('mercadopago');
  
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('❌ MP_ACCESS_TOKEN not found in environment variables');
  } else {
    console.log('✅ MercadoPago SDK v2 access token found');
    
    // Initialize MercadoPago with SDK v2
    const client = new MercadoPagoConfig({
      accessToken: accessToken,
      options: {
        timeout: 5000,
        idempotencyKey: 'abc'
      }
    });
    
    mercadopago = {
      client,
      Preference: new Preference(client)
    };
    
    console.log('✅ MercadoPago SDK v2 initialized successfully');
  }
} catch (error) {
  console.error('❌ Error initializing MercadoPago SDK v2:', error);
}

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

// 🔥 DATABASE INITIALIZATION - CREATE ALL TABLES
const initializeDatabase = async () => {
  try {
    console.log('🔄 Initializing database tables...');

    // Create users table
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
        password_hash VARCHAR(255) NOT NULL,
        roles TEXT[] DEFAULT ARRAY['client'],
        percentage INTEGER DEFAULT 50,
        category_id INTEGER,
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_expiry TIMESTAMP,
        professional_registration VARCHAR(100),
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create service_categories table
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

    // Create consultations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id),
        dependent_id INTEGER,
        professional_id INTEGER REFERENCES users(id) NOT NULL,
        service_id INTEGER REFERENCES services(id) NOT NULL,
        value DECIMAL(10,2) NOT NULL,
        date TIMESTAMP NOT NULL,
        status VARCHAR(50) DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create dependents table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dependents (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id) NOT NULL,
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) UNIQUE NOT NULL,
        birth_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create professional_locations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_locations (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) NOT NULL,
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

    // Create agenda_subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        expires_at TIMESTAMP,
        last_payment TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create schedule_configs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_configs (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) NOT NULL UNIQUE,
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

    // Create appointments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) NOT NULL,
        patient_id INTEGER NOT NULL,
        date TIMESTAMP NOT NULL,
        status VARCHAR(50) DEFAULT 'scheduled',
        notes TEXT,
        is_convenio_patient BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create agenda_patients table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_patients (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) NOT NULL,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create medical_records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INTEGER REFERENCES consultations(id),
        patient_id INTEGER NOT NULL,
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

    // Insert default service categories if they don't exist
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
        ('Nutrição', 'Consultas nutricionais'),
        ('Odontologia', 'Serviços odontológicos')
      `);
    }

    // Insert default services if they don't exist
    const servicesResult = await pool.query('SELECT COUNT(*) FROM services');
    if (parseInt(servicesResult.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO services (name, description, base_price, category_id, is_base_service) VALUES
        ('Consulta Fisioterapia', 'Consulta inicial de fisioterapia', 80.00, 1, true),
        ('Sessão Fisioterapia', 'Sessão de fisioterapia', 60.00, 1, false),
        ('Consulta Quiropraxia', 'Consulta quiropráctica', 100.00, 2, true),
        ('Massagem Relaxante', 'Massagem para relaxamento', 70.00, 3, false),
        ('Sessão Acupuntura', 'Sessão de acupuntura', 80.00, 4, false),
        ('Aula Pilates', 'Aula individual de pilates', 60.00, 5, false),
        ('Consulta Psicológica', 'Consulta psicológica', 120.00, 6, true),
        ('Consulta Nutricional', 'Consulta com nutricionista', 90.00, 7, true),
        ('Consulta Odontológica', 'Consulta odontológica', 80.00, 8, true)
      `);
    }

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
};

// Initialize database on startup
initializeDatabase().catch(console.error);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 🔥 AUTH ROUTES
app.post('/api/auth/login', async (req, res) => {
  try {
    const { cpf, password } = req.body;

    if (!cpf || !password) {
      return res.status(400).json({ message: 'CPF e senha são obrigatórios' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    const result = await pool.query(
      'SELECT id, name, cpf, password_hash, roles FROM users WHERE cpf = $1',
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
      return res.status(400).json({ message: 'User ID e role são obrigatórios' });
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

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    const userData = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: user.roles,
      currentRole: role
    };

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

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    const userData = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: user.roles,
      currentRole: role
    };

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

    if (!/^\d{11}$/.test(cleanCpf)) {
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

// 🔥 USER ROUTES
app.get('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.cpf, u.email, u.phone, u.birth_date,
        u.address, u.address_number, u.address_complement,
        u.neighborhood, u.city, u.state, u.roles, u.percentage,
        u.category_id, u.subscription_status, u.subscription_expiry,
        u.created_at, sc.name as category_name
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
    
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.cpf, u.email, u.phone, u.birth_date,
        u.address, u.address_number, u.address_complement,
        u.neighborhood, u.city, u.state, u.roles, u.percentage,
        u.category_id, u.subscription_status, u.subscription_expiry,
        u.professional_registration, u.photo_url, u.created_at,
        sc.name as category_name
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE u.id = $1
    `, [id]);

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

    const cleanCpf = cpf.replace(/\D/g, '');

    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cleanCpf]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'CPF já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password_hash, roles,
        percentage, category_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id, name, cpf, email, roles
    `, [
      name, cleanCpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, hashedPassword, roles,
      percentage, category_id
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles,
      percentage, category_id
    } = req.body;

    // Check if user can edit this profile
    if (req.user.id !== parseInt(id) && !req.user.roles?.includes('admin')) {
      return res.status(403).json({ message: 'Não autorizado' });
    }

    const result = await pool.query(`
      UPDATE users SET
        name = $1, email = $2, phone = $3, birth_date = $4,
        address = $5, address_number = $6, address_complement = $7,
        neighborhood = $8, city = $9, state = $10, roles = $11,
        percentage = $12, category_id = $13, updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING id, name, email, roles
    `, [
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles,
      percentage, category_id, id
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
    const { id } = req.params;
    const { expiry_date } = req.body;

    if (!expiry_date) {
      return res.status(400).json({ message: 'Data de expiração é obrigatória' });
    }

    const result = await pool.query(`
      UPDATE users SET
        subscription_status = 'active',
        subscription_expiry = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, name, subscription_status, subscription_expiry
    `, [expiry_date, id]);

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
    const { id } = req.params;

    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json({ message: 'Usuário excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/users/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Senha atual e nova senha são obrigatórias' });
    }

    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const isValidPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Senha atual incorreta' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedNewPassword, userId]
    );

    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔥 SERVICE CATEGORIES ROUTES
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

// 🔥 SERVICES ROUTES
app.get('/api/services', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, sc.name as category_name
      FROM services s
      LEFT JOIN service_categories sc ON s.category_id = sc.id
      ORDER BY sc.name, s.name
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

    const result = await pool.query(`
      INSERT INTO services (name, description, base_price, category_id, is_base_service)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, description, base_price, category_id, is_base_service]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/services/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, base_price, category_id, is_base_service } = req.body;

    const result = await pool.query(`
      UPDATE services SET
        name = $1, description = $2, base_price = $3,
        category_id = $4, is_base_service = $5
      WHERE id = $6
      RETURNING *
    `, [name, description, base_price, category_id, is_base_service, id]);

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
    const { id } = req.params;

    const result = await pool.query('DELETE FROM services WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }

    res.json({ message: 'Serviço excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔥 CONSULTATIONS ROUTES
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query = `
      SELECT 
        c.id, c.value, c.date, c.status,
        s.name as service_name,
        CASE 
          WHEN c.dependent_id IS NOT NULL THEN d.name
          ELSE u.name
        END as client_name,
        p.name as professional_name,
        CASE 
          WHEN c.dependent_id IS NOT NULL THEN true
          ELSE false
        END as is_dependent
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN users p ON c.professional_id = p.id
      LEFT JOIN services s ON c.service_id = s.id
    `;

    const params = [];

    if (req.user.currentRole === 'professional') {
      query += ' WHERE c.professional_id = $1';
      params.push(req.user.id);
    } else if (req.user.currentRole === 'client') {
      query += ' WHERE (c.client_id = $1 OR d.client_id = $1)';
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
      return res.status(400).json({ message: 'Dados obrigatórios não preenchidos' });
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

// 🔥 DEPENDENTS ROUTES
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;

    // Check if user can access this client's dependents
    if (req.user.currentRole === 'client' && req.user.id !== parseInt(clientId)) {
      return res.status(403).json({ message: 'Não autorizado' });
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

app.get('/api/dependents/lookup', authenticate, async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }

    const cleanCpf = cpf.toString().replace(/\D/g, '');

    const result = await pool.query(`
      SELECT 
        d.id, d.name, d.cpf, d.birth_date, d.client_id,
        u.name as client_name, u.subscription_status as client_subscription_status
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
      return res.status(400).json({ message: 'Dados obrigatórios não preenchidos' });
    }

    // Check if user can add dependents for this client
    if (req.user.currentRole === 'client' && req.user.id !== parseInt(client_id)) {
      return res.status(403).json({ message: 'Não autorizado' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    // Check if CPF already exists
    const existingDependent = await pool.query('SELECT id FROM dependents WHERE cpf = $1', [cleanCpf]);
    if (existingDependent.rows.length > 0) {
      return res.status(409).json({ message: 'CPF já cadastrado' });
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

app.put('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, birth_date } = req.body;

    const result = await pool.query(`
      UPDATE dependents SET name = $1, birth_date = $2
      WHERE id = $3
      RETURNING *
    `, [name, birth_date, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.delete('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM dependents WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    res.json({ message: 'Dependente excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔥 CLIENTS LOOKUP ROUTE
app.get('/api/clients/lookup', authenticate, async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }

    const cleanCpf = cpf.toString().replace(/\D/g, '');

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

// 🔥 PROFESSIONALS ROUTE
app.get('/api/professionals', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.email, u.phone, u.address, u.address_number,
        u.address_complement, u.neighborhood, u.city, u.state,
        u.photo_url, sc.name as category_name
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

// 🔥 PROFESSIONAL LOCATIONS ROUTES
app.get('/api/professional-locations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM professional_locations WHERE professional_id = $1 ORDER BY is_main DESC, clinic_name',
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching professional locations:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/professional-locations', authenticate, authorize(['professional']), async (req, res) => {
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

app.put('/api/professional-locations/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main
    } = req.body;

    // If this is set as main, unset other main locations
    if (is_main) {
      await pool.query(
        'UPDATE professional_locations SET is_main = false WHERE professional_id = $1 AND id != $2',
        [req.user.id, id]
      );
    }

    const result = await pool.query(`
      UPDATE professional_locations SET
        clinic_name = $1, address = $2, address_number = $3, address_complement = $4,
        neighborhood = $5, city = $6, state = $7, phone = $8, is_main = $9
      WHERE id = $10 AND professional_id = $11
      RETURNING *
    `, [
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main, id, req.user.id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Local não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating professional location:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.delete('/api/professional-locations/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM professional_locations WHERE id = $1 AND professional_id = $2 RETURNING id',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Local não encontrado' });
    }

    res.json({ message: 'Local excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting professional location:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔥 AGENDA ROUTES
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM agenda_subscriptions WHERE professional_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.user.id]
    );

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
    const expiresAt = new Date(subscription.expires_at);
    const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));

    res.json({
      status: subscription.status,
      expires_at: subscription.expires_at,
      days_remaining: daysRemaining,
      can_use_agenda: subscription.status === 'active' && expiresAt > now,
      last_payment: subscription.last_payment
    });
  } catch (error) {
    console.error('Error fetching agenda subscription status:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM schedule_configs WHERE professional_id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      // Return default config
      return res.json({
        professional_id: req.user.id,
        monday_start: '08:00',
        monday_end: '18:00',
        tuesday_start: '08:00',
        tuesday_end: '18:00',
        wednesday_start: '08:00',
        wednesday_end: '18:00',
        thursday_start: '08:00',
        thursday_end: '18:00',
        friday_start: '08:00',
        friday_end: '18:00',
        saturday_start: null,
        saturday_end: null,
        sunday_start: null,
        sunday_end: null,
        slot_duration: 30,
        break_start: '12:00',
        break_end: '13:00'
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching schedule config:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { include_archived } = req.query;
    
    let query = `
      SELECT * FROM agenda_patients 
      WHERE professional_id = $1
    `;
    
    if (include_archived !== 'true') {
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

app.post('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, notes
    } = req.body;

    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    const result = await pool.query(`
      INSERT INTO agenda_patients (
        professional_id, name, cpf, email, phone, birth_date,
        address, address_number, address_complement, neighborhood,
        city, state, notes, is_convenio_patient
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false)
      RETURNING *
    `, [
      req.user.id, name, cleanCpf, email, phone, birth_date,
      address, address_number, address_complement, neighborhood,
      city, state, notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating agenda patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/agenda/patients/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const result = await pool.query(`
      UPDATE agenda_patients SET notes = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND professional_id = $3
      RETURNING *
    `, [notes, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating agenda patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/agenda/patients/:id/archive', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_archived } = req.body;

    const result = await pool.query(`
      UPDATE agenda_patients SET is_archived = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND professional_id = $3
      RETURNING *
    `, [is_archived, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error archiving agenda patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        a.id, a.date, a.status, a.notes,
        a.patient_id, ap.name as patient_name, ap.phone as patient_phone,
        a.is_convenio_patient
      FROM appointments a
      LEFT JOIN agenda_patients ap ON a.patient_id = ap.id
      WHERE a.professional_id = $1
    `;

    const params = [req.user.id];

    if (start_date && end_date) {
      query += ' AND a.date >= $2 AND a.date <= $3';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY a.date';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patient_id, date, notes } = req.body;

    if (!patient_id || !date) {
      return res.status(400).json({ message: 'Paciente e data são obrigatórios' });
    }

    const result = await pool.query(`
      INSERT INTO appointments (professional_id, patient_id, date, notes, status)
      VALUES ($1, $2, $3, $4, 'scheduled')
      RETURNING *
    `, [req.user.id, patient_id, date, notes]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔥 MEDICAL RECORDS ROUTES
app.get('/api/medical-records/patient/:patientId', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patientId } = req.params;

    const result = await pool.query(`
      SELECT 
        mr.*, c.date as consultation_date, s.name as service_name,
        ap.name as patient_name, ap.cpf as patient_cpf,
        u.name as professional_name, u.professional_registration
      FROM medical_records mr
      LEFT JOIN consultations c ON mr.consultation_id = c.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN agenda_patients ap ON mr.patient_id = ap.id
      LEFT JOIN users u ON mr.professional_id = u.id
      WHERE mr.patient_id = $1 AND mr.professional_id = $2
      ORDER BY mr.created_at DESC
    `, [patientId, req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching medical records:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/medical-records', authenticate, authorize(['professional']), async (req, res) => {
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
        physical_examination, diagnosis, treatment_plan,
        clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      patient_id, req.user.id, chief_complaint, anamnesis,
      physical_examination, diagnosis, treatment_plan,
      clinical_evolution, internal_notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating medical record:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/medical-records/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      chief_complaint, anamnesis, physical_examination,
      diagnosis, treatment_plan, clinical_evolution, internal_notes
    } = req.body;

    const result = await pool.query(`
      UPDATE medical_records SET
        chief_complaint = $1, anamnesis = $2, physical_examination = $3,
        diagnosis = $4, treatment_plan = $5, clinical_evolution = $6,
        internal_notes = $7, updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 AND professional_id = $9
      RETURNING *
    `, [
      chief_complaint, anamnesis, physical_examination,
      diagnosis, treatment_plan, clinical_evolution, internal_notes,
      id, req.user.id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Prontuário não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating medical record:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔥 REPORTS ROUTES
app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    const result = await pool.query(`
      SELECT 
        SUM(c.value) as total_revenue,
        COUNT(*) as total_consultations,
        json_agg(
          json_build_object(
            'professional_name', p.name,
            'professional_percentage', p.percentage,
            'revenue', prof_revenue.revenue,
            'consultation_count', prof_revenue.consultation_count,
            'professional_payment', ROUND((prof_revenue.revenue * p.percentage / 100)::numeric, 2),
            'clinic_revenue', ROUND((prof_revenue.revenue * (100 - p.percentage) / 100)::numeric, 2)
          )
        ) as revenue_by_professional,
        (
          SELECT json_agg(
            json_build_object(
              'service_name', s.name,
              'revenue', service_revenue.revenue,
              'consultation_count', service_revenue.consultation_count
            )
          )
          FROM (
            SELECT 
              c2.service_id,
              SUM(c2.value) as revenue,
              COUNT(*) as consultation_count
            FROM consultations c2
            WHERE c2.date >= $1 AND c2.date <= $2
            GROUP BY c2.service_id
          ) service_revenue
          JOIN services s ON service_revenue.service_id = s.id
        ) as revenue_by_service
      FROM consultations c
      JOIN users p ON c.professional_id = p.id
      JOIN (
        SELECT 
          professional_id,
          SUM(value) as revenue,
          COUNT(*) as consultation_count
        FROM consultations
        WHERE date >= $1 AND date <= $2
        GROUP BY professional_id
      ) prof_revenue ON c.professional_id = prof_revenue.professional_id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY ()
    `, [start_date, end_date]);

    if (result.rows.length === 0 || !result.rows[0].total_revenue) {
      return res.json({
        total_revenue: 0,
        revenue_by_professional: [],
        revenue_by_service: []
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error generating revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/reports/professional-revenue', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    const professionalId = req.user.id;

    // Get professional percentage
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [professionalId]
    );

    const percentage = professionalResult.rows[0]?.percentage || 50;

    const result = await pool.query(`
      SELECT 
        c.id, c.date, c.value,
        CASE 
          WHEN c.dependent_id IS NOT NULL THEN d.name
          ELSE u.name
        END as client_name,
        s.name as service_name,
        ROUND((c.value * (100 - $3) / 100)::numeric, 2) as amount_to_pay
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN services s ON c.service_id = s.id
      WHERE c.professional_id = $1 AND c.date >= $2 AND c.date <= $4
      ORDER BY c.date DESC
    `, [professionalId, start_date, percentage, end_date]);

    const consultations = result.rows;
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.value), 0);
    const totalAmountToPay = consultations.reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0);

    res.json({
      summary: {
        professional_percentage: percentage,
        total_revenue: totalRevenue,
        consultation_count: consultations.length,
        amount_to_pay: totalAmountToPay
      },
      consultations: consultations
    });
  } catch (error) {
    console.error('Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/reports/professional-consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    const professionalId = req.user.id;

    // Get professional percentage
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [professionalId]
    );

    const percentage = professionalResult.rows[0]?.percentage || 50;

    const result = await pool.query(`
      SELECT 
        c.id, c.consultation_id, c.date, c.value as total_value,
        CASE 
          WHEN c.dependent_id IS NOT NULL THEN d.name
          ELSE u.name
        END as patient_name,
        s.name as service_name,
        ROUND((c.value * (100 - $3) / 100)::numeric, 2) as amount_to_pay,
        CASE 
          WHEN c.client_id IS NOT NULL OR c.dependent_id IS NOT NULL THEN true
          ELSE false
        END as is_convenio_patient,
        CASE 
          WHEN mr.id IS NOT NULL THEN true
          ELSE false
        END as has_medical_record
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN medical_records mr ON c.id = mr.consultation_id
      WHERE c.professional_id = $1 AND c.date >= $2 AND c.date <= $4
      ORDER BY c.date DESC
    `, [professionalId, start_date, percentage, end_date]);

    const consultations = result.rows;
    const convenioConsultations = consultations.filter(c => c.is_convenio_patient);
    const particularConsultations = consultations.filter(c => !c.is_convenio_patient);

    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const convenioRevenue = convenioConsultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const particularRevenue = particularConsultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const totalAmountToPay = convenioConsultations.reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0);

    res.json({
      summary: {
        total_consultations: consultations.length,
        convenio_consultations: convenioConsultations.length,
        particular_consultations: particularConsultations.length,
        total_revenue: totalRevenue,
        convenio_revenue: convenioRevenue,
        particular_revenue: particularRevenue,
        amount_to_pay: totalAmountToPay
      },
      consultations: consultations
    });
  } catch (error) {
    console.error('Error generating professional consultations report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/reports/new-clients', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_new_clients,
        COUNT(*) * 250 as subscription_revenue,
        json_agg(
          json_build_object(
            'month', TO_CHAR(created_at, 'YYYY-MM'),
            'count', monthly_count,
            'revenue', monthly_count * 250
          )
        ) as clients_by_month
      FROM (
        SELECT 
          created_at,
          COUNT(*) OVER (PARTITION BY TO_CHAR(created_at, 'YYYY-MM')) as monthly_count
        FROM users
        WHERE 'client' = ANY(roles) 
        AND created_at >= $1 
        AND created_at <= $2
      ) monthly_data
    `, [start_date, end_date]);

    if (result.rows.length === 0) {
      return res.json({
        total_new_clients: 0,
        subscription_revenue: 0,
        clients_by_month: []
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error generating new clients report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/reports/professional-revenue-summary', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    const result = await pool.query(`
      SELECT 
        SUM(c.value) as total_revenue,
        json_agg(
          json_build_object(
            'professional_name', p.name,
            'professional_percentage', p.percentage,
            'revenue', prof_revenue.revenue,
            'consultation_count', prof_revenue.consultation_count,
            'professional_payment', ROUND((prof_revenue.revenue * p.percentage / 100)::numeric, 2),
            'clinic_revenue', ROUND((prof_revenue.revenue * (100 - p.percentage) / 100)::numeric, 2)
          )
        ) as revenue_by_professional,
        (
          SELECT json_agg(
            json_build_object(
              'service_name', s.name,
              'revenue', service_revenue.revenue,
              'consultation_count', service_revenue.consultation_count
            )
          )
          FROM (
            SELECT 
              c2.service_id,
              SUM(c2.value) as revenue,
              COUNT(*) as consultation_count
            FROM consultations c2
            WHERE c2.date >= $1 AND c2.date <= $2
            GROUP BY c2.service_id
          ) service_revenue
          JOIN services s ON service_revenue.service_id = s.id
        ) as revenue_by_service
      FROM consultations c
      JOIN users p ON c.professional_id = p.id
      JOIN (
        SELECT 
          professional_id,
          SUM(value) as revenue,
          COUNT(*) as consultation_count
        FROM consultations
        WHERE date >= $1 AND date <= $2
        GROUP BY professional_id
      ) prof_revenue ON c.professional_id = prof_revenue.professional_id
      WHERE c.date >= $1 AND c.date <= $2
    `, [start_date, end_date]);

    if (result.rows.length === 0 || !result.rows[0].total_revenue) {
      return res.json({
        total_revenue: 0,
        revenue_by_professional: [],
        revenue_by_service: []
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error generating professional revenue summary:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/reports/total-revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Get subscription revenue (new clients * 250)
    const subscriptionResult = await pool.query(`
      SELECT COUNT(*) * 250 as subscription_revenue
      FROM users
      WHERE 'client' = ANY(roles) 
      AND created_at >= $1 
      AND created_at <= $2
    `, [start_date, end_date]);

    // Get consultation revenue (clinic percentage)
    const consultationResult = await pool.query(`
      SELECT 
        SUM(ROUND((c.value * (100 - p.percentage) / 100)::numeric, 2)) as consultation_revenue,
        SUM(c.value) as total_consultation_value
      FROM consultations c
      JOIN users p ON c.professional_id = p.id
      WHERE c.date >= $1 AND c.date <= $2
    `, [start_date, end_date]);

    const subscriptionRevenue = parseFloat(subscriptionResult.rows[0]?.subscription_revenue || 0);
    const consultationRevenue = parseFloat(consultationResult.rows[0]?.consultation_revenue || 0);
    const totalConsultationValue = parseFloat(consultationResult.rows[0]?.total_consultation_value || 0);

    res.json({
      subscription_revenue: subscriptionRevenue,
      consultation_revenue: consultationRevenue,
      total_revenue: totalConsultationValue,
      clinic_total_revenue: subscriptionRevenue + consultationRevenue
    });
  } catch (error) {
    console.error('Error generating total revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔥 MERCADO PAGO ROUTES WITH SDK V2
app.post('/api/create-subscription', authenticate, async (req, res) => {
  try {
    if (!mercadopago) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }

    const { user_id, dependent_ids = [] } = req.body;
    
    // Calculate total amount: R$250 for titular + R$50 per dependent
    const dependentCount = dependent_ids.length;
    const totalAmount = 250 + (dependentCount * 50);

    console.log('🔄 Creating subscription payment with SDK v2:', {
      user_id,
      dependent_count: dependentCount,
      total_amount: totalAmount
    });

    // 🔥 CREATE PREFERENCE WITH SDK V2
    const preferenceData = {
      items: [
        {
          id: `subscription-${user_id}`,
          title: `Assinatura Cartão Quiro Ferreira - Titular + ${dependentCount} dependente(s)`,
          description: `Assinatura mensal do convênio para titular e ${dependentCount} dependente(s)`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: totalAmount
        }
      ],
      payer: {
        email: 'cliente@quiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=pending`
      },
      auto_return: 'approved',
      external_reference: `subscription-${user_id}-${Date.now()}`,
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`
    };

    const preference = await mercadopago.Preference.create({ body: preferenceData });
    
    console.log('✅ Subscription preference created with SDK v2:', preference.id);

    res.json({
      id: preference.id,
      init_point: preference.init_point,
      sandbox_init_point: preference.sandbox_init_point
    });
  } catch (error) {
    console.error('❌ Error creating subscription with SDK v2:', error);
    res.status(500).json({ 
      message: 'Erro ao criar pagamento de assinatura',
      error: error.message 
    });
  }
});

app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    if (!mercadopago) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }

    const { amount } = req.body;
    const professionalId = req.user.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }

    console.log('🔄 Creating professional payment with SDK v2:', {
      professional_id: professionalId,
      amount: amount
    });

    // 🔥 CREATE PREFERENCE WITH SDK V2
    const preferenceData = {
      items: [
        {
          id: `professional-payment-${professionalId}`,
          title: 'Pagamento ao Convênio Quiro Ferreira',
          description: 'Repasse de porcentagem das consultas realizadas',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: parseFloat(amount)
        }
      ],
      payer: {
        email: 'profissional@quiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=pending`
      },
      auto_return: 'approved',
      external_reference: `professional-${professionalId}-${Date.now()}`,
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`
    };

    const preference = await mercadopago.Preference.create({ body: preferenceData });
    
    console.log('✅ Professional payment preference created with SDK v2:', preference.id);

    res.json({
      id: preference.id,
      init_point: preference.init_point,
      sandbox_init_point: preference.sandbox_init_point
    });
  } catch (error) {
    console.error('❌ Error creating professional payment with SDK v2:', error);
    res.status(500).json({ 
      message: 'Erro ao criar pagamento profissional',
      error: error.message 
    });
  }
});

app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    if (!mercadopago) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }

    const professionalId = req.user.id;
    const amount = 49.90; // Fixed amount for agenda subscription

    console.log('🔄 Creating agenda subscription payment with SDK v2:', {
      professional_id: professionalId,
      amount: amount
    });

    // 🔥 CREATE PREFERENCE WITH SDK V2
    const preferenceData = {
      items: [
        {
          id: `agenda-subscription-${professionalId}`,
          title: 'Assinatura Agenda Profissional',
          description: 'Acesso mensal à agenda profissional completa',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: amount
        }
      ],
      payer: {
        email: 'profissional@quiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=pending`
      },
      auto_return: 'approved',
      external_reference: `agenda-${professionalId}-${Date.now()}`,
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`
    };

    const preference = await mercadopago.Preference.create({ body: preferenceData });
    
    console.log('✅ Agenda subscription preference created with SDK v2:', preference.id);

    res.json({
      id: preference.id,
      init_point: preference.init_point,
      sandbox_init_point: preference.sandbox_init_point
    });
  } catch (error) {
    console.error('❌ Error creating agenda subscription with SDK v2:', error);
    res.status(500).json({ 
      message: 'Erro ao criar pagamento da agenda',
      error: error.message 
    });
  }
});

// 🔥 WEBHOOK ROUTE FOR MERCADO PAGO
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    console.log('🔔 MercadoPago webhook received:', req.body);
    
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      console.log('💳 Processing payment notification:', paymentId);
      
      // Here you would typically:
      // 1. Get payment details from MercadoPago API
      // 2. Update subscription status in database
      // 3. Send confirmation email
      
      // For now, just log the payment
      console.log('✅ Payment processed successfully');
    }
    
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// 🔥 IMAGE UPLOAD ROUTE
app.post('/api/upload-image', authenticate, async (req, res) => {
  try {
    const upload = createUpload();
    
    upload.single('image')(req, res, async (err) => {
      if (err) {
        console.error('❌ Upload error:', err);
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: 'Arquivo muito grande. Máximo 5MB.' });
          }
        }
        return res.status(400).json({ message: err.message || 'Erro no upload da imagem' });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'Nenhum arquivo enviado' });
      }

      console.log('✅ Image uploaded successfully:', req.file.path);

      // Update user photo URL in database
      await pool.query(
        'UPDATE users SET photo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [req.file.path, req.user.id]
      );

      res.json({
        message: 'Imagem enviada com sucesso',
        imageUrl: req.file.path
      });
    });
  } catch (error) {
    console.error('❌ Error in image upload route:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Erro interno do servidor' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

export default app;