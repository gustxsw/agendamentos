import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { authenticate, authorize } from './middleware/auth.js';
import createUpload from './middleware/upload.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://www.cartaoquiroferreira.com.br',
    'https://cartaoquiroferreira.com.br'
  ],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// 🔥 MERCADO PAGO SDK V2 CONFIGURATION
let mercadopago;
try {
  const { MercadoPagoConfig, Preference } = await import('mercadopago');
  
  const accessToken = process.env.MP_ACCESS_TOKEN;
  console.log('🔥 MercadoPago SDK v2 - Access Token:', accessToken ? 'Found' : 'Missing');
  
  if (accessToken) {
    const client = new MercadoPagoConfig({
      accessToken: accessToken,
      options: {
        timeout: 5000,
        idempotencyKey: 'abc'
      }
    });
    
    mercadopago = {
      client,
      Preference
    };
    
    console.log('✅ MercadoPago SDK v2 initialized successfully');
  } else {
    console.warn('⚠️ MercadoPago access token not found');
  }
} catch (error) {
  console.error('❌ Error initializing MercadoPago SDK v2:', error);
}

// 🗄️ DATABASE INITIALIZATION WITH ALL TABLES
const initializeDatabase = async () => {
  try {
    console.log('🔄 Initializing database...');

    // 1. Users table with enhanced fields
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
        percentage DECIMAL(5,2),
        category_id INTEGER,
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_expiry TIMESTAMP,
        photo_url TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Service categories
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Services
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

    // 4. Professional locations (NEW)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_locations (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        clinic_name VARCHAR(255),
        address TEXT NOT NULL,
        address_number VARCHAR(20),
        address_complement VARCHAR(100),
        neighborhood VARCHAR(100),
        city VARCHAR(100),
        state VARCHAR(2),
        phone VARCHAR(20),
        is_primary BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. Dependents
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

    // 6. Enhanced consultations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id),
        dependent_id INTEGER REFERENCES dependents(id),
        professional_id INTEGER REFERENCES users(id) NOT NULL,
        service_id INTEGER REFERENCES services(id) NOT NULL,
        location_id INTEGER REFERENCES professional_locations(id),
        value DECIMAL(10,2) NOT NULL,
        date TIMESTAMP NOT NULL,
        consultation_type VARCHAR(20) DEFAULT 'convenio',
        status VARCHAR(20) DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 7. Medical records (NEW - PRONTUÁRIOS)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INTEGER REFERENCES consultations(id) ON DELETE CASCADE,
        patient_id INTEGER, -- Can be client_id or dependent_id
        patient_type VARCHAR(20) NOT NULL, -- 'client' or 'dependent'
        professional_id INTEGER REFERENCES users(id) NOT NULL,
        
        -- Consultation data
        chief_complaint TEXT, -- Motivo da consulta
        anamnesis TEXT, -- Anamnese
        physical_examination TEXT, -- Avaliação
        diagnosis TEXT, -- Diagnóstico
        treatment_plan TEXT, -- Tratamento
        clinical_evolution TEXT, -- Evolução clínica
        internal_notes TEXT, -- Observações internas
        
        -- Professional signature
        professional_name VARCHAR(255),
        professional_registration VARCHAR(100),
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 8. Agenda subscriptions (NEW)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        expires_at TIMESTAMP,
        last_payment_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 9. Schedule configurations (ENHANCED)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_configs (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        location_id INTEGER REFERENCES professional_locations(id),
        
        -- Weekly schedule
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
        
        -- Break times
        break_start TIME,
        break_end TIME,
        
        -- Slot configuration
        slot_duration INTEGER DEFAULT 30,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 10. Professional patients (ENHANCED)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_patients (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER, -- Can be client_id or dependent_id
        patient_type VARCHAR(20) NOT NULL, -- 'client' or 'dependent'
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
        is_archived BOOLEAN DEFAULT false, -- NEW: Archive patients
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 11. Appointments (ENHANCED)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES professional_patients(id) ON DELETE CASCADE,
        location_id INTEGER REFERENCES professional_locations(id),
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        
        -- Recurring appointments (NEW)
        is_recurring BOOLEAN DEFAULT false,
        recurring_pattern JSONB, -- Store recurring pattern
        parent_appointment_id INTEGER REFERENCES appointments(id),
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 12. Password reset tokens (NEW)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 13. Client subscriptions tracking (NEW)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_subscriptions (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        subscription_type VARCHAR(50) DEFAULT 'monthly',
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        payment_date TIMESTAMP,
        expires_at TIMESTAMP,
        mercadopago_payment_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ All database tables created successfully');

    // Insert default data
    await insertDefaultData();

  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
};

// 📊 INSERT DEFAULT DATA
const insertDefaultData = async () => {
  try {
    // Check if data already exists
    const existingUsers = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(existingUsers.rows[0].count) > 0) {
      console.log('✅ Default data already exists');
      return;
    }

    console.log('🔄 Inserting default data...');

    // 1. Service categories
    const categoryResult = await pool.query(`
      INSERT INTO service_categories (name, description) VALUES
      ('Fisioterapia', 'Serviços de fisioterapia e reabilitação'),
      ('Quiropraxia', 'Tratamentos quiropráticos'),
      ('Massoterapia', 'Massagens terapêuticas'),
      ('Acupuntura', 'Tratamentos com acupuntura')
      RETURNING id
    `);

    // 2. Services
    await pool.query(`
      INSERT INTO services (name, description, base_price, category_id, is_base_service) VALUES
      ('Consulta Fisioterapia', 'Consulta inicial de fisioterapia', 120.00, $1, true),
      ('Sessão Fisioterapia', 'Sessão de fisioterapia', 80.00, $1, false),
      ('Consulta Quiropraxia', 'Consulta quiropráctica', 150.00, $2, true),
      ('Ajuste Quiroprático', 'Ajuste da coluna vertebral', 100.00, $2, false),
      ('Massagem Relaxante', 'Massagem para relaxamento', 90.00, $3, false),
      ('Massagem Terapêutica', 'Massagem para tratamento', 110.00, $3, true),
      ('Sessão Acupuntura', 'Sessão de acupuntura', 100.00, $4, true)
    `, [categoryResult.rows[0].id, categoryResult.rows[1]?.id || categoryResult.rows[0].id, 
        categoryResult.rows[2]?.id || categoryResult.rows[0].id, categoryResult.rows[3]?.id || categoryResult.rows[0].id]);

    // 3. Test users
    const adminPassword = await bcrypt.hash('admin123', 10);
    const profPassword = await bcrypt.hash('prof123', 10);
    const clientPassword = await bcrypt.hash('client123', 10);

    // Admin user
    const adminResult = await pool.query(`
      INSERT INTO users (name, cpf, email, password_hash, roles, subscription_status) VALUES
      ('Administrador Sistema', '00000000000', 'admin@quiroferreira.com', $1, $2, 'active')
      RETURNING id
    `, [adminPassword, ['admin']]);

    // Professional user
    const profResult = await pool.query(`
      INSERT INTO users (name, cpf, email, password_hash, roles, percentage, category_id, subscription_status) VALUES
      ('Dr. João Silva', '11111111111', 'joao@quiroferreira.com', $1, $2, 60.00, $3, 'active')
      RETURNING id
    `, [profPassword, ['professional'], categoryResult.rows[0].id]);

    // Client user
    const clientResult = await pool.query(`
      INSERT INTO users (name, cpf, email, password_hash, roles, subscription_status, subscription_expiry) VALUES
      ('Maria Santos', '22222222222', 'maria@email.com', $1, $2, 'active', $3)
      RETURNING id
    `, [clientPassword, ['client'], new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]);

    // 4. Professional location
    await pool.query(`
      INSERT INTO professional_locations (professional_id, clinic_name, address, address_number, city, state, is_primary) VALUES
      ($1, 'Clínica Quiro Ferreira', 'Rua das Flores', '123', 'Goiânia', 'GO', true)
    `, [profResult.rows[0].id]);

    // 5. Sample dependent
    await pool.query(`
      INSERT INTO dependents (client_id, name, cpf, birth_date) VALUES
      ($1, 'Pedro Santos', '33333333333', '2010-05-15')
    `, [clientResult.rows[0].id]);

    // 6. Agenda subscription for professional
    await pool.query(`
      INSERT INTO agenda_subscriptions (professional_id, status, expires_at) VALUES
      ($1, 'active', $2)
    `, [profResult.rows[0].id, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]);

    console.log('✅ Default data inserted successfully');
    console.log('🔑 Test credentials:');
    console.log('👑 Admin: CPF 000.000.000-00, Senha: admin123');
    console.log('👨‍⚕️ Professional: CPF 111.111.111-11, Senha: prof123');
    console.log('👤 Client: CPF 222.222.222-22, Senha: client123');

  } catch (error) {
    console.error('❌ Error inserting default data:', error);
  }
};

// 🔐 AUTHENTICATION ROUTES
app.post('/api/auth/login', async (req, res) => {
  try {
    const { cpf, password } = req.body;
    console.log('🔄 Login attempt for CPF:', cpf);

    const cleanCpf = cpf.replace(/\D/g, '');
    const result = await pool.query(
      'SELECT id, name, cpf, password_hash, roles FROM users WHERE cpf = $1 AND is_active = true',
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

    console.log('✅ Login successful for user:', user.name);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        roles: user.roles || []
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/select-role', async (req, res) => {
  try {
    const { userId, role } = req.body;
    console.log('🎯 Role selection:', { userId, role });

    const result = await pool.query(
      'SELECT id, name, cpf, roles FROM users WHERE id = $1 AND is_active = true',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];
    if (!user.roles || !user.roles.includes(role)) {
      return res.status(403).json({ message: 'Role não autorizada' });
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

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        roles: user.roles,
        currentRole: role
      }
    });
  } catch (error) {
    console.error('❌ Role selection error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/switch-role', authenticate, async (req, res) => {
  try {
    const { role } = req.body;
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT roles FROM users WHERE id = $1 AND is_active = true',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];
    if (!user.roles || !user.roles.includes(role)) {
      return res.status(403).json({ message: 'Role não autorizada' });
    }

    const token = jwt.sign(
      { id: userId, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({
      token,
      user: {
        id: req.user.id,
        name: req.user.name,
        cpf: req.user.cpf,
        roles: user.roles,
        currentRole: role
      }
    });
  } catch (error) {
    console.error('❌ Role switch error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, password
    } = req.body;

    const cleanCpf = cpf.replace(/\D/g, '');
    const cleanPhone = phone ? phone.replace(/\D/g, '') : null;

    // Check if CPF already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cleanCpf]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password_hash, roles
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, name, cpf
    `, [
      name, cleanCpf, email, cleanPhone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, passwordHash, ['client']
    ]);

    console.log('✅ New client registered:', result.rows[0].name);

    res.status(201).json({
      user: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        cpf: result.rows[0].cpf,
        roles: ['client']
      }
    });
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout realizado com sucesso' });
});

// 🔑 CHANGE PASSWORD ROUTE (NEW)
app.put('/api/auth/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user.id;

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'Nova senha e confirmação não coincidem' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Nova senha deve ter pelo menos 6 caracteres' });
    }

    // Get current password hash
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Senha atual incorreta' });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', 
      [newPasswordHash, userId]);

    console.log('✅ Password changed for user:', req.user.name);
    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('❌ Change password error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 💳 MERCADO PAGO ROUTES (SDK V2)
app.post('/api/create-subscription', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { user_id, dependent_ids = [] } = req.body;
    
    if (!mercadopago) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }

    console.log('🔄 Creating client subscription payment with SDK v2...');

    const basePrice = 250; // R$ 250 for titular
    const dependentPrice = 50; // R$ 50 per dependent
    const totalAmount = basePrice + (dependent_ids.length * dependentPrice);

    const preference = new mercadopago.Preference(mercadopago.client);

    const preferenceData = {
      items: [
        {
          title: 'Assinatura Cartão Quiro Ferreira',
          description: `Titular + ${dependent_ids.length} dependente(s)`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: totalAmount
        }
      ],
      payer: {
        email: req.user.email || 'cliente@quiroferreira.com'
      },
      external_reference: `client_subscription_${user_id}_${Date.now()}`,
      notification_url: `${process.env.BASE_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`
      },
      auto_return: 'approved'
    };

    const response = await preference.create({ body: preferenceData });
    
    console.log('✅ Client subscription preference created with SDK v2:', response.id);

    res.json({
      preference_id: response.id,
      init_point: response.init_point,
      sandbox_init_point: response.sandbox_init_point
    });
  } catch (error) {
    console.error('❌ Error creating client subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!mercadopago) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }

    console.log('🔄 Creating professional payment with SDK v2...');

    const preference = new mercadopago.Preference(mercadopago.client);

    const preferenceData = {
      items: [
        {
          title: 'Repasse ao Convênio Quiro Ferreira',
          description: 'Pagamento referente às consultas realizadas',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: parseFloat(amount)
        }
      ],
      payer: {
        email: req.user.email || 'profissional@quiroferreira.com'
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

    const response = await preference.create({ body: preferenceData });
    
    console.log('✅ Professional payment preference created with SDK v2:', response.id);

    res.json({
      preference_id: response.id,
      init_point: response.init_point,
      sandbox_init_point: response.sandbox_init_point
    });
  } catch (error) {
    console.error('❌ Error creating professional payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    if (!mercadopago) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }

    console.log('🔄 Creating agenda subscription payment with SDK v2...');

    const preference = new mercadopago.Preference(mercadopago.client);

    const preferenceData = {
      items: [
        {
          title: 'Assinatura Agenda Profissional',
          description: 'Acesso à agenda profissional por 30 dias',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: 49.90
        }
      ],
      payer: {
        email: req.user.email || 'profissional@quiroferreira.com'
      },
      external_reference: `agenda_subscription_${req.user.id}_${Date.now()}`,
      notification_url: `${process.env.BASE_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`
      },
      auto_return: 'approved'
    };

    const response = await preference.create({ body: preferenceData });
    
    console.log('✅ Agenda subscription preference created with SDK v2:', response.id);

    res.json({
      preference_id: response.id,
      init_point: response.init_point,
      sandbox_init_point: response.sandbox_init_point
    });
  } catch (error) {
    console.error('❌ Error creating agenda subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

// 🔔 MERCADO PAGO WEBHOOK
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    console.log('🔔 MercadoPago webhook received:', req.body);
    
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      console.log('💳 Processing payment:', paymentId);
      
      // Here you would typically:
      // 1. Get payment details from MercadoPago API
      // 2. Update subscription status in database
      // 3. Send confirmation email
      
      // For now, just log the payment
      console.log('✅ Payment processed successfully');
    }
    
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ message: 'Erro no webhook' });
  }
});

// 👥 USER MANAGEMENT ROUTES
app.get('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.cpf, u.email, u.phone, u.birth_date,
        u.address, u.address_number, u.address_complement,
        u.neighborhood, u.city, u.state, u.roles, u.percentage,
        u.subscription_status, u.subscription_expiry, u.is_active,
        u.created_at, sc.name as category_name
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE u.is_active = true
      ORDER BY u.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching users:', error);
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
        u.subscription_status, u.subscription_expiry, u.photo_url,
        u.is_active, u.created_at, sc.name as category_name
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE u.id = $1 AND u.is_active = true
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error fetching user:', error);
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

    const cleanCpf = cpf.replace(/\D/g, '');
    const cleanPhone = phone ? phone.replace(/\D/g, '') : null;

    // Check if CPF already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cleanCpf]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password_hash, roles,
        percentage, category_id, subscription_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, name, cpf
    `, [
      name, cleanCpf, email, cleanPhone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, passwordHash, roles,
      percentage, category_id, roles.includes('client') ? 'pending' : 'active'
    ]);

    console.log('✅ New user created:', result.rows[0].name);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error creating user:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
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

    const cleanPhone = phone ? phone.replace(/\D/g, '') : null;

    await pool.query(`
      UPDATE users SET
        name = $1, email = $2, phone = $3, birth_date = $4,
        address = $5, address_number = $6, address_complement = $7,
        neighborhood = $8, city = $9, state = $10, roles = $11,
        percentage = $12, category_id = $13, updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
    `, [
      name, email, cleanPhone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles,
      percentage, category_id, id
    ]);

    console.log('✅ User updated:', id);
    res.json({ message: 'Usuário atualizado com sucesso' });
  } catch (error) {
    console.error('❌ Error updating user:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.delete('/api/users/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [id]);

    console.log('✅ User deactivated:', id);
    res.json({ message: 'Usuário desativado com sucesso' });
  } catch (error) {
    console.error('❌ Error deactivating user:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/users/:id/activate', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { expiry_date } = req.body;

    await pool.query(`
      UPDATE users SET 
        subscription_status = 'active',
        subscription_expiry = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [expiry_date, id]);

    console.log('✅ Client activated:', id);
    res.json({ message: 'Cliente ativado com sucesso' });
  } catch (error) {
    console.error('❌ Error activating client:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 👨‍⚕️ PROFESSIONALS ROUTES
app.get('/api/professionals', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.email, u.phone, u.address, u.address_number,
        u.address_complement, u.neighborhood, u.city, u.state,
        u.photo_url, sc.name as category_name
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE 'professional' = ANY(u.roles) AND u.is_active = true
      ORDER BY u.name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching professionals:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🏥 PROFESSIONAL LOCATIONS ROUTES (NEW)
app.get('/api/professional-locations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM professional_locations 
      WHERE professional_id = $1 
      ORDER BY is_primary DESC, created_at ASC
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching locations:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/professional-locations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_primary
    } = req.body;

    // If this is primary, unset other primary locations
    if (is_primary) {
      await pool.query(
        'UPDATE professional_locations SET is_primary = false WHERE professional_id = $1',
        [req.user.id]
      );
    }

    const result = await pool.query(`
      INSERT INTO professional_locations (
        professional_id, clinic_name, address, address_number, address_complement,
        neighborhood, city, state, phone, is_primary
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      req.user.id, clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_primary
    ]);

    console.log('✅ Location added for professional:', req.user.name);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error adding location:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/professional-locations/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_primary
    } = req.body;

    // If this is primary, unset other primary locations
    if (is_primary) {
      await pool.query(
        'UPDATE professional_locations SET is_primary = false WHERE professional_id = $1 AND id != $2',
        [req.user.id, id]
      );
    }

    await pool.query(`
      UPDATE professional_locations SET
        clinic_name = $1, address = $2, address_number = $3, address_complement = $4,
        neighborhood = $5, city = $6, state = $7, phone = $8, is_primary = $9
      WHERE id = $10 AND professional_id = $11
    `, [
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_primary, id, req.user.id
    ]);

    console.log('✅ Location updated:', id);
    res.json({ message: 'Local atualizado com sucesso' });
  } catch (error) {
    console.error('❌ Error updating location:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.delete('/api/professional-locations/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      'DELETE FROM professional_locations WHERE id = $1 AND professional_id = $2',
      [id, req.user.id]
    );

    console.log('✅ Location deleted:', id);
    res.json({ message: 'Local excluído com sucesso' });
  } catch (error) {
    console.error('❌ Error deleting location:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🛠️ SERVICES ROUTES
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
    console.error('❌ Error fetching services:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
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

    console.log('✅ Service created:', result.rows[0].name);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error creating service:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/services/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, base_price, category_id, is_base_service } = req.body;

    await pool.query(`
      UPDATE services SET
        name = $1, description = $2, base_price = $3,
        category_id = $4, is_base_service = $5
      WHERE id = $6
    `, [name, description, base_price, category_id, is_base_service, id]);

    console.log('✅ Service updated:', id);
    res.json({ message: 'Serviço atualizado com sucesso' });
  } catch (error) {
    console.error('❌ Error updating service:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.delete('/api/services/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM services WHERE id = $1', [id]);

    console.log('✅ Service deleted:', id);
    res.json({ message: 'Serviço excluído com sucesso' });
  } catch (error) {
    console.error('❌ Error deleting service:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 📂 SERVICE CATEGORIES ROUTES
app.get('/api/service-categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM service_categories ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching categories:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
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

    console.log('✅ Category created:', result.rows[0].name);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error creating category:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🩺 CONSULTATIONS ROUTES
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query = `
      SELECT 
        c.id, c.value, c.date, c.consultation_type, c.status,
        COALESCE(d.name, u.name) as client_name,
        CASE WHEN c.dependent_id IS NOT NULL THEN true ELSE false END as is_dependent,
        s.name as service_name,
        prof.name as professional_name
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users prof ON c.professional_id = prof.id
    `;

    let params = [];
    let whereConditions = [];

    if (req.user.currentRole === 'client') {
      whereConditions.push('(c.client_id = $1 OR d.client_id = $1)');
      params.push(req.user.id);
    } else if (req.user.currentRole === 'professional') {
      whereConditions.push('c.professional_id = $1');
      params.push(req.user.id);
    }

    if (whereConditions.length > 0) {
      query += ' WHERE ' + whereConditions.join(' AND ');
    }

    query += ' ORDER BY c.date DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching consultations:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { client_id, dependent_id, service_id, value, date, location_id } = req.body;

    const result = await pool.query(`
      INSERT INTO consultations (
        client_id, dependent_id, professional_id, service_id, 
        location_id, value, date, consultation_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      client_id, dependent_id, req.user.id, service_id,
      location_id, value, date, client_id ? 'convenio' : 'particular'
    ]);

    console.log('✅ Consultation registered by:', req.user.name);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error registering consultation:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 📋 MEDICAL RECORDS ROUTES (NEW - PRONTUÁRIOS)
app.get('/api/medical-records/:patientId/:patientType', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patientId, patientType } = req.params;

    const result = await pool.query(`
      SELECT 
        mr.*,
        c.date as consultation_date,
        s.name as service_name,
        CASE 
          WHEN mr.patient_type = 'client' THEN u.name
          ELSE d.name
        END as patient_name
      FROM medical_records mr
      LEFT JOIN consultations c ON mr.consultation_id = c.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users u ON mr.patient_id = u.id AND mr.patient_type = 'client'
      LEFT JOIN dependents d ON mr.patient_id = d.id AND mr.patient_type = 'dependent'
      WHERE mr.patient_id = $1 AND mr.patient_type = $2 AND mr.professional_id = $3
      ORDER BY mr.created_at DESC
    `, [patientId, patientType, req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching medical records:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/medical-records/consultation/:consultationId', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { consultationId } = req.params;

    const result = await pool.query(`
      SELECT mr.* FROM medical_records mr
      WHERE mr.consultation_id = $1 AND mr.professional_id = $2
    `, [consultationId, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Prontuário não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error fetching medical record:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/medical-records', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      consultation_id, patient_id, patient_type, chief_complaint,
      anamnesis, physical_examination, diagnosis, treatment_plan,
      clinical_evolution, internal_notes, professional_registration
    } = req.body;

    const result = await pool.query(`
      INSERT INTO medical_records (
        consultation_id, patient_id, patient_type, professional_id,
        chief_complaint, anamnesis, physical_examination, diagnosis,
        treatment_plan, clinical_evolution, internal_notes,
        professional_name, professional_registration
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      consultation_id, patient_id, patient_type, req.user.id,
      chief_complaint, anamnesis, physical_examination, diagnosis,
      treatment_plan, clinical_evolution, internal_notes,
      req.user.name, professional_registration
    ]);

    console.log('✅ Medical record created for consultation:', consultation_id);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error creating medical record:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/medical-records/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      chief_complaint, anamnesis, physical_examination, diagnosis,
      treatment_plan, clinical_evolution, internal_notes, professional_registration
    } = req.body;

    await pool.query(`
      UPDATE medical_records SET
        chief_complaint = $1, anamnesis = $2, physical_examination = $3,
        diagnosis = $4, treatment_plan = $5, clinical_evolution = $6,
        internal_notes = $7, professional_registration = $8,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9 AND professional_id = $10
    `, [
      chief_complaint, anamnesis, physical_examination, diagnosis,
      treatment_plan, clinical_evolution, internal_notes, professional_registration,
      id, req.user.id
    ]);

    console.log('✅ Medical record updated:', id);
    res.json({ message: 'Prontuário atualizado com sucesso' });
  } catch (error) {
    console.error('❌ Error updating medical record:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 👶 DEPENDENTS ROUTES
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;

    // Check if user can access this client's dependents
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
    console.error('❌ Error fetching dependents:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/dependents/lookup', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.query;
    const cleanCpf = cpf.replace(/\D/g, '');

    const result = await pool.query(`
      SELECT 
        d.id, d.name, d.cpf, d.birth_date, d.client_id,
        u.name as client_name, u.subscription_status as client_subscription_status
      FROM dependents d
      JOIN users u ON d.client_id = u.id
      WHERE d.cpf = $1 AND u.is_active = true
    `, [cleanCpf]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error looking up dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/dependents', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;

    // Check if user can add dependents to this client
    if (req.user.id !== client_id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
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

    console.log('✅ Dependent added:', result.rows[0].name);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error adding dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/dependents/:id', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, birth_date } = req.body;

    // Check if user owns this dependent
    const dependentCheck = await pool.query(
      'SELECT client_id FROM dependents WHERE id = $1',
      [id]
    );

    if (dependentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    if (dependentCheck.rows[0].client_id !== req.user.id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }

    await pool.query(`
      UPDATE dependents SET name = $1, birth_date = $2
      WHERE id = $3
    `, [name, birth_date, id]);

    console.log('✅ Dependent updated:', id);
    res.json({ message: 'Dependente atualizado com sucesso' });
  } catch (error) {
    console.error('❌ Error updating dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.delete('/api/dependents/:id', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user owns this dependent
    const dependentCheck = await pool.query(
      'SELECT client_id FROM dependents WHERE id = $1',
      [id]
    );

    if (dependentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    if (dependentCheck.rows[0].client_id !== req.user.id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }

    await pool.query('DELETE FROM dependents WHERE id = $1', [id]);

    console.log('✅ Dependent deleted:', id);
    res.json({ message: 'Dependente excluído com sucesso' });
  } catch (error) {
    console.error('❌ Error deleting dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🔍 CLIENT LOOKUP ROUTES
app.get('/api/clients/lookup', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.query;
    const cleanCpf = cpf.replace(/\D/g, '');

    const result = await pool.query(`
      SELECT id, name, cpf, subscription_status
      FROM users 
      WHERE cpf = $1 AND 'client' = ANY(roles) AND is_active = true
    `, [cleanCpf]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error looking up client:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 📅 AGENDA ROUTES (ENHANCED)
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT status, expires_at, last_payment_date
      FROM agenda_subscriptions 
      WHERE professional_id = $1 
      ORDER BY created_at DESC 
      LIMIT 1
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
    const canUseAgenda = subscription.status === 'active' && daysRemaining > 0;

    res.json({
      status: subscription.status,
      expires_at: subscription.expires_at,
      days_remaining: daysRemaining,
      can_use_agenda: canUseAgenda,
      last_payment: subscription.last_payment_date
    });
  } catch (error) {
    console.error('❌ Error fetching subscription status:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM schedule_configs 
      WHERE professional_id = $1 
      ORDER BY created_at DESC 
      LIMIT 1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      // Return default configuration
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
        break_start: '12:00',
        break_end: '13:00',
        slot_duration: 30
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error fetching schedule config:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      location_id, monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end, break_start, break_end, slot_duration
    } = req.body;

    // Delete existing config
    await pool.query('DELETE FROM schedule_configs WHERE professional_id = $1', [req.user.id]);

    // Insert new config
    const result = await pool.query(`
      INSERT INTO schedule_configs (
        professional_id, location_id, monday_start, monday_end, tuesday_start, tuesday_end,
        wednesday_start, wednesday_end, thursday_start, thursday_end,
        friday_start, friday_end, saturday_start, saturday_end,
        sunday_start, sunday_end, break_start, break_end, slot_duration
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [
      req.user.id, location_id, monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end, break_start, break_end, slot_duration
    ]);

    console.log('✅ Schedule config updated for:', req.user.name);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error updating schedule config:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { include_archived = 'false' } = req.query;
    
    let query = `
      SELECT * FROM professional_patients 
      WHERE professional_id = $1
    `;
    
    if (include_archived !== 'true') {
      query += ' AND is_archived = false';
    }
    
    query += ' ORDER BY name';

    const result = await pool.query(query, [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching patients:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, notes
    } = req.body;

    const cleanCpf = cpf.replace(/\D/g, '');
    const cleanPhone = phone ? phone.replace(/\D/g, '') : null;

    const result = await pool.query(`
      INSERT INTO professional_patients (
        professional_id, name, cpf, email, phone, birth_date,
        address, address_number, address_complement, neighborhood,
        city, state, notes, patient_type, is_convenio_patient
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'particular', false)
      RETURNING *
    `, [
      req.user.id, name, cleanCpf, email, cleanPhone, birth_date,
      address, address_number, address_complement, neighborhood,
      city, state, notes
    ]);

    console.log('✅ Patient added to agenda:', result.rows[0].name);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error adding patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/agenda/patients/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    await pool.query(`
      UPDATE professional_patients SET notes = $1
      WHERE id = $2 AND professional_id = $3
    `, [notes, id, req.user.id]);

    console.log('✅ Patient notes updated:', id);
    res.json({ message: 'Observações atualizadas com sucesso' });
  } catch (error) {
    console.error('❌ Error updating patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/agenda/patients/:id/archive', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { archived } = req.body;

    await pool.query(`
      UPDATE professional_patients SET is_archived = $1
      WHERE id = $2 AND professional_id = $3
    `, [archived, id, req.user.id]);

    console.log('✅ Patient archive status updated:', id);
    res.json({ message: archived ? 'Paciente arquivado' : 'Paciente desarquivado' });
  } catch (error) {
    console.error('❌ Error archiving patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date, view_type = 'week' } = req.query;

    let query = `
      SELECT 
        a.id, a.date, a.status, a.notes, a.is_recurring,
        p.id as patient_id, p.name as patient_name, p.phone as patient_phone,
        p.is_convenio_patient, pl.clinic_name, pl.address
      FROM appointments a
      JOIN professional_patients p ON a.patient_id = p.id
      LEFT JOIN professional_locations pl ON a.location_id = pl.id
      WHERE a.professional_id = $1
    `;

    const params = [req.user.id];

    if (start_date && end_date) {
      query += ' AND a.date BETWEEN $2 AND $3';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY a.date';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patient_id, location_id, date, notes, is_recurring, recurring_pattern } = req.body;

    const result = await pool.query(`
      INSERT INTO appointments (
        professional_id, patient_id, location_id, date, notes, is_recurring, recurring_pattern
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [req.user.id, patient_id, location_id, date, notes, is_recurring, recurring_pattern]);

    // If recurring, create additional appointments
    if (is_recurring && recurring_pattern) {
      // Implementation for recurring appointments would go here
      console.log('📅 Recurring appointment created, pattern:', recurring_pattern);
    }

    console.log('✅ Appointment created:', result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error creating appointment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.put('/api/agenda/appointments/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    await pool.query(`
      UPDATE appointments SET status = $1, notes = $2
      WHERE id = $3 AND professional_id = $4
    `, [status, notes, id, req.user.id]);

    console.log('✅ Appointment updated:', id);
    res.json({ message: 'Agendamento atualizado com sucesso' });
  } catch (error) {
    console.error('❌ Error updating appointment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 📊 ENHANCED REPORTS ROUTES
app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    // Professional revenue report
    const professionalResult = await pool.query(`
      SELECT 
        prof.name as professional_name,
        prof.percentage as professional_percentage,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue,
        SUM(c.value * prof.percentage / 100) as professional_payment,
        SUM(c.value * (100 - prof.percentage) / 100) as clinic_revenue
      FROM consultations c
      JOIN users prof ON c.professional_id = prof.id
      WHERE c.date BETWEEN $1 AND $2
        AND c.consultation_type = 'convenio'
      GROUP BY prof.id, prof.name, prof.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    // Service revenue report
    const serviceResult = await pool.query(`
      SELECT 
        s.name as service_name,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      WHERE c.date BETWEEN $1 AND $2
        AND c.consultation_type = 'convenio'
      GROUP BY s.id, s.name
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    // Total revenue
    const totalResult = await pool.query(`
      SELECT SUM(value) as total_revenue
      FROM consultations
      WHERE date BETWEEN $1 AND $2
        AND consultation_type = 'convenio'
    `, [start_date, end_date]);

    res.json({
      total_revenue: parseFloat(totalResult.rows[0].total_revenue || 0),
      revenue_by_professional: professionalResult.rows.map(row => ({
        ...row,
        revenue: parseFloat(row.revenue),
        professional_payment: parseFloat(row.professional_payment),
        clinic_revenue: parseFloat(row.clinic_revenue)
      })),
      revenue_by_service: serviceResult.rows.map(row => ({
        ...row,
        revenue: parseFloat(row.revenue)
      }))
    });
  } catch (error) {
    console.error('❌ Error generating revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/reports/professional-revenue', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    // Get professional percentage
    const profResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [req.user.id]
    );

    const percentage = profResult.rows[0]?.percentage || 50;

    // Get consultations summary
    const summaryResult = await pool.query(`
      SELECT 
        COUNT(*) as consultation_count,
        SUM(value) as total_revenue,
        SUM(value * (100 - $1) / 100) as amount_to_pay
      FROM consultations
      WHERE professional_id = $2 
        AND date BETWEEN $3 AND $4
        AND consultation_type = 'convenio'
    `, [percentage, req.user.id, start_date, end_date]);

    // Get detailed consultations
    const consultationsResult = await pool.query(`
      SELECT 
        c.date,
        COALESCE(d.name, u.name) as client_name,
        s.name as service_name,
        c.value as total_value,
        (c.value * (100 - $1) / 100) as amount_to_pay
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN services s ON c.service_id = s.id
      WHERE c.professional_id = $2 
        AND c.date BETWEEN $3 AND $4
        AND c.consultation_type = 'convenio'
      ORDER BY c.date DESC
    `, [percentage, req.user.id, start_date, end_date]);

    res.json({
      summary: {
        professional_percentage: percentage,
        consultation_count: parseInt(summaryResult.rows[0].consultation_count),
        total_revenue: parseFloat(summaryResult.rows[0].total_revenue || 0),
        amount_to_pay: parseFloat(summaryResult.rows[0].amount_to_pay || 0)
      },
      consultations: consultationsResult.rows.map(row => ({
        ...row,
        total_value: parseFloat(row.total_value),
        amount_to_pay: parseFloat(row.amount_to_pay)
      }))
    });
  } catch (error) {
    console.error('❌ Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// NEW: Enhanced consultation history for professionals
app.get('/api/reports/consultation-history', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date, consultation_type, page = 1, limit = 50 } = req.query;
    
    let query = `
      SELECT 
        c.id, c.date, c.value, c.consultation_type,
        COALESCE(d.name, u.name) as patient_name,
        s.name as service_name,
        CASE 
          WHEN c.consultation_type = 'convenio' THEN (c.value * (100 - prof.percentage) / 100)
          ELSE 0
        END as amount_to_pay_convenio,
        pl.clinic_name,
        CASE WHEN mr.id IS NOT NULL THEN true ELSE false END as has_medical_record
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN services s ON c.service_id = s.id
      JOIN users prof ON c.professional_id = prof.id
      LEFT JOIN professional_locations pl ON c.location_id = pl.id
      LEFT JOIN medical_records mr ON c.id = mr.consultation_id
      WHERE c.professional_id = $1
    `;

    const params = [req.user.id];
    let paramCount = 1;

    if (start_date && end_date) {
      paramCount++;
      query += ` AND c.date BETWEEN $${paramCount} AND $${paramCount + 1}`;
      params.push(start_date);
      paramCount++;
      params.push(end_date);
    }

    if (consultation_type && consultation_type !== 'all') {
      paramCount++;
      query += ` AND c.consultation_type = $${paramCount}`;
      params.push(consultation_type);
    }

    query += ' ORDER BY c.date DESC';

    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(limit);
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(offset);

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM consultations c
      WHERE c.professional_id = $1
    `;
    const countParams = [req.user.id];
    let countParamCount = 1;

    if (start_date && end_date) {
      countParamCount++;
      countQuery += ` AND c.date BETWEEN $${countParamCount} AND $${countParamCount + 1}`;
      countParams.push(start_date);
      countParamCount++;
      countParams.push(end_date);
    }

    if (consultation_type && consultation_type !== 'all') {
      countParamCount++;
      countQuery += ` AND c.consultation_type = $${countParamCount}`;
      countParams.push(consultation_type);
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      consultations: result.rows.map(row => ({
        ...row,
        value: parseFloat(row.value),
        amount_to_pay_convenio: parseFloat(row.amount_to_pay_convenio || 0)
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        totalPages: Math.ceil(parseInt(countResult.rows[0].total) / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Error fetching consultation history:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// NEW: Client subscription reports for admin
app.get('/api/reports/client-subscriptions', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    const result = await pool.query(`
      SELECT 
        COUNT(*) as new_clients,
        SUM(cs.amount) as subscription_revenue
      FROM client_subscriptions cs
      JOIN users u ON cs.client_id = u.id
      WHERE cs.created_at BETWEEN $1 AND $2
        AND cs.status = 'paid'
    `, [start_date, end_date]);

    res.json({
      new_clients: parseInt(result.rows[0].new_clients || 0),
      subscription_revenue: parseFloat(result.rows[0].subscription_revenue || 0)
    });
  } catch (error) {
    console.error('❌ Error generating client subscription report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// NEW: Total revenue report combining all sources
app.get('/api/reports/total-revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    // Client subscriptions revenue
    const subscriptionsResult = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as subscription_revenue
      FROM client_subscriptions
      WHERE created_at BETWEEN $1 AND $2
        AND status = 'paid'
    `, [start_date, end_date]);

    // Professional percentage revenue (clinic's share)
    const professionalResult = await pool.query(`
      SELECT COALESCE(SUM(c.value * (100 - u.percentage) / 100), 0) as professional_percentage_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date BETWEEN $1 AND $2
        AND c.consultation_type = 'convenio'
    `, [start_date, end_date]);

    const subscriptionRevenue = parseFloat(subscriptionsResult.rows[0].subscription_revenue);
    const professionalPercentageRevenue = parseFloat(professionalResult.rows[0].professional_percentage_revenue);
    const totalRevenue = subscriptionRevenue + professionalPercentageRevenue;

    res.json({
      subscription_revenue: subscriptionRevenue,
      professional_percentage_revenue: professionalPercentageRevenue,
      total_revenue: totalRevenue
    });
  } catch (error) {
    console.error('❌ Error generating total revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 📸 IMAGE UPLOAD ROUTE
app.post('/api/upload-image', authenticate, async (req, res) => {
  try {
    const upload = createUpload();
    
    upload.single('image')(req, res, async (err) => {
      if (err) {
        console.error('❌ Upload error:', err);
        return res.status(400).json({ message: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'Nenhuma imagem foi enviada' });
      }

      console.log('📸 Image uploaded:', req.file.path);

      // Update user's photo URL
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
    console.error('❌ Error uploading image:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// 🚀 START SERVER
const startServer = async () => {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
      console.log(`💳 MercadoPago SDK v2: ${mercadopago ? '✅ Ready' : '❌ Not configured'}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();