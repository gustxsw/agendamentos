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
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Serve static files from dist directory
app.use(express.static('dist'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ==================== AUTH ROUTES ====================

// Register route (only for clients)
app.post('/api/auth/register', async (req, res) => {
  try {
    const {
      name,
      cpf,
      email,
      phone,
      birth_date,
      address,
      address_number,
      address_complement,
      neighborhood,
      city,
      state,
      password,
    } = req.body;

    console.log('📝 Registration attempt for:', { name, cpf });

    // Validate required fields
    if (!name || !cpf || !password) {
      return res.status(400).json({ message: 'Nome, CPF e senha são obrigatórios' });
    }

    // Validate CPF format
    if (!/^\d{11}$/.test(cpf)) {
      return res.status(400).json({ message: 'CPF deve conter 11 dígitos numéricos' });
    }

    // Check if user already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cpf]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Usuário já cadastrado com este CPF' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user with client role
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, password_hash, roles,
        subscription_status, subscription_expiry
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) 
      RETURNING id, name, cpf, roles, subscription_status`,
      [
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, hashedPassword, 
        JSON.stringify(['client']), 'pending', null
      ]
    );

    const user = result.rows[0];
    console.log('✅ User registered successfully:', user.id);

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        roles: user.roles,
        subscription_status: user.subscription_status
      }
    });
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Login route
app.post('/api/auth/login', async (req, res) => {
  try {
    const { cpf, password } = req.body;

    console.log('🔐 Login attempt for CPF:', cpf);

    if (!cpf || !password) {
      return res.status(400).json({ message: 'CPF e senha são obrigatórios' });
    }

    // Find user by CPF
    const result = await pool.query(
      'SELECT id, name, cpf, password_hash, roles FROM users WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    const user = result.rows[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    console.log('✅ Login successful for user:', user.id);

    // Return user data without token for role selection
    res.json({
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        roles: user.roles
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Role selection route
app.post('/api/auth/select-role', async (req, res) => {
  try {
    const { userId, role } = req.body;

    console.log('🎯 Role selection:', { userId, role });

    if (!userId || !role) {
      return res.status(400).json({ message: 'ID do usuário e role são obrigatórios' });
    }

    // Get user data
    const result = await pool.query(
      'SELECT id, name, cpf, roles FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];

    // Verify user has the requested role
    if (!user.roles.includes(role)) {
      return res.status(403).json({ message: 'Usuário não possui esta role' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    console.log('✅ Role selected successfully:', { userId, role });

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

// Switch role route
app.post('/api/auth/switch-role', authenticate, async (req, res) => {
  try {
    const { role } = req.body;
    const userId = req.user.id;

    console.log('🔄 Role switch:', { userId, role });

    // Get user data
    const result = await pool.query(
      'SELECT id, name, cpf, roles FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];

    // Verify user has the requested role
    if (!user.roles.includes(role)) {
      return res.status(403).json({ message: 'Usuário não possui esta role' });
    }

    // Generate new JWT token
    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    console.log('✅ Role switched successfully:', { userId, role });

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
    console.error('❌ Role switch error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Logout route
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout realizado com sucesso' });
});

// ==================== USER ROUTES ====================

// Get all users (admin only)
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
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get user by ID
app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Users can only access their own data unless they're admin
    if (req.user.currentRole !== 'admin' && req.user.id !== parseInt(id)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const result = await pool.query(`
      SELECT 
        id, name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, roles, percentage, 
        category_id, subscription_status, subscription_expiry, created_at,
        photo_url, professional_registration
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

// Create user (admin only)
app.post('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, password, roles,
      percentage, category_id
    } = req.body;

    // Validate required fields
    if (!name || !cpf || !password || !roles || roles.length === 0) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }

    // Check if user already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE cpf = $1', [cpf]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Usuário já cadastrado com este CPF' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Set subscription status based on roles
    let subscriptionStatus = 'pending';
    let subscriptionExpiry = null;
    
    if (roles.includes('client')) {
      subscriptionStatus = 'pending';
    } else if (roles.includes('professional') || roles.includes('admin')) {
      subscriptionStatus = 'active';
      subscriptionExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
    }

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, password_hash, roles,
        percentage, category_id, subscription_status, subscription_expiry
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) 
      RETURNING id, name, cpf, roles, subscription_status`,
      [
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, hashedPassword, 
        JSON.stringify(roles), percentage, category_id, subscriptionStatus, subscriptionExpiry
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Update user (admin only or own profile)
app.put('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles,
      percentage, category_id
    } = req.body;

    // Users can only update their own data unless they're admin
    if (req.user.currentRole !== 'admin' && req.user.id !== parseInt(id)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const result = await pool.query(
      `UPDATE users SET 
        name = $1, email = $2, phone = $3, birth_date = $4, address = $5, 
        address_number = $6, address_complement = $7, neighborhood = $8, 
        city = $9, state = $10, roles = $11, percentage = $12, category_id = $13,
        updated_at = CURRENT_TIMESTAMP
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

// Activate user (admin only)
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
    res.status(500).json({ message: 'Erro interno do servidor' });
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
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, userId]
    );

    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// ==================== SERVICE CATEGORY ROUTES ====================

// Get all service categories
app.get('/api/service-categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM service_categories ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching service categories:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Create service category (admin only)
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

// ==================== SERVICE ROUTES ====================

// Get all services
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

// Create service (admin only)
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

// Update service (admin only)
app.put('/api/services/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, base_price, category_id, is_base_service } = req.body;

    const result = await pool.query(
      `UPDATE services SET 
        name = $1, description = $2, base_price = $3, category_id = $4, 
        is_base_service = $5, updated_at = CURRENT_TIMESTAMP
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
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// ==================== CONSULTATION ROUTES ====================

// Get all consultations
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query = `
      SELECT 
        c.id, c.date, c.value, c.created_at,
        s.name as service_name,
        u.name as professional_name,
        COALESCE(d.name, cl.name) as client_name,
        CASE WHEN c.dependent_id IS NOT NULL THEN true ELSE false END as is_dependent,
        CASE WHEN cl.roles::jsonb ? 'client' THEN true ELSE false END as is_convenio_patient
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      JOIN users u ON c.professional_id = u.id
      LEFT JOIN users cl ON c.client_id = cl.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
    `;

    const params = [];

    // Filter by role
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

// Create consultation (professional only)
app.post('/api/consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { client_id, dependent_id, service_id, value, date } = req.body;
    const professional_id = req.user.id;

    // Validate required fields
    if ((!client_id && !dependent_id) || !service_id || !value || !date) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }

    // If dependent_id is provided, get the client_id from the dependent
    let finalClientId = client_id;
    if (dependent_id) {
      const dependentResult = await pool.query(
        'SELECT client_id FROM dependents WHERE id = $1',
        [dependent_id]
      );
      
      if (dependentResult.rows.length === 0) {
        return res.status(404).json({ message: 'Dependente não encontrado' });
      }
      
      finalClientId = dependentResult.rows[0].client_id;
    }

    // Verify client has active subscription
    const clientResult = await pool.query(
      'SELECT subscription_status FROM users WHERE id = $1',
      [finalClientId]
    );

    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }

    if (clientResult.rows[0].subscription_status !== 'active') {
      return res.status(400).json({ message: 'Cliente não possui assinatura ativa' });
    }

    // Insert consultation
    const result = await pool.query(
      `INSERT INTO consultations (client_id, dependent_id, professional_id, service_id, value, date) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [finalClientId, dependent_id, professional_id, service_id, value, date]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating consultation:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// ==================== CLIENT LOOKUP ROUTES ====================

// Lookup client by CPF
app.get('/api/clients/lookup', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }

    const result = await pool.query(
      `SELECT id, name, cpf, subscription_status 
       FROM users 
       WHERE cpf = $1 AND roles::jsonb ? 'client'`,
      [cpf.replace(/\D/g, '')]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up client:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// ==================== DEPENDENT ROUTES ====================

// Get dependents by client ID
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;

    // Verify access
    if (req.user.currentRole === 'client' && req.user.id !== parseInt(clientId)) {
      return res.status(403).json({ message: 'Acesso negado' });
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

// Lookup dependent by CPF
app.get('/api/dependents/lookup', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }

    const result = await pool.query(
      `SELECT d.*, u.name as client_name, u.subscription_status as client_subscription_status
       FROM dependents d
       JOIN users u ON d.client_id = u.id
       WHERE d.cpf = $1`,
      [cpf.replace(/\D/g, '')]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Create dependent
app.post('/api/dependents', authenticate, async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;

    // Verify access
    if (req.user.currentRole === 'client' && req.user.id !== parseInt(client_id)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    // Validate required fields
    if (!client_id || !name || !cpf) {
      return res.status(400).json({ message: 'Cliente, nome e CPF são obrigatórios' });
    }

    // Check if CPF already exists
    const existingDependent = await pool.query(
      'SELECT id FROM dependents WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
    );

    if (existingDependent.rows.length > 0) {
      return res.status(400).json({ message: 'Já existe um dependente com este CPF' });
    }

    // Check if CPF exists as a user
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Este CPF já está cadastrado como usuário' });
    }

    // Check dependent limit (10 per client)
    const dependentCount = await pool.query(
      'SELECT COUNT(*) FROM dependents WHERE client_id = $1',
      [client_id]
    );

    if (parseInt(dependentCount.rows[0].count) >= 10) {
      return res.status(400).json({ message: 'Limite máximo de 10 dependentes atingido' });
    }

    const result = await pool.query(
      'INSERT INTO dependents (client_id, name, cpf, birth_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [client_id, name, cpf.replace(/\D/g, ''), birth_date]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Update dependent
app.put('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, birth_date } = req.body;

    // Get dependent to verify access
    const dependentResult = await pool.query(
      'SELECT client_id FROM dependents WHERE id = $1',
      [id]
    );

    if (dependentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    // Verify access
    if (req.user.currentRole === 'client' && req.user.id !== dependentResult.rows[0].client_id) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const result = await pool.query(
      'UPDATE dependents SET name = $1, birth_date = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
      [name, birth_date, id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Delete dependent
app.delete('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    // Get dependent to verify access
    const dependentResult = await pool.query(
      'SELECT client_id FROM dependents WHERE id = $1',
      [id]
    );

    if (dependentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }

    // Verify access
    if (req.user.currentRole === 'client' && req.user.id !== dependentResult.rows[0].client_id) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    await pool.query('DELETE FROM dependents WHERE id = $1', [id]);

    res.json({ message: 'Dependente excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting dependent:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// ==================== PROFESSIONAL ROUTES ====================

// Get all professionals (for client view)
app.get('/api/professionals', authenticate, authorize(['client']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.email, u.phone, u.address, u.address_number, 
        u.address_complement, u.neighborhood, u.city, u.state, u.roles,
        u.photo_url, sc.name as category_name
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE u.roles::jsonb ? 'professional'
      ORDER BY u.name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching professionals:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// ==================== AGENDA ROUTES ====================

// Get subscription status for agenda
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // For now, return active status for all professionals
    // In the future, implement actual subscription logic
    res.json({
      status: 'active',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      days_remaining: 30,
      can_use_agenda: true
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get schedule config
app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM schedule_configs WHERE professional_id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      // Return default config
      res.json({
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
    } else {
      res.json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error fetching schedule config:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
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

    // Check if config exists
    const existingConfig = await pool.query(
      'SELECT id FROM schedule_configs WHERE professional_id = $1',
      [req.user.id]
    );

    let result;
    if (existingConfig.rows.length === 0) {
      // Create new config
      result = await pool.query(
        `INSERT INTO schedule_configs (
          professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
          wednesday_start, wednesday_end, thursday_start, thursday_end,
          friday_start, friday_end, saturday_start, saturday_end,
          sunday_start, sunday_end, slot_duration, break_start, break_end
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) 
        RETURNING *`,
        [
          req.user.id, timeFields.monday_start, timeFields.monday_end,
          timeFields.tuesday_start, timeFields.tuesday_end,
          timeFields.wednesday_start, timeFields.wednesday_end,
          timeFields.thursday_start, timeFields.thursday_end,
          timeFields.friday_start, timeFields.friday_end,
          timeFields.saturday_start, timeFields.saturday_end,
          timeFields.sunday_start, timeFields.sunday_end,
          slot_duration, timeFields.break_start, timeFields.break_end
        ]
      );
    } else {
      // Update existing config
      result = await pool.query(
        `UPDATE schedule_configs SET 
          monday_start = $2, monday_end = $3, tuesday_start = $4, tuesday_end = $5,
          wednesday_start = $6, wednesday_end = $7, thursday_start = $8, thursday_end = $9,
          friday_start = $10, friday_end = $11, saturday_start = $12, saturday_end = $13,
          sunday_start = $14, sunday_end = $15, slot_duration = $16, break_start = $17, break_end = $18,
          updated_at = CURRENT_TIMESTAMP
        WHERE professional_id = $1 
        RETURNING *`,
        [
          req.user.id, timeFields.monday_start, timeFields.monday_end,
          timeFields.tuesday_start, timeFields.tuesday_end,
          timeFields.wednesday_start, timeFields.wednesday_end,
          timeFields.thursday_start, timeFields.thursday_end,
          timeFields.friday_start, timeFields.friday_end,
          timeFields.saturday_start, timeFields.saturday_end,
          timeFields.sunday_start, timeFields.sunday_end,
          slot_duration, timeFields.break_start, timeFields.break_end
        ]
      );
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving schedule config:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get professional patients
app.get('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { include_archived } = req.query;
    
    let query = `
      SELECT 
        pp.id, pp.name, pp.cpf, pp.email, pp.phone, pp.birth_date,
        pp.address, pp.address_number, pp.address_complement, 
        pp.neighborhood, pp.city, pp.state, pp.linked_at, pp.notes,
        pp.is_convenio_patient, pp.is_archived
      FROM professional_patients pp
      WHERE pp.professional_id = $1
    `;

    if (include_archived !== 'true') {
      query += ' AND pp.is_archived = false';
    }

    query += ' ORDER BY pp.name';

    const result = await pool.query(query, [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Create professional patient
app.post('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, notes
    } = req.body;

    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }

    // Check if patient already exists for this professional
    const existingPatient = await pool.query(
      'SELECT id FROM professional_patients WHERE professional_id = $1 AND cpf = $2',
      [req.user.id, cpf.replace(/\D/g, '')]
    );

    if (existingPatient.rows.length > 0) {
      return res.status(400).json({ message: 'Paciente já cadastrado' });
    }

    const result = await pool.query(
      `INSERT INTO professional_patients (
        professional_id, name, cpf, email, phone, birth_date,
        address, address_number, address_complement, neighborhood,
        city, state, notes, patient_type, is_convenio_patient
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) 
      RETURNING *`,
      [
        req.user.id, name, cpf.replace(/\D/g, ''), email, phone, birth_date,
        address, address_number, address_complement, neighborhood,
        city, state, notes, 'particular', false
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Update professional patient
app.put('/api/agenda/patients/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const result = await pool.query(
      `UPDATE professional_patients SET 
        notes = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND professional_id = $3 
      RETURNING *`,
      [notes, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Archive/unarchive professional patient
app.put('/api/agenda/patients/:id/archive', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_archived } = req.body;

    const result = await pool.query(
      `UPDATE professional_patients SET 
        is_archived = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND professional_id = $3 
      RETURNING *`,
      [is_archived, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error archiving patient:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get appointments
app.get('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    console.log('📅 Fetching appointments for professional:', req.user.id);
    console.log('📅 Date range:', { start_date, end_date });

    let query = `
      SELECT 
        a.id, a.date, a.status, a.notes, a.patient_id,
        COALESCE(pp.name, u.name, d.name) as patient_name,
        COALESCE(pp.phone, u.phone) as patient_phone,
        CASE 
          WHEN pp.id IS NOT NULL THEN pp.is_convenio_patient
          WHEN u.id IS NOT NULL THEN true
          ELSE false
        END as is_convenio_patient
      FROM appointments a
      LEFT JOIN professional_patients pp ON a.patient_id = pp.id AND a.patient_type = 'particular'
      LEFT JOIN users u ON a.patient_id = u.id AND a.patient_type = 'convenio'
      LEFT JOIN dependents d ON a.patient_id = d.id AND a.patient_type = 'dependent'
      WHERE a.professional_id = $1
    `;

    const params = [req.user.id];

    if (start_date && end_date) {
      query += ' AND a.date >= $2 AND a.date <= $3';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY a.date';

    console.log('📅 Executing query:', query);
    console.log('📅 With params:', params);

    const result = await pool.query(query, params);
    
    console.log('📅 Found appointments:', result.rows.length);
    console.log('📅 Appointments:', result.rows);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Create appointment
app.post('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patient_id, date, notes } = req.body;

    console.log('📝 Creating appointment:', { patient_id, date, notes, professional_id: req.user.id });

    if (!patient_id || !date) {
      return res.status(400).json({ message: 'Paciente e data são obrigatórios' });
    }

    // Determine patient type by checking which table the patient belongs to
    let patientType = 'particular';
    let patientExists = false;

    // Check if it's a professional patient
    const professionalPatient = await pool.query(
      'SELECT id FROM professional_patients WHERE id = $1 AND professional_id = $2',
      [patient_id, req.user.id]
    );

    if (professionalPatient.rows.length > 0) {
      patientType = 'particular';
      patientExists = true;
    } else {
      // Check if it's a convenio user
      const convenioUser = await pool.query(
        'SELECT id FROM users WHERE id = $1 AND roles::jsonb ? \'client\'',
        [patient_id]
      );

      if (convenioUser.rows.length > 0) {
        patientType = 'convenio';
        patientExists = true;
      } else {
        // Check if it's a dependent
        const dependent = await pool.query(
          'SELECT id FROM dependents WHERE id = $1',
          [patient_id]
        );

        if (dependent.rows.length > 0) {
          patientType = 'dependent';
          patientExists = true;
        }
      }
    }

    if (!patientExists) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }

    const result = await pool.query(
      `INSERT INTO appointments (professional_id, patient_id, patient_type, date, notes, status) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, patient_id, patientType, date, notes, 'scheduled']
    );

    console.log('✅ Appointment created:', result.rows[0]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Update appointment status
app.put('/api/agenda/appointments/:id/status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Status inválido' });
    }

    const result = await pool.query(
      `UPDATE appointments SET 
        status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND professional_id = $3 
      RETURNING *`,
      [status, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating appointment status:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
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
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// ==================== MEDICAL RECORDS ROUTES ====================

// Get medical records for a patient
app.get('/api/medical-records/patient/:patientId', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patientId } = req.params;

    const result = await pool.query(`
      SELECT 
        mr.*, 
        c.date as consultation_date,
        s.name as service_name,
        u.name as professional_name,
        u.professional_registration,
        COALESCE(pp.name, us.name, d.name) as patient_name,
        COALESCE(pp.cpf, us.cpf, d.cpf) as patient_cpf
      FROM medical_records mr
      LEFT JOIN consultations c ON mr.consultation_id = c.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users u ON mr.professional_id = u.id
      LEFT JOIN professional_patients pp ON mr.patient_id = pp.id AND mr.patient_type = 'particular'
      LEFT JOIN users us ON mr.patient_id = us.id AND mr.patient_type = 'convenio'
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

// Create medical record
app.post('/api/medical-records', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      patient_id, consultation_id, chief_complaint, anamnesis,
      physical_examination, diagnosis, treatment_plan,
      clinical_evolution, internal_notes
    } = req.body;

    if (!patient_id) {
      return res.status(400).json({ message: 'ID do paciente é obrigatório' });
    }

    // Determine patient type
    let patientType = 'particular';
    
    // Check if it's a professional patient
    const professionalPatient = await pool.query(
      'SELECT id FROM professional_patients WHERE id = $1 AND professional_id = $2',
      [patient_id, req.user.id]
    );

    if (professionalPatient.rows.length > 0) {
      patientType = 'particular';
    } else {
      // Check if it's a convenio user
      const convenioUser = await pool.query(
        'SELECT id FROM users WHERE id = $1 AND roles::jsonb ? \'client\'',
        [patient_id]
      );

      if (convenioUser.rows.length > 0) {
        patientType = 'convenio';
      } else {
        // Check if it's a dependent
        const dependent = await pool.query(
          'SELECT id FROM dependents WHERE id = $1',
          [patient_id]
        );

        if (dependent.rows.length > 0) {
          patientType = 'dependent';
        }
      }
    }

    const result = await pool.query(
      `INSERT INTO medical_records (
        professional_id, patient_id, patient_type, consultation_id,
        chief_complaint, anamnesis, physical_examination, diagnosis,
        treatment_plan, clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
      RETURNING *`,
      [
        req.user.id, patient_id, patientType, consultation_id,
        chief_complaint, anamnesis, physical_examination, diagnosis,
        treatment_plan, clinical_evolution, internal_notes
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating medical record:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Update medical record
app.put('/api/medical-records/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      chief_complaint, anamnesis, physical_examination, diagnosis,
      treatment_plan, clinical_evolution, internal_notes
    } = req.body;

    const result = await pool.query(
      `UPDATE medical_records SET 
        chief_complaint = $1, anamnesis = $2, physical_examination = $3,
        diagnosis = $4, treatment_plan = $5, clinical_evolution = $6,
        internal_notes = $7, updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 AND professional_id = $9 
      RETURNING *`,
      [
        chief_complaint, anamnesis, physical_examination, diagnosis,
        treatment_plan, clinical_evolution, internal_notes, id, req.user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Prontuário não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating medical record:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// ==================== PROFESSIONAL LOCATIONS ROUTES ====================

// Get professional locations
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

    // If this is set as main, unset other main locations
    if (is_main) {
      await pool.query(
        'UPDATE professional_locations SET is_main = false WHERE professional_id = $1',
        [req.user.id]
      );
    }

    const result = await pool.query(
      `INSERT INTO professional_locations (
        professional_id, clinic_name, address, address_number, address_complement,
        neighborhood, city, state, phone, is_main
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
      RETURNING *`,
      [
        req.user.id, clinic_name, address, address_number, address_complement,
        neighborhood, city, state, phone, is_main
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating professional location:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
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

    // If this is set as main, unset other main locations
    if (is_main) {
      await pool.query(
        'UPDATE professional_locations SET is_main = false WHERE professional_id = $1 AND id != $2',
        [req.user.id, id]
      );
    }

    const result = await pool.query(
      `UPDATE professional_locations SET 
        clinic_name = $1, address = $2, address_number = $3, address_complement = $4,
        neighborhood = $5, city = $6, state = $7, phone = $8, is_main = $9,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10 AND professional_id = $11 
      RETURNING *`,
      [
        clinic_name, address, address_number, address_complement,
        neighborhood, city, state, phone, is_main, id, req.user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Local não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating professional location:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
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
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// ==================== REPORTS ROUTES ====================

// Professional revenue report
app.get('/api/reports/professional-revenue', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const professionalId = req.user.id;

    console.log('📊 Generating professional revenue report for:', professionalId);
    console.log('📊 Date range:', { start_date, end_date });

    // Get professional percentage
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [professionalId]
    );

    const professionalPercentage = professionalResult.rows[0]?.percentage || 50;

    // Get consultations for the period
    let query = `
      SELECT 
        c.date, c.value,
        COALESCE(d.name, cl.name) as client_name,
        s.name as service_name
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      LEFT JOIN users cl ON c.client_id = cl.id
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

    // Calculate totals
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.value), 0);
    const amountToPay = totalRevenue * (100 - professionalPercentage) / 100;

    // Format consultations for response
    const formattedConsultations = consultations.map(c => ({
      date: c.date,
      client_name: c.client_name,
      service_name: c.service_name,
      total_value: parseFloat(c.value),
      amount_to_pay: parseFloat(c.value) * (100 - professionalPercentage) / 100
    }));

    const response = {
      summary: {
        professional_percentage: professionalPercentage,
        total_revenue: totalRevenue,
        consultation_count: consultations.length,
        amount_to_pay: amountToPay
      },
      consultations: formattedConsultations
    };

    console.log('📊 Report generated:', response.summary);

    res.json(response);
  } catch (error) {
    console.error('Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
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

    const professionalPercentage = professionalResult.rows[0]?.percentage || 50;

    // Get consultations with medical records info
    let query = `
      SELECT 
        c.id as consultation_id,
        c.date, c.value,
        COALESCE(d.name, cl.name) as patient_name,
        s.name as service_name,
        CASE WHEN cl.roles::jsonb ? 'client' THEN true ELSE false END as is_convenio_patient,
        CASE WHEN mr.id IS NOT NULL THEN true ELSE false END as has_medical_record
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      LEFT JOIN users cl ON c.client_id = cl.id
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
    const consultations = result.rows;

    // Calculate summary
    const totalConsultations = consultations.length;
    const convenioConsultations = consultations.filter(c => c.is_convenio_patient).length;
    const particularConsultations = totalConsultations - convenioConsultations;
    
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.value), 0);
    const convenioRevenue = consultations
      .filter(c => c.is_convenio_patient)
      .reduce((sum, c) => sum + parseFloat(c.value), 0);
    const particularRevenue = totalRevenue - convenioRevenue;
    
    const amountToPay = convenioRevenue * (100 - professionalPercentage) / 100;

    // Format consultations
    const formattedConsultations = consultations.map(c => ({
      id: c.consultation_id,
      consultation_id: c.consultation_id,
      date: c.date,
      patient_name: c.patient_name,
      service_name: c.service_name,
      total_value: parseFloat(c.value),
      amount_to_pay: c.is_convenio_patient ? parseFloat(c.value) * (100 - professionalPercentage) / 100 : 0,
      is_convenio_patient: c.is_convenio_patient,
      has_medical_record: c.has_medical_record
    }));

    res.json({
      summary: {
        total_consultations: totalConsultations,
        convenio_consultations: convenioConsultations,
        particular_consultations: particularConsultations,
        total_revenue: totalRevenue,
        convenio_revenue: convenioRevenue,
        particular_revenue: particularRevenue,
        amount_to_pay: amountToPay
      },
      consultations: formattedConsultations
    });
  } catch (error) {
    console.error('Error generating professional consultations report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Admin revenue report
app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        c.value,
        u.name as professional_name,
        u.percentage as professional_percentage,
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

    // Calculate revenue by professional
    const revenueByProfessional = {};
    const revenueByService = {};
    let totalRevenue = 0;

    consultations.forEach(c => {
      const value = parseFloat(c.value);
      const percentage = c.professional_percentage || 50;
      const professionalPayment = value * percentage / 100;
      const clinicRevenue = value - professionalPayment;

      totalRevenue += value;

      // By professional
      if (!revenueByProfessional[c.professional_name]) {
        revenueByProfessional[c.professional_name] = {
          professional_name: c.professional_name,
          professional_percentage: percentage,
          revenue: 0,
          consultation_count: 0,
          professional_payment: 0,
          clinic_revenue: 0
        };
      }

      revenueByProfessional[c.professional_name].revenue += value;
      revenueByProfessional[c.professional_name].consultation_count += 1;
      revenueByProfessional[c.professional_name].professional_payment += professionalPayment;
      revenueByProfessional[c.professional_name].clinic_revenue += clinicRevenue;

      // By service
      if (!revenueByService[c.service_name]) {
        revenueByService[c.service_name] = {
          service_name: c.service_name,
          revenue: 0,
          consultation_count: 0
        };
      }

      revenueByService[c.service_name].revenue += value;
      revenueByService[c.service_name].consultation_count += 1;
    });

    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: Object.values(revenueByProfessional),
      revenue_by_service: Object.values(revenueByService)
    });
  } catch (error) {
    console.error('Error generating revenue report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// New clients report
app.get('/api/reports/new-clients', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as count
      FROM users 
      WHERE roles::jsonb ? 'client'
    `;

    const params = [];

    if (start_date && end_date) {
      query += ' AND created_at >= $1 AND created_at <= $2';
      params.push(start_date, end_date);
    }

    query += ' GROUP BY DATE_TRUNC(\'month\', created_at) ORDER BY month';

    const result = await pool.query(query, params);

    // Calculate totals
    const totalNewClients = result.rows.reduce((sum, row) => sum + parseInt(row.count), 0);
    const subscriptionRevenue = totalNewClients * 250; // R$250 per subscription

    const clientsByMonth = result.rows.map(row => ({
      month: row.month.toISOString().split('T')[0].substring(0, 7), // YYYY-MM format
      count: parseInt(row.count),
      revenue: parseInt(row.count) * 250
    }));

    res.json({
      total_new_clients: totalNewClients,
      subscription_revenue: subscriptionRevenue,
      clients_by_month: clientsByMonth
    });
  } catch (error) {
    console.error('Error generating new clients report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Professional revenue summary report
app.get('/api/reports/professional-revenue-summary', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        c.value,
        u.name as professional_name,
        u.percentage as professional_percentage,
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

    // Calculate revenue by professional
    const revenueByProfessional = {};
    const revenueByService = {};
    let totalRevenue = 0;

    consultations.forEach(c => {
      const value = parseFloat(c.value);
      const percentage = c.professional_percentage || 50;
      const professionalPayment = value * percentage / 100;
      const clinicRevenue = value - professionalPayment;

      totalRevenue += value;

      // By professional
      if (!revenueByProfessional[c.professional_name]) {
        revenueByProfessional[c.professional_name] = {
          professional_name: c.professional_name,
          professional_percentage: percentage,
          revenue: 0,
          consultation_count: 0,
          professional_payment: 0,
          clinic_revenue: 0
        };
      }

      revenueByProfessional[c.professional_name].revenue += value;
      revenueByProfessional[c.professional_name].consultation_count += 1;
      revenueByProfessional[c.professional_name].professional_payment += professionalPayment;
      revenueByProfessional[c.professional_name].clinic_revenue += clinicRevenue;

      // By service
      if (!revenueByService[c.service_name]) {
        revenueByService[c.service_name] = {
          service_name: c.service_name,
          revenue: 0,
          consultation_count: 0
        };
      }

      revenueByService[c.service_name].revenue += value;
      revenueByService[c.service_name].consultation_count += 1;
    });

    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: Object.values(revenueByProfessional),
      revenue_by_service: Object.values(revenueByService)
    });
  } catch (error) {
    console.error('Error generating professional revenue summary report:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Total revenue report
app.get('/api/reports/total-revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    // Get subscription revenue (new clients)
    let clientQuery = `
      SELECT COUNT(*) as count
      FROM users 
      WHERE roles::jsonb ? 'client'
    `;

    const clientParams = [];

    if (start_date && end_date) {
      clientQuery += ' AND created_at >= $1 AND created_at <= $2';
      clientParams.push(start_date, end_date);
    }

    const clientResult = await pool.query(clientQuery, clientParams);
    const newClients = parseInt(clientResult.rows[0].count);
    const subscriptionRevenue = newClients * 250;

    // Get consultation revenue (clinic percentage)
    let consultationQuery = `
      SELECT 
        c.value,
        u.percentage as professional_percentage
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
    `;

    const consultationParams = [];

    if (start_date && end_date) {
      consultationQuery += ' WHERE c.date >= $1 AND c.date <= $2';
      consultationParams.push(start_date, end_date);
    }

    const consultationResult = await pool.query(consultationQuery, consultationParams);
    
    let consultationRevenue = 0;
    let totalConsultationValue = 0;

    consultationResult.rows.forEach(c => {
      const value = parseFloat(c.value);
      const percentage = c.professional_percentage || 50;
      const clinicRevenue = value * (100 - percentage) / 100;
      
      totalConsultationValue += value;
      consultationRevenue += clinicRevenue;
    });

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
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// ==================== PAYMENT ROUTES ====================

// Create subscription payment (client)
app.post('/api/create-subscription', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { user_id, dependent_ids } = req.body;
    
    // Calculate amount: R$250 for titular + R$50 per dependent
    const dependentCount = dependent_ids ? dependent_ids.length : 0;
    const amount = 250 + (dependentCount * 50);

    // Create MercadoPago preference
    const preference = {
      items: [
        {
          title: 'Assinatura Cartão Quiro Ferreira',
          description: `Assinatura mensal - Titular + ${dependentCount} dependente(s)`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: amount
        }
      ],
      payer: {
        email: 'cliente@example.com' // You should get this from user data
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/payment/success`,
        failure: `${req.protocol}://${req.get('host')}/payment/failure`,
        pending: `${req.protocol}://${req.get('host')}/payment/pending`
      },
      auto_return: 'approved',
      external_reference: `subscription_${user_id}_${Date.now()}`
    };

    // For now, return a mock response
    // In production, you would integrate with MercadoPago API
    res.json({
      id: `PREF_${Date.now()}`,
      init_point: `https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF_${Date.now()}`,
      sandbox_init_point: `https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF_${Date.now()}`
    });
  } catch (error) {
    console.error('Error creating subscription payment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
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
          unit_price: amount
        }
      ],
      payer: {
        email: 'profissional@example.com' // You should get this from user data
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/payment/success`,
        failure: `${req.protocol}://${req.get('host')}/payment/failure`,
        pending: `${req.protocol}://${req.get('host')}/payment/pending`
      },
      auto_return: 'approved',
      external_reference: `professional_payment_${req.user.id}_${Date.now()}`
    };

    // For now, return a mock response
    // In production, you would integrate with MercadoPago API
    res.json({
      id: `PREF_${Date.now()}`,
      init_point: `https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF_${Date.now()}`,
      sandbox_init_point: `https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF_${Date.now()}`
    });
  } catch (error) {
    console.error('Error creating professional payment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Create agenda subscription payment
app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const amount = 49.90; // Fixed amount for agenda subscription

    // Create MercadoPago preference
    const preference = {
      items: [
        {
          title: 'Assinatura Agenda Profissional',
          description: 'Acesso mensal à agenda profissional',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: amount
        }
      ],
      payer: {
        email: 'profissional@example.com' // You should get this from user data
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/payment/success`,
        failure: `${req.protocol}://${req.get('host')}/payment/failure`,
        pending: `${req.protocol}://${req.get('host')}/payment/pending`
      },
      auto_return: 'approved',
      external_reference: `agenda_subscription_${req.user.id}_${Date.now()}`
    };

    // For now, return a mock response
    // In production, you would integrate with MercadoPago API
    res.json({
      id: `PREF_${Date.now()}`,
      init_point: `https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF_${Date.now()}`,
      sandbox_init_point: `https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF_${Date.now()}`
    });
  } catch (error) {
    console.error('Error creating agenda subscription payment:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// ==================== IMAGE UPLOAD ROUTES ====================

// Upload image route
app.post('/api/upload-image', authenticate, async (req, res) => {
  try {
    // Create upload middleware
    const upload = createUpload();
    
    // Use multer middleware
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
        return res.status(400).json({ message: 'Nenhuma imagem foi enviada' });
      }

      console.log('✅ Image uploaded successfully:', req.file.path);

      // Update user photo_url in database
      try {
        await pool.query(
          'UPDATE users SET photo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [req.file.path, req.user.id]
        );

        res.json({
          message: 'Imagem enviada com sucesso',
          imageUrl: req.file.path
        });
      } catch (dbError) {
        console.error('❌ Database error:', dbError);
        res.status(500).json({ message: 'Erro ao salvar URL da imagem no banco de dados' });
      }
    });
  } catch (error) {
    console.error('❌ Upload route error:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// ==================== CATCH-ALL ROUTE ====================

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
});

// ==================== ERROR HANDLING ====================

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Global error:', err);
  res.status(500).json({ message: 'Erro interno do servidor' });
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
});