import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { authenticate, authorize } from './middleware/auth.js';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import multer from 'multer';
import createUpload from './middleware/upload.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://www.cartaoquiroferreira.com.br',
    'https://cartaoquiroferreira.com.br'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// 🔥 COMPLETE DATABASE INITIALIZATION
const initializeDatabase = async () => {
  try {
    console.log('🔄 Initializing complete database schema...');

    // 1. Create users table with all required columns
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
        roles TEXT[] DEFAULT '{}',
        percentage INTEGER DEFAULT 50,
        category_id INTEGER,
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_expiry TIMESTAMP,
        photo_url TEXT,
        professional_registration VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Create service categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Create services table
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

    // 4. Create dependents table
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

    // 5. Create consultations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id),
        dependent_id INTEGER REFERENCES dependents(id),
        professional_id INTEGER REFERENCES users(id) NOT NULL,
        service_id INTEGER REFERENCES services(id) NOT NULL,
        value DECIMAL(10,2) NOT NULL,
        date TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. Create professional_patients table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_patients (
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
        patient_type VARCHAR(20) DEFAULT 'particular',
        is_archived BOOLEAN DEFAULT false,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 7. Create professional_locations table
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

    // 8. Create schedule_configs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_configs (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        work_start TIME DEFAULT '08:00',
        work_end TIME DEFAULT '18:00',
        break_start TIME DEFAULT '12:00',
        break_end TIME DEFAULT '13:00',
        slot_duration INTEGER DEFAULT 30,
        monday_start TIME DEFAULT '08:00',
        monday_end TIME DEFAULT '18:00',
        tuesday_start TIME DEFAULT '08:00',
        tuesday_end TIME DEFAULT '18:00',
        wednesday_start TIME DEFAULT '08:00',
        wednesday_end TIME DEFAULT '18:00',
        thursday_start TIME DEFAULT '08:00',
        thursday_end TIME DEFAULT '18:00',
        friday_start TIME DEFAULT '08:00',
        friday_end TIME DEFAULT '18:00',
        saturday_start TIME,
        saturday_end TIME,
        sunday_start TIME,
        sunday_end TIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 9. Create appointments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER,
        location_id INTEGER REFERENCES professional_locations(id),
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        is_recurring BOOLEAN DEFAULT false,
        recurrence_pattern VARCHAR(20),
        recurrence_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 10. Create medical_records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INTEGER REFERENCES consultations(id),
        patient_id INTEGER NOT NULL,
        professional_id INTEGER REFERENCES users(id) NOT NULL,
        patient_type VARCHAR(20) DEFAULT 'convenio',
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

    // 11. Create agenda_subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        status VARCHAR(20) DEFAULT 'inactive',
        expires_at TIMESTAMP,
        last_payment TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        ('Sessão Quiropraxia', 'Sessão de quiropraxia', 80.00, 2, false),
        ('Massagem Relaxante', 'Massagem para relaxamento', 70.00, 3, false),
        ('Massagem Terapêutica', 'Massagem terapêutica', 80.00, 3, true),
        ('Sessão Acupuntura', 'Sessão de acupuntura', 90.00, 4, true),
        ('Aula Pilates', 'Aula individual de pilates', 60.00, 5, false),
        ('Consulta Psicológica', 'Consulta psicológica', 120.00, 6, true),
        ('Consulta Nutricional', 'Consulta com nutricionista', 100.00, 7, true),
        ('Consulta Odontológica', 'Consulta odontológica', 80.00, 8, true)
      `);
    }

    console.log('✅ Database schema initialized successfully!');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
};

// Initialize database on startup
initializeDatabase();

// 🔥 AUTHENTICATION ROUTES
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
      roles: user.roles || []
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
      sameSite: 'lax',
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
      sameSite: 'lax',
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

    if (cleanCpf.length !== 11) {
      return res.status(400).json({ message: 'CPF deve conter 11 dígitos' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cleanCpf]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
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

// 🔥 USER MANAGEMENT ROUTES
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
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT id, name, cpf, email, phone, birth_date, address, address_number,
             address_complement, neighborhood, city, state, roles, percentage,
             category_id, subscription_status, subscription_expiry, photo_url,
             professional_registration, created_at
      FROM users 
      WHERE id = $1
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
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password_hash, roles,
        percentage, category_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id, name, cpf, email, phone, roles, percentage, category_id, created_at
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
      address_complement, neighborhood, city, state, roles, percentage, category_id
    } = req.body;

    // Check if user can edit this profile
    if (req.user.id !== parseInt(id) && !req.user.roles?.includes('admin')) {
      return res.status(403).json({ message: 'Não autorizado' });
    }

    const result = await pool.query(`
      UPDATE users SET
        name = COALESCE($1, name),
        email = $2,
        phone = $3,
        birth_date = $4,
        address = $5,
        address_number = $6,
        address_complement = $7,
        neighborhood = $8,
        city = $9,
        state = $10,
        roles = COALESCE($11, roles),
        percentage = $12,
        category_id = $13,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING id, name, cpf, email, phone, roles, percentage, category_id
    `, [
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles, percentage,
      category_id, id
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

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Nova senha deve ter pelo menos 6 caracteres' });
    }

    // Get current password hash
    const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = userResult.rows[0];
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);

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
    console.error('Error fetching categories:', error);
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
    console.error('Error creating category:', error);
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
      return res.status(400).json({ message: 'Nome e preço são obrigatórios' });
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
        name = $1,
        description = $2,
        base_price = $3,
        category_id = $4,
        is_base_service = $5
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
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }

    // Check if user can add dependents for this client
    if (req.user.currentRole === 'client' && req.user.id !== parseInt(client_id)) {
      return res.status(403).json({ message: 'Não autorizado' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    // Check if CPF already exists
    const existingDependent = await pool.query('SELECT id FROM dependents WHERE cpf = $1', [cleanCpf]);
    if (existingDependent.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
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
      UPDATE dependents SET
        name = $1,
        birth_date = $2
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

// 🔥 CONSULTATIONS ROUTES
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query = `
      SELECT c.*, 
             COALESCE(u.name, d.name) as client_name,
             s.name as service_name,
             p.name as professional_name,
             CASE 
               WHEN c.dependent_id IS NOT NULL THEN true 
               ELSE false 
             END as is_dependent
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN services s ON c.service_id = s.id
      JOIN users p ON c.professional_id = p.id
    `;

    const params = [];

    // Filter by role
    if (req.user.currentRole === 'client') {
      query += ` WHERE (c.client_id = $1 OR d.client_id = $1)`;
      params.push(req.user.id);
    } else if (req.user.currentRole === 'professional') {
      query += ` WHERE c.professional_id = $1`;
      params.push(req.user.id);
    }

    query += ` ORDER BY c.date DESC`;

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

// 🔥 CLIENT LOOKUP ROUTES
app.get('/api/clients/lookup', authenticate, authorize(['professional']), async (req, res) => {
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

// 🔥 PROFESSIONALS ROUTES
app.get('/api/professionals', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.phone, u.address, u.address_number,
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
        clinic_name = $1,
        address = $2,
        address_number = $3,
        address_complement = $4,
        neighborhood = $5,
        city = $6,
        state = $7,
        phone = $8,
        is_main = $9
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
    const result = await pool.query(`
      SELECT status, expires_at, last_payment,
             CASE 
               WHEN status = 'active' AND expires_at > CURRENT_TIMESTAMP THEN true
               ELSE false
             END as can_use_agenda,
             CASE 
               WHEN expires_at IS NOT NULL THEN 
                 GREATEST(0, EXTRACT(days FROM expires_at - CURRENT_TIMESTAMP)::integer)
               ELSE 0
             END as days_remaining
      FROM agenda_subscriptions 
      WHERE professional_id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      // Create default subscription record
      await pool.query(`
        INSERT INTO agenda_subscriptions (professional_id, status)
        VALUES ($1, 'inactive')
      `, [req.user.id]);

      res.json({
        status: 'inactive',
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: false
      });
    } else {
      res.json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM schedule_configs WHERE professional_id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      // Create default config
      const defaultConfig = await pool.query(`
        INSERT INTO schedule_configs (professional_id)
        VALUES ($1)
        RETURNING *
      `, [req.user.id]);

      res.json(defaultConfig.rows[0]);
    } else {
      res.json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error fetching schedule config:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      work_start, work_end, break_start, break_end, slot_duration,
      monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end
    } = req.body;

    const result = await pool.query(`
      INSERT INTO schedule_configs (
        professional_id, work_start, work_end, break_start, break_end, slot_duration,
        monday_start, monday_end, tuesday_start, tuesday_end,
        wednesday_start, wednesday_end, thursday_start, thursday_end,
        friday_start, friday_end, saturday_start, saturday_end,
        sunday_start, sunday_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      ON CONFLICT (professional_id) DO UPDATE SET
        work_start = EXCLUDED.work_start,
        work_end = EXCLUDED.work_end,
        break_start = EXCLUDED.break_start,
        break_end = EXCLUDED.break_end,
        slot_duration = EXCLUDED.slot_duration,
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
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      req.user.id, work_start, work_end, break_start, break_end, slot_duration,
      monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving schedule config:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { include_archived } = req.query;

    let query = `
      SELECT pp.id, pp.name, pp.cpf, pp.email, pp.phone, pp.birth_date,
             pp.address, pp.address_number, pp.address_complement, pp.neighborhood,
             pp.city, pp.state, pp.notes, pp.is_archived, pp.linked_at,
             false as is_convenio_patient
      FROM professional_patients pp
      WHERE pp.professional_id = $1
    `;

    if (include_archived !== 'true') {
      query += ` AND pp.is_archived = false`;
    }

    query += `
      UNION ALL
      SELECT u.id, u.name, u.cpf, u.email, u.phone, u.birth_date,
             u.address, u.address_number, u.address_complement, u.neighborhood,
             u.city, u.state, '' as notes, false as is_archived, u.created_at as linked_at,
             true as is_convenio_patient
      FROM users u
      WHERE 'client' = ANY(u.roles) AND u.subscription_status = 'active'
      
      UNION ALL
      SELECT d.id + 100000 as id, d.name, d.cpf, '' as email, '' as phone, d.birth_date,
             '' as address, '' as address_number, '' as address_complement, '' as neighborhood,
             '' as city, '' as state, '' as notes, false as is_archived, d.created_at as linked_at,
             true as is_convenio_patient
      FROM dependents d
      JOIN users u ON d.client_id = u.id
      WHERE u.subscription_status = 'active'
      
      ORDER BY name
    `;

    const result = await pool.query(query, [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching patients:', error);
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
      INSERT INTO professional_patients (
        professional_id, name, cpf, email, phone, birth_date, address,
        address_number, address_complement, neighborhood, city, state, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      req.user.id, name, cleanCpf, email, phone, birth_date, address,
      address_number, address_complement, neighborhood, city, state, notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/agenda/patients/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const result = await pool.query(`
      UPDATE professional_patients SET
        notes = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND professional_id = $3
      RETURNING *
    `, [notes, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/agenda/patients/:id/archive', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_archived } = req.body;

    const result = await pool.query(`
      UPDATE professional_patients SET
        is_archived = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND professional_id = $3
      RETURNING *
    `, [is_archived, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error archiving patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT a.*, 
             COALESCE(pp.name, u.name, d.name) as patient_name,
             COALESCE(pp.phone, u.phone, '') as patient_phone,
             COALESCE(pp.patient_type = 'convenio', u.id IS NOT NULL, d.id IS NOT NULL) as is_convenio_patient,
             pl.clinic_name as location_name
      FROM appointments a
      LEFT JOIN professional_patients pp ON a.patient_id = pp.id AND a.patient_id < 100000
      LEFT JOIN users u ON a.patient_id = u.id AND a.patient_id < 100000
      LEFT JOIN dependents d ON (a.patient_id - 100000) = d.id AND a.patient_id >= 100000
      LEFT JOIN professional_locations pl ON a.location_id = pl.id
      WHERE a.professional_id = $1
    `;

    const params = [req.user.id];

    if (start_date && end_date) {
      query += ` AND a.date BETWEEN $2 AND $3`;
      params.push(start_date, end_date);
    }

    query += ` ORDER BY a.date`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      patient_id, location_id, date, notes, is_recurring,
      recurrence_pattern, recurrence_end
    } = req.body;

    if (!patient_id || !location_id || !date) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }

    if (is_recurring && recurrence_end) {
      // Create recurring appointments
      const appointments = [];
      let currentDate = new Date(date);
      const endDate = new Date(recurrence_end);

      while (currentDate <= endDate) {
        const result = await pool.query(`
          INSERT INTO appointments (
            professional_id, patient_id, location_id, date, notes,
            is_recurring, recurrence_pattern
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `, [
          req.user.id, patient_id, location_id, currentDate.toISOString(),
          notes, is_recurring, recurrence_pattern
        ]);

        appointments.push(result.rows[0]);

        // Calculate next occurrence
        switch (recurrence_pattern) {
          case 'weekly':
            currentDate.setDate(currentDate.getDate() + 7);
            break;
          case 'biweekly':
            currentDate.setDate(currentDate.getDate() + 14);
            break;
          case 'monthly':
            currentDate.setMonth(currentDate.getMonth() + 1);
            break;
          default:
            currentDate = new Date(endDate.getTime() + 1); // Break the loop
        }
      }

      res.status(201).json({ message: 'Agendamentos recorrentes criados', appointments });
    } else {
      // Create single appointment
      const result = await pool.query(`
        INSERT INTO appointments (
          professional_id, patient_id, location_id, date, notes
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [req.user.id, patient_id, location_id, date, notes]);

      res.status(201).json(result.rows[0]);
    }
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
      SELECT mr.*, 
             COALESCE(pp.name, u.name, d.name) as patient_name,
             COALESCE(pp.cpf, u.cpf, d.cpf) as patient_cpf,
             c.date as consultation_date,
             s.name as service_name,
             p.name as professional_name,
             p.professional_registration
      FROM medical_records mr
      LEFT JOIN consultations c ON mr.consultation_id = c.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users p ON mr.professional_id = p.id
      LEFT JOIN professional_patients pp ON mr.patient_id = pp.id AND mr.patient_type = 'particular'
      LEFT JOIN users u ON mr.patient_id = u.id AND mr.patient_type = 'convenio'
      LEFT JOIN dependents d ON mr.patient_id = d.id AND mr.patient_type = 'dependent'
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

    // Determine patient type
    let patient_type = 'particular';
    if (patient_id >= 100000) {
      patient_type = 'dependent';
    } else {
      // Check if it's a convenio patient
      const convenioCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1 AND \'client\' = ANY(roles)',
        [patient_id]
      );
      if (convenioCheck.rows.length > 0) {
        patient_type = 'convenio';
      }
    }

    const result = await pool.query(`
      INSERT INTO medical_records (
        patient_id, professional_id, patient_type, chief_complaint, anamnesis,
        physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      patient_id, req.user.id, patient_type, chief_complaint, anamnesis,
      physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
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
        chief_complaint = $1,
        anamnesis = $2,
        physical_examination = $3,
        diagnosis = $4,
        treatment_plan = $5,
        clinical_evolution = $6,
        internal_notes = $7,
        updated_at = CURRENT_TIMESTAMP
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

    const professionalPercentage = professionalResult.rows[0]?.percentage || 50;

    // Get consultations for the period
    const consultationsResult = await pool.query(`
      SELECT c.*, 
             COALESCE(u.name, d.name) as client_name,
             s.name as service_name
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN services s ON c.service_id = s.id
      WHERE c.professional_id = $1 
        AND c.date BETWEEN $2 AND $3
      ORDER BY c.date DESC
    `, [professionalId, start_date, end_date]);

    const consultations = consultationsResult.rows.map(consultation => ({
      ...consultation,
      amount_to_pay: parseFloat(consultation.value) * (100 - professionalPercentage) / 100
    }));

    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.value), 0);
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

app.get('/api/reports/professional-consultations', authenticate, authorize(['professional']), async (req, res) => {
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

    const professionalPercentage = professionalResult.rows[0]?.percentage || 50;

    // Get consultations with medical records info
    const consultationsResult = await pool.query(`
      SELECT c.id as consultation_id, c.date, c.value as total_value,
             COALESCE(u.name, d.name) as patient_name,
             s.name as service_name,
             CASE 
               WHEN c.dependent_id IS NOT NULL OR u.id IS NOT NULL THEN true 
               ELSE false 
             END as is_convenio_patient,
             CASE 
               WHEN mr.id IS NOT NULL THEN true 
               ELSE false 
             END as has_medical_record,
             (c.value * ($4::numeric / 100)) as amount_to_pay
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN services s ON c.service_id = s.id
      LEFT JOIN medical_records mr ON c.id = mr.consultation_id
      WHERE c.professional_id = $1 
        AND c.date BETWEEN $2 AND $3
      ORDER BY c.date DESC
    `, [professionalId, start_date, end_date, 100 - professionalPercentage]);

    const consultations = consultationsResult.rows;

    // Calculate summary
    const totalConsultations = consultations.length;
    const convenioConsultations = consultations.filter(c => c.is_convenio_patient).length;
    const particularConsultations = totalConsultations - convenioConsultations;
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const convenioRevenue = consultations
      .filter(c => c.is_convenio_patient)
      .reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const particularRevenue = totalRevenue - convenioRevenue;
    const amountToPay = consultations
      .filter(c => c.is_convenio_patient)
      .reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0);

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

app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Get revenue by professional
    const professionalRevenueResult = await pool.query(`
      SELECT u.name as professional_name,
             u.percentage as professional_percentage,
             COUNT(c.id) as consultation_count,
             SUM(c.value) as revenue,
             SUM(c.value * (u.percentage::numeric / 100)) as professional_payment,
             SUM(c.value * ((100 - u.percentage)::numeric / 100)) as clinic_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY u.id, u.name, u.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    // Get revenue by service
    const serviceRevenueResult = await pool.query(`
      SELECT s.name as service_name,
             COUNT(c.id) as consultation_count,
             SUM(c.value) as revenue
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY s.id, s.name
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    const totalRevenue = professionalRevenueResult.rows.reduce(
      (sum, row) => sum + parseFloat(row.revenue || 0), 0
    );

    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: professionalRevenueResult.rows,
      revenue_by_service: serviceRevenueResult.rows
    });
  } catch (error) {
    console.error('Error generating revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/reports/new-clients', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Get new clients in the period
    const newClientsResult = await pool.query(`
      SELECT COUNT(*) as total_new_clients,
             SUM(250) as subscription_revenue
      FROM users
      WHERE 'client' = ANY(roles) 
        AND created_at BETWEEN $1 AND $2
    `, [start_date, end_date]);

    // Get clients by month
    const clientsByMonthResult = await pool.query(`
      SELECT DATE_TRUNC('month', created_at) as month,
             COUNT(*) as count,
             SUM(250) as revenue
      FROM users
      WHERE 'client' = ANY(roles) 
        AND created_at BETWEEN $1 AND $2
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `, [start_date, end_date]);

    res.json({
      total_new_clients: parseInt(newClientsResult.rows[0].total_new_clients || 0),
      subscription_revenue: parseFloat(newClientsResult.rows[0].subscription_revenue || 0),
      clients_by_month: clientsByMonthResult.rows.map(row => ({
        month: row.month.toISOString().split('T')[0].substring(0, 7),
        count: parseInt(row.count),
        revenue: parseFloat(row.revenue)
      }))
    });
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

    // Get revenue by professional
    const professionalRevenueResult = await pool.query(`
      SELECT u.name as professional_name,
             u.percentage as professional_percentage,
             COUNT(c.id) as consultation_count,
             SUM(c.value) as revenue,
             SUM(c.value * (u.percentage::numeric / 100)) as professional_payment,
             SUM(c.value * ((100 - u.percentage)::numeric / 100)) as clinic_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY u.id, u.name, u.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    // Get revenue by service
    const serviceRevenueResult = await pool.query(`
      SELECT s.name as service_name,
             COUNT(c.id) as consultation_count,
             SUM(c.value) as revenue
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY s.id, s.name
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    const totalRevenue = professionalRevenueResult.rows.reduce(
      (sum, row) => sum + parseFloat(row.revenue || 0), 0
    );

    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: professionalRevenueResult.rows,
      revenue_by_service: serviceRevenueResult.rows
    });
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

    // Get subscription revenue (new clients)
    const subscriptionResult = await pool.query(`
      SELECT COUNT(*) * 250 as subscription_revenue
      FROM users
      WHERE 'client' = ANY(roles) 
        AND created_at BETWEEN $1 AND $2
    `, [start_date, end_date]);

    // Get consultation revenue (clinic percentage)
    const consultationResult = await pool.query(`
      SELECT SUM(c.value * ((100 - u.percentage)::numeric / 100)) as consultation_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date BETWEEN $1 AND $2
    `, [start_date, end_date]);

    const subscriptionRevenue = parseFloat(subscriptionResult.rows[0].subscription_revenue || 0);
    const consultationRevenue = parseFloat(consultationResult.rows[0].consultation_revenue || 0);
    const totalRevenue = subscriptionRevenue + consultationRevenue;

    res.json({
      subscription_revenue: subscriptionRevenue,
      consultation_revenue: consultationRevenue,
      total_revenue: totalRevenue,
      clinic_total_revenue: totalRevenue
    });
  } catch (error) {
    console.error('Error generating total revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔥 IMAGE UPLOAD ROUTE
app.post('/api/upload-image', authenticate, async (req, res) => {
  try {
    let upload;
    try {
      upload = createUpload();
    } catch (error) {
      console.error('Error creating upload middleware:', error);
      return res.status(500).json({ 
        message: 'Serviço de upload não disponível. Verifique a configuração do Cloudinary.' 
      });
    }

    upload.single('image')(req, res, async (err) => {
      if (err) {
        console.error('Upload error:', err);
        return res.status(400).json({ message: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'Nenhum arquivo enviado' });
      }

      try {
        // Update user's photo URL
        await pool.query(
          'UPDATE users SET photo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [req.file.path, req.user.id]
        );

        res.json({
          message: 'Imagem enviada com sucesso',
          imageUrl: req.file.path
        });
      } catch (dbError) {
        console.error('Database error:', dbError);
        res.status(500).json({ message: 'Erro ao salvar URL da imagem' });
      }
    });
  } catch (error) {
    console.error('Error in upload route:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔥 PAYMENT ROUTES (Mercado Pago SDK v2)
app.post('/api/create-subscription', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { user_id, dependent_ids = [] } = req.body;
    
    // Calculate total amount
    const baseAmount = 250; // R$250 for titular
    const dependentAmount = dependent_ids.length * 50; // R$50 per dependent
    const totalAmount = baseAmount + dependentAmount;

    // Get user info
    const userResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [user_id]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Create preference using Mercado Pago SDK v2
    const MercadoPago = (await import('mercadopago')).default;
    
    const client = new MercadoPago({
      accessToken: process.env.MP_ACCESS_TOKEN,
      options: { timeout: 5000 }
    });

    const preference = {
      items: [
        {
          title: 'Assinatura Cartão Quiro Ferreira',
          description: `Assinatura mensal - Titular + ${dependent_ids.length} dependente(s)`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: totalAmount
        }
      ],
      payer: {
        name: user.name,
        email: user.email || 'cliente@quiroferreira.com.br'
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/client`,
        failure: `${req.protocol}://${req.get('host')}/client`,
        pending: `${req.protocol}://${req.get('host')}/client`
      },
      auto_return: 'approved',
      external_reference: `subscription_${user_id}_${Date.now()}`,
      notification_url: `${req.protocol}://${req.get('host')}/api/webhooks/mercadopago`
    };

    const response = await client.preferences.create({ body: preference });

    res.json({
      id: response.id,
      init_point: response.init_point,
      sandbox_init_point: response.sandbox_init_point
    });
  } catch (error) {
    console.error('Error creating subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    
    // Get professional info
    const userResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [professionalId]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Create preference using Mercado Pago SDK v2
    const MercadoPago = (await import('mercadopago')).default;
    
    const client = new MercadoPago({
      accessToken: process.env.MP_ACCESS_TOKEN,
      options: { timeout: 5000 }
    });

    const preference = {
      items: [
        {
          title: 'Assinatura Agenda Profissional',
          description: 'Acesso mensal à agenda profissional',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: 49.90
        }
      ],
      payer: {
        name: user.name,
        email: user.email || 'profissional@quiroferreira.com.br'
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/professional/agenda`,
        failure: `${req.protocol}://${req.get('host')}/professional/agenda`,
        pending: `${req.protocol}://${req.get('host')}/professional/agenda`
      },
      auto_return: 'approved',
      external_reference: `agenda_${professionalId}_${Date.now()}`,
      notification_url: `${req.protocol}://${req.get('host')}/api/webhooks/mercadopago`
    };

    const response = await client.preferences.create({ body: preference });

    res.json({
      id: response.id,
      init_point: response.init_point,
      sandbox_init_point: response.sandbox_init_point
    });
  } catch (error) {
    console.error('Error creating agenda subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { amount } = req.body;
    const professionalId = req.user.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }

    // Get professional info
    const userResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [professionalId]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Create preference using Mercado Pago SDK v2
    const MercadoPago = (await import('mercadopago')).default;
    
    const client = new MercadoPago({
      accessToken: process.env.MP_ACCESS_TOKEN,
      options: { timeout: 5000 }
    });

    const preference = {
      items: [
        {
          title: 'Pagamento ao Convênio',
          description: 'Repasse de consultas realizadas',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: parseFloat(amount)
        }
      ],
      payer: {
        name: user.name,
        email: user.email || 'profissional@quiroferreira.com.br'
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/professional`,
        failure: `${req.protocol}://${req.get('host')}/professional`,
        pending: `${req.protocol}://${req.get('host')}/professional`
      },
      auto_return: 'approved',
      external_reference: `payment_${professionalId}_${Date.now()}`,
      notification_url: `${req.protocol}://${req.get('host')}/api/webhooks/mercadopago`
    };

    const response = await client.preferences.create({ body: preference });

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

// 🔥 WEBHOOK ROUTE
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === 'payment') {
      const paymentId = data.id;
      
      // Get payment details from Mercado Pago
      const MercadoPago = (await import('mercadopago')).default;
      
      const client = new MercadoPago({
        accessToken: process.env.MP_ACCESS_TOKEN,
        options: { timeout: 5000 }
      });

      const payment = await client.payment.findById(paymentId);

      if (payment.status === 'approved') {
        const externalReference = payment.external_reference;
        
        if (externalReference.startsWith('subscription_')) {
          // Handle subscription payment
          const userId = externalReference.split('_')[1];
          const expiryDate = new Date();
          expiryDate.setMonth(expiryDate.getMonth() + 1);

          await pool.query(`
            UPDATE users SET
              subscription_status = 'active',
              subscription_expiry = $1,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
          `, [expiryDate, userId]);

        } else if (externalReference.startsWith('agenda_')) {
          // Handle agenda subscription payment
          const professionalId = externalReference.split('_')[1];
          const expiryDate = new Date();
          expiryDate.setMonth(expiryDate.getMonth() + 1);

          await pool.query(`
            INSERT INTO agenda_subscriptions (professional_id, status, expires_at, last_payment)
            VALUES ($1, 'active', $2, CURRENT_TIMESTAMP)
            ON CONFLICT (professional_id) DO UPDATE SET
              status = 'active',
              expires_at = $2,
              last_payment = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          `, [professionalId, expiryDate]);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ message: 'Erro no webhook' });
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
  console.log(`🔗 API URL: http://localhost:${PORT}`);
});