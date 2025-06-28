import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { authenticate, authorize } from './middleware/auth.js';
import createUpload from './middleware/upload.js';
import dotenv from 'dotenv';

// 🔥 MERCADO PAGO SDK V2 IMPORT
import { MercadoPagoConfig, Preference } from 'mercadopago';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 🔥 INITIALIZE MERCADO PAGO SDK V2
let mercadopago;
try {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('❌ MP_ACCESS_TOKEN not found in environment variables');
    throw new Error('MercadoPago access token is required');
  }
  
  mercadopago = new MercadoPagoConfig({
    accessToken: accessToken,
    options: {
      timeout: 5000,
      idempotencyKey: 'abc'
    }
  });
  
  console.log('✅ MercadoPago SDK v2 initialized successfully');
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

// Database initialization
const initializeDatabase = async () => {
  try {
    console.log('🔄 Initializing database...');

    // Create users table with enhanced structure
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

    // Create consultations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id),
        dependent_id INTEGER,
        professional_id INTEGER REFERENCES users(id),
        service_id INTEGER REFERENCES services(id),
        value DECIMAL(10,2) NOT NULL,
        date TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create dependents table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dependents (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) UNIQUE NOT NULL,
        birth_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🔥 NEW: Professional patients table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_patients (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id),
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
        is_archived BOOLEAN DEFAULT false,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🔥 NEW: Professional locations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_locations (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id),
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

    // 🔥 NEW: Professional schedule configuration table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_schedule_config (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) UNIQUE,
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

    // 🔥 NEW: Professional appointments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id),
        patient_id INTEGER,
        patient_type VARCHAR(20) DEFAULT 'particular',
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

    // 🔥 NEW: Professional subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) UNIQUE,
        status VARCHAR(20) DEFAULT 'inactive',
        expires_at TIMESTAMP,
        last_payment TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🔥 NEW: Medical records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INTEGER REFERENCES consultations(id),
        patient_id INTEGER,
        patient_type VARCHAR(20) DEFAULT 'convenio',
        professional_id INTEGER REFERENCES users(id),
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

    // Insert default admin user
    const adminExists = await pool.query('SELECT id FROM users WHERE cpf = $1', ['00000000000']);
    if (adminExists.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(`
        INSERT INTO users (name, cpf, password_hash, roles) 
        VALUES ($1, $2, $3, $4)
      `, ['Administrador', '00000000000', hashedPassword, ['admin']]);
      console.log('✅ Default admin user created');
    }

    // Insert default categories
    const categoriesExist = await pool.query('SELECT id FROM service_categories LIMIT 1');
    if (categoriesExist.rows.length === 0) {
      await pool.query(`
        INSERT INTO service_categories (name, description) VALUES
        ('Fisioterapia', 'Serviços de fisioterapia e reabilitação'),
        ('Quiropraxia', 'Tratamentos quiropráticos'),
        ('Massoterapia', 'Massagens terapêuticas'),
        ('Acupuntura', 'Tratamentos com acupuntura'),
        ('Pilates', 'Aulas e sessões de pilates')
      `);
      console.log('✅ Default categories created');
    }

    // Insert default services
    const servicesExist = await pool.query('SELECT id FROM services LIMIT 1');
    if (servicesExist.rows.length === 0) {
      await pool.query(`
        INSERT INTO services (name, description, base_price, category_id, is_base_service) VALUES
        ('Consulta Fisioterapia', 'Consulta inicial de fisioterapia', 80.00, 1, true),
        ('Sessão Fisioterapia', 'Sessão de fisioterapia', 60.00, 1, false),
        ('Consulta Quiropraxia', 'Consulta inicial de quiropraxia', 100.00, 2, true),
        ('Ajuste Quiroprático', 'Sessão de ajuste quiroprático', 80.00, 2, false),
        ('Massagem Relaxante', 'Massagem para relaxamento', 70.00, 3, false),
        ('Massagem Terapêutica', 'Massagem para tratamento', 90.00, 3, true),
        ('Sessão Acupuntura', 'Sessão de acupuntura', 85.00, 4, true),
        ('Aula Pilates Individual', 'Aula individual de pilates', 75.00, 5, false),
        ('Aula Pilates Grupo', 'Aula em grupo de pilates', 45.00, 5, true)
      `);
      console.log('✅ Default services created');
    }

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
};

// Initialize database on startup
initializeDatabase();

// 🔥 MERCADO PAGO SDK V2 ROUTES

// Client subscription payment (SDK v2)
app.post('/api/create-subscription', authenticate, async (req, res) => {
  try {
    console.log('🔄 Creating client subscription payment with SDK v2...');
    
    if (!mercadopago) {
      throw new Error('MercadoPago not initialized');
    }

    const { user_id, dependent_ids = [] } = req.body;
    
    // Calculate total amount
    const baseAmount = 250; // R$ 250 for titular
    const dependentAmount = dependent_ids.length * 50; // R$ 50 per dependent
    const totalAmount = baseAmount + dependentAmount;

    const preference = new Preference(mercadopago);
    
    const preferenceData = {
      items: [
        {
          title: 'Assinatura Cartão Quiro Ferreira',
          description: `Assinatura mensal - Titular + ${dependent_ids.length} dependente(s)`,
          quantity: 1,
          unit_price: totalAmount,
          currency_id: 'BRL'
        }
      ],
      payer: {
        email: req.user.email || 'cliente@quiroferreira.com.br'
      },
      external_reference: `subscription_${user_id}_${Date.now()}`,
      notification_url: `${process.env.BASE_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`
      },
      auto_return: 'approved'
    };

    const result = await preference.create({ body: preferenceData });
    
    console.log('✅ Client subscription preference created with SDK v2:', result.id);
    
    res.json({
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error('❌ Error creating client subscription payment:', error);
    res.status(500).json({ 
      message: 'Erro ao criar pagamento de assinatura',
      error: error.message 
    });
  }
});

// Professional agenda subscription payment (SDK v2)
app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    console.log('🔄 Creating agenda subscription payment with SDK v2...');
    
    if (!mercadopago) {
      throw new Error('MercadoPago not initialized');
    }

    const preference = new Preference(mercadopago);
    
    const preferenceData = {
      items: [
        {
          title: 'Assinatura Agenda Profissional',
          description: 'Acesso mensal à agenda profissional completa',
          quantity: 1,
          unit_price: 49.90,
          currency_id: 'BRL'
        }
      ],
      payer: {
        email: req.user.email || 'profissional@quiroferreira.com.br'
      },
      external_reference: `agenda_${req.user.id}_${Date.now()}`,
      notification_url: `${process.env.BASE_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`
      },
      auto_return: 'approved'
    };

    const result = await preference.create({ body: preferenceData });
    
    console.log('✅ Agenda subscription preference created with SDK v2:', result.id);
    
    res.json({
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error('❌ Error creating agenda subscription payment:', error);
    res.status(500).json({ 
      message: 'Erro ao criar pagamento da agenda',
      error: error.message 
    });
  }
});

// Professional payment to clinic (SDK v2)
app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    console.log('🔄 Creating professional payment with SDK v2...');
    
    if (!mercadopago) {
      throw new Error('MercadoPago not initialized');
    }

    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }

    const preference = new Preference(mercadopago);
    
    const preferenceData = {
      items: [
        {
          title: 'Pagamento ao Convênio Quiro Ferreira',
          description: 'Repasse de porcentagem das consultas realizadas',
          quantity: 1,
          unit_price: parseFloat(amount),
          currency_id: 'BRL'
        }
      ],
      payer: {
        email: req.user.email || 'profissional@quiroferreira.com.br'
      },
      external_reference: `professional_payment_${req.user.id}_${Date.now()}`,
      notification_url: `${process.env.BASE_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`
      },
      auto_return: 'approved'
    };

    const result = await preference.create({ body: preferenceData });
    
    console.log('✅ Professional payment preference created with SDK v2:', result.id);
    
    res.json({
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error('❌ Error creating professional payment:', error);
    res.status(500).json({ 
      message: 'Erro ao criar pagamento profissional',
      error: error.message 
    });
  }
});

// 🔥 WEBHOOK HANDLER FOR SDK V2
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    console.log('🔔 MercadoPago webhook received:', req.body);
    
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      console.log('💳 Processing payment:', paymentId);
      
      // Here you would typically:
      // 1. Fetch payment details from MercadoPago API
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

// Auth routes
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

    res.json({
      user: userData,
      message: 'Login realizado com sucesso'
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
      return res.status(403).json({ message: 'Role não autorizada para este usuário' });
    }

    const token = jwt.sign(
      { 
        id: user.id, 
        currentRole: role,
        roles: user.roles 
      },
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
      user: userData,
      token,
      message: 'Role selecionada com sucesso'
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

    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];

    if (!user.roles || !user.roles.includes(role)) {
      return res.status(403).json({ message: 'Role não autorizada para este usuário' });
    }

    const token = jwt.sign(
      { 
        id: user.id, 
        currentRole: role,
        roles: user.roles 
      },
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
      user: userData,
      token,
      message: 'Role alterada com sucesso'
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, name, cpf, roles
    `, [
      name, cleanCpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, hashedPassword, ['client']
    ]);

    const user = result.rows[0];

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        roles: user.roles
      },
      message: 'Usuário criado com sucesso'
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
    res.status(500).json({ message: 'Erro ao carregar usuários' });
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
      RETURNING id, name, cpf, roles
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

app.put('/api/users/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles,
      percentage, category_id
    } = req.body;

    const result = await pool.query(`
      UPDATE users SET
        name = $1, email = $2, phone = $3, birth_date = $4,
        address = $5, address_number = $6, address_complement = $7,
        neighborhood = $8, city = $9, state = $10, roles = $11,
        percentage = $12, category_id = $13, updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING id, name, cpf, roles
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

// 🔥 NEW: Change password route
app.put('/api/users/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Senha atual e nova senha são obrigatórias' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Nova senha deve ter pelo menos 6 caracteres' });
    }

    // Get current user
    const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = userResult.rows[0];

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Senha atual incorreta' });
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(`
      UPDATE users SET 
        password_hash = $1, 
        updated_at = CURRENT_TIMESTAMP 
      WHERE id = $2
    `, [hashedNewPassword, req.user.id]);

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
    res.status(500).json({ message: 'Erro ao carregar categorias' });
  }
});

app.post('/api/service-categories', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Nome é obrigatório' });
    }

    const result = await pool.query(`
      INSERT INTO service_categories (name, description)
      VALUES ($1, $2)
      RETURNING *
    `, [name, description]);

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
      ORDER BY sc.name, s.name
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
    res.status(500).json({ message: 'Erro ao criar serviço' });
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

// Consultations routes
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query = `
      SELECT 
        c.id, c.value, c.date, c.created_at,
        COALESCE(d.name, u.name) as client_name,
        s.name as service_name,
        prof.name as professional_name,
        CASE WHEN c.dependent_id IS NOT NULL THEN true ELSE false END as is_dependent
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users prof ON c.professional_id = prof.id
    `;

    const params = [];

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
    res.status(500).json({ message: 'Erro ao carregar consultas' });
  }
});

app.post('/api/consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { client_id, dependent_id, service_id, value, date } = req.body;

    if ((!client_id && !dependent_id) || !service_id || !value || !date) {
      return res.status(400).json({ message: 'Dados obrigatórios não preenchidos' });
    }

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

// Client lookup routes
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

// Dependents routes
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    // Verify access
    if (req.user.currentRole === 'client' && req.user.id !== parseInt(clientId)) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }

    const result = await pool.query(`
      SELECT * FROM dependents 
      WHERE client_id = $1 
      ORDER BY name
    `, [clientId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dependents:', error);
    res.status(500).json({ message: 'Erro ao carregar dependentes' });
  }
});

app.get('/api/dependents/lookup', authenticate, authorize(['professional']), async (req, res) => {
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
    res.status(500).json({ message: 'Erro ao buscar dependente' });
  }
});

app.post('/api/dependents', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;

    if (req.user.id !== client_id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }

    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');
    
    // Check if CPF already exists
    const existingDependent = await pool.query('SELECT id FROM dependents WHERE cpf = $1', [cleanCpf]);
    if (existingDependent.rows.length > 0) {
      return res.status(409).json({ message: 'CPF já cadastrado' });
    }

    // Check dependent limit (10 per client)
    const dependentCount = await pool.query('SELECT COUNT(*) FROM dependents WHERE client_id = $1', [client_id]);
    if (parseInt(dependentCount.rows[0].count) >= 10) {
      return res.status(400).json({ message: 'Limite de 10 dependentes atingido' });
    }

    const result = await pool.query(`
      INSERT INTO dependents (client_id, name, cpf, birth_date)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [client_id, name, cleanCpf, birth_date]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating dependent:', error);
    res.status(500).json({ message: 'Erro ao criar dependente' });
  }
});

app.put('/api/dependents/:id', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, birth_date } = req.body;

    // Verify ownership
    const dependentCheck = await pool.query('SELECT client_id FROM dependents WHERE id = $1', [id]);
    if (dependentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    if (dependentCheck.rows[0].client_id !== req.user.id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }

    const result = await pool.query(`
      UPDATE dependents SET name = $1, birth_date = $2
      WHERE id = $3
      RETURNING *
    `, [name, birth_date, id]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating dependent:', error);
    res.status(500).json({ message: 'Erro ao atualizar dependente' });
  }
});

app.delete('/api/dependents/:id', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const dependentCheck = await pool.query('SELECT client_id FROM dependents WHERE id = $1', [id]);
    if (dependentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    if (dependentCheck.rows[0].client_id !== req.user.id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }

    await pool.query('DELETE FROM dependents WHERE id = $1', [id]);
    res.json({ message: 'Dependente excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting dependent:', error);
    res.status(500).json({ message: 'Erro ao excluir dependente' });
  }
});

// 🔥 NEW: Professional patients routes
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
    
    if (include_archived !== 'true') {
      query += ` AND pp.is_archived = false`;
    }
    
    query += `
      UNION ALL
      SELECT 
        u.id, $1 as professional_id, u.name, u.cpf, u.email, u.phone,
        u.birth_date, u.address, u.address_number, u.address_complement,
        u.neighborhood, u.city, u.state, '' as notes, false as is_archived,
        u.created_at as linked_at, u.created_at,
        false as is_convenio_patient
      FROM users u
      WHERE 'client' = ANY(u.roles) AND u.subscription_status = 'active'
      ORDER BY name
    `;

    const result = await pool.query(query, [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ message: 'Erro ao carregar pacientes' });
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
        professional_id, name, cpf, email, phone, birth_date,
        address, address_number, address_complement, neighborhood,
        city, state, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      req.user.id, name, cleanCpf, email, phone, birth_date,
      address, address_number, address_complement, neighborhood,
      city, state, notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating patient:', error);
    res.status(500).json({ message: 'Erro ao criar paciente' });
  }
});

app.put('/api/agenda/patients/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const result = await pool.query(`
      UPDATE professional_patients 
      SET notes = $1 
      WHERE id = $2 AND professional_id = $3
      RETURNING *
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
      UPDATE professional_patients 
      SET is_archived = $1 
      WHERE id = $2 AND professional_id = $3
      RETURNING *
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

// 🔥 NEW: Professional locations routes
app.get('/api/professional-locations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM professional_locations 
      WHERE professional_id = $1 
      ORDER BY is_main DESC, clinic_name
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ message: 'Erro ao carregar locais' });
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
      await pool.query(`
        UPDATE professional_locations 
        SET is_main = false 
        WHERE professional_id = $1
      `, [req.user.id]);
    }

    const result = await pool.query(`
      INSERT INTO professional_locations (
        professional_id, clinic_name, address, address_number,
        address_complement, neighborhood, city, state, phone, is_main
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      req.user.id, clinic_name, address, address_number,
      address_complement, neighborhood, city, state, phone, is_main
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating location:', error);
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

    // If this is set as main, unset other main locations
    if (is_main) {
      await pool.query(`
        UPDATE professional_locations 
        SET is_main = false 
        WHERE professional_id = $1 AND id != $2
      `, [req.user.id, id]);
    }

    const result = await pool.query(`
      UPDATE professional_locations SET
        clinic_name = $1, address = $2, address_number = $3,
        address_complement = $4, neighborhood = $5, city = $6,
        state = $7, phone = $8, is_main = $9
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
    console.error('Error updating location:', error);
    res.status(500).json({ message: 'Erro ao atualizar local' });
  }
});

app.delete('/api/professional-locations/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      DELETE FROM professional_locations 
      WHERE id = $1 AND professional_id = $2
      RETURNING id
    `, [id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Local não encontrado' });
    }

    res.json({ message: 'Local excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting location:', error);
    res.status(500).json({ message: 'Erro ao excluir local' });
  }
});

// 🔥 NEW: Agenda routes
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM professional_subscriptions 
      WHERE professional_id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.json({
        status: 'inactive',
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: false
      });
    }

    const subscription = result.rows[0];
    const now = new Date();
    const expiresAt = new Date(subscription.expires_at);
    const daysRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
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
    res.status(500).json({ message: 'Erro ao carregar status da assinatura' });
  }
});

app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM professional_schedule_config 
      WHERE professional_id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      // Return default configuration
      return res.json({
        professional_id: req.user.id,
        work_start: '08:00',
        work_end: '18:00',
        break_start: '12:00',
        break_end: '13:00',
        slot_duration: 30,
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
        sunday_end: null
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching schedule config:', error);
    res.status(500).json({ message: 'Erro ao carregar configuração' });
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
      INSERT INTO professional_schedule_config (
        professional_id, work_start, work_end, break_start, break_end,
        slot_duration, monday_start, monday_end, tuesday_start, tuesday_end,
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
      req.user.id, work_start, work_end, break_start, break_end,
      slot_duration, monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving schedule config:', error);
    res.status(500).json({ message: 'Erro ao salvar configuração' });
  }
});

app.get('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        pa.*,
        COALESCE(pp.name, u.name) as patient_name,
        COALESCE(pp.phone, u.phone) as patient_phone,
        CASE WHEN pp.id IS NOT NULL THEN false ELSE true END as is_convenio_patient,
        pl.clinic_name as location_name
      FROM professional_appointments pa
      LEFT JOIN professional_patients pp ON pa.patient_id = pp.id AND pa.patient_type = 'particular'
      LEFT JOIN users u ON pa.patient_id = u.id AND pa.patient_type = 'convenio'
      LEFT JOIN professional_locations pl ON pa.location_id = pl.id
      WHERE pa.professional_id = $1
    `;

    const params = [req.user.id];

    if (start_date && end_date) {
      query += ` AND pa.date BETWEEN $2 AND $3`;
      params.push(start_date, end_date);
    }

    query += ` ORDER BY pa.date`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro ao carregar agendamentos' });
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

    // Determine patient type
    const patientCheck = await pool.query(`
      SELECT 'particular' as type FROM professional_patients WHERE id = $1
      UNION ALL
      SELECT 'convenio' as type FROM users WHERE id = $1 AND 'client' = ANY(roles)
    `, [patient_id]);

    if (patientCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    const patientType = patientCheck.rows[0].type;

    if (is_recurring && recurrence_pattern && recurrence_end) {
      // Create recurring appointments
      const appointments = [];
      const startDate = new Date(date);
      const endDate = new Date(recurrence_end);
      let currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const result = await pool.query(`
          INSERT INTO professional_appointments (
            professional_id, patient_id, patient_type, location_id,
            date, notes, is_recurring, recurrence_pattern, recurrence_end
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `, [
          req.user.id, patient_id, patientType, location_id,
          currentDate.toISOString(), notes, true, recurrence_pattern, recurrence_end
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

      res.status(201).json(appointments);
    } else {
      // Create single appointment
      const result = await pool.query(`
        INSERT INTO professional_appointments (
          professional_id, patient_id, patient_type, location_id,
          date, notes, is_recurring
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        req.user.id, patient_id, patientType, location_id,
        date, notes, false
      ]);

      res.status(201).json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erro ao criar agendamento' });
  }
});

// 🔥 NEW: Medical records routes
app.get('/api/medical-records/patient/:patientId', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patientId } = req.params;

    const result = await pool.query(`
      SELECT 
        mr.*,
        COALESCE(pp.name, u.name) as patient_name,
        COALESCE(pp.cpf, u.cpf) as patient_cpf,
        c.date as consultation_date,
        s.name as service_name,
        prof.name as professional_name,
        prof.professional_registration
      FROM medical_records mr
      LEFT JOIN consultations c ON mr.consultation_id = c.id
      LEFT JOIN professional_patients pp ON mr.patient_id = pp.id AND mr.patient_type = 'particular'
      LEFT JOIN users u ON mr.patient_id = u.id AND mr.patient_type = 'convenio'
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users prof ON mr.professional_id = prof.id
      WHERE mr.professional_id = $1 AND mr.patient_id = $2
      ORDER BY mr.created_at DESC
    `, [req.user.id, patientId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching medical records:', error);
    res.status(500).json({ message: 'Erro ao carregar prontuários' });
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
    const patientCheck = await pool.query(`
      SELECT 'particular' as type FROM professional_patients WHERE id = $1
      UNION ALL
      SELECT 'convenio' as type FROM users WHERE id = $1 AND 'client' = ANY(roles)
    `, [patient_id]);

    if (patientCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    const patientType = patientCheck.rows[0].type;

    const result = await pool.query(`
      INSERT INTO medical_records (
        patient_id, patient_type, professional_id, chief_complaint,
        anamnesis, physical_examination, diagnosis, treatment_plan,
        clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      patient_id, patientType, req.user.id, chief_complaint,
      anamnesis, physical_examination, diagnosis, treatment_plan,
      clinical_evolution, internal_notes
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
    res.status(500).json({ message: 'Erro ao atualizar prontuário' });
  }
});

// 🔥 NEW: Enhanced reports routes
app.get('/api/reports/professional-consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Get consultations with medical records info
    const consultationsResult = await pool.query(`
      SELECT 
        c.id as consultation_id,
        c.date,
        COALESCE(d.name, u.name) as patient_name,
        s.name as service_name,
        c.value as total_value,
        CASE 
          WHEN d.id IS NOT NULL OR u.subscription_status = 'active' THEN 
            ROUND(c.value * (100 - COALESCE(prof.percentage, 50)) / 100, 2)
          ELSE 0
        END as amount_to_pay,
        CASE WHEN d.id IS NOT NULL OR u.subscription_status = 'active' THEN true ELSE false END as is_convenio_patient,
        CASE WHEN mr.id IS NOT NULL THEN true ELSE false END as has_medical_record
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users prof ON c.professional_id = prof.id
      LEFT JOIN medical_records mr ON c.id = mr.consultation_id
      WHERE c.professional_id = $1 
        AND c.date BETWEEN $2 AND $3
      ORDER BY c.date DESC
    `, [req.user.id, start_date, end_date]);

    // Calculate summary
    const consultations = consultationsResult.rows;
    const summary = {
      total_consultations: consultations.length,
      convenio_consultations: consultations.filter(c => c.is_convenio_patient).length,
      particular_consultations: consultations.filter(c => !c.is_convenio_patient).length,
      total_revenue: consultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0),
      convenio_revenue: consultations.filter(c => c.is_convenio_patient).reduce((sum, c) => sum + parseFloat(c.total_value), 0),
      particular_revenue: consultations.filter(c => !c.is_convenio_patient).reduce((sum, c) => sum + parseFloat(c.total_value), 0),
      amount_to_pay: consultations.reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0)
    };

    res.json({
      consultations,
      summary
    });
  } catch (error) {
    console.error('Error generating professional consultations report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório' });
  }
});

app.get('/api/reports/professional-revenue', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    console.log('🔄 Generating professional revenue report for user:', req.user.id);
    console.log('🔄 Date range:', { start_date, end_date });

    // Get user percentage - FIXED: Convert to integer properly
    const userResult = await pool.query('SELECT percentage FROM users WHERE id = $1', [req.user.id]);
    const userPercentage = userResult.rows[0]?.percentage || 50;
    const professionalPercentage = parseInt(userPercentage); // 🔥 FIXED: Convert to integer

    console.log('🔄 Professional percentage:', professionalPercentage);

    const result = await pool.query(`
      SELECT 
        c.date,
        COALESCE(d.name, u.name) as client_name,
        s.name as service_name,
        c.value as total_value,
        CASE 
          WHEN d.id IS NOT NULL OR u.subscription_status = 'active' THEN 
            ROUND(c.value * (100 - $4) / 100, 2)
          ELSE 0
        END as amount_to_pay
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN services s ON c.service_id = s.id
      WHERE c.professional_id = $1 
        AND c.date BETWEEN $2 AND $3
      ORDER BY c.date DESC
    `, [req.user.id, start_date, end_date, professionalPercentage]);

    const consultations = result.rows;
    console.log('✅ Found consultations:', consultations.length);

    const summary = {
      professional_percentage: professionalPercentage,
      total_revenue: consultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0),
      consultation_count: consultations.length,
      amount_to_pay: consultations.reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0)
    };

    console.log('✅ Summary calculated:', summary);

    res.json({
      summary,
      consultations
    });
  } catch (error) {
    console.error('❌ Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório financeiro' });
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
      SELECT 
        COUNT(*) as total_new_clients,
        COUNT(*) * 250 as subscription_revenue
      FROM users 
      WHERE 'client' = ANY(roles) 
        AND created_at BETWEEN $1 AND $2
    `, [start_date, end_date]);

    // Get clients by month
    const clientsByMonthResult = await pool.query(`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as count,
        COUNT(*) * 250 as revenue
      FROM users 
      WHERE 'client' = ANY(roles) 
        AND created_at BETWEEN $1 AND $2
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `, [start_date, end_date]);

    const summary = newClientsResult.rows[0];
    const clientsByMonth = clientsByMonthResult.rows.map(row => ({
      month: row.month.toISOString().split('T')[0].substring(0, 7), // YYYY-MM format
      count: parseInt(row.count),
      revenue: parseFloat(row.revenue)
    }));

    res.json({
      total_new_clients: parseInt(summary.total_new_clients),
      subscription_revenue: parseFloat(summary.subscription_revenue),
      clients_by_month: clientsByMonth
    });
  } catch (error) {
    console.error('Error generating new clients report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de novos clientes' });
  }
});

app.get('/api/reports/professional-revenue-summary', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Get revenue by professional
    const revenueByProfessionalResult = await pool.query(`
      SELECT 
        prof.name as professional_name,
        prof.percentage as professional_percentage,
        SUM(c.value) as revenue,
        COUNT(c.id) as consultation_count,
        SUM(ROUND(c.value * prof.percentage / 100, 2)) as professional_payment,
        SUM(ROUND(c.value * (100 - prof.percentage) / 100, 2)) as clinic_revenue
      FROM consultations c
      JOIN users prof ON c.professional_id = prof.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY prof.id, prof.name, prof.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    // Get revenue by service
    const revenueByServiceResult = await pool.query(`
      SELECT 
        s.name as service_name,
        SUM(c.value) as revenue,
        COUNT(c.id) as consultation_count
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY s.id, s.name
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    const revenueByProfessional = revenueByProfessionalResult.rows.map(row => ({
      professional_name: row.professional_name,
      professional_percentage: parseInt(row.professional_percentage),
      revenue: parseFloat(row.revenue),
      consultation_count: parseInt(row.consultation_count),
      professional_payment: parseFloat(row.professional_payment),
      clinic_revenue: parseFloat(row.clinic_revenue)
    }));

    const revenueByService = revenueByServiceResult.rows.map(row => ({
      service_name: row.service_name,
      revenue: parseFloat(row.revenue),
      consultation_count: parseInt(row.consultation_count)
    }));

    const totalRevenue = revenueByProfessional.reduce((sum, prof) => sum + prof.revenue, 0);

    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: revenueByProfessional,
      revenue_by_service: revenueByService
    });
  } catch (error) {
    console.error('Error generating professional revenue summary:', error);
    res.status(500).json({ message: 'Erro ao gerar resumo de faturamento' });
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
      SELECT 
        SUM(ROUND(c.value * (100 - prof.percentage) / 100, 2)) as consultation_revenue
      FROM consultations c
      JOIN users prof ON c.professional_id = prof.id
      WHERE c.date BETWEEN $1 AND $2
    `, [start_date, end_date]);

    const subscriptionRevenue = parseFloat(subscriptionResult.rows[0].subscription_revenue) || 0;
    const consultationRevenue = parseFloat(consultationResult.rows[0].consultation_revenue) || 0;
    const totalRevenue = subscriptionRevenue + consultationRevenue;

    res.json({
      subscription_revenue: subscriptionRevenue,
      consultation_revenue: consultationRevenue,
      total_revenue: totalRevenue,
      clinic_total_revenue: totalRevenue // Same as total for clinic
    });
  } catch (error) {
    console.error('Error generating total revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de faturamento total' });
  }
});

app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Get revenue by professional
    const revenueByProfessionalResult = await pool.query(`
      SELECT 
        prof.name as professional_name,
        prof.percentage as professional_percentage,
        SUM(c.value) as revenue,
        COUNT(c.id) as consultation_count,
        SUM(ROUND(c.value * prof.percentage / 100, 2)) as professional_payment,
        SUM(ROUND(c.value * (100 - prof.percentage) / 100, 2)) as clinic_revenue
      FROM consultations c
      JOIN users prof ON c.professional_id = prof.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY prof.id, prof.name, prof.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    // Get revenue by service
    const revenueByServiceResult = await pool.query(`
      SELECT 
        s.name as service_name,
        SUM(c.value) as revenue,
        COUNT(c.id) as consultation_count
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY s.id, s.name
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    const revenueByProfessional = revenueByProfessionalResult.rows.map(row => ({
      professional_name: row.professional_name,
      professional_percentage: parseInt(row.professional_percentage),
      revenue: parseFloat(row.revenue),
      consultation_count: parseInt(row.consultation_count),
      professional_payment: parseFloat(row.professional_payment),
      clinic_revenue: parseFloat(row.clinic_revenue)
    }));

    const revenueByService = revenueByServiceResult.rows.map(row => ({
      service_name: row.service_name,
      revenue: parseFloat(row.revenue),
      consultation_count: parseInt(row.consultation_count)
    }));

    const totalRevenue = revenueByProfessional.reduce((sum, prof) => sum + prof.revenue, 0);

    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: revenueByProfessional,
      revenue_by_service: revenueByService
    });
  } catch (error) {
    console.error('Error generating revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de faturamento' });
  }
});

// 🔥 NEW: Professionals list for clients
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
    res.status(500).json({ message: 'Erro ao carregar profissionais' });
  }
});

// 🔥 NEW: Image upload route
app.post('/api/upload-image', authenticate, async (req, res) => {
  try {
    console.log('🔄 Starting image upload process...');
    
    // Create upload middleware instance
    const upload = createUpload();
    
    // Use multer middleware
    upload.single('image')(req, res, async (err) => {
      if (err) {
        console.error('❌ Multer error:', err);
        return res.status(400).json({ 
          message: 'Erro no upload da imagem',
          error: err.message 
        });
      }

      if (!req.file) {
        console.error('❌ No file provided');
        return res.status(400).json({ message: 'Nenhuma imagem foi enviada' });
      }

      console.log('✅ File uploaded to Cloudinary:', req.file.path);

      try {
        // Update user photo URL in database
        await pool.query(`
          UPDATE users SET 
            photo_url = $1, 
            updated_at = CURRENT_TIMESTAMP 
          WHERE id = $2
        `, [req.file.path, req.user.id]);

        console.log('✅ User photo URL updated in database');

        res.json({
          message: 'Imagem enviada com sucesso',
          imageUrl: req.file.path
        });
      } catch (dbError) {
        console.error('❌ Database error:', dbError);
        res.status(500).json({ 
          message: 'Erro ao salvar URL da imagem',
          error: dbError.message 
        });
      }
    });
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ 
      message: 'Erro interno no upload',
      error: error.message 
    });
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
  console.log(`💳 MercadoPago SDK v2: ${mercadopago ? '✅ Ready' : '❌ Not configured'}`);
});