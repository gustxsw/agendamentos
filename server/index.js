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
let mercadoPagoClient = null;

try {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  
  if (!accessToken) {
    console.warn('⚠️ MP_ACCESS_TOKEN not found in environment variables');
  } else {
    console.log('🔄 Initializing MercadoPago SDK v2...');
    
    mercadoPagoClient = new MercadoPagoConfig({
      accessToken: accessToken,
      options: {
        timeout: 5000,
        idempotencyKey: 'abc'
      }
    });
    
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

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    mercadoPago: mercadoPagoClient ? 'Connected' : 'Not configured'
  });
});

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, password
    } = req.body;

    if (!name || !cpf || !password) {
      return res.status(400).json({ message: 'Nome, CPF e senha são obrigatórios' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cpf]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password, roles,
        subscription_status, subscription_expiry
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id, name, cpf, roles`,
      [
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, hashedPassword,
        JSON.stringify(['client']), 'pending', null
      ]
    );

    const user = result.rows[0];
    res.status(201).json({ user });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { cpf, password } = req.body;

    if (!cpf || !password) {
      return res.status(400).json({ message: 'CPF e senha são obrigatórios' });
    }

    const result = await pool.query(
      'SELECT id, name, cpf, password, roles FROM users WHERE cpf = $1',
      [cpf]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password);

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
      'SELECT roles FROM users WHERE id = $1',
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
      { id: userId, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    const userData = {
      id: req.user.id,
      name: req.user.name,
      cpf: req.user.cpf,
      roles: user.roles,
      currentRole: role
    };

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({ user: userData, token });
  } catch (error) {
    console.error('Role switch error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout realizado com sucesso' });
});

// 🔥 CLIENT SUBSCRIPTION PAYMENT WITH SDK V2
app.post('/api/create-subscription', authenticate, authorize(['client']), async (req, res) => {
  try {
    if (!mercadoPagoClient) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }

    const { user_id, dependent_ids = [] } = req.body;
    
    console.log('🔄 Creating client subscription payment with SDK v2...');
    
    // Get user info
    const userResult = await pool.query(
      'SELECT name, email FROM users WHERE id = $1',
      [user_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    const user = userResult.rows[0];
    
    // Get dependents count
    const dependentsResult = await pool.query(
      'SELECT COUNT(*) as count FROM dependents WHERE client_id = $1',
      [user_id]
    );
    
    const dependentCount = parseInt(dependentsResult.rows[0].count) || 0;
    
    // Calculate total amount
    const basePrice = 250; // R$ 250 for titular
    const dependentPrice = 50; // R$ 50 per dependent
    const totalAmount = basePrice + (dependentCount * dependentPrice);
    
    console.log('💰 Subscription calculation:', {
      basePrice,
      dependentCount,
      dependentPrice,
      totalAmount
    });

    const preference = new Preference(mercadoPagoClient);
    
    const preferenceData = {
      items: [
        {
          id: `subscription-${user_id}`,
          title: `Assinatura Cartão Quiro Ferreira - ${user.name}`,
          description: `Assinatura mensal (Titular + ${dependentCount} dependente(s))`,
          quantity: 1,
          unit_price: totalAmount,
          currency_id: 'BRL'
        }
      ],
      payer: {
        name: user.name,
        email: user.email || `user${user_id}@quiroferreira.com.br`
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=pending`
      },
      auto_return: 'approved',
      external_reference: `client-subscription-${user_id}`,
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      statement_descriptor: 'QUIRO FERREIRA'
    };

    console.log('🔄 Creating preference with SDK v2:', preferenceData);

    const result = await preference.create({ body: preferenceData });
    
    console.log('✅ Client subscription preference created with SDK v2:', {
      id: result.id,
      init_point: result.init_point
    });

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

// 🔥 PROFESSIONAL PAYMENT WITH SDK V2
app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    if (!mercadoPagoClient) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }

    const { amount } = req.body;
    const professionalId = req.user.id;
    
    console.log('🔄 Creating professional payment with SDK v2...', { amount, professionalId });
    
    // Validate amount
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Valor inválido para pagamento' });
    }
    
    // Get professional info
    const userResult = await pool.query(
      'SELECT name, email FROM users WHERE id = $1',
      [professionalId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    const professional = userResult.rows[0];

    const preference = new Preference(mercadoPagoClient);
    
    const preferenceData = {
      items: [
        {
          id: `professional-payment-${professionalId}`,
          title: `Pagamento ao Convênio - ${professional.name}`,
          description: `Repasse de consultas realizadas`,
          quantity: 1,
          unit_price: numericAmount,
          currency_id: 'BRL'
        }
      ],
      payer: {
        name: professional.name,
        email: professional.email || `professional${professionalId}@quiroferreira.com.br`
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=pending`
      },
      auto_return: 'approved',
      external_reference: `professional-payment-${professionalId}-${Date.now()}`,
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      statement_descriptor: 'QUIRO FERREIRA'
    };

    console.log('🔄 Creating professional preference with SDK v2:', preferenceData);

    const result = await preference.create({ body: preferenceData });
    
    console.log('✅ Professional payment preference created with SDK v2:', {
      id: result.id,
      init_point: result.init_point
    });

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

// 🔥 AGENDA SUBSCRIPTION PAYMENT WITH SDK V2
app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    if (!mercadoPagoClient) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }

    const professionalId = req.user.id;
    
    console.log('🔄 Creating agenda subscription payment with SDK v2...', { professionalId });
    
    // Get professional info
    const userResult = await pool.query(
      'SELECT name, email FROM users WHERE id = $1',
      [professionalId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    const professional = userResult.rows[0];
    const subscriptionPrice = 49.90; // R$ 49,90 monthly

    const preference = new Preference(mercadoPagoClient);
    
    const preferenceData = {
      items: [
        {
          id: `agenda-subscription-${professionalId}`,
          title: `Assinatura Agenda Profissional - ${professional.name}`,
          description: `Acesso completo à agenda profissional por 30 dias`,
          quantity: 1,
          unit_price: subscriptionPrice,
          currency_id: 'BRL'
        }
      ],
      payer: {
        name: professional.name,
        email: professional.email || `professional${professionalId}@quiroferreira.com.br`
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=pending`
      },
      auto_return: 'approved',
      external_reference: `agenda-subscription-${professionalId}-${Date.now()}`,
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      statement_descriptor: 'QUIRO FERREIRA'
    };

    console.log('🔄 Creating agenda subscription preference with SDK v2:', preferenceData);

    const result = await preference.create({ body: preferenceData });
    
    console.log('✅ Agenda subscription preference created with SDK v2:', {
      id: result.id,
      init_point: result.init_point
    });

    res.json({
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });

  } catch (error) {
    console.error('❌ Error creating agenda subscription payment:', error);
    res.status(500).json({ 
      message: 'Erro ao criar pagamento de assinatura da agenda',
      error: error.message 
    });
  }
});

// 🔥 MERCADO PAGO WEBHOOK WITH SDK V2
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    console.log('🔔 MercadoPago webhook received:', req.body);
    
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      console.log('💳 Processing payment webhook:', paymentId);
      
      // Here you would typically:
      // 1. Fetch payment details from MercadoPago API using SDK v2
      // 2. Update your database based on payment status
      // 3. Send confirmation emails, etc.
      
      // For now, just log the webhook
      console.log('✅ Payment webhook processed successfully');
    }
    
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Error processing MercadoPago webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Users routes
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
        u.created_at, u.photo_url, u.professional_registration,
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

    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cpf]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password, roles,
        percentage, category_id, subscription_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, name, cpf, roles`,
      [
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, hashedPassword,
        JSON.stringify(roles), percentage, category_id,
        roles.includes('client') ? 'pending' : null
      ]
    );

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
    if (req.user.id !== parseInt(id) && !req.user.roles.includes('admin')) {
      return res.status(403).json({ message: 'Não autorizado' });
    }

    const result = await pool.query(
      `UPDATE users SET 
        name = $1, email = $2, phone = $3, birth_date = $4,
        address = $5, address_number = $6, address_complement = $7,
        neighborhood = $8, city = $9, state = $10, roles = $11,
        percentage = $12, category_id = $13, updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING id, name, cpf, roles`,
      [
        name, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state,
        JSON.stringify(roles), percentage, category_id, id
      ]
    );

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

    const result = await pool.query(
      `UPDATE users SET 
        subscription_status = 'active',
        subscription_expiry = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, name, subscription_status, subscription_expiry`,
      [expiry_date, id]
    );

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

// Service categories routes
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
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/services', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description, base_price, category_id, is_base_service } = req.body;

    if (!name || !description || !base_price) {
      return res.status(400).json({ message: 'Nome, descrição e preço são obrigatórios' });
    }

    const result = await pool.query(
      `INSERT INTO services (name, description, base_price, category_id, is_base_service) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description, base_price, category_id, is_base_service || false]
    );

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

    const result = await pool.query(
      `UPDATE services SET 
        name = $1, description = $2, base_price = $3, 
        category_id = $4, is_base_service = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 RETURNING *`,
      [name, description, base_price, category_id, is_base_service, id]
    );

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

// Consultations routes
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query = `
      SELECT 
        c.id, c.date, c.value, c.created_at,
        COALESCE(d.name, u.name) as client_name,
        s.name as service_name,
        p.name as professional_name,
        CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users p ON c.professional_id = p.id
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
      return res.status(400).json({ message: 'Dados incompletos' });
    }

    const result = await pool.query(
      `INSERT INTO consultations (client_id, dependent_id, professional_id, service_id, value, date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [client_id, dependent_id, professional_id, service_id, value, date]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating consultation:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Dependents routes
app.get('/api/dependents/:client_id', authenticate, async (req, res) => {
  try {
    const { client_id } = req.params;

    // Check if user can access these dependents
    if (req.user.currentRole === 'client' && req.user.id !== parseInt(client_id)) {
      return res.status(403).json({ message: 'Não autorizado' });
    }

    const result = await pool.query(
      'SELECT * FROM dependents WHERE client_id = $1 ORDER BY name',
      [client_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dependents:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/dependents/lookup', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }

    const result = await pool.query(`
      SELECT 
        d.id, d.name, d.cpf, d.birth_date, d.client_id,
        u.name as client_name, u.subscription_status as client_subscription_status
      FROM dependents d
      JOIN users u ON d.client_id = u.id
      WHERE d.cpf = $1
    `, [cpf]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.post('/api/dependents', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;

    // Check if user can add dependents to this client
    if (req.user.id !== client_id) {
      return res.status(403).json({ message: 'Não autorizado' });
    }

    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }

    // Check if CPF already exists
    const existingDependent = await pool.query(
      'SELECT id FROM dependents WHERE cpf = $1',
      [cpf]
    );

    if (existingDependent.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado como dependente' });
    }

    // Check if CPF exists as user
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE cpf = $1',
      [cpf]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado como usuário' });
    }

    const result = await pool.query(
      `INSERT INTO dependents (client_id, name, cpf, birth_date)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [client_id, name, cpf, birth_date]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating dependent:', error);
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
      return res.status(403).json({ message: 'Não autorizado' });
    }

    const result = await pool.query(
      `UPDATE dependents SET name = $1, birth_date = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [name, birth_date, id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating dependent:', error);
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
      return res.status(403).json({ message: 'Não autorizado' });
    }

    await pool.query('DELETE FROM dependents WHERE id = $1', [id]);

    res.json({ message: 'Dependente excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Client lookup route
app.get('/api/clients/lookup', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }

    const result = await pool.query(`
      SELECT id, name, cpf, subscription_status, subscription_expiry
      FROM users 
      WHERE cpf = $1 AND roles ? 'client'
    `, [cpf]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up client:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Professionals route
app.get('/api/professionals', authenticate, authorize(['client']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.email, u.phone, u.roles,
        u.address, u.address_number, u.address_complement,
        u.neighborhood, u.city, u.state, u.photo_url,
        sc.name as category_name
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE u.roles ? 'professional'
      ORDER BY u.name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching professionals:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
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
        return res.status(400).json({ message: 'Nenhuma imagem foi enviada' });
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
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Reports routes
app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Revenue by professional
    const professionalRevenueResult = await pool.query(`
      SELECT 
        p.name as professional_name,
        p.percentage as professional_percentage,
        SUM(c.value) as revenue,
        COUNT(c.id) as consultation_count,
        SUM(c.value * p.percentage / 100) as professional_payment,
        SUM(c.value * (100 - p.percentage) / 100) as clinic_revenue
      FROM consultations c
      JOIN users p ON c.professional_id = p.id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY p.id, p.name, p.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    // Revenue by service
    const serviceRevenueResult = await pool.query(`
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

    // Total revenue
    const totalRevenueResult = await pool.query(`
      SELECT SUM(value) as total_revenue
      FROM consultations
      WHERE date >= $1 AND date <= $2
    `, [start_date, end_date]);

    res.json({
      total_revenue: parseFloat(totalRevenueResult.rows[0].total_revenue) || 0,
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
    const professional_id = req.user.id;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }

    // Get professional percentage
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [professional_id]
    );

    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }

    const professional_percentage = professionalResult.rows[0].percentage || 50;

    // Get consultations for this professional
    const consultationsResult = await pool.query(`
      SELECT 
        c.date, c.value,
        COALESCE(d.name, u.name) as client_name,
        s.name as service_name,
        (c.value * $3 / 100) as amount_to_pay
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN services s ON c.service_id = s.id
      WHERE c.professional_id = $1 AND c.date >= $2 AND c.date <= $4
      ORDER BY c.date DESC
    `, [professional_id, start_date, 100 - professional_percentage, end_date]);

    // Calculate summary
    const totalRevenue = consultationsResult.rows.reduce((sum, row) => sum + parseFloat(row.value), 0);
    const totalAmountToPay = consultationsResult.rows.reduce((sum, row) => sum + parseFloat(row.amount_to_pay), 0);

    res.json({
      summary: {
        professional_percentage,
        total_revenue: totalRevenue,
        consultation_count: consultationsResult.rows.length,
        amount_to_pay: totalAmountToPay
      },
      consultations: consultationsResult.rows.map(row => ({
        ...row,
        total_value: parseFloat(row.value),
        amount_to_pay: parseFloat(row.amount_to_pay)
      }))
    });
  } catch (error) {
    console.error('Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Agenda routes
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const professional_id = req.user.id;

    // For now, return a mock response - in production you would check actual subscription status
    res.json({
      status: 'active', // or 'expired', 'pending'
      expires_at: '2025-02-27T23:59:59Z',
      days_remaining: 30,
      can_use_agenda: true,
      last_payment: '2025-01-27T10:00:00Z'
    });
  } catch (error) {
    console.error('Error checking subscription status:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  
  if (mercadoPagoClient) {
    console.log('💳 MercadoPago SDK v2 ready for payments');
  } else {
    console.log('⚠️ MercadoPago SDK v2 not configured - payments will not work');
  }
});