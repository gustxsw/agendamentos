import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { pool } from './db.js';
import { authenticate, authorize } from './middleware/auth.js';
import createUpload from './middleware/upload.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
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

// =====================================================
// DATABASE INITIALIZATION
// =====================================================
const initializeDatabase = async () => {
  try {
    console.log('🔄 Initializing database tables...');

    // 1. Service Categories Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Services Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        base_price DECIMAL(10,2) NOT NULL DEFAULT 0,
        category_id INTEGER REFERENCES service_categories(id) ON DELETE SET NULL,
        is_base_service BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Users Table
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
        percentage INTEGER DEFAULT 50,
        category_id INTEGER REFERENCES service_categories(id) ON DELETE SET NULL,
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_expiry TIMESTAMP,
        photo_url TEXT,
        professional_registration VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. Dependents Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dependents (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) UNIQUE NOT NULL,
        birth_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. Consultations Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        dependent_id INTEGER REFERENCES dependents(id) ON DELETE SET NULL,
        professional_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        value DECIMAL(10,2) NOT NULL,
        date TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT check_client_or_dependent CHECK (
          (client_id IS NOT NULL AND dependent_id IS NULL) OR 
          (client_id IS NULL AND dependent_id IS NOT NULL)
        )
      )
    `);

    // 6. Professional Locations Table
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 7. Schedule Configs Table
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

    // 8. Professional Patients Table
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
        patient_type VARCHAR(20) DEFAULT 'particular',
        is_archived BOOLEAN DEFAULT false,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(professional_id, cpf)
      )
    `);

    // 9. Appointments Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER NOT NULL REFERENCES professional_patients(id) ON DELETE CASCADE,
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        recurrence_pattern VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 10. Medical Records Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INTEGER REFERENCES consultations(id) ON DELETE SET NULL,
        patient_id INTEGER REFERENCES professional_patients(id) ON DELETE CASCADE,
        professional_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

    // 11. Agenda Subscriptions Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        expires_at TIMESTAMP,
        last_payment TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(professional_id)
      )
    `);

    // Insert default service categories if they don't exist
    await pool.query(`
      INSERT INTO service_categories (name, description) 
      VALUES 
        ('Fisioterapia', 'Serviços de fisioterapia e reabilitação'),
        ('Quiropraxia', 'Tratamentos quiropráticos'),
        ('Massoterapia', 'Massagens terapêuticas'),
        ('Acupuntura', 'Tratamentos com acupuntura'),
        ('Pilates', 'Aulas e sessões de pilates'),
        ('Psicologia', 'Atendimento psicológico'),
        ('Nutrição', 'Consultas nutricionais'),
        ('Odontologia', 'Serviços odontológicos')
      ON CONFLICT (name) DO NOTHING
    `);

    // Insert default services if they don't exist
    const categoryResult = await pool.query('SELECT id, name FROM service_categories');
    const categories = categoryResult.rows;

    for (const category of categories) {
      let services = [];
      
      switch (category.name) {
        case 'Fisioterapia':
          services = [
            { name: 'Consulta Fisioterapêutica', price: 80.00 },
            { name: 'Sessão de Fisioterapia', price: 60.00 },
            { name: 'RPG - Reeducação Postural Global', price: 90.00 }
          ];
          break;
        case 'Quiropraxia':
          services = [
            { name: 'Consulta Quiroprática', price: 100.00 },
            { name: 'Ajuste Quiroprático', price: 80.00 }
          ];
          break;
        case 'Massoterapia':
          services = [
            { name: 'Massagem Relaxante', price: 70.00 },
            { name: 'Massagem Terapêutica', price: 80.00 },
            { name: 'Drenagem Linfática', price: 90.00 }
          ];
          break;
        case 'Acupuntura':
          services = [
            { name: 'Sessão de Acupuntura', price: 85.00 },
            { name: 'Acupuntura Estética', price: 100.00 }
          ];
          break;
        case 'Pilates':
          services = [
            { name: 'Aula de Pilates Individual', price: 60.00 },
            { name: 'Aula de Pilates em Dupla', price: 40.00 }
          ];
          break;
        case 'Psicologia':
          services = [
            { name: 'Consulta Psicológica', price: 120.00 },
            { name: 'Terapia de Casal', price: 150.00 }
          ];
          break;
        case 'Nutrição':
          services = [
            { name: 'Consulta Nutricional', price: 100.00 },
            { name: 'Retorno Nutricional', price: 80.00 }
          ];
          break;
        case 'Odontologia':
          services = [
            { name: 'Consulta Odontológica', price: 80.00 },
            { name: 'Limpeza Dental', price: 100.00 },
            { name: 'Restauração', price: 150.00 }
          ];
          break;
      }

      for (const service of services) {
        await pool.query(`
          INSERT INTO services (name, description, base_price, category_id, is_base_service)
          VALUES ($1, $2, $3, $4, true)
          ON CONFLICT DO NOTHING
        `, [service.name, `Serviço de ${category.name}`, service.price, category.id]);
      }
    }

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
};

// Initialize database on startup
initializeDatabase().catch(console.error);

// =====================================================
// AUTHENTICATION ROUTES
// =====================================================

// Login
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

// Select Role
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

    res.json({ token, user: userData });
  } catch (error) {
    console.error('Role selection error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Switch Role
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

    res.json({ token, user: userData });
  } catch (error) {
    console.error('Role switch error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Register
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

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE cpf = $1',
      [cleanCpf]
    );

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

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout realizado com sucesso' });
});

// =====================================================
// USER ROUTES
// =====================================================

// Get all users (admin only)
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
    res.status(500).json({ message: 'Erro ao buscar usuários' });
  }
});

// Get user by ID
app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.cpf, u.email, u.phone, u.birth_date,
        u.address, u.address_number, u.address_complement,
        u.neighborhood, u.city, u.state, u.roles, u.percentage,
        u.category_id, u.subscription_status, u.subscription_expiry,
        u.photo_url, u.professional_registration, u.created_at,
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
    res.status(500).json({ message: 'Erro ao buscar usuário' });
  }
});

// Create user (admin only)
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

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE cpf = $1',
      [cleanCpf]
    );

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
    res.status(500).json({ message: 'Erro ao criar usuário' });
  }
});

// Update user
app.put('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles,
      percentage, category_id
    } = req.body;

    // Check if user can update this profile
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
    res.status(500).json({ message: 'Erro ao atualizar usuário' });
  }
});

// Delete user (admin only)
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
    res.status(500).json({ message: 'Erro ao excluir usuário' });
  }
});

// Activate client (admin only)
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
      WHERE id = $2 AND 'client' = ANY(roles)
      RETURNING id, name, subscription_status, subscription_expiry
    `, [expiry_date, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error activating client:', error);
    res.status(500).json({ message: 'Erro ao ativar cliente' });
  }
});

// Change password
app.put('/api/users/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Senha atual e nova senha são obrigatórias' });
    }

    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

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
    res.status(500).json({ message: 'Erro ao alterar senha' });
  }
});

// =====================================================
// SERVICE CATEGORIES ROUTES
// =====================================================

// Get all service categories
app.get('/api/service-categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, description, created_at
      FROM service_categories
      ORDER BY name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching service categories:', error);
    res.status(500).json({ message: 'Erro ao buscar categorias' });
  }
});

// Create service category (admin only)
app.post('/api/service-categories', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Nome é obrigatório' });
    }

    const result = await pool.query(`
      INSERT INTO service_categories (name, description)
      VALUES ($1, $2)
      RETURNING id, name, description, created_at
    `, [name, description]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating service category:', error);
    if (error.code === '23505') {
      res.status(409).json({ message: 'Categoria já existe' });
    } else {
      res.status(500).json({ message: 'Erro ao criar categoria' });
    }
  }
});

// =====================================================
// SERVICES ROUTES
// =====================================================

// Get all services
app.get('/api/services', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.id, s.name, s.description, s.base_price, s.category_id,
        s.is_base_service, s.created_at, sc.name as category_name
      FROM services s
      LEFT JOIN service_categories sc ON s.category_id = sc.id
      ORDER BY sc.name, s.name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ message: 'Erro ao buscar serviços' });
  }
});

// Create service (admin only)
app.post('/api/services', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description, base_price, category_id, is_base_service } = req.body;

    if (!name || !base_price) {
      return res.status(400).json({ message: 'Nome e preço são obrigatórios' });
    }

    const result = await pool.query(`
      INSERT INTO services (name, description, base_price, category_id, is_base_service)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, description, base_price, category_id, is_base_service
    `, [name, description, base_price, category_id, is_base_service]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ message: 'Erro ao criar serviço' });
  }
});

// Update service (admin only)
app.put('/api/services/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, base_price, category_id, is_base_service } = req.body;

    const result = await pool.query(`
      UPDATE services SET
        name = $1, description = $2, base_price = $3,
        category_id = $4, is_base_service = $5, updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING id, name, description, base_price, category_id, is_base_service
    `, [name, description, base_price, category_id, is_base_service, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({ message: 'Erro ao atualizar serviço' });
  }
});

// Delete service (admin only)
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
    res.status(500).json({ message: 'Erro ao excluir serviço' });
  }
});

// =====================================================
// CONSULTATIONS ROUTES
// =====================================================

// Get all consultations
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query = `
      SELECT 
        c.id, c.value, c.date, c.created_at,
        s.name as service_name,
        CASE 
          WHEN c.client_id IS NOT NULL THEN u.name
          WHEN c.dependent_id IS NOT NULL THEN d.name
        END as client_name,
        CASE 
          WHEN c.dependent_id IS NOT NULL THEN true
          ELSE false
        END as is_dependent,
        p.name as professional_name
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN users p ON c.professional_id = p.id
      LEFT JOIN services s ON c.service_id = s.id
    `;

    const params = [];

    // Filter by role
    if (req.user.currentRole === 'client') {
      query += ` WHERE (c.client_id = $1 OR c.dependent_id IN (
        SELECT id FROM dependents WHERE client_id = $1
      ))`;
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
    res.status(500).json({ message: 'Erro ao buscar consultas' });
  }
});

// Create consultation (professional only)
app.post('/api/consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { client_id, dependent_id, service_id, value, date } = req.body;
    const professional_id = req.user.id;

    if ((!client_id && !dependent_id) || !service_id || !value || !date) {
      return res.status(400).json({ message: 'Dados obrigatórios não preenchidos' });
    }

    if (client_id && dependent_id) {
      return res.status(400).json({ message: 'Não é possível selecionar cliente e dependente ao mesmo tempo' });
    }

    // Verify client/dependent exists and has active subscription
    let subscriptionCheck;
    if (client_id) {
      subscriptionCheck = await pool.query(
        'SELECT subscription_status FROM users WHERE id = $1',
        [client_id]
      );
    } else {
      subscriptionCheck = await pool.query(`
        SELECT u.subscription_status 
        FROM dependents d 
        JOIN users u ON d.client_id = u.id 
        WHERE d.id = $1
      `, [dependent_id]);
    }

    if (subscriptionCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente ou dependente não encontrado' });
    }

    if (subscriptionCheck.rows[0].subscription_status !== 'active') {
      return res.status(400).json({ message: 'Cliente não possui assinatura ativa' });
    }

    const result = await pool.query(`
      INSERT INTO consultations (client_id, dependent_id, professional_id, service_id, value, date)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, client_id, dependent_id, professional_id, service_id, value, date
    `, [client_id, dependent_id, professional_id, service_id, value, date]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating consultation:', error);
    res.status(500).json({ message: 'Erro ao registrar consulta' });
  }
});

// =====================================================
// DEPENDENTS ROUTES
// =====================================================

// Get dependents by client ID
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;

    // Check if user can access these dependents
    if (req.user.currentRole === 'client' && req.user.id !== parseInt(clientId)) {
      return res.status(403).json({ message: 'Não autorizado' });
    }

    const result = await pool.query(`
      SELECT id, name, cpf, birth_date, created_at
      FROM dependents
      WHERE client_id = $1
      ORDER BY name
    `, [clientId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dependents:', error);
    res.status(500).json({ message: 'Erro ao buscar dependentes' });
  }
});

// Lookup dependent by CPF
app.get('/api/dependents/lookup', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    const result = await pool.query(`
      SELECT 
        d.id, d.name, d.cpf, d.birth_date,
        d.client_id, u.name as client_name,
        u.subscription_status as client_subscription_status
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
    res.status(500).json({ message: 'Erro ao buscar dependente' });
  }
});

// Create dependent
app.post('/api/dependents', authenticate, async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;

    if (!client_id || !name || !cpf) {
      return res.status(400).json({ message: 'Dados obrigatórios não preenchidos' });
    }

    // Check if user can create dependents for this client
    if (req.user.currentRole === 'client' && req.user.id !== parseInt(client_id)) {
      return res.status(403).json({ message: 'Não autorizado' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    // Check if CPF already exists
    const existingCpf = await pool.query(
      'SELECT id FROM dependents WHERE cpf = $1 UNION SELECT id FROM users WHERE cpf = $1',
      [cleanCpf]
    );

    if (existingCpf.rows.length > 0) {
      return res.status(409).json({ message: 'CPF já cadastrado' });
    }

    // Check dependent limit (10 per client)
    const dependentCount = await pool.query(
      'SELECT COUNT(*) FROM dependents WHERE client_id = $1',
      [client_id]
    );

    if (parseInt(dependentCount.rows[0].count) >= 10) {
      return res.status(400).json({ message: 'Limite de 10 dependentes por cliente' });
    }

    const result = await pool.query(`
      INSERT INTO dependents (client_id, name, cpf, birth_date)
      VALUES ($1, $2, $3, $4)
      RETURNING id, client_id, name, cpf, birth_date, created_at
    `, [client_id, name, cleanCpf, birth_date]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating dependent:', error);
    res.status(500).json({ message: 'Erro ao criar dependente' });
  }
});

// Update dependent
app.put('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, birth_date } = req.body;

    // Check if user can update this dependent
    if (req.user.currentRole === 'client') {
      const dependentCheck = await pool.query(
        'SELECT client_id FROM dependents WHERE id = $1',
        [id]
      );

      if (dependentCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Dependente não encontrado' });
      }

      if (dependentCheck.rows[0].client_id !== req.user.id) {
        return res.status(403).json({ message: 'Não autorizado' });
      }
    }

    const result = await pool.query(`
      UPDATE dependents SET
        name = $1, birth_date = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING id, name, cpf, birth_date
    `, [name, birth_date, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating dependent:', error);
    res.status(500).json({ message: 'Erro ao atualizar dependente' });
  }
});

// Delete dependent
app.delete('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user can delete this dependent
    if (req.user.currentRole === 'client') {
      const dependentCheck = await pool.query(
        'SELECT client_id FROM dependents WHERE id = $1',
        [id]
      );

      if (dependentCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Dependente não encontrado' });
      }

      if (dependentCheck.rows[0].client_id !== req.user.id) {
        return res.status(403).json({ message: 'Não autorizado' });
      }
    }

    const result = await pool.query('DELETE FROM dependents WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    res.json({ message: 'Dependente excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting dependent:', error);
    res.status(500).json({ message: 'Erro ao excluir dependente' });
  }
});

// =====================================================
// CLIENT LOOKUP ROUTES
// =====================================================

// Lookup client by CPF (professional only)
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
    res.status(500).json({ message: 'Erro ao buscar cliente' });
  }
});

// =====================================================
// PROFESSIONALS ROUTES
// =====================================================

// Get all professionals (client only)
app.get('/api/professionals', authenticate, authorize(['client']), async (req, res) => {
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
    res.status(500).json({ message: 'Erro ao buscar profissionais' });
  }
});

// =====================================================
// PROFESSIONAL LOCATIONS ROUTES
// =====================================================

// Get professional locations
app.get('/api/professional-locations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, clinic_name, address, address_number, address_complement,
             neighborhood, city, state, phone, is_main, created_at
      FROM professional_locations
      WHERE professional_id = $1
      ORDER BY is_main DESC, clinic_name
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching professional locations:', error);
    res.status(500).json({ message: 'Erro ao buscar locais' });
  }
});

// Create professional location
app.post('/api/professional-locations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main
    } = req.body;

    if (!clinic_name || !address || !address_number || !neighborhood || !city || !state) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }

    // If this is main location, unset other main locations
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
      RETURNING id, clinic_name, address, address_number, address_complement,
                neighborhood, city, state, phone, is_main, created_at
    `, [
      req.user.id, clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating professional location:', error);
    res.status(500).json({ message: 'Erro ao criar local' });
  }
});

// Update professional location
app.put('/api/professional-locations/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main
    } = req.body;

    // If this is main location, unset other main locations
    if (is_main) {
      await pool.query(
        'UPDATE professional_locations SET is_main = false WHERE professional_id = $1 AND id != $2',
        [req.user.id, id]
      );
    }

    const result = await pool.query(`
      UPDATE professional_locations SET
        clinic_name = $1, address = $2, address_number = $3, address_complement = $4,
        neighborhood = $5, city = $6, state = $7, phone = $8, is_main = $9,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10 AND professional_id = $11
      RETURNING id, clinic_name, address, address_number, address_complement,
                neighborhood, city, state, phone, is_main
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
    res.status(500).json({ message: 'Erro ao atualizar local' });
  }
});

// Delete professional location
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
    res.status(500).json({ message: 'Erro ao excluir local' });
  }
});

// =====================================================
// AGENDA ROUTES
// =====================================================

// Get agenda subscription status
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT status, expires_at, last_payment
      FROM agenda_subscriptions
      WHERE professional_id = $1
    `, [req.user.id]);

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
    const canUseAgenda = subscription.status === 'active' && expiresAt > now;

    res.json({
      status: subscription.status,
      expires_at: subscription.expires_at,
      days_remaining: daysRemaining,
      can_use_agenda: canUseAgenda,
      last_payment: subscription.last_payment
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ message: 'Erro ao buscar status da assinatura' });
  }
});

// Get schedule config
app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
             wednesday_start, wednesday_end, thursday_start, thursday_end,
             friday_start, friday_end, saturday_start, saturday_end,
             sunday_start, sunday_end, slot_duration, break_start, break_end
      FROM schedule_configs
      WHERE professional_id = $1
    `, [req.user.id]);

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
        break_start: null,
        break_end: null
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching schedule config:', error);
    res.status(500).json({ message: 'Erro ao buscar configuração de horários' });
  }
});

// Save schedule config
app.post('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end, slot_duration, break_start, break_end
    } = req.body;

    // Convert empty strings to null for time fields
    const timeFields = {
      monday_start: monday_start || null,
      monday_end: monday_end || null,
      tuesday_start: tuesday_start || null,
      tuesday_end: tuesday_end || null,
      wednesday_start: wednesday_start || null,
      wednesday_end: wednesday_end || null,
      thursday_start: thursday_start || null,
      thursday_end: thursday_end || null,
      friday_start: friday_start || null,
      friday_end: friday_end || null,
      saturday_start: saturday_start || null,
      saturday_end: saturday_end || null,
      sunday_start: sunday_start || null,
      sunday_end: sunday_end || null,
      break_start: break_start || null,
      break_end: break_end || null
    };

    const result = await pool.query(`
      INSERT INTO schedule_configs (
        professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
        wednesday_start, wednesday_end, thursday_start, thursday_end,
        friday_start, friday_end, saturday_start, saturday_end,
        sunday_start, sunday_end, slot_duration, break_start, break_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (professional_id) DO UPDATE SET
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
      req.user.id,
      timeFields.monday_start, timeFields.monday_end,
      timeFields.tuesday_start, timeFields.tuesday_end,
      timeFields.wednesday_start, timeFields.wednesday_end,
      timeFields.thursday_start, timeFields.thursday_end,
      timeFields.friday_start, timeFields.friday_end,
      timeFields.saturday_start, timeFields.saturday_end,
      timeFields.sunday_start, timeFields.sunday_end,
      slot_duration || 30,
      timeFields.break_start, timeFields.break_end
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving schedule config:', error);
    res.status(500).json({ message: 'Erro ao salvar configuração de horários' });
  }
});

// Get agenda patients
app.get('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { include_archived } = req.query;
    
    let query = `
      SELECT 
        pp.id, pp.name, pp.cpf, pp.email, pp.phone, pp.birth_date,
        pp.address, pp.address_number, pp.address_complement,
        pp.neighborhood, pp.city, pp.state, pp.notes, pp.patient_type,
        pp.is_archived, pp.linked_at, pp.created_at,
        CASE WHEN pp.patient_type = 'convenio' THEN true ELSE false END as is_convenio_patient
      FROM professional_patients pp
      WHERE pp.professional_id = $1
    `;

    const params = [req.user.id];

    if (include_archived !== 'true') {
      query += ` AND pp.is_archived = false`;
    }

    query += ` ORDER BY pp.name`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching agenda patients:', error);
    res.status(500).json({ message: 'Erro ao buscar pacientes' });
  }
});

// Create agenda patient
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
        professional_id, name, cpf, email, phone, birth_date,
        address, address_number, address_complement, neighborhood,
        city, state, notes, patient_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'particular')
      RETURNING id, name, cpf, email, phone, birth_date, address, address_number,
                address_complement, neighborhood, city, state, notes, patient_type,
                is_archived, linked_at, created_at
    `, [
      req.user.id, name, cleanCpf, email, phone, birth_date,
      address, address_number, address_complement, neighborhood,
      city, state, notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating patient:', error);
    if (error.code === '23505') {
      res.status(409).json({ message: 'CPF já cadastrado para este profissional' });
    } else {
      res.status(500).json({ message: 'Erro ao criar paciente' });
    }
  }
});

// Update agenda patient
app.put('/api/agenda/patients/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const result = await pool.query(`
      UPDATE professional_patients SET
        notes = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND professional_id = $3
      RETURNING id, name, cpf, notes
    `, [notes, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating patient:', error);
    res.status(500).json({ message: 'Erro ao atualizar paciente' });
  }
});

// Archive/unarchive patient
app.put('/api/agenda/patients/:id/archive', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_archived } = req.body;

    const result = await pool.query(`
      UPDATE professional_patients SET
        is_archived = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND professional_id = $3
      RETURNING id, name, is_archived
    `, [is_archived, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error archiving patient:', error);
    res.status(500).json({ message: 'Erro ao arquivar paciente' });
  }
});

// Get appointments
app.get('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        a.id, a.date, a.status, a.notes,
        pp.id as patient_id, pp.name as patient_name, pp.phone as patient_phone,
        CASE WHEN pp.patient_type = 'convenio' THEN true ELSE false END as is_convenio_patient
      FROM appointments a
      JOIN professional_patients pp ON a.patient_id = pp.id
      WHERE a.professional_id = $1
    `;

    const params = [req.user.id];

    if (start_date && end_date) {
      query += ` AND a.date >= $2 AND a.date <= $3`;
      params.push(start_date, end_date);
    }

    query += ` ORDER BY a.date`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro ao buscar agendamentos' });
  }
});

// Create appointment
app.post('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patient_id, date, notes } = req.body;

    if (!patient_id || !date) {
      return res.status(400).json({ message: 'Paciente e data são obrigatórios' });
    }

    // Verify patient belongs to this professional
    const patientCheck = await pool.query(
      'SELECT id FROM professional_patients WHERE id = $1 AND professional_id = $2',
      [patient_id, req.user.id]
    );

    if (patientCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    const result = await pool.query(`
      INSERT INTO appointments (professional_id, patient_id, date, notes)
      VALUES ($1, $2, $3, $4)
      RETURNING id, professional_id, patient_id, date, status, notes, created_at
    `, [req.user.id, patient_id, date, notes]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erro ao criar agendamento' });
  }
});

// Update appointment
app.put('/api/agenda/appointments/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { date, status, notes } = req.body;

    const result = await pool.query(`
      UPDATE appointments SET
        date = COALESCE($1, date),
        status = COALESCE($2, status),
        notes = COALESCE($3, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 AND professional_id = $5
      RETURNING id, date, status, notes
    `, [date, status, notes, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ message: 'Erro ao atualizar agendamento' });
  }
});

// Delete appointment
app.delete('/api/agenda/appointments/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM appointments WHERE id = $1 AND professional_id = $2 RETURNING id',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    res.json({ message: 'Agendamento excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting appointment:', error);
    res.status(500).json({ message: 'Erro ao excluir agendamento' });
  }
});

// =====================================================
// MEDICAL RECORDS ROUTES
// =====================================================

// Get medical records by patient
app.get('/api/medical-records/patient/:patientId', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patientId } = req.params;

    const result = await pool.query(`
      SELECT 
        mr.id, mr.consultation_id, mr.patient_id, mr.patient_type,
        mr.chief_complaint, mr.anamnesis, mr.physical_examination,
        mr.diagnosis, mr.treatment_plan, mr.clinical_evolution,
        mr.internal_notes, mr.created_at, mr.updated_at,
        pp.name as patient_name, pp.cpf as patient_cpf,
        c.date as consultation_date, s.name as service_name,
        u.name as professional_name, u.professional_registration
      FROM medical_records mr
      LEFT JOIN professional_patients pp ON mr.patient_id = pp.id
      LEFT JOIN consultations c ON mr.consultation_id = c.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users u ON mr.professional_id = u.id
      WHERE mr.patient_id = $1 AND mr.professional_id = $2
      ORDER BY mr.created_at DESC
    `, [patientId, req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching medical records:', error);
    res.status(500).json({ message: 'Erro ao buscar prontuários' });
  }
});

// Create medical record
app.post('/api/medical-records', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      patient_id, chief_complaint, anamnesis, physical_examination,
      diagnosis, treatment_plan, clinical_evolution, internal_notes
    } = req.body;

    if (!patient_id) {
      return res.status(400).json({ message: 'ID do paciente é obrigatório' });
    }

    // Verify patient belongs to this professional
    const patientCheck = await pool.query(
      'SELECT id, patient_type FROM professional_patients WHERE id = $1 AND professional_id = $2',
      [patient_id, req.user.id]
    );

    if (patientCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    const patientType = patientCheck.rows[0].patient_type || 'particular';

    const result = await pool.query(`
      INSERT INTO medical_records (
        patient_id, professional_id, patient_type, chief_complaint,
        anamnesis, physical_examination, diagnosis, treatment_plan,
        clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, patient_id, professional_id, patient_type, chief_complaint,
                anamnesis, physical_examination, diagnosis, treatment_plan,
                clinical_evolution, internal_notes, created_at, updated_at
    `, [
      patient_id, req.user.id, patientType, chief_complaint,
      anamnesis, physical_examination, diagnosis, treatment_plan,
      clinical_evolution, internal_notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating medical record:', error);
    res.status(500).json({ message: 'Erro ao criar prontuário' });
  }
});

// Update medical record
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
      RETURNING id, chief_complaint, anamnesis, physical_examination,
                diagnosis, treatment_plan, clinical_evolution, internal_notes,
                updated_at
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
    res.status(500).json({ message: 'Erro ao atualizar prontuário' });
  }
});

// =====================================================
// REPORTS ROUTES
// =====================================================

// Professional revenue report
app.get('/api/reports/professional-revenue', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const professionalId = req.user.id;

    // Get professional percentage
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [professionalId]
    );

    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }

    const professionalPercentage = professionalResult.rows[0].percentage || 50;

    let query = `
      SELECT 
        c.id, c.date, c.value as total_value,
        CASE 
          WHEN c.client_id IS NOT NULL THEN u.name
          WHEN c.dependent_id IS NOT NULL THEN d.name
        END as client_name,
        s.name as service_name,
        ROUND(c.value * (100 - $1) / 100, 2) as amount_to_pay
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN services s ON c.service_id = s.id
      WHERE c.professional_id = $2
    `;

    const params = [professionalPercentage, professionalId];

    if (start_date && end_date) {
      query += ` AND c.date >= $3 AND c.date <= $4`;
      params.push(start_date, end_date);
    }

    query += ` ORDER BY c.date DESC`;

    const result = await pool.query(query, params);

    // Calculate summary
    const consultations = result.rows;
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const amountToPay = consultations.reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0);

    const summary = {
      professional_percentage: professionalPercentage,
      total_revenue: totalRevenue,
      consultation_count: consultations.length,
      amount_to_pay: amountToPay
    };

    res.json({ summary, consultations });
  } catch (error) {
    console.error('Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

// Professional consultations report
app.get('/api/reports/professional-consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const professionalId = req.user.id;

    // Get professional percentage
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [professionalId]
    );

    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }

    const professionalPercentage = professionalResult.rows[0].percentage || 50;

    let query = `
      SELECT 
        c.id, c.consultation_id, c.date, c.value as total_value,
        CASE 
          WHEN c.client_id IS NOT NULL THEN u.name
          WHEN c.dependent_id IS NOT NULL THEN d.name
        END as patient_name,
        s.name as service_name,
        CASE 
          WHEN c.client_id IS NOT NULL THEN true
          WHEN c.dependent_id IS NOT NULL THEN true
          ELSE false
        END as is_convenio_patient,
        ROUND(c.value * (100 - $1) / 100, 2) as amount_to_pay,
        CASE WHEN mr.id IS NOT NULL THEN true ELSE false END as has_medical_record
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN medical_records mr ON c.id = mr.consultation_id
      WHERE c.professional_id = $2
    `;

    const params = [professionalPercentage, professionalId];

    if (start_date && end_date) {
      query += ` AND c.date >= $3 AND c.date <= $4`;
      params.push(start_date, end_date);
    }

    query += ` ORDER BY c.date DESC`;

    const result = await pool.query(query, params);

    // Calculate summary
    const consultations = result.rows;
    const totalConsultations = consultations.length;
    const convenioConsultations = consultations.filter(c => c.is_convenio_patient).length;
    const particularConsultations = totalConsultations - convenioConsultations;
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const convenioRevenue = consultations
      .filter(c => c.is_convenio_patient)
      .reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const particularRevenue = totalRevenue - convenioRevenue;
    const amountToPay = consultations.reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0);

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
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

// Revenue report (admin only)
app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        c.id, c.value, c.date,
        CASE 
          WHEN c.client_id IS NOT NULL THEN u.name
          WHEN c.dependent_id IS NOT NULL THEN d.name
        END as client_name,
        s.name as service_name,
        p.name as professional_name,
        p.percentage as professional_percentage,
        ROUND(c.value * p.percentage / 100, 2) as professional_payment,
        ROUND(c.value * (100 - p.percentage) / 100, 2) as clinic_revenue
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users p ON c.professional_id = p.id
      WHERE 1=1
    `;

    const params = [];

    if (start_date && end_date) {
      query += ` AND c.date >= $1 AND c.date <= $2`;
      params.push(start_date, end_date);
    }

    query += ` ORDER BY c.date DESC`;

    const result = await pool.query(query, params);

    // Calculate totals
    const consultations = result.rows;
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.value), 0);

    // Group by professional
    const revenueByProfessional = consultations.reduce((acc, consultation) => {
      const profName = consultation.professional_name;
      if (!acc[profName]) {
        acc[profName] = {
          professional_name: profName,
          professional_percentage: consultation.professional_percentage,
          revenue: 0,
          consultation_count: 0,
          professional_payment: 0,
          clinic_revenue: 0
        };
      }
      acc[profName].revenue += parseFloat(consultation.value);
      acc[profName].consultation_count += 1;
      acc[profName].professional_payment += parseFloat(consultation.professional_payment);
      acc[profName].clinic_revenue += parseFloat(consultation.clinic_revenue);
      return acc;
    }, {});

    // Group by service
    const revenueByService = consultations.reduce((acc, consultation) => {
      const serviceName = consultation.service_name;
      if (!acc[serviceName]) {
        acc[serviceName] = {
          service_name: serviceName,
          revenue: 0,
          consultation_count: 0
        };
      }
      acc[serviceName].revenue += parseFloat(consultation.value);
      acc[serviceName].consultation_count += 1;
      return acc;
    }, {});

    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: Object.values(revenueByProfessional),
      revenue_by_service: Object.values(revenueByService)
    });
  } catch (error) {
    console.error('Error generating revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

// New clients report (admin only)
app.get('/api/reports/new-clients', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        COUNT(*) as total_new_clients,
        SUM(250) as subscription_revenue,
        DATE_TRUNC('month', created_at) as month
      FROM users 
      WHERE 'client' = ANY(roles)
    `;

    const params = [];

    if (start_date && end_date) {
      query += ` AND created_at >= $1 AND created_at <= $2`;
      params.push(start_date, end_date);
    }

    query += ` GROUP BY DATE_TRUNC('month', created_at) ORDER BY month DESC`;

    const result = await pool.query(query, params);

    // Calculate totals
    const totalNewClients = result.rows.reduce((sum, row) => sum + parseInt(row.total_new_clients), 0);
    const subscriptionRevenue = result.rows.reduce((sum, row) => sum + parseFloat(row.subscription_revenue), 0);

    const clientsByMonth = result.rows.map(row => ({
      month: row.month.toISOString().split('T')[0].substring(0, 7), // YYYY-MM format
      count: parseInt(row.total_new_clients),
      revenue: parseFloat(row.subscription_revenue)
    }));

    res.json({
      total_new_clients: totalNewClients,
      subscription_revenue: subscriptionRevenue,
      clients_by_month: clientsByMonth
    });
  } catch (error) {
    console.error('Error generating new clients report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

// Professional revenue summary (admin only)
app.get('/api/reports/professional-revenue-summary', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        p.name as professional_name,
        p.percentage as professional_percentage,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue,
        SUM(ROUND(c.value * p.percentage / 100, 2)) as professional_payment,
        SUM(ROUND(c.value * (100 - p.percentage) / 100, 2)) as clinic_revenue
      FROM consultations c
      JOIN users p ON c.professional_id = p.id
      WHERE 1=1
    `;

    const params = [];

    if (start_date && end_date) {
      query += ` AND c.date >= $1 AND c.date <= $2`;
      params.push(start_date, end_date);
    }

    query += ` GROUP BY p.id, p.name, p.percentage ORDER BY revenue DESC`;

    const professionalResult = await pool.query(query, params);

    // Get service breakdown
    let serviceQuery = `
      SELECT 
        s.name as service_name,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      WHERE 1=1
    `;

    if (start_date && end_date) {
      serviceQuery += ` AND c.date >= $1 AND c.date <= $2`;
    }

    serviceQuery += ` GROUP BY s.id, s.name ORDER BY revenue DESC`;

    const serviceResult = await pool.query(serviceQuery, params);

    // Calculate total revenue
    const totalRevenue = professionalResult.rows.reduce((sum, row) => sum + parseFloat(row.revenue || 0), 0);

    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: professionalResult.rows.map(row => ({
        professional_name: row.professional_name,
        professional_percentage: parseInt(row.professional_percentage),
        revenue: parseFloat(row.revenue || 0),
        consultation_count: parseInt(row.consultation_count),
        professional_payment: parseFloat(row.professional_payment || 0),
        clinic_revenue: parseFloat(row.clinic_revenue || 0)
      })),
      revenue_by_service: serviceResult.rows.map(row => ({
        service_name: row.service_name,
        revenue: parseFloat(row.revenue || 0),
        consultation_count: parseInt(row.consultation_count)
      }))
    });
  } catch (error) {
    console.error('Error generating professional revenue summary:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

// Total revenue report (admin only)
app.get('/api/reports/total-revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    // Get subscription revenue (new clients)
    let clientQuery = `
      SELECT COUNT(*) * 250 as subscription_revenue
      FROM users 
      WHERE 'client' = ANY(roles)
    `;

    const params = [];

    if (start_date && end_date) {
      clientQuery += ` AND created_at >= $1 AND created_at <= $2`;
      params.push(start_date, end_date);
    }

    const clientResult = await pool.query(clientQuery, params);

    // Get consultation revenue (clinic percentage)
    let consultationQuery = `
      SELECT 
        SUM(c.value) as total_consultation_revenue,
        SUM(ROUND(c.value * (100 - p.percentage) / 100, 2)) as clinic_consultation_revenue
      FROM consultations c
      JOIN users p ON c.professional_id = p.id
      WHERE 1=1
    `;

    if (start_date && end_date) {
      consultationQuery += ` AND c.date >= $1 AND c.date <= $2`;
    }

    const consultationResult = await pool.query(consultationQuery, params);

    const subscriptionRevenue = parseFloat(clientResult.rows[0].subscription_revenue || 0);
    const totalConsultationRevenue = parseFloat(consultationResult.rows[0].total_consultation_revenue || 0);
    const clinicConsultationRevenue = parseFloat(consultationResult.rows[0].clinic_consultation_revenue || 0);

    res.json({
      subscription_revenue: subscriptionRevenue,
      consultation_revenue: clinicConsultationRevenue,
      total_revenue: totalConsultationRevenue,
      clinic_total_revenue: subscriptionRevenue + clinicConsultationRevenue
    });
  } catch (error) {
    console.error('Error generating total revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

// =====================================================
// IMAGE UPLOAD ROUTE
// =====================================================

// Upload image
app.post('/api/upload-image', authenticate, async (req, res) => {
  try {
    // Create upload middleware instance
    const upload = createUpload();
    
    // Use multer middleware
    upload.single('image')(req, res, async (err) => {
      if (err) {
        console.error('Upload error:', err);
        return res.status(400).json({ message: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'Nenhum arquivo enviado' });
      }

      try {
        // Update user photo URL in database
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
    console.error('Upload route error:', error);
    res.status(500).json({ message: 'Erro no upload da imagem' });
  }
});

// =====================================================
// PAYMENT ROUTES (MERCADO PAGO)
// =====================================================

// Create subscription payment (client)
app.post('/api/create-subscription', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { user_id, dependent_ids } = req.body;
    
    // Calculate total amount (R$250 for client + R$50 per dependent)
    const dependentCount = dependent_ids ? dependent_ids.length : 0;
    const totalAmount = 250 + (dependentCount * 50);

    // Create MercadoPago preference
    const preference = {
      items: [
        {
          title: 'Assinatura Cartão Quiro Ferreira',
          description: `Assinatura mensal - Titular + ${dependentCount} dependente(s)`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: totalAmount
        }
      ],
      payer: {
        email: 'cliente@quiroferreira.com.br'
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/payment/success`,
        failure: `${req.protocol}://${req.get('host')}/payment/failure`,
        pending: `${req.protocol}://${req.get('host')}/payment/pending`
      },
      auto_return: 'approved',
      external_reference: `subscription_${user_id}_${Date.now()}`
    };

    // Mock response for development
    const mockResponse = {
      id: `PREF_${Date.now()}`,
      init_point: `https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF_${Date.now()}`,
      sandbox_init_point: `https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF_${Date.now()}`
    };

    res.json(mockResponse);
  } catch (error) {
    console.error('Error creating subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

// Create professional payment
app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }

    // Create MercadoPago preference
    const preference = {
      items: [
        {
          title: 'Pagamento ao Convênio Quiro Ferreira',
          description: 'Repasse de consultas realizadas',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: parseFloat(amount)
        }
      ],
      payer: {
        email: 'profissional@quiroferreira.com.br'
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/payment/success`,
        failure: `${req.protocol}://${req.get('host')}/payment/failure`,
        pending: `${req.protocol}://${req.get('host')}/payment/pending`
      },
      auto_return: 'approved',
      external_reference: `professional_payment_${req.user.id}_${Date.now()}`
    };

    // Mock response for development
    const mockResponse = {
      id: `PREF_${Date.now()}`,
      init_point: `https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF_${Date.now()}`,
      sandbox_init_point: `https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF_${Date.now()}`
    };

    res.json(mockResponse);
  } catch (error) {
    console.error('Error creating professional payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

// Create agenda subscription payment
app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;

    // Create MercadoPago preference
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
        email: 'profissional@quiroferreira.com.br'
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/payment/success`,
        failure: `${req.protocol}://${req.get('host')}/payment/failure`,
        pending: `${req.protocol}://${req.get('host')}/payment/pending`
      },
      auto_return: 'approved',
      external_reference: `agenda_subscription_${professionalId}_${Date.now()}`
    };

    // Mock response for development
    const mockResponse = {
      id: `PREF_${Date.now()}`,
      init_point: `https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF_${Date.now()}`,
      sandbox_init_point: `https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF_${Date.now()}`
    };

    res.json(mockResponse);
  } catch (error) {
    console.error('Error creating agenda subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento da agenda' });
  }
});

// =====================================================
// ERROR HANDLING MIDDLEWARE
// =====================================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Erro interno do servidor' });
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;