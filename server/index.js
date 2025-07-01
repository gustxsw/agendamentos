import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { authenticate, authorize } from './middleware/auth.js';
import createUpload from './middleware/upload.js';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

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

// 🔥 MERCADO PAGO SDK V2 SETUP
let mercadopago;
try {
  const { MercadoPagoConfig, Preference } = await import('mercadopago');
  
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    console.warn('⚠️ MercadoPago access token not found');
  } else {
    mercadopago = {
      config: new MercadoPagoConfig({ accessToken }),
      Preference
    };
    console.log('✅ MercadoPago SDK v2 initialized successfully');
  }
} catch (error) {
  console.error('❌ Error initializing MercadoPago SDK v2:', error);
}

// Database initialization
const initializeDatabase = async () => {
  try {
    console.log('🔄 Initializing database...');

    // Create users table with all necessary columns
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
        photo_url TEXT,
        professional_registration VARCHAR(50),
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT check_client_or_dependent CHECK (
          (client_id IS NOT NULL AND dependent_id IS NULL) OR 
          (client_id IS NULL AND dependent_id IS NOT NULL)
        )
      )
    `);

    // 🔥 Create professional_locations table
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🔥 Create schedule_configs table with nullable time fields
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_configs (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        work_start TIME,
        work_end TIME,
        break_start TIME,
        break_end TIME,
        slot_duration INTEGER DEFAULT 30,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🔥 Create professional_patients table
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(professional_id, cpf)
      )
    `);

    // 🔥 Create appointments table with all necessary columns
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES professional_patients(id) ON DELETE CASCADE,
        location_id INTEGER REFERENCES professional_locations(id),
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        is_recurring BOOLEAN DEFAULT false,
        recurrence_pattern VARCHAR(20),
        recurrence_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🔥 Create medical_records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INTEGER REFERENCES consultations(id),
        patient_id INTEGER REFERENCES professional_patients(id),
        professional_id INTEGER REFERENCES users(id) NOT NULL,
        patient_type VARCHAR(20) DEFAULT 'particular',
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

    // 🔥 Create agenda_subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        status VARCHAR(20) DEFAULT 'pending',
        expires_at TIMESTAMP,
        last_payment TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default data
    await insertDefaultData();

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
};

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
        ('Consulta Fisioterapia', 'Consulta inicial de fisioterapia', 120.00, 1, true),
        ('Sessão Fisioterapia', 'Sessão de fisioterapia', 80.00, 1, false),
        ('Consulta Quiropraxia', 'Consulta inicial de quiropraxia', 150.00, 2, true),
        ('Ajuste Quiroprático', 'Sessão de ajuste quiroprático', 100.00, 2, false),
        ('Massagem Relaxante', 'Massagem para relaxamento', 90.00, 3, false),
        ('Massagem Terapêutica', 'Massagem para tratamento', 110.00, 3, true),
        ('Sessão Acupuntura', 'Sessão de acupuntura', 95.00, 4, true),
        ('Aula Pilates Individual', 'Aula individual de pilates', 85.00, 5, false),
        ('Aula Pilates Grupo', 'Aula em grupo de pilates', 45.00, 5, true)
      `);
    }

    // Check if admin user exists
    const adminResult = await pool.query("SELECT * FROM users WHERE 'admin' = ANY(roles)");
    if (adminResult.rows.length === 0) {
      console.log('🔄 Creating default admin user...');
      
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(`
        INSERT INTO users (name, cpf, password_hash, roles, professional_registration) 
        VALUES ('Administrador', '00000000000', $1, ARRAY['admin'], 'ADMIN001')
      `, [hashedPassword]);
    }

    console.log('✅ Default data inserted successfully');
  } catch (error) {
    console.error('❌ Error inserting default data:', error);
  }
};

// Initialize database on startup
initializeDatabase().catch(console.error);

// Health check endpoint
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

// User routes
app.get('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, roles, percentage,
        category_id, subscription_status, subscription_expiry, created_at,
        professional_registration, photo_url
      FROM users 
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Erro ao buscar usuários' });
  }
});

app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        id, name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, roles, percentage,
        category_id, subscription_status, subscription_expiry, created_at,
        professional_registration, photo_url
      FROM users 
      WHERE id = $1
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
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password_hash, roles,
        percentage, category_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id, name, cpf, roles
    `, [
      name, cleanCpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, hashedPassword, roles,
      percentage, category_id
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating user:', error);
    if (error.code === '23505') {
      res.status(409).json({ message: 'CPF já cadastrado' });
    } else {
      res.status(500).json({ message: 'Erro ao criar usuário' });
    }
  }
});

app.put('/api/users/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles, percentage, category_id
    } = req.body;

    const result = await pool.query(`
      UPDATE users SET
        name = $1, email = $2, phone = $3, birth_date = $4, address = $5,
        address_number = $6, address_complement = $7, neighborhood = $8,
        city = $9, state = $10, roles = $11, percentage = $12, category_id = $13,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING id, name, cpf, roles
    `, [
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles, percentage, category_id, id
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
    res.status(500).json({ message: 'Erro ao ativar usuário' });
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
    res.status(500).json({ message: 'Erro ao excluir usuário' });
  }
});

app.put('/api/users/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Senha atual e nova senha são obrigatórias' });
    }

    const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
    
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

// Service categories routes
app.get('/api/service-categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM service_categories ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Erro ao buscar categorias' });
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
    res.status(500).json({ message: 'Erro ao criar categoria' });
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
    res.status(500).json({ message: 'Erro ao buscar serviços' });
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
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [name, description, base_price, category_id, is_base_service]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ message: 'Erro ao criar serviço' });
  }
});

app.put('/api/services/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, base_price, category_id, is_base_service } = req.body;

    const result = await pool.query(`
      UPDATE services SET
        name = $1, description = $2, base_price = $3, category_id = $4, is_base_service = $5
      WHERE id = $6 RETURNING *
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
    res.status(500).json({ message: 'Erro ao buscar dependentes' });
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
    res.status(500).json({ message: 'Erro ao buscar dependente' });
  }
});

app.post('/api/dependents', authenticate, async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;

    if (!client_id || !name || !cpf) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    const result = await pool.query(`
      INSERT INTO dependents (client_id, name, cpf, birth_date)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [client_id, name, cleanCpf, birth_date]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating dependent:', error);
    if (error.code === '23505') {
      res.status(409).json({ message: 'CPF já cadastrado' });
    } else {
      res.status(500).json({ message: 'Erro ao criar dependente' });
    }
  }
});

app.put('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, birth_date } = req.body;

    const result = await pool.query(`
      UPDATE dependents SET name = $1, birth_date = $2
      WHERE id = $3 RETURNING *
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
    res.status(500).json({ message: 'Erro ao excluir dependente' });
  }
});

// Consultations routes
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query;
    let params = [];

    if (req.user.currentRole === 'client') {
      query = `
        SELECT 
          c.id, c.value, c.date, c.created_at,
          s.name as service_name,
          u.name as professional_name,
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
      query = `
        SELECT 
          c.id, c.value, c.date, c.created_at,
          s.name as service_name,
          u.name as professional_name,
          COALESCE(d.name, u2.name) as client_name,
          CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users u ON c.professional_id = u.id
        LEFT JOIN users u2 ON c.client_id = u2.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE c.professional_id = $1
        ORDER BY c.date DESC
      `;
      params = [req.user.id];
    } else {
      query = `
        SELECT 
          c.id, c.value, c.date, c.created_at,
          s.name as service_name,
          u.name as professional_name,
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
    res.status(500).json({ message: 'Erro ao buscar consultas' });
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
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [client_id, dependent_id, professional_id, service_id, value, date]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating consultation:', error);
    res.status(500).json({ message: 'Erro ao registrar consulta' });
  }
});

// Client lookup route
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
    res.status(500).json({ message: 'Erro ao buscar cliente' });
  }
});

// Professionals route
app.get('/api/professionals', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.email, u.phone, u.address, u.address_number,
        u.address_complement, u.neighborhood, u.city, u.state,
        u.photo_url, u.professional_registration,
        sc.name as category_name
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
    res.status(500).json({ message: 'Erro ao buscar locais' });
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

    // If this is being set as main, unset other main locations
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
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

app.put('/api/professional-locations/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main
    } = req.body;

    // If this is being set as main, unset other main locations
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
      WHERE id = $10 AND professional_id = $11 RETURNING *
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

// 🔥 AGENDA ROUTES
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT status, expires_at, last_payment
      FROM agenda_subscriptions 
      WHERE professional_id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.json({
        status: 'pending',
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: false
      });
    }

    const subscription = result.rows[0];
    const now = new Date();
    const expiresAt = subscription.expires_at ? new Date(subscription.expires_at) : null;
    
    let daysRemaining = 0;
    let canUseAgenda = false;

    if (subscription.status === 'active' && expiresAt && expiresAt > now) {
      daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      canUseAgenda = true;
    }

    res.json({
      status: subscription.status,
      expires_at: subscription.expires_at,
      days_remaining: daysRemaining,
      can_use_agenda: canUseAgenda,
      last_payment: subscription.last_payment
    });
  } catch (error) {
    console.error('Error fetching agenda subscription status:', error);
    res.status(500).json({ message: 'Erro ao buscar status da assinatura' });
  }
});

// 🔥 SCHEDULE CONFIG ROUTES (Fixed to handle empty time values)
app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM schedule_configs WHERE professional_id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.json(null);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching schedule config:', error);
    res.status(500).json({ message: 'Erro ao buscar configuração' });
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

    // 🔥 Convert empty strings to null for time fields
    const timeFields = {
      work_start: work_start || null,
      work_end: work_end || null,
      break_start: break_start || null,
      break_end: break_end || null,
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
      sunday_end: sunday_end || null
    };

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
      req.user.id, timeFields.work_start, timeFields.work_end, timeFields.break_start, timeFields.break_end, slot_duration,
      timeFields.monday_start, timeFields.monday_end, timeFields.tuesday_start, timeFields.tuesday_end,
      timeFields.wednesday_start, timeFields.wednesday_end, timeFields.thursday_start, timeFields.thursday_end,
      timeFields.friday_start, timeFields.friday_end, timeFields.saturday_start, timeFields.saturday_end,
      timeFields.sunday_start, timeFields.sunday_end
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving schedule config:', error);
    res.status(500).json({ message: 'Erro ao salvar configuração' });
  }
});

// 🔥 PROFESSIONAL PATIENTS ROUTES
app.get('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { include_archived } = req.query;
    
    let query = `
      SELECT 
        pp.*, 
        true as is_convenio_patient
      FROM professional_patients pp
      WHERE pp.professional_id = $1
    `;

    // Add archived filter
    if (include_archived !== 'true') {
      query += ' AND pp.is_archived = false';
    }

    // Add union with convenio patients
    query += `
      UNION ALL
      SELECT 
        u.id, $1 as professional_id, u.name, u.cpf, u.email, u.phone, u.birth_date,
        u.address, u.address_number, u.address_complement, u.neighborhood, u.city, u.state,
        '' as notes, 'convenio' as patient_type, false as is_archived,
        u.created_at as linked_at, u.created_at, u.updated_at,
        true as is_convenio_patient
      FROM users u
      WHERE 'client' = ANY(u.roles) AND u.subscription_status = 'active'
    `;

    // Add union with dependents
    query += `
      UNION ALL
      SELECT 
        d.id + 100000 as id, $1 as professional_id, d.name, d.cpf, '' as email, '' as phone, d.birth_date,
        '' as address, '' as address_number, '' as address_complement, '' as neighborhood, '' as city, '' as state,
        '' as notes, 'convenio' as patient_type, false as is_archived,
        d.created_at as linked_at, d.created_at, d.created_at as updated_at,
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
    res.status(500).json({ message: 'Erro ao buscar pacientes' });
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *
    `, [
      req.user.id, name, cleanCpf, email, phone, birth_date, address,
      address_number, address_complement, neighborhood, city, state, notes
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

app.put('/api/agenda/patients/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const result = await pool.query(`
      UPDATE professional_patients SET
        notes = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND professional_id = $3 RETURNING *
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

app.put('/api/agenda/patients/:id/archive', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_archived } = req.body;

    const result = await pool.query(`
      UPDATE professional_patients SET
        is_archived = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND professional_id = $3 RETURNING *
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

// 🔥 APPOINTMENTS ROUTES
app.get('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        a.id, a.date, a.status, a.notes, a.is_recurring, a.recurrence_pattern,
        pp.id as patient_id, pp.name as patient_name, pp.phone as patient_phone,
        pp.is_convenio_patient,
        pl.id as location_id, pl.clinic_name as location_name
      FROM appointments a
      JOIN professional_patients pp ON a.patient_id = pp.id
      LEFT JOIN professional_locations pl ON a.location_id = pl.id
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
    res.status(500).json({ message: 'Erro ao buscar agendamentos' });
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
          ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
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
        ) VALUES ($1, $2, $3, $4, $5) RETURNING *
      `, [req.user.id, patient_id, location_id, date, notes]);

      res.status(201).json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erro ao criar agendamento' });
  }
});

app.put('/api/agenda/appointments/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const result = await pool.query(`
      UPDATE appointments SET
        status = $1, notes = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND professional_id = $4 RETURNING *
    `, [status, notes, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ message: 'Erro ao atualizar agendamento' });
  }
});

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

// 🔥 MEDICAL RECORDS ROUTES
app.get('/api/medical-records/patient/:patientId', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patientId } = req.params;

    const result = await pool.query(`
      SELECT 
        mr.*,
        pp.name as patient_name, pp.cpf as patient_cpf,
        c.date as consultation_date, s.name as service_name,
        u.name as professional_name, u.professional_registration
      FROM medical_records mr
      JOIN professional_patients pp ON mr.patient_id = pp.id
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
        physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
    `, [
      patient_id, req.user.id, chief_complaint, anamnesis,
      physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating medical record:', error);
    res.status(500).json({ message: 'Erro ao criar prontuário' });
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
      WHERE id = $8 AND professional_id = $9 RETURNING *
    `, [
      chief_complaint, anamnesis, physical_examination,
      diagnosis, treatment_plan, clinical_evolution, internal_notes, id, req.user.id
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

// Reports routes
app.get('/api/reports/professional-revenue', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const professionalId = req.user.id;

    console.log('Generating professional revenue report for:', professionalId);
    console.log('Date range:', start_date, 'to', end_date);

    // Get professional percentage
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [professionalId]
    );

    const professionalPercentage = professionalResult.rows[0]?.percentage || 50;

    // Get consultations for the period
    let query = `
      SELECT 
        c.id, c.value, c.date,
        s.name as service_name,
        COALESCE(d.name, u.name) as client_name
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE c.professional_id = $1
    `;

    const params = [professionalId];

    if (start_date && end_date) {
      query += ' AND c.date >= $2 AND c.date <= $3';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY c.date DESC';

    const consultationsResult = await pool.query(query, params);
    const consultations = consultationsResult.rows;

    // Calculate summary
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.value), 0);
    const amountToPay = (totalRevenue * (100 - professionalPercentage)) / 100;

    const summary = {
      professional_percentage: professionalPercentage,
      total_revenue: totalRevenue,
      consultation_count: consultations.length,
      amount_to_pay: amountToPay
    };

    // Format consultations for response
    const formattedConsultations = consultations.map(c => ({
      date: c.date,
      client_name: c.client_name,
      service_name: c.service_name,
      total_value: parseFloat(c.value),
      amount_to_pay: (parseFloat(c.value) * (100 - professionalPercentage)) / 100
    }));

    res.json({
      summary,
      consultations: formattedConsultations
    });
  } catch (error) {
    console.error('Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

app.get('/api/reports/professional-consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const professionalId = req.user.id;

    // Get professional percentage
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [professionalId]
    );

    const professionalPercentage = professionalResult.rows[0]?.percentage || 50;

    // Get consultations with medical records info
    let query = `
      SELECT 
        c.id as consultation_id, c.value as total_value, c.date,
        s.name as service_name,
        COALESCE(d.name, u.name) as patient_name,
        CASE WHEN d.id IS NOT NULL THEN true ELSE true END as is_convenio_patient,
        CASE WHEN mr.id IS NOT NULL THEN true ELSE false END as has_medical_record
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN medical_records mr ON c.id = mr.consultation_id
      WHERE c.professional_id = $1
    `;

    const params = [professionalId];

    if (start_date && end_date) {
      query += ' AND c.date >= $2 AND c.date <= $3';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY c.date DESC';

    const result = await pool.query(query, params);
    const consultations = result.rows.map(row => ({
      ...row,
      amount_to_pay: (parseFloat(row.total_value) * (100 - professionalPercentage)) / 100
    }));

    // Calculate summary
    const totalConsultations = consultations.length;
    const convenioConsultations = consultations.filter(c => c.is_convenio_patient).length;
    const particularConsultations = totalConsultations - convenioConsultations;
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const convenioRevenue = consultations
      .filter(c => c.is_convenio_patient)
      .reduce((sum, c) => sum + parseFloat(c.total_value), 0);
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

    res.json({
      summary,
      consultations
    });
  } catch (error) {
    console.error('Error generating professional consultations report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        c.value, c.date,
        u.name as professional_name, u.percentage as professional_percentage,
        s.name as service_name
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      JOIN services s ON c.service_id = s.id
    `;

    const params = [];

    if (start_date && end_date) {
      query += ' WHERE c.date >= $1 AND c.date <= $2';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY c.date DESC';

    const result = await pool.query(query, params);
    const consultations = result.rows;

    // Group by professional
    const professionalRevenue = {};
    const serviceRevenue = {};
    let totalRevenue = 0;

    consultations.forEach(consultation => {
      const value = parseFloat(consultation.value);
      const percentage = consultation.professional_percentage || 50;
      const professionalPayment = (value * percentage) / 100;
      const clinicRevenue = value - professionalPayment;

      totalRevenue += value;

      // Professional revenue
      if (!professionalRevenue[consultation.professional_name]) {
        professionalRevenue[consultation.professional_name] = {
          professional_name: consultation.professional_name,
          professional_percentage: percentage,
          revenue: 0,
          consultation_count: 0,
          professional_payment: 0,
          clinic_revenue: 0
        };
      }

      professionalRevenue[consultation.professional_name].revenue += value;
      professionalRevenue[consultation.professional_name].consultation_count += 1;
      professionalRevenue[consultation.professional_name].professional_payment += professionalPayment;
      professionalRevenue[consultation.professional_name].clinic_revenue += clinicRevenue;

      // Service revenue
      if (!serviceRevenue[consultation.service_name]) {
        serviceRevenue[consultation.service_name] = {
          service_name: consultation.service_name,
          revenue: 0,
          consultation_count: 0
        };
      }

      serviceRevenue[consultation.service_name].revenue += value;
      serviceRevenue[consultation.service_name].consultation_count += 1;
    });

    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: Object.values(professionalRevenue),
      revenue_by_service: Object.values(serviceRevenue)
    });
  } catch (error) {
    console.error('Error generating revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

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
      query += ' AND created_at >= $1 AND created_at <= $2';
      params.push(start_date, end_date);
    }

    query += ' GROUP BY DATE_TRUNC(\'month\', created_at) ORDER BY month';

    const result = await pool.query(query, params);

    const totalNewClients = result.rows.reduce((sum, row) => sum + parseInt(row.total_new_clients), 0);
    const subscriptionRevenue = totalNewClients * 250;

    const clientsByMonth = result.rows.map(row => ({
      month: row.month.toISOString().slice(0, 7),
      count: parseInt(row.total_new_clients),
      revenue: parseInt(row.total_new_clients) * 250
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

app.get('/api/reports/professional-revenue-summary', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        c.value, c.date,
        u.name as professional_name, u.percentage as professional_percentage,
        s.name as service_name
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      JOIN services s ON c.service_id = s.id
    `;

    const params = [];

    if (start_date && end_date) {
      query += ' WHERE c.date >= $1 AND c.date <= $2';
      params.push(start_date, end_date);
    }

    const result = await pool.query(query, params);
    const consultations = result.rows;

    // Group by professional and service
    const professionalRevenue = {};
    const serviceRevenue = {};
    let totalRevenue = 0;

    consultations.forEach(consultation => {
      const value = parseFloat(consultation.value);
      const percentage = consultation.professional_percentage || 50;
      const professionalPayment = (value * percentage) / 100;
      const clinicRevenue = value - professionalPayment;

      totalRevenue += value;

      // Professional revenue
      if (!professionalRevenue[consultation.professional_name]) {
        professionalRevenue[consultation.professional_name] = {
          professional_name: consultation.professional_name,
          professional_percentage: percentage,
          revenue: 0,
          consultation_count: 0,
          professional_payment: 0,
          clinic_revenue: 0
        };
      }

      professionalRevenue[consultation.professional_name].revenue += value;
      professionalRevenue[consultation.professional_name].consultation_count += 1;
      professionalRevenue[consultation.professional_name].professional_payment += professionalPayment;
      professionalRevenue[consultation.professional_name].clinic_revenue += clinicRevenue;

      // Service revenue
      if (!serviceRevenue[consultation.service_name]) {
        serviceRevenue[consultation.service_name] = {
          service_name: consultation.service_name,
          revenue: 0,
          consultation_count: 0
        };
      }

      serviceRevenue[consultation.service_name].revenue += value;
      serviceRevenue[consultation.service_name].consultation_count += 1;
    });

    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: Object.values(professionalRevenue),
      revenue_by_service: Object.values(serviceRevenue)
    });
  } catch (error) {
    console.error('Error generating professional revenue summary:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

app.get('/api/reports/total-revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    // Get subscription revenue (new clients)
    let clientQuery = `
      SELECT COUNT(*) * 250 as subscription_revenue
      FROM users 
      WHERE 'client' = ANY(roles)
    `;

    const clientParams = [];

    if (start_date && end_date) {
      clientQuery += ' AND created_at >= $1 AND created_at <= $2';
      clientParams.push(start_date, end_date);
    }

    const clientResult = await pool.query(clientQuery, clientParams);
    const subscriptionRevenue = parseFloat(clientResult.rows[0].subscription_revenue) || 0;

    // Get consultation revenue (clinic percentage)
    let consultationQuery = `
      SELECT 
        SUM(c.value * (100 - COALESCE(u.percentage, 50)) / 100) as consultation_revenue,
        SUM(c.value) as total_consultation_value
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
    `;

    const consultationParams = [];

    if (start_date && end_date) {
      consultationQuery += ' WHERE c.date >= $1 AND c.date <= $2';
      consultationParams.push(start_date, end_date);
    }

    const consultationResult = await pool.query(consultationQuery, consultationParams);
    const consultationRevenue = parseFloat(consultationResult.rows[0].consultation_revenue) || 0;
    const totalConsultationValue = parseFloat(consultationResult.rows[0].total_consultation_value) || 0;

    const totalRevenue = subscriptionRevenue + totalConsultationValue;
    const clinicTotalRevenue = subscriptionRevenue + consultationRevenue;

    res.json({
      subscription_revenue: subscriptionRevenue,
      consultation_revenue: consultationRevenue,
      total_revenue: totalRevenue,
      clinic_total_revenue: clinicTotalRevenue
    });
  } catch (error) {
    console.error('Error generating total revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

// 🔥 MERCADO PAGO PAYMENT ROUTES (SDK V2)
app.post('/api/create-subscription', authenticate, authorize(['client']), async (req, res) => {
  try {
    if (!mercadopago) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }

    const { user_id, dependent_ids = [] } = req.body;
    
    // Calculate total amount
    const baseAmount = 250; // R$ 250 for titular
    const dependentAmount = dependent_ids.length * 50; // R$ 50 per dependent
    const totalAmount = baseAmount + dependentAmount;

    const preference = new mercadopago.Preference(mercadopago.config);

    const preferenceData = {
      items: [
        {
          title: `Assinatura Cartão Quiro Ferreira - Titular + ${dependent_ids.length} dependente(s)`,
          quantity: 1,
          unit_price: totalAmount,
          currency_id: 'BRL'
        }
      ],
      payer: {
        email: 'cliente@quiroferreira.com.br'
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

    const result = await preference.create({ body: preferenceData });
    
    console.log('✅ Client subscription preference created:', result.id);
    
    res.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error('❌ Error creating client subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    if (!mercadopago) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }

    const preference = new mercadopago.Preference(mercadopago.config);

    const preferenceData = {
      items: [
        {
          title: 'Assinatura Agenda Profissional - Mensal',
          quantity: 1,
          unit_price: 49.90,
          currency_id: 'BRL'
        }
      ],
      payer: {
        email: 'profissional@quiroferreira.com.br'
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/professional/agenda`,
        failure: `${req.protocol}://${req.get('host')}/professional/agenda`,
        pending: `${req.protocol}://${req.get('host')}/professional/agenda`
      },
      auto_return: 'approved',
      external_reference: `agenda_${req.user.id}_${Date.now()}`,
      notification_url: `${req.protocol}://${req.get('host')}/api/webhooks/mercadopago`
    };

    const result = await preference.create({ body: preferenceData });
    
    console.log('✅ Agenda subscription preference created:', result.id);
    
    res.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error('❌ Error creating agenda subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento da agenda' });
  }
});

app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    if (!mercadopago) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }

    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }

    const preference = new mercadopago.Preference(mercadopago.config);

    const preferenceData = {
      items: [
        {
          title: 'Pagamento ao Convênio Quiro Ferreira',
          quantity: 1,
          unit_price: parseFloat(amount),
          currency_id: 'BRL'
        }
      ],
      payer: {
        email: 'profissional@quiroferreira.com.br'
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/professional`,
        failure: `${req.protocol}://${req.get('host')}/professional`,
        pending: `${req.protocol}://${req.get('host')}/professional`
      },
      auto_return: 'approved',
      external_reference: `professional_payment_${req.user.id}_${Date.now()}`,
      notification_url: `${req.protocol}://${req.get('host')}/api/webhooks/mercadopago`
    };

    const result = await preference.create({ body: preferenceData });
    
    console.log('✅ Professional payment preference created:', result.id);
    
    res.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error('❌ Error creating professional payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

// 🔥 WEBHOOK ROUTE
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    console.log('🔔 MercadoPago webhook received:', req.body);
    
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      console.log('💳 Processing payment:', paymentId);
      
      // Here you would typically:
      // 1. Verify the payment with MercadoPago API
      // 2. Update subscription status in database
      // 3. Send confirmation email
      
      // For now, just log the payment
      console.log('✅ Payment processed successfully');
    }
    
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ message: 'Webhook error' });
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

      // Update user's photo_url in database
      await pool.query(
        'UPDATE users SET photo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
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

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ message: 'Erro interno do servidor' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

export default app;