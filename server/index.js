import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";
import { authenticate, authorize } from "./middleware/auth.js";
import createUpload from "./middleware/upload.js";
import { MercadoPagoConfig, Preference } from "mercadopago";

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

console.log('🔥 MercadoPago SDK v2 configured with access token:', process.env.MP_ACCESS_TOKEN ? 'Found' : 'Missing');

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

// 🔥 CREATE ALL NECESSARY TABLES
const createTables = async () => {
  try {
    console.log('🔄 Creating database tables...');

    // Users table
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
        percentage INTEGER,
        category_id INTEGER,
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_expiry TIMESTAMP,
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Service categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Services table
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

    // Dependents table
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

    // Consultations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id),
        dependent_id INTEGER REFERENCES dependents(id),
        professional_id INTEGER REFERENCES users(id) NOT NULL,
        service_id INTEGER REFERENCES services(id) NOT NULL,
        date TIMESTAMP NOT NULL,
        value DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🔥 NEW AGENDA TABLES

    // Professional patients table (for linking patients to professionals)
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

    // Schedule configuration table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_config (
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

    // Appointments table
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

    // Agenda payments table (separate from consultation payments)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_payments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        payment_reference VARCHAR(255),
        payment_date TIMESTAMP,
        period_start DATE,
        period_end DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Blocked time slots table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_slots (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date TIMESTAMP NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ All database tables created successfully');

    // 🔥 INSERT DEFAULT DATA
    await insertDefaultData();

  } catch (error) {
    console.error('❌ Error creating tables:', error);
  }
};

// 🔥 INSERT DEFAULT DATA
const insertDefaultData = async () => {
  try {
    console.log('🔄 Inserting default data...');

    // Check if categories already exist
    const categoriesResult = await pool.query('SELECT COUNT(*) FROM service_categories');
    const categoriesCount = parseInt(categoriesResult.rows[0].count);

    if (categoriesCount === 0) {
      console.log('📝 Inserting service categories...');
      await pool.query(`
        INSERT INTO service_categories (name, description) VALUES
        ('Fisioterapia', 'Serviços de fisioterapia e reabilitação'),
        ('Psicologia', 'Atendimento psicológico e terapias'),
        ('Nutrição', 'Consultas nutricionais e acompanhamento'),
        ('Odontologia', 'Tratamentos dentários e odontológicos')
      `);
    }

    // Check if services already exist
    const servicesResult = await pool.query('SELECT COUNT(*) FROM services');
    const servicesCount = parseInt(servicesResult.rows[0].count);

    if (servicesCount === 0) {
      console.log('📝 Inserting services...');
      await pool.query(`
        INSERT INTO services (name, description, base_price, category_id, is_base_service) VALUES
        ('Consulta Fisioterapêutica', 'Avaliação e tratamento fisioterapêutico', 80.00, 1, true),
        ('Sessão de Psicoterapia', 'Atendimento psicológico individual', 120.00, 2, true),
        ('Consulta Nutricional', 'Avaliação nutricional e prescrição de dieta', 100.00, 3, true),
        ('Consulta Odontológica', 'Exame clínico e diagnóstico odontológico', 90.00, 4, true),
        ('Limpeza Dentária', 'Profilaxia e limpeza dos dentes', 60.00, 4, false)
      `);
    }

    // Check if test users already exist
    const usersResult = await pool.query('SELECT COUNT(*) FROM users WHERE cpf IN ($1, $2, $3)', 
      ['00000000000', '11111111111', '22222222222']);
    const usersCount = parseInt(usersResult.rows[0].count);

    if (usersCount === 0) {
      console.log('👥 Creating test users...');

      const hashedPassword = await bcrypt.hash('admin123', 10);
      const hashedProfPassword = await bcrypt.hash('prof123', 10);
      const hashedClientPassword = await bcrypt.hash('client123', 10);

      // 1. Admin user
      const adminResult = await pool.query(`
        INSERT INTO users (name, cpf, email, password_hash, roles, subscription_status, subscription_expiry)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `, [
        'Administrador Teste',
        '00000000000',
        'admin@quiroferreira.com.br',
        hashedPassword,
        ['admin'],
        'active',
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      ]);

      // 2. Professional user
      const professionalResult = await pool.query(`
        INSERT INTO users (name, cpf, email, phone, password_hash, roles, percentage, category_id, subscription_status, subscription_expiry)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `, [
        'Dr. João Silva',
        '11111111111',
        'joao@quiroferreira.com.br',
        '64981249199',
        hashedProfPassword,
        ['professional'],
        50,
        1, // Fisioterapia category
        'active',
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      ]);

      const professionalId = professionalResult.rows[0].id;

      // Create schedule config for professional
      await pool.query(`
        INSERT INTO schedule_config (
          professional_id, 
          monday_start, monday_end,
          tuesday_start, tuesday_end,
          wednesday_start, wednesday_end,
          thursday_start, thursday_end,
          friday_start, friday_end,
          slot_duration
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        professionalId,
        '08:00', '18:00',
        '08:00', '18:00',
        '08:00', '18:00',
        '08:00', '18:00',
        '08:00', '18:00',
        30
      ]);

      // Create agenda payment for professional (active for 30 days)
      await pool.query(`
        INSERT INTO agenda_payments (
          professional_id, amount, status, payment_date, period_start, period_end
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        professionalId,
        49.90,
        'paid',
        new Date(),
        new Date(),
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      ]);

      // 3. Client user
      await pool.query(`
        INSERT INTO users (name, cpf, email, phone, password_hash, roles, subscription_status, subscription_expiry)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        'Maria Santos',
        '22222222222',
        'maria@cliente.com.br',
        '64987654321',
        hashedClientPassword,
        ['client'],
        'active',
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      ]);

      console.log('✅ Test users created successfully');
      console.log('🔑 Login credentials:');
      console.log('   👑 Admin: CPF 000.000.000-00, Senha: admin123');
      console.log('   👨‍⚕️ Professional: CPF 111.111.111-11, Senha: prof123');
      console.log('   👤 Client: CPF 222.222.222-22, Senha: client123');
    }

    console.log('✅ Default data insertion completed');

  } catch (error) {
    console.error('❌ Error inserting default data:', error);
  }
};

// Initialize database
createTables();

// Auth routes
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

    if (!user.password_hash) {
      return res.status(401).json({ message: 'Usuário sem senha definida' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    const userRoles = user.roles || [];
    const needsRoleSelection = userRoles.length > 1;

    res.json({
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
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
        cpf: user.cpf,
        roles: userRoles,
        currentRole: role
      }
    });

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
        cpf: user.cpf,
        roles: userRoles,
        currentRole: role
      }
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
      RETURNING id, name, cpf
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
        roles: ['client']
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

// 🔥 MERCADO PAGO ROUTES WITH SDK V2

// Client subscription payment
app.post('/api/create-subscription', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { user_id, dependent_ids } = req.body;
    
    console.log('🔄 Creating client subscription payment with SDK v2...');

    // Calculate total amount
    const dependentCount = dependent_ids ? dependent_ids.length : 0;
    const totalAmount = 250 + (dependentCount * 50); // R$250 + R$50 per dependent

    // 🔥 CREATE PREFERENCE WITH SDK V2
    const preference = new Preference(client);

    const preferenceData = {
      items: [
        {
          title: 'Assinatura Convênio Quiro Ferreira',
          description: `Assinatura mensal - Titular + ${dependentCount} dependente(s)`,
          quantity: 1,
          unit_price: totalAmount,
          currency_id: 'BRL'
        }
      ],
      payer: {
        email: req.user.email || 'cliente@quiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=pending`
      },
      auto_return: 'approved',
      external_reference: `client_subscription_${user_id}_${Date.now()}`,
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`
    };

    const result = await preference.create({ body: preferenceData });
    
    console.log('✅ Client subscription preference created with SDK v2:', result.id);

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

// Professional payment to clinic
app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { amount } = req.body;
    
    console.log('🔄 Creating professional payment with SDK v2...');

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }

    // 🔥 CREATE PREFERENCE WITH SDK V2
    const preference = new Preference(client);

    const preferenceData = {
      items: [
        {
          title: 'Repasse ao Convênio Quiro Ferreira',
          description: 'Valor a ser repassado ao convênio referente às consultas realizadas',
          quantity: 1,
          unit_price: parseFloat(amount),
          currency_id: 'BRL'
        }
      ],
      payer: {
        email: req.user.email || 'profissional@quiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=pending`
      },
      auto_return: 'approved',
      external_reference: `professional_payment_${req.user.id}_${Date.now()}`,
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`
    };

    const result = await preference.create({ body: preferenceData });
    
    console.log('✅ Professional payment preference created with SDK v2:', result.id);

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

// 🔥 NEW: Agenda subscription payment
app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    console.log('🔄 Creating agenda subscription payment with SDK v2...');

    const professionalId = req.user.id;
    const monthlyPrice = 49.90;

    // 🔥 CREATE PREFERENCE WITH SDK V2
    const preference = new Preference(client);

    const preferenceData = {
      items: [
        {
          title: 'Assinatura Agenda Profissional',
          description: 'Acesso mensal à agenda profissional Quiro Ferreira',
          quantity: 1,
          unit_price: monthlyPrice,
          currency_id: 'BRL'
        }
      ],
      payer: {
        email: req.user.email || 'profissional@quiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=pending`
      },
      auto_return: 'approved',
      external_reference: `agenda_subscription_${professionalId}_${Date.now()}`,
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`
    };

    const result = await preference.create({ body: preferenceData });
    
    console.log('✅ Agenda subscription preference created with SDK v2:', result.id);

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

// 🔥 AGENDA ROUTES

// Get subscription status
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;

    const result = await pool.query(`
      SELECT * FROM agenda_payments 
      WHERE professional_id = $1 AND status = 'paid'
      ORDER BY period_end DESC 
      LIMIT 1
    `, [professionalId]);

    if (result.rows.length === 0) {
      return res.json({
        status: 'inactive',
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: false
      });
    }

    const payment = result.rows[0];
    const now = new Date();
    const expiryDate = new Date(payment.period_end);
    const daysRemaining = Math.max(0, Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)));

    res.json({
      status: daysRemaining > 0 ? 'active' : 'expired',
      expires_at: payment.period_end,
      days_remaining: daysRemaining,
      can_use_agenda: daysRemaining > 0,
      last_payment: payment.payment_date
    });

  } catch (error) {
    console.error('Error getting subscription status:', error);
    res.status(500).json({ message: 'Erro ao verificar status da assinatura' });
  }
});

// Get schedule configuration
app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;

    const result = await pool.query(
      'SELECT * FROM schedule_config WHERE professional_id = $1',
      [professionalId]
    );

    if (result.rows.length === 0) {
      // Create default config
      const defaultConfig = await pool.query(`
        INSERT INTO schedule_config (
          professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
          wednesday_start, wednesday_end, thursday_start, thursday_end,
          friday_start, friday_end, slot_duration
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `, [
        professionalId, '08:00', '18:00', '08:00', '18:00',
        '08:00', '18:00', '08:00', '18:00', '08:00', '18:00', 30
      ]);

      return res.json(defaultConfig.rows[0]);
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error getting schedule config:', error);
    res.status(500).json({ message: 'Erro ao carregar configuração de horários' });
  }
});

// Get professional patients
app.get('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;

    // Check subscription
    const subscriptionCheck = await pool.query(`
      SELECT period_end FROM agenda_payments 
      WHERE professional_id = $1 AND status = 'paid' AND period_end > NOW()
      ORDER BY period_end DESC LIMIT 1
    `, [professionalId]);

    if (subscriptionCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Assinatura da agenda necessária' });
    }

    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.cpf, u.email, u.phone, u.birth_date,
        u.address, u.address_number, u.address_complement,
        u.neighborhood, u.city, u.state,
        pp.notes, pp.linked_at,
        CASE WHEN u.roles && ARRAY['client'] THEN true ELSE false END as is_convenio_patient
      FROM users u
      JOIN professional_patients pp ON u.id = pp.patient_id
      WHERE pp.professional_id = $1
      ORDER BY u.name
    `, [professionalId]);

    res.json(result.rows);

  } catch (error) {
    console.error('Error getting patients:', error);
    res.status(500).json({ message: 'Erro ao carregar pacientes' });
  }
});

// Add patient
app.post('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const { name, cpf, email, phone, birth_date, address, address_number, address_complement, neighborhood, city, state, notes } = req.body;

    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }

    const cleanCpf = cpf.replace(/\D/g, '');

    // Check if patient already exists
    let patientResult = await pool.query('SELECT id FROM users WHERE cpf = $1', [cleanCpf]);
    let patientId;

    if (patientResult.rows.length === 0) {
      // Create new patient
      const newPatient = await pool.query(`
        INSERT INTO users (name, cpf, email, phone, birth_date, address, address_number, address_complement, neighborhood, city, state, roles)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `, [name, cleanCpf, email, phone, birth_date, address, address_number, address_complement, neighborhood, city, state, []]);
      
      patientId = newPatient.rows[0].id;
    } else {
      patientId = patientResult.rows[0].id;
    }

    // Link patient to professional
    await pool.query(`
      INSERT INTO professional_patients (professional_id, patient_id, notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (professional_id, patient_id) DO UPDATE SET notes = $3
    `, [professionalId, patientId, notes]);

    // Return patient data
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.cpf, u.email, u.phone, u.birth_date,
        u.address, u.address_number, u.address_complement,
        u.neighborhood, u.city, u.state,
        pp.notes, pp.linked_at,
        CASE WHEN u.roles && ARRAY['client'] THEN true ELSE false END as is_convenio_patient
      FROM users u
      JOIN professional_patients pp ON u.id = pp.patient_id
      WHERE pp.professional_id = $1 AND u.id = $2
    `, [professionalId, patientId]);

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error adding patient:', error);
    res.status(500).json({ message: 'Erro ao adicionar paciente' });
  }
});

// Update patient notes
app.put('/api/agenda/patients/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const patientId = req.params.id;
    const { notes } = req.body;

    await pool.query(`
      UPDATE professional_patients 
      SET notes = $1 
      WHERE professional_id = $2 AND patient_id = $3
    `, [notes, professionalId, patientId]);

    res.json({ message: 'Observações atualizadas com sucesso' });

  } catch (error) {
    console.error('Error updating patient notes:', error);
    res.status(500).json({ message: 'Erro ao atualizar observações' });
  }
});

// Get appointments
app.get('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const { start_date, end_date } = req.query;

    const result = await pool.query(`
      SELECT 
        a.id, a.date, a.status, a.notes,
        u.id as patient_id, u.name as patient_name, u.phone as patient_phone,
        CASE WHEN u.roles && ARRAY['client'] THEN true ELSE false END as is_convenio_patient
      FROM appointments a
      JOIN users u ON a.patient_id = u.id
      WHERE a.professional_id = $1 
        AND a.date >= $2 
        AND a.date <= $3
      ORDER BY a.date
    `, [professionalId, start_date, end_date]);

    res.json(result.rows);

  } catch (error) {
    console.error('Error getting appointments:', error);
    res.status(500).json({ message: 'Erro ao carregar agendamentos' });
  }
});

// Create appointment
app.post('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professionalId = req.user.id;
    const { patient_id, date, notes } = req.body;

    const result = await pool.query(`
      INSERT INTO appointments (professional_id, patient_id, date, notes)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [professionalId, patient_id, date, notes]);

    res.json({ id: result.rows[0].id, message: 'Agendamento criado com sucesso' });

  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erro ao criar agendamento' });
  }
});

// Other existing routes...
// (Keep all your existing routes for users, consultations, etc.)

// Users routes
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
    res.status(500).json({ message: 'Erro ao carregar usuários' });
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
    res.status(500).json({ message: 'Erro ao carregar usuário' });
  }
});

// Continue with all other existing routes...
// (I'll keep the rest of your existing routes as they are)

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔥 MercadoPago SDK v2 integration ready`);
});