import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import cookieParser from 'cookie-parser';
import { authenticate, authorize } from './middleware/auth.js';
import createUploadMiddleware from './middleware/upload.js';
import dotenv from 'dotenv';
import { createHmac } from 'crypto';
import { MercadoPagoConfig, Payment, Preference } from 'mercadopago';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Handlebars from 'handlebars';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Initialize environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configure CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3001',
  'https://cartaoquiroferreira.com.br',
  'https://www.cartaoquiroferreira.com.br',
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);

// Middleware
app.use(express.json());
app.use(cookieParser());

// Configure MercadoPago
const mercadoPagoPublicKey = process.env.MERCADOPAGO_PUBLIC_KEY;
const mercadoPagoAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const mercadoPagoWebhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;

let mercadopago;
if (mercadoPagoAccessToken) {
  try {
    mercadopago = new MercadoPagoConfig({ 
      accessToken: mercadoPagoAccessToken,
    });
    console.log('✅ MercadoPago configured successfully');
  } catch (error) {
    console.error('❌ Error configuring MercadoPago:', error);
  }
} else {
  console.warn('⚠️ MercadoPago access token not found');
}

// Configure file upload middleware
const { processUpload } = createUploadMiddleware();

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup database tables
app.get('/api/setup-database', async (req, res) => {
  try {
    // Create agenda_payments table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_payments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER NOT NULL,
        amount NUMERIC NOT NULL DEFAULT 49.90,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_date TIMESTAMPTZ,
        expiry_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    console.log('✅ Database tables created successfully');
    res.status(200).json({ message: 'Database setup completed successfully' });
  } catch (error) {
    console.error('❌ Error setting up database:', error);
    res.status(500).json({ message: 'Error setting up database', error: error.message });
  }
});

// Insert sample data for testing
const insertSampleData = async () => {
  try {
    // Check if we have any active subscriptions
    const existingData = await pool.query(
      'SELECT * FROM agenda_payments WHERE status = $1 LIMIT 1',
      ['active']
    );
    
    if (existingData.rows.length === 0) {
      console.log('🔄 No active subscriptions found, inserting sample data...');
      
      // Set expiry date to 30 days from now
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);
      
      // Insert sample data for professional IDs 1, 2, and 3
      for (const professionalId of [1, 2, 3]) {
        await pool.query(
          `INSERT INTO agenda_payments 
           (professional_id, amount, status, payment_date, expiry_date) 
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (professional_id) DO NOTHING`,
          [professionalId, 49.90, 'active', new Date(), expiryDate]
        );
      }
      
      console.log('✅ Sample data inserted successfully');
    } else {
      console.log('✅ Active subscriptions already exist, skipping sample data insertion');
    }
  } catch (error) {
    console.error('❌ Error inserting sample data:', error);
  }
};

// Auth routes
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

    // Validate required fields
    if (!name || !cpf || !password) {
      return res.status(400).json({ message: 'Nome, CPF e senha são obrigatórios' });
    }

    // Check if user already exists
    const userExists = await pool.query(
      'SELECT * FROM users WHERE cpf = $1',
      [cpf]
    );

    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: 'Usuário já cadastrado com este CPF' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user with client role
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, password, roles, 
        subscription_status
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
      RETURNING id, name, cpf, email, roles`,
      [
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
        hashedPassword,
        ['client'],
        'pending',
      ]
    );

    const user = result.rows[0];

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, currentRole: 'client' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );

    // Set token in cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    // Return user data
    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        email: user.email,
        roles: user.roles,
        currentRole: 'client',
      },
      token,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Erro ao registrar usuário' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { cpf, password } = req.body;

    // Validate input
    if (!cpf || !password) {
      return res.status(400).json({ message: 'CPF e senha são obrigatórios' });
    }

    // Find user
    const result = await pool.query(
      'SELECT id, name, cpf, email, password, roles FROM users WHERE cpf = $1',
      [cpf]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    const user = result.rows[0];

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    // Check if user has multiple roles
    const needsRoleSelection = user.roles && user.roles.length > 1;

    // Return user data without token if role selection is needed
    if (needsRoleSelection) {
      return res.status(200).json({
        user: {
          id: user.id,
          name: user.name,
          cpf: user.cpf,
          email: user.email,
          roles: user.roles,
        },
        needsRoleSelection: true,
      });
    }

    // Generate JWT token with default role
    const defaultRole = user.roles && user.roles.length > 0 ? user.roles[0] : 'client';
    const token = jwt.sign(
      { id: user.id, currentRole: defaultRole },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );

    // Set token in cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    // Return user data with token
    res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        email: user.email,
        roles: user.roles,
        currentRole: defaultRole,
      },
      token,
      needsRoleSelection: false,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Erro ao fazer login' });
  }
});

app.post('/api/auth/select-role', async (req, res) => {
  try {
    const { userId, role } = req.body;

    // Validate input
    if (!userId || !role) {
      return res.status(400).json({ message: 'ID do usuário e role são obrigatórios' });
    }

    // Find user
    const result = await pool.query(
      'SELECT id, name, cpf, email, roles FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];

    // Verify role is valid for this user
    if (!user.roles || !user.roles.includes(role)) {
      return res.status(403).json({ message: 'Role não autorizada para este usuário' });
    }

    // Generate JWT token with selected role
    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );

    // Set token in cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    // Return user data with token
    res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        email: user.email,
        roles: user.roles,
        currentRole: role,
      },
      token,
    });
  } catch (error) {
    console.error('Role selection error:', error);
    res.status(500).json({ message: 'Erro ao selecionar role' });
  }
});

app.post('/api/auth/switch-role', authenticate, async (req, res) => {
  try {
    const { role } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!role) {
      return res.status(400).json({ message: 'Role é obrigatória' });
    }

    // Find user
    const result = await pool.query(
      'SELECT id, name, cpf, email, roles FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];

    // Verify role is valid for this user
    if (!user.roles || !user.roles.includes(role)) {
      return res.status(403).json({ message: 'Role não autorizada para este usuário' });
    }

    // Generate JWT token with new role
    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );

    // Set token in cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    // Return user data with token
    res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        email: user.email,
        roles: user.roles,
        currentRole: role,
      },
      token,
    });
  } catch (error) {
    console.error('Role switch error:', error);
    res.status(500).json({ message: 'Erro ao trocar role' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.status(200).json({ message: 'Logout realizado com sucesso' });
});

// User routes
app.get('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, cpf, email, phone, birth_date, address, address_number, address_complement, neighborhood, city, state, roles, percentage, category_id, subscription_status, subscription_expiry, created_at FROM users ORDER BY name'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Erro ao buscar usuários' });
  }
});

app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is requesting their own data or is an admin
    if (req.user.id !== parseInt(id) && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const result = await pool.query(
      'SELECT id, name, cpf, email, phone, birth_date, address, address_number, address_complement, neighborhood, city, state, roles, percentage, category_id, subscription_status, subscription_expiry, created_at, photo_url, professional_registration, signature_url FROM users WHERE id = $1',
      [id]
    );
    
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
      roles,
      percentage,
      category_id,
    } = req.body;

    // Validate required fields
    if (!name || !cpf || !password || !roles || roles.length === 0) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }

    // Check if user already exists
    const userExists = await pool.query(
      'SELECT * FROM users WHERE cpf = $1',
      [cpf]
    );

    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: 'Usuário já cadastrado com este CPF' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, password, roles, 
        percentage, category_id, subscription_status
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) 
      RETURNING id, name, cpf, email, roles`,
      [
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
        hashedPassword,
        roles,
        percentage,
        category_id,
        roles.includes('client') ? 'pending' : null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ message: 'Erro ao criar usuário' });
  }
});

app.put('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      email,
      phone,
      birth_date,
      address,
      address_number,
      address_complement,
      neighborhood,
      city,
      state,
      roles,
      percentage,
      category_id,
    } = req.body;

    // Check if user is updating their own data or is an admin
    if (req.user.id !== parseInt(id) && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }

    // Update user
    const result = await pool.query(
      `UPDATE users SET 
        name = COALESCE($1, name),
        email = COALESCE($2, email),
        phone = COALESCE($3, phone),
        birth_date = COALESCE($4, birth_date),
        address = COALESCE($5, address),
        address_number = COALESCE($6, address_number),
        address_complement = COALESCE($7, address_complement),
        neighborhood = COALESCE($8, neighborhood),
        city = COALESCE($9, city),
        state = COALESCE($10, state),
        roles = COALESCE($11, roles),
        percentage = COALESCE($12, percentage),
        category_id = COALESCE($13, category_id),
        updated_at = NOW()
      WHERE id = $14
      RETURNING id, name, cpf, email, roles`,
      [
        name,
        email,
        phone,
        birth_date,
        address,
        address_number,
        address_complement,
        neighborhood,
        city,
        state,
        roles,
        percentage,
        category_id,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Erro ao atualizar usuário' });
  }
});

app.put('/api/users/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Senha atual e nova senha são obrigatórias' });
    }

    // Get user
    const userResult = await pool.query(
      'SELECT password FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, userResult.rows[0].password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Senha atual incorreta' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await pool.query(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, userId]
    );

    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Erro ao alterar senha' });
  }
});

app.delete('/api/users/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    // Delete user
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json({ message: 'Usuário excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Erro ao excluir usuário' });
  }
});

// Client activation endpoint
app.put('/api/users/:id/activate', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { expiry_date } = req.body;

    if (!expiry_date) {
      return res.status(400).json({ message: 'Data de expiração é obrigatória' });
    }

    // Update user subscription status
    const result = await pool.query(
      `UPDATE users SET 
        subscription_status = 'active',
        subscription_expiry = $1,
        updated_at = NOW()
      WHERE id = $2 AND 'client' = ANY(roles)
      RETURNING id, name, subscription_status, subscription_expiry`,
      [expiry_date, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error activating client:', error);
    res.status(500).json({ message: 'Erro ao ativar cliente' });
  }
});

// Dependents routes
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    // Check if user is requesting their own dependents or is an admin
    if (req.user.id !== parseInt(clientId) && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
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

app.post('/api/dependents', authenticate, async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;
    
    // Check if user is creating dependents for themselves or is an admin
    if (req.user.id !== parseInt(client_id) && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Validate required fields
    if (!client_id || !name || !cpf) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }
    
    // Check if dependent already exists
    const dependentExists = await pool.query(
      'SELECT * FROM dependents WHERE cpf = $1',
      [cpf]
    );
    
    if (dependentExists.rows.length > 0) {
      return res.status(400).json({ message: 'Dependente já cadastrado com este CPF' });
    }
    
    // Check if client has reached the maximum number of dependents (10)
    const dependentsCount = await pool.query(
      'SELECT COUNT(*) FROM dependents WHERE client_id = $1',
      [client_id]
    );
    
    if (parseInt(dependentsCount.rows[0].count) >= 10) {
      return res.status(400).json({ message: 'Número máximo de dependentes atingido (10)' });
    }
    
    // Create dependent
    const result = await pool.query(
      'INSERT INTO dependents (client_id, name, cpf, birth_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [client_id, name, cpf, birth_date]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating dependent:', error);
    res.status(500).json({ message: 'Erro ao criar dependente' });
  }
});

app.put('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, birth_date } = req.body;
    
    // Get dependent
    const dependentResult = await pool.query(
      'SELECT * FROM dependents WHERE id = $1',
      [id]
    );
    
    if (dependentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }
    
    const dependent = dependentResult.rows[0];
    
    // Check if user is updating their own dependent or is an admin
    if (req.user.id !== dependent.client_id && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Update dependent
    const result = await pool.query(
      'UPDATE dependents SET name = COALESCE($1, name), birth_date = COALESCE($2, birth_date), updated_at = NOW() WHERE id = $3 RETURNING *',
      [name, birth_date, id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating dependent:', error);
    res.status(500).json({ message: 'Erro ao atualizar dependente' });
  }
});

app.delete('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get dependent
    const dependentResult = await pool.query(
      'SELECT * FROM dependents WHERE id = $1',
      [id]
    );
    
    if (dependentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }
    
    const dependent = dependentResult.rows[0];
    
    // Check if user is deleting their own dependent or is an admin
    if (req.user.id !== dependent.client_id && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Delete dependent
    await pool.query(
      'DELETE FROM dependents WHERE id = $1',
      [id]
    );
    
    res.json({ message: 'Dependente excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting dependent:', error);
    res.status(500).json({ message: 'Erro ao excluir dependente' });
  }
});

// Lookup dependent by CPF
app.get('/api/dependents/lookup/:cpf', authenticate, async (req, res) => {
  try {
    const { cpf } = req.params;
    
    // Get dependent with client info
    const result = await pool.query(
      `SELECT d.*, c.name as client_name, c.subscription_status as client_subscription_status 
       FROM dependents d 
       JOIN users c ON d.client_id = c.id 
       WHERE d.cpf = $1`,
      [cpf]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up dependent:', error);
    res.status(500).json({ message: 'Erro ao buscar dependente' });
  }
});

// Lookup client by CPF
app.get('/api/clients/lookup/:cpf', authenticate, async (req, res) => {
  try {
    const { cpf } = req.params;
    
    // Get client
    const result = await pool.query(
      `SELECT id, name, cpf, subscription_status, subscription_expiry 
       FROM users 
       WHERE cpf = $1 AND 'client' = ANY(roles)`,
      [cpf]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up client:', error);
    res.status(500).json({ message: 'Erro ao buscar cliente' });
  }
});

// Service categories routes
app.get('/api/service-categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM service_categories ORDER BY name'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching service categories:', error);
    res.status(500).json({ message: 'Erro ao buscar categorias de serviço' });
  }
});

app.post('/api/service-categories', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description } = req.body;
    
    // Validate required fields
    if (!name) {
      return res.status(400).json({ message: 'Nome é obrigatório' });
    }
    
    // Create category
    const result = await pool.query(
      'INSERT INTO service_categories (name, description) VALUES ($1, $2) RETURNING *',
      [name, description]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating service category:', error);
    res.status(500).json({ message: 'Erro ao criar categoria de serviço' });
  }
});

// Services routes
app.get('/api/services', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, c.name as category_name 
       FROM services s 
       LEFT JOIN service_categories c ON s.category_id = c.id 
       ORDER BY s.name`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ message: 'Erro ao buscar serviços' });
  }
});

app.post('/api/services', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description, base_price, category_id, is_base_service } = req.body;
    
    // Validate required fields
    if (!name || !base_price) {
      return res.status(400).json({ message: 'Nome e preço base são obrigatórios' });
    }
    
    // Create service
    const result = await pool.query(
      'INSERT INTO services (name, description, base_price, category_id, is_base_service) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, description, base_price, category_id, is_base_service]
    );
    
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
    
    // Update service
    const result = await pool.query(
      `UPDATE services SET 
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        base_price = COALESCE($3, base_price),
        category_id = COALESCE($4, category_id),
        is_base_service = COALESCE($5, is_base_service),
        updated_at = NOW()
      WHERE id = $6
      RETURNING *`,
      [name, description, base_price, category_id, is_base_service, id]
    );
    
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
    
    // Delete service
    const result = await pool.query(
      'DELETE FROM services WHERE id = $1 RETURNING id',
      [id]
    );
    
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
    let query;
    let params = [];
    
    if (req.user.currentRole === 'client') {
      // Clients can only see their own consultations and their dependents'
      query = `
        SELECT c.*, s.name as service_name, p.name as professional_name, 
               CASE WHEN c.dependent_id IS NULL THEN u.name ELSE d.name END as client_name,
               CASE WHEN c.dependent_id IS NULL THEN false ELSE true END as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users p ON c.professional_id = p.id
        JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE c.client_id = $1
        ORDER BY c.date DESC
      `;
      params = [req.user.id];
    } else if (req.user.currentRole === 'professional') {
      // Professionals can only see consultations they performed
      query = `
        SELECT c.*, s.name as service_name, 
               CASE WHEN c.dependent_id IS NULL THEN u.name ELSE d.name END as client_name
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE c.professional_id = $1
        ORDER BY c.date DESC
      `;
      params = [req.user.id];
    } else {
      // Admins and clinics can see all consultations
      query = `
        SELECT c.*, s.name as service_name, p.name as professional_name, 
               CASE WHEN c.dependent_id IS NULL THEN u.name ELSE d.name END as client_name
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users p ON c.professional_id = p.id
        JOIN users u ON c.client_id = u.id
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

app.post('/api/consultations', authenticate, async (req, res) => {
  try {
    const { client_id, dependent_id, professional_id, service_id, value, date, notes, location_id } = req.body;
    
    // Validate required fields
    if ((!client_id && !dependent_id) || !professional_id || !service_id || !value || !date) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }
    
    // If dependent_id is provided, verify it belongs to client_id
    if (dependent_id) {
      const dependentResult = await pool.query(
        'SELECT * FROM dependents WHERE id = $1',
        [dependent_id]
      );
      
      if (dependentResult.rows.length === 0) {
        return res.status(404).json({ message: 'Dependente não encontrado' });
      }
      
      // If client_id is not provided, get it from the dependent
      const actualClientId = client_id || dependentResult.rows[0].client_id;
      
      // Verify client has active subscription
      const clientResult = await pool.query(
        'SELECT subscription_status FROM users WHERE id = $1 AND subscription_status = $2',
        [actualClientId, 'active']
      );
      
      if (clientResult.rows.length === 0) {
        return res.status(400).json({ message: 'Cliente não possui assinatura ativa' });
      }
    } else {
      // Verify client has active subscription
      const clientResult = await pool.query(
        'SELECT subscription_status FROM users WHERE id = $1 AND subscription_status = $2',
        [client_id, 'active']
      );
      
      if (clientResult.rows.length === 0) {
        return res.status(400).json({ message: 'Cliente não possui assinatura ativa' });
      }
    }
    
    // Create consultation
    const result = await pool.query(
      `INSERT INTO consultations (
        client_id, dependent_id, professional_id, service_id, value, date, notes, location_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [client_id, dependent_id, professional_id, service_id, value, date, notes, location_id]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating consultation:', error);
    res.status(500).json({ message: 'Erro ao criar consulta' });
  }
});

// Professionals routes
app.get('/api/professionals', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.roles, u.address, u.address_number, 
              u.address_complement, u.neighborhood, u.city, u.state, u.photo_url,
              c.name as category_name
       FROM users u
       LEFT JOIN service_categories c ON u.category_id = c.id
       WHERE 'professional' = ANY(u.roles)
       ORDER BY u.name`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching professionals:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais' });
  }
});

// Professional locations routes
app.get('/api/professional-locations', authenticate, async (req, res) => {
  try {
    // Only professionals can access their own locations
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const result = await pool.query(
      'SELECT * FROM professional_locations WHERE professional_id = $1 ORDER BY is_main DESC, clinic_name',
      [req.user.id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching professional locations:', error);
    res.status(500).json({ message: 'Erro ao buscar locais de atendimento' });
  }
});

app.post('/api/professional-locations', authenticate, async (req, res) => {
  try {
    // Only professionals can create their own locations
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const {
      clinic_name,
      address,
      address_number,
      address_complement,
      neighborhood,
      city,
      state,
      phone,
      is_main
    } = req.body;
    
    // Validate required fields
    if (!clinic_name || !address || !address_number || !neighborhood || !city || !state) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }
    
    // If this is the main location, update all other locations to not be main
    if (is_main) {
      await pool.query(
        'UPDATE professional_locations SET is_main = false WHERE professional_id = $1',
        [req.user.id]
      );
    }
    
    // Create location
    const result = await pool.query(
      `INSERT INTO professional_locations (
        professional_id, clinic_name, address, address_number, address_complement,
        neighborhood, city, state, phone, is_main
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        req.user.id,
        clinic_name,
        address,
        address_number,
        address_complement,
        neighborhood,
        city,
        state,
        phone,
        is_main
      ]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating professional location:', error);
    res.status(500).json({ message: 'Erro ao criar local de atendimento' });
  }
});

app.put('/api/professional-locations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Only professionals can update their own locations
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if location belongs to the professional
    const locationResult = await pool.query(
      'SELECT * FROM professional_locations WHERE id = $1 AND professional_id = $2',
      [id, req.user.id]
    );
    
    if (locationResult.rows.length === 0) {
      return res.status(404).json({ message: 'Local de atendimento não encontrado' });
    }
    
    const {
      clinic_name,
      address,
      address_number,
      address_complement,
      neighborhood,
      city,
      state,
      phone,
      is_main
    } = req.body;
    
    // If this is the main location, update all other locations to not be main
    if (is_main) {
      await pool.query(
        'UPDATE professional_locations SET is_main = false WHERE professional_id = $1 AND id != $2',
        [req.user.id, id]
      );
    }
    
    // Update location
    const result = await pool.query(
      `UPDATE professional_locations SET 
        clinic_name = COALESCE($1, clinic_name),
        address = COALESCE($2, address),
        address_number = COALESCE($3, address_number),
        address_complement = COALESCE($4, address_complement),
        neighborhood = COALESCE($5, neighborhood),
        city = COALESCE($6, city),
        state = COALESCE($7, state),
        phone = COALESCE($8, phone),
        is_main = COALESCE($9, is_main),
        updated_at = NOW()
      WHERE id = $10 AND professional_id = $11
      RETURNING *`,
      [
        clinic_name,
        address,
        address_number,
        address_complement,
        neighborhood,
        city,
        state,
        phone,
        is_main,
        id,
        req.user.id
      ]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating professional location:', error);
    res.status(500).json({ message: 'Erro ao atualizar local de atendimento' });
  }
});

app.delete('/api/professional-locations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Only professionals can delete their own locations
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if location belongs to the professional
    const locationResult = await pool.query(
      'SELECT * FROM professional_locations WHERE id = $1 AND professional_id = $2',
      [id, req.user.id]
    );
    
    if (locationResult.rows.length === 0) {
      return res.status(404).json({ message: 'Local de atendimento não encontrado' });
    }
    
    // Delete location
    await pool.query(
      'DELETE FROM professional_locations WHERE id = $1 AND professional_id = $2',
      [id, req.user.id]
    );
    
    res.json({ message: 'Local de atendimento excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting professional location:', error);
    res.status(500).json({ message: 'Erro ao excluir local de atendimento' });
  }
});

// Agenda routes
app.get('/api/agenda/subscription-status', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    console.log('🔍 Checking agenda subscription status for professional ID:', req.user.id);
    
    try {
      // Check if agenda_payments table exists
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'agenda_payments'
        );
      `);
      
      const tableExists = tableCheck.rows[0].exists;
      console.log('🔍 agenda_payments table exists:', tableExists);
      
      if (!tableExists) {
        // Create the table if it doesn't exist
        await pool.query(`
          CREATE TABLE IF NOT EXISTS agenda_payments (
            id SERIAL PRIMARY KEY,
            professional_id INTEGER NOT NULL,
            amount NUMERIC NOT NULL DEFAULT 49.90,
            status TEXT NOT NULL DEFAULT 'pending',
            payment_date TIMESTAMPTZ,
            expiry_date TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );
        `);
        console.log('✅ Created agenda_payments table');
      }
      
      // Check if professional has active agenda subscription
      const agendaPaymentResult = await pool.query(
        'SELECT * FROM agenda_payments WHERE professional_id = $1 ORDER BY created_at DESC LIMIT 1',
        [req.user.id]
      );
      
      console.log('🔍 Agenda payment result:', agendaPaymentResult.rows[0] || 'No records found');
      
      let status = 'pending';
      let expiresAt = null;
      let daysRemaining = 0;
      let canUseAgenda = false;
      
      if (agendaPaymentResult.rows.length > 0) {
        const payment = agendaPaymentResult.rows[0];
        status = payment.status;
        expiresAt = payment.expiry_date;
        
        // Check if status is exactly 'active'
        if (status === 'active' && expiresAt) {
          const now = new Date();
          const expiry = new Date(expiresAt);
          
          // Calculate days remaining
          const diffTime = expiry.getTime() - now.getTime();
          daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          // Check if subscription is still valid
          canUseAgenda = daysRemaining > 0;
          
          // If expired, update status
          if (!canUseAgenda) {
            status = 'expired';
            await pool.query(
              'UPDATE agenda_payments SET status = $1 WHERE id = $2',
              ['expired', payment.id]
            );
          }
        }
      }
      
      console.log('🔍 Subscription status:', {
        status,
        expiresAt,
        daysRemaining,
        canUseAgenda
      });
      
      res.json({
        status,
        expires_at: expiresAt,
        days_remaining: daysRemaining,
        can_use_agenda: canUseAgenda,
        last_payment: agendaPaymentResult.rows.length > 0 ? agendaPaymentResult.rows[0].payment_date : null
      });
    } catch (error) {
      console.error('❌ Error checking agenda_payments table:', error);
      
      // Fallback response if there's an error with the database
      res.json({
        status: 'unknown',
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: false
      });
    }
  } catch (error) {
    console.error('Error checking agenda subscription:', error);
    res.status(500).json({ message: 'Erro ao verificar assinatura da agenda' });
  }
});

app.post('/api/agenda/create-subscription-payment', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    if (!mercadopago) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }
    
    // Get professional data
    const professionalResult = await pool.query(
      'SELECT name, email FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    const professional = professionalResult.rows[0];
    
    // Create payment preference
    const preference = new Preference(mercadopago);
    const preferenceData = {
      items: [
        {
          id: 'agenda-subscription',
          title: 'Assinatura da Agenda Profissional',
          quantity: 1,
          unit_price: 49.90,
          currency_id: 'BRL',
          description: 'Assinatura mensal da Agenda Profissional Quiro Ferreira'
        }
      ],
      payer: {
        name: professional.name,
        email: professional.email || 'cliente@cartaoquiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`
      },
      auto_return: 'approved',
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/mercadopago/webhook`,
      external_reference: `agenda-${req.user.id}`,
      metadata: {
        professional_id: req.user.id,
        payment_type: 'agenda_subscription'
      }
    };
    
    const result = await preference.create({ body: preferenceData });
    
    // Create pending payment record
    await pool.query(
      'INSERT INTO agenda_payments (professional_id, amount, status) VALUES ($1, $2, $3)',
      [req.user.id, 49.90, 'pending']
    );
    
    res.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error('Error creating agenda subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento da assinatura da agenda' });
  }
});

// Agenda patients routes
app.get('/api/agenda/patients', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional' && req.user.currentRole !== 'clinic') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if professional has active agenda subscription
    if (req.user.currentRole === 'professional') {
      try {
        // Check if agenda_payments table exists
        const tableCheck = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'agenda_payments'
          );
        `);
        
        const tableExists = tableCheck.rows[0].exists;
        
        if (tableExists) {
          // Check if professional has active agenda subscription
          const agendaPaymentResult = await pool.query(
            'SELECT * FROM agenda_payments WHERE professional_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
            [req.user.id, 'active']
          );
          
          const canUseAgenda = agendaPaymentResult.rows.length > 0;
          
          if (!canUseAgenda) {
            return res.status(403).json({ message: 'Assinatura da agenda necessária' });
          }
        } else {
          // If table doesn't exist, create it and allow access
          await pool.query(`
            CREATE TABLE IF NOT EXISTS agenda_payments (
              id SERIAL PRIMARY KEY,
              professional_id INTEGER NOT NULL,
              amount NUMERIC NOT NULL DEFAULT 49.90,
              status TEXT NOT NULL DEFAULT 'pending',
              payment_date TIMESTAMPTZ,
              expiry_date TIMESTAMPTZ,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW()
            );
          `);
          
          // Insert active subscription for this professional
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 30);
          
          await pool.query(
            `INSERT INTO agenda_payments 
             (professional_id, amount, status, payment_date, expiry_date) 
             VALUES ($1, $2, $3, $4, $5)`,
            [req.user.id, 49.90, 'active', new Date(), expiryDate]
          );
        }
      } catch (error) {
        console.error('Error checking agenda subscription:', error);
        return res.status(500).json({ message: 'Erro ao verificar assinatura da agenda' });
      }
    }
    
    // Get include_archived parameter
    const includeArchived = req.query.include_archived === 'true';
    
    let query;
    let params;
    
    if (req.user.currentRole === 'professional') {
      // Professionals can only see their own patients
      query = `
        SELECT * FROM patients 
        WHERE professional_id = $1
        ${includeArchived ? '' : 'AND is_archived = false'}
        ORDER BY name
      `;
      params = [req.user.id];
    } else {
      // Clinics can see all patients
      query = `
        SELECT p.*, u.name as professional_name 
        FROM patients p
        JOIN users u ON p.professional_id = u.id
        ${includeArchived ? '' : 'WHERE p.is_archived = false'}
        ORDER BY p.name
      `;
      params = [];
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ message: 'Erro ao buscar pacientes' });
  }
});

app.get('/api/agenda/patients/lookup/:cpf', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional' && req.user.currentRole !== 'clinic') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { cpf } = req.params;
    
    // Get patient
    const result = await pool.query(
      'SELECT * FROM patients WHERE cpf = $1',
      [cpf]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up patient:', error);
    res.status(500).json({ message: 'Erro ao buscar paciente' });
  }
});

app.post('/api/agenda/patients', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional' && req.user.currentRole !== 'clinic') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if professional has active agenda subscription
    if (req.user.currentRole === 'professional') {
      try {
        // Check if agenda_payments table exists
        const tableCheck = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'agenda_payments'
          );
        `);
        
        const tableExists = tableCheck.rows[0].exists;
        
        if (tableExists) {
          // Check if professional has active agenda subscription
          const agendaPaymentResult = await pool.query(
            'SELECT * FROM agenda_payments WHERE professional_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
            [req.user.id, 'active']
          );
          
          const canUseAgenda = agendaPaymentResult.rows.length > 0;
          
          if (!canUseAgenda) {
            return res.status(403).json({ message: 'Assinatura da agenda necessária' });
          }
        } else {
          // If table doesn't exist, create it and allow access
          await pool.query(`
            CREATE TABLE IF NOT EXISTS agenda_payments (
              id SERIAL PRIMARY KEY,
              professional_id INTEGER NOT NULL,
              amount NUMERIC NOT NULL DEFAULT 49.90,
              status TEXT NOT NULL DEFAULT 'pending',
              payment_date TIMESTAMPTZ,
              expiry_date TIMESTAMPTZ,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW()
            );
          `);
          
          // Insert active subscription for this professional
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 30);
          
          await pool.query(
            `INSERT INTO agenda_payments 
             (professional_id, amount, status, payment_date, expiry_date) 
             VALUES ($1, $2, $3, $4, $5)`,
            [req.user.id, 49.90, 'active', new Date(), expiryDate]
          );
        }
      } catch (error) {
        console.error('Error checking agenda subscription:', error);
        return res.status(500).json({ message: 'Erro ao verificar assinatura da agenda' });
      }
    }
    
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
      notes
    } = req.body;
    
    // Validate required fields
    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }
    
    // Check if patient already exists
    const patientExists = await pool.query(
      'SELECT * FROM patients WHERE cpf = $1',
      [cpf]
    );
    
    if (patientExists.rows.length > 0) {
      return res.status(400).json({ message: 'Paciente já cadastrado com este CPF' });
    }
    
    // Create patient
    const result = await pool.query(
      `INSERT INTO patients (
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, notes, professional_id, is_convenio_patient
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
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
        notes,
        req.user.id,
        false // Not a convenio patient
      ]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating patient:', error);
    res.status(500).json({ message: 'Erro ao criar paciente' });
  }
});

app.put('/api/agenda/patients/:id', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional' && req.user.currentRole !== 'clinic') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { id } = req.params;
    const { notes } = req.body;
    
    // Check if patient belongs to the professional
    let query;
    let params;
    
    if (req.user.currentRole === 'professional') {
      query = 'SELECT * FROM patients WHERE id = $1 AND professional_id = $2';
      params = [id, req.user.id];
    } else {
      query = 'SELECT * FROM patients WHERE id = $1';
      params = [id];
    }
    
    const patientResult = await pool.query(query, params);
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    // Update patient
    const result = await pool.query(
      'UPDATE patients SET notes = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [notes, id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating patient:', error);
    res.status(500).json({ message: 'Erro ao atualizar paciente' });
  }
});

app.put('/api/agenda/patients/:id/archive', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional' && req.user.currentRole !== 'clinic') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { id } = req.params;
    const { is_archived } = req.body;
    
    // Check if patient belongs to the professional
    let query;
    let params;
    
    if (req.user.currentRole === 'professional') {
      query = 'SELECT * FROM patients WHERE id = $1 AND professional_id = $2';
      params = [id, req.user.id];
    } else {
      query = 'SELECT * FROM patients WHERE id = $1';
      params = [id];
    }
    
    const patientResult = await pool.query(query, params);
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    // Update patient
    const result = await pool.query(
      'UPDATE patients SET is_archived = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [is_archived, id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error archiving patient:', error);
    res.status(500).json({ message: 'Erro ao arquivar paciente' });
  }
});

// Agenda appointments routes
app.get('/api/agenda/appointments', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional' && req.user.currentRole !== 'clinic') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if professional has active agenda subscription
    if (req.user.currentRole === 'professional') {
      try {
        // Check if agenda_payments table exists
        const tableCheck = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'agenda_payments'
          );
        `);
        
        const tableExists = tableCheck.rows[0].exists;
        
        if (tableExists) {
          // Check if professional has active agenda subscription
          const agendaPaymentResult = await pool.query(
            'SELECT * FROM agenda_payments WHERE professional_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
            [req.user.id, 'active']
          );
          
          const canUseAgenda = agendaPaymentResult.rows.length > 0;
          
          if (!canUseAgenda) {
            return res.status(403).json({ message: 'Assinatura da agenda necessária' });
          }
        } else {
          // If table doesn't exist, create it and allow access
          await pool.query(`
            CREATE TABLE IF NOT EXISTS agenda_payments (
              id SERIAL PRIMARY KEY,
              professional_id INTEGER NOT NULL,
              amount NUMERIC NOT NULL DEFAULT 49.90,
              status TEXT NOT NULL DEFAULT 'pending',
              payment_date TIMESTAMPTZ,
              expiry_date TIMESTAMPTZ,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW()
            );
          `);
          
          // Insert active subscription for this professional
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 30);
          
          await pool.query(
            `INSERT INTO agenda_payments 
             (professional_id, amount, status, payment_date, expiry_date) 
             VALUES ($1, $2, $3, $4, $5)`,
            [req.user.id, 49.90, 'active', new Date(), expiryDate]
          );
        }
      } catch (error) {
        console.error('Error checking agenda subscription:', error);
        return res.status(500).json({ message: 'Erro ao verificar assinatura da agenda' });
      }
    }
    
    // Get date range from query params
    const { start_date, end_date, professional_id } = req.query;
    
    let query;
    let params = [];
    
    if (req.user.currentRole === 'professional') {
      // Professionals can only see their own appointments
      query = `
        SELECT a.*, p.name as patient_name, p.phone as patient_phone, p.is_convenio_patient
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.professional_id = $1
      `;
      params = [req.user.id];
    } else {
      // Clinics can see appointments for specific professional or all
      query = `
        SELECT a.*, p.name as patient_name, p.phone as patient_phone, p.is_convenio_patient,
               u.name as professional_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users u ON a.professional_id = u.id
      `;
      
      if (professional_id) {
        query += ' WHERE a.professional_id = $1';
        params = [professional_id];
      }
    }
    
    // Add date range filter if provided
    if (start_date && end_date) {
      const paramIndex = params.length + 1;
      query += params.length > 0 ? ' AND' : ' WHERE';
      query += ` a.date BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
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

app.post('/api/agenda/appointments', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional' && req.user.currentRole !== 'clinic') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if professional has active agenda subscription
    if (req.user.currentRole === 'professional') {
      try {
        // Check if agenda_payments table exists
        const tableCheck = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'agenda_payments'
          );
        `);
        
        const tableExists = tableCheck.rows[0].exists;
        
        if (tableExists) {
          // Check if professional has active agenda subscription
          const agendaPaymentResult = await pool.query(
            'SELECT * FROM agenda_payments WHERE professional_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
            [req.user.id, 'active']
          );
          
          const canUseAgenda = agendaPaymentResult.rows.length > 0;
          
          if (!canUseAgenda) {
            return res.status(403).json({ message: 'Assinatura da agenda necessária' });
          }
        } else {
          // If table doesn't exist, create it and allow access
          await pool.query(`
            CREATE TABLE IF NOT EXISTS agenda_payments (
              id SERIAL PRIMARY KEY,
              professional_id INTEGER NOT NULL,
              amount NUMERIC NOT NULL DEFAULT 49.90,
              status TEXT NOT NULL DEFAULT 'pending',
              payment_date TIMESTAMPTZ,
              expiry_date TIMESTAMPTZ,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW()
            );
          `);
          
          // Insert active subscription for this professional
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 30);
          
          await pool.query(
            `INSERT INTO agenda_payments 
             (professional_id, amount, status, payment_date, expiry_date) 
             VALUES ($1, $2, $3, $4, $5)`,
            [req.user.id, 49.90, 'active', new Date(), expiryDate]
          );
        }
      } catch (error) {
        console.error('Error checking agenda subscription:', error);
        return res.status(500).json({ message: 'Erro ao verificar assinatura da agenda' });
      }
    }
    
    const { patient_id, date, notes, status, professional_id, service_id, value, location_id } = req.body;
    
    // Validate required fields
    if (!patient_id || !date) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }
    
    // Check if patient exists
    const patientResult = await pool.query(
      'SELECT * FROM patients WHERE id = $1',
      [patient_id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    // Create appointment
    const result = await pool.query(
      `INSERT INTO appointments (
        patient_id, professional_id, date, notes, status, service_id, value, location_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        patient_id,
        professional_id || req.user.id,
        date,
        notes,
        status || 'scheduled',
        service_id,
        value,
        location_id
      ]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erro ao criar agendamento' });
  }
});

// Medical records routes
app.get('/api/medical-records/patient/:patientId', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional' && req.user.currentRole !== 'clinic') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { patientId } = req.params;
    
    let query;
    let params;
    
    if (req.user.currentRole === 'professional') {
      // Professionals can only see their own medical records
      query = `
        SELECT mr.*, p.name as patient_name, p.cpf as patient_cpf, s.name as service_name,
               u.name as professional_name, u.professional_registration
        FROM medical_records mr
        JOIN patients p ON mr.patient_id = p.id
        LEFT JOIN services s ON mr.service_id = s.id
        JOIN users u ON mr.professional_id = u.id
        WHERE mr.patient_id = $1 AND mr.professional_id = $2
        ORDER BY mr.created_at DESC
      `;
      params = [patientId, req.user.id];
    } else {
      // Clinics can see all medical records
      query = `
        SELECT mr.*, p.name as patient_name, p.cpf as patient_cpf, s.name as service_name,
               u.name as professional_name, u.professional_registration
        FROM medical_records mr
        JOIN patients p ON mr.patient_id = p.id
        LEFT JOIN services s ON mr.service_id = s.id
        JOIN users u ON mr.professional_id = u.id
        WHERE mr.patient_id = $1
        ORDER BY mr.created_at DESC
      `;
      params = [patientId];
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching medical records:', error);
    res.status(500).json({ message: 'Erro ao buscar prontuários' });
  }
});

app.post('/api/medical-records', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const {
      patient_id,
      consultation_id,
      service_id,
      chief_complaint,
      anamnesis,
      physical_examination,
      diagnosis,
      treatment_plan,
      clinical_evolution,
      internal_notes
    } = req.body;
    
    // Validate required fields
    if (!patient_id) {
      return res.status(400).json({ message: 'ID do paciente é obrigatório' });
    }
    
    // Check if patient exists and belongs to the professional
    const patientResult = await pool.query(
      'SELECT * FROM patients WHERE id = $1 AND professional_id = $2',
      [patient_id, req.user.id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    // Create medical record
    const result = await pool.query(
      `INSERT INTO medical_records (
        patient_id, professional_id, consultation_id, service_id, chief_complaint,
        anamnesis, physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        patient_id,
        req.user.id,
        consultation_id,
        service_id,
        chief_complaint,
        anamnesis,
        physical_examination,
        diagnosis,
        treatment_plan,
        clinical_evolution,
        internal_notes
      ]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating medical record:', error);
    res.status(500).json({ message: 'Erro ao criar prontuário' });
  }
});

app.put('/api/medical-records/:id', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { id } = req.params;
    const {
      chief_complaint,
      anamnesis,
      physical_examination,
      diagnosis,
      treatment_plan,
      clinical_evolution,
      internal_notes
    } = req.body;
    
    // Check if medical record exists and belongs to the professional
    const recordResult = await pool.query(
      'SELECT * FROM medical_records WHERE id = $1 AND professional_id = $2',
      [id, req.user.id]
    );
    
    if (recordResult.rows.length === 0) {
      return res.status(404).json({ message: 'Prontuário não encontrado' });
    }
    
    // Update medical record
    const result = await pool.query(
      `UPDATE medical_records SET 
        chief_complaint = COALESCE($1, chief_complaint),
        anamnesis = COALESCE($2, anamnesis),
        physical_examination = COALESCE($3, physical_examination),
        diagnosis = COALESCE($4, diagnosis),
        treatment_plan = COALESCE($5, treatment_plan),
        clinical_evolution = COALESCE($6, clinical_evolution),
        internal_notes = COALESCE($7, internal_notes),
        updated_at = NOW()
      WHERE id = $8 AND professional_id = $9
      RETURNING *`,
      [
        chief_complaint,
        anamnesis,
        physical_examination,
        diagnosis,
        treatment_plan,
        clinical_evolution,
        internal_notes,
        id,
        req.user.id
      ]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating medical record:', error);
    res.status(500).json({ message: 'Erro ao atualizar prontuário' });
  }
});

// Clinic routes
app.get('/api/clinic/professionals', authenticate, async (req, res) => {
  try {
    // Only clinics can access this endpoint
    if (req.user.currentRole !== 'clinic' && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const result = await pool.query(
      `SELECT u.id, u.name, u.cpf, u.email, u.phone, u.professional_registration, 
              u.photo_url, u.professional_type, u.percentage, u.is_active, c.name as category_name
       FROM users u
       LEFT JOIN service_categories c ON u.category_id = c.id
       WHERE 'professional' = ANY(u.roles)
       ORDER BY u.name`
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic professionals:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais da clínica' });
  }
});

app.post('/api/clinic/professionals', authenticate, async (req, res) => {
  try {
    // Only clinics can access this endpoint
    if (req.user.currentRole !== 'clinic' && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const {
      name,
      cpf,
      email,
      phone,
      password,
      professional_registration,
      category_id,
      percentage,
      professional_type
    } = req.body;
    
    // Validate required fields
    if (!name || !cpf || !password) {
      return res.status(400).json({ message: 'Nome, CPF e senha são obrigatórios' });
    }
    
    // Check if user already exists
    const userExists = await pool.query(
      'SELECT * FROM users WHERE cpf = $1',
      [cpf]
    );
    
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: 'Usuário já cadastrado com este CPF' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create professional
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, password, professional_registration, 
        category_id, percentage, professional_type, roles, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        name,
        cpf,
        email,
        phone,
        hashedPassword,
        professional_registration,
        category_id,
        percentage || 50,
        professional_type || 'convenio',
        ['professional'],
        true
      ]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating clinic professional:', error);
    res.status(500).json({ message: 'Erro ao criar profissional da clínica' });
  }
});

app.put('/api/clinic/professionals/:id', authenticate, async (req, res) => {
  try {
    // Only clinics can access this endpoint
    if (req.user.currentRole !== 'clinic' && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { id } = req.params;
    const { percentage, is_active } = req.body;
    
    // Update professional
    const result = await pool.query(
      `UPDATE users SET 
        percentage = COALESCE($1, percentage),
        is_active = COALESCE($2, is_active),
        updated_at = NOW()
      WHERE id = $3 AND 'professional' = ANY(roles)
      RETURNING *`,
      [percentage, is_active, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating clinic professional:', error);
    res.status(500).json({ message: 'Erro ao atualizar profissional da clínica' });
  }
});

app.get('/api/clinic/patients', authenticate, async (req, res) => {
  try {
    // Only clinics can access this endpoint
    if (req.user.currentRole !== 'clinic' && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const result = await pool.query(
      `SELECT p.*, u.name as professional_name
       FROM patients p
       JOIN users u ON p.professional_id = u.id
       ORDER BY p.name`
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic patients:', error);
    res.status(500).json({ message: 'Erro ao buscar pacientes da clínica' });
  }
});

app.get('/api/clinic/agenda/professionals', authenticate, async (req, res) => {
  try {
    // Only clinics can access this endpoint
    if (req.user.currentRole !== 'clinic' && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const result = await pool.query(
      `SELECT id, name, professional_type
       FROM users
       WHERE 'professional' = ANY(roles)
       AND (professional_type = 'agenda' OR professional_type = 'both')
       AND is_active = true
       ORDER BY name`
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic agenda professionals:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais da agenda da clínica' });
  }
});

app.get('/api/clinic/agenda/appointments', authenticate, async (req, res) => {
  try {
    // Only clinics can access this endpoint
    if (req.user.currentRole !== 'clinic' && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { professional_id, start_date, end_date } = req.query;
    
    // Validate required fields
    if (!professional_id) {
      return res.status(400).json({ message: 'ID do profissional é obrigatório' });
    }
    
    let query = `
      SELECT a.*, p.name as patient_name, p.phone as patient_phone, p.is_convenio_patient,
             u.name as professional_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN users u ON a.professional_id = u.id
      WHERE a.professional_id = $1
    `;
    
    const params = [professional_id];
    
    // Add date range filter if provided
    if (start_date && end_date) {
      query += ' AND a.date BETWEEN $2 AND $3';
      params.push(start_date, end_date);
    }
    
    query += ' ORDER BY a.date';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic agenda appointments:', error);
    res.status(500).json({ message: 'Erro ao buscar agendamentos da clínica' });
  }
});

app.post('/api/clinic/consultations', authenticate, async (req, res) => {
  try {
    // Only clinics can access this endpoint
    if (req.user.currentRole !== 'clinic' && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { client_id, dependent_id, professional_id, service_id, value, date, notes, location_id } = req.body;
    
    // Validate required fields
    if ((!client_id && !dependent_id) || !professional_id || !service_id || !value || !date) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }
    
    // If dependent_id is provided, verify it belongs to client_id
    if (dependent_id) {
      const dependentResult = await pool.query(
        'SELECT * FROM dependents WHERE id = $1',
        [dependent_id]
      );
      
      if (dependentResult.rows.length === 0) {
        return res.status(404).json({ message: 'Dependente não encontrado' });
      }
      
      // If client_id is not provided, get it from the dependent
      const actualClientId = client_id || dependentResult.rows[0].client_id;
      
      // Verify client has active subscription
      const clientResult = await pool.query(
        'SELECT subscription_status FROM users WHERE id = $1 AND subscription_status = $2',
        [actualClientId, 'active']
      );
      
      if (clientResult.rows.length === 0) {
        return res.status(400).json({ message: 'Cliente não possui assinatura ativa' });
      }
    } else {
      // Verify client has active subscription
      const clientResult = await pool.query(
        'SELECT subscription_status FROM users WHERE id = $1 AND subscription_status = $2',
        [client_id, 'active']
      );
      
      if (clientResult.rows.length === 0) {
        return res.status(400).json({ message: 'Cliente não possui assinatura ativa' });
      }
    }
    
    // Create consultation
    const result = await pool.query(
      `INSERT INTO consultations (
        client_id, dependent_id, professional_id, service_id, value, date, notes, location_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [client_id, dependent_id, professional_id, service_id, value, date, notes, location_id]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating clinic consultation:', error);
    res.status(500).json({ message: 'Erro ao criar consulta da clínica' });
  }
});

// Reports routes
app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }
    
    // Get revenue by professional
    const professionalRevenueResult = await pool.query(
      `SELECT 
        p.id as professional_id,
        p.name as professional_name,
        p.percentage as professional_percentage,
        SUM(c.value) as revenue,
        COUNT(c.id) as consultation_count,
        SUM(c.value * p.percentage / 100) as professional_payment,
        SUM(c.value * (100 - p.percentage) / 100) as clinic_revenue
      FROM consultations c
      JOIN users p ON c.professional_id = p.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY p.id, p.name, p.percentage
      ORDER BY revenue DESC`,
      [start_date, end_date]
    );
    
    // Get revenue by service
    const serviceRevenueResult = await pool.query(
      `SELECT 
        s.id as service_id,
        s.name as service_name,
        SUM(c.value) as revenue,
        COUNT(c.id) as consultation_count
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY s.id, s.name
      ORDER BY revenue DESC`,
      [start_date, end_date]
    );
    
    // Get total revenue
    const totalRevenueResult = await pool.query(
      'SELECT SUM(value) as total_revenue FROM consultations WHERE date BETWEEN $1 AND $2',
      [start_date, end_date]
    );
    
    const totalRevenue = totalRevenueResult.rows[0]?.total_revenue || 0;
    
    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: professionalRevenueResult.rows,
      revenue_by_service: serviceRevenueResult.rows
    });
  } catch (error) {
    console.error('Error generating revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de faturamento' });
  }
});

app.get('/api/reports/professional-revenue', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }
    
    // Get professional data
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    const percentage = professionalResult.rows[0].percentage || 50;
    
    // Get consultations
    const consultationsResult = await pool.query(
      `SELECT 
        c.id, c.date, c.value, s.name as service_name,
        CASE WHEN c.dependent_id IS NULL THEN u.name ELSE d.name END as client_name
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE c.professional_id = $1 AND c.date BETWEEN $2 AND $3
      ORDER BY c.date DESC`,
      [req.user.id, start_date, end_date]
    );
    
    // Calculate summary
    const totalRevenue = consultationsResult.rows.reduce((sum, c) => sum + parseFloat(c.value), 0);
    const consultationCount = consultationsResult.rows.length;
    const amountToPay = totalRevenue * (100 - percentage) / 100;
    
    res.json({
      summary: {
        professional_percentage: percentage,
        total_revenue: totalRevenue,
        consultation_count: consultationCount,
        amount_to_pay: amountToPay
      },
      consultations: consultationsResult.rows
    });
  } catch (error) {
    console.error('Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de faturamento do profissional' });
  }
});

app.get('/api/reports/professional-consultations', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }
    
    // Get professional data
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    const percentage = professionalResult.rows[0].percentage || 50;
    
    // Get consultations from convenio
    const convenioConsultationsResult = await pool.query(
      `SELECT 
        c.id, c.date, c.value, s.name as service_name,
        CASE WHEN c.dependent_id IS NULL THEN u.name ELSE d.name END as patient_name,
        c.value as total_value,
        c.value * (100 - $4) / 100 as amount_to_pay,
        TRUE as is_convenio_patient,
        EXISTS (
          SELECT 1 FROM medical_records mr WHERE mr.consultation_id = c.id
        ) as has_medical_record
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE c.professional_id = $1 AND c.date BETWEEN $2 AND $3
      ORDER BY c.date DESC`,
      [req.user.id, start_date, end_date, percentage]
    );
    
    // Get consultations from particular patients
    const particularConsultationsResult = await pool.query(
      `SELECT 
        a.id, a.date, a.value, s.name as service_name,
        p.name as patient_name,
        a.value as total_value,
        0 as amount_to_pay,
        FALSE as is_convenio_patient,
        EXISTS (
          SELECT 1 FROM medical_records mr WHERE mr.consultation_id = a.id
        ) as has_medical_record
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN services s ON a.service_id = s.id
      WHERE a.professional_id = $1 AND a.date BETWEEN $2 AND $3 AND a.status = 'completed'
      ORDER BY a.date DESC`,
      [req.user.id, start_date, end_date]
    );
    
    // Combine and sort consultations
    const allConsultations = [
      ...convenioConsultationsResult.rows,
      ...particularConsultationsResult.rows
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    // Calculate summary
    const convenioRevenue = convenioConsultationsResult.rows.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const particularRevenue = particularConsultationsResult.rows.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const totalRevenue = convenioRevenue + particularRevenue;
    const amountToPay = convenioConsultationsResult.rows.reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0);
    
    res.json({
      summary: {
        professional_percentage: percentage,
        total_revenue: totalRevenue,
        convenio_revenue: convenioRevenue,
        particular_revenue: particularRevenue,
        convenio_consultations: convenioConsultationsResult.rows.length,
        particular_consultations: particularConsultationsResult.rows.length,
        total_consultations: allConsultations.length,
        amount_to_pay: amountToPay
      },
      consultations: allConsultations
    });
  } catch (error) {
    console.error('Error generating professional consultations report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de consultas do profissional' });
  }
});

// Professional payment routes
app.post('/api/professional/create-payment', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    if (!mercadopago) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }
    
    const { amount } = req.body;
    
    // Validate amount
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }
    
    // Get professional data
    const professionalResult = await pool.query(
      'SELECT name, email FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    const professional = professionalResult.rows[0];
    
    // Create payment preference
    const preference = new Preference(mercadopago);
    const preferenceData = {
      items: [
        {
          id: 'professional-payment',
          title: 'Pagamento ao Convênio Quiro Ferreira',
          quantity: 1,
          unit_price: parseFloat(amount),
          currency_id: 'BRL',
          description: 'Pagamento referente às consultas realizadas'
        }
      ],
      payer: {
        name: professional.name,
        email: professional.email || 'profissional@cartaoquiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`
      },
      auto_return: 'approved',
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/mercadopago/webhook`,
      external_reference: `payment-${req.user.id}`,
      metadata: {
        professional_id: req.user.id,
        payment_type: 'professional_payment'
      }
    };
    
    const result = await preference.create({ body: preferenceData });
    
    // Create payment record
    await pool.query(
      'INSERT INTO professional_payments (professional_id, amount, status) VALUES ($1, $2, $3)',
      [req.user.id, amount, 'pending']
    );
    
    res.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error('Error creating professional payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento do profissional' });
  }
});

// Professional signature upload
app.post('/api/professional/signature', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { signature_url } = req.body;
    
    // Validate signature URL
    if (!signature_url) {
      return res.status(400).json({ message: 'URL da assinatura é obrigatória' });
    }
    
    // Update professional signature
    const result = await pool.query(
      'UPDATE users SET signature_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id, signature_url',
      [signature_url, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating professional signature:', error);
    res.status(500).json({ message: 'Erro ao atualizar assinatura do profissional' });
  }
});

// Image upload route
app.post('/api/upload-image', authenticate, processUpload('image'), async (req, res) => {
  try {
    if (!req.cloudinaryResult) {
      return res.status(400).json({ message: 'Nenhuma imagem enviada' });
    }
    
    const imageUrl = req.cloudinaryResult.secure_url;
    
    // If this is a profile photo, update the user's photo_url
    if (req.body.type === 'profile') {
      await pool.query(
        'UPDATE users SET photo_url = $1, updated_at = NOW() WHERE id = $2',
        [imageUrl, req.user.id]
      );
    }
    
    res.json({ imageUrl });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ message: 'Erro ao fazer upload da imagem' });
  }
});

// Document templates routes
app.get('/api/document-templates', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Get templates from templates directory
    const templatesDir = path.join(__dirname, 'templates');
    const templateFiles = fs.readdirSync(templatesDir).filter(file => file.endsWith('.html'));
    
    const templates = templateFiles.map(file => {
      const filePath = path.join(templatesDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const type = file.replace('.html', '');
      
      return {
        id: type,
        name: getTemplateDisplayName(type),
        type,
        content,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });
    
    res.json(templates);
  } catch (error) {
    console.error('Error fetching document templates:', error);
    res.status(500).json({ message: 'Erro ao buscar templates de documentos' });
  }
});

// Helper function to get template display name
function getTemplateDisplayName(type) {
  const displayNames = {
    atestado: 'Atestado Médico',
    receituario: 'Receituário',
    termo_consentimento: 'Termo de Consentimento',
    lgpd: 'Termo LGPD',
    solicitacao_exames: 'Solicitação de Exames',
    declaracao_comparecimento: 'Declaração de Comparecimento'
  };
  
  return displayNames[type] || type;
}

// Document generation route
app.post('/api/generate-document', authenticate, async (req, res) => {
  try {
    // Only professionals can access this endpoint
    if (req.user.currentRole !== 'professional') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { template_id, patient_id, ...formData } = req.body;
    
    // Validate required fields
    if (!template_id || !patient_id) {
      return res.status(400).json({ message: 'Template e paciente são obrigatórios' });
    }
    
    // Get patient data
    const patientResult = await pool.query(
      'SELECT * FROM patients WHERE id = $1 AND professional_id = $2',
      [patient_id, req.user.id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    const patient = patientResult.rows[0];
    
    // Get professional data
    const professionalResult = await pool.query(
      'SELECT name, professional_registration, signature_url FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    const professional = professionalResult.rows[0];
    
    // Get template
    const templatePath = path.join(__dirname, 'templates', `${template_id}.html`);
    
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ message: 'Template não encontrado' });
    }
    
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    
    // Compile template
    const template = Handlebars.compile(templateContent);
    
    // Format CPF
    const formattedCpf = patient.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    
    // Prepare data for template
    const templateData = {
      nome: patient.name,
      cpf: formattedCpf,
      email: patient.email,
      telefone: patient.phone,
      endereco: patient.address,
      numero: patient.address_number,
      complemento: patient.address_complement,
      bairro: patient.neighborhood,
      cidade: patient.city,
      estado: patient.state,
      data_atual: format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }),
      hora_atual: format(new Date(), "HH:mm", { locale: ptBR }),
      profissional_nome: professional.name,
      profissional_registro: professional.professional_registration,
      profissional_assinatura: professional.signature_url,
      ...formData
    };
    
    // Generate HTML
    const html = template(templateData);
    
    // Generate PDF
    const pdfOptions = {
      format: 'A4',
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm'
      }
    };
    
    // TODO: Implement PDF generation
    // For now, just return the HTML
    
    // Save document record
    const documentResult = await pool.query(
      `INSERT INTO generated_documents (
        patient_id, professional_id, type, url, template_name
      ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        patient_id,
        req.user.id,
        template_id,
        'https://example.com/document.pdf', // Placeholder URL
        getTemplateDisplayName(template_id)
      ]
    );
    
    res.json({
      id: documentResult.rows[0].id,
      url: 'https://example.com/document.pdf', // Placeholder URL
      html
    });
  } catch (error) {
    console.error('Error generating document:', error);
    res.status(500).json({ message: 'Erro ao gerar documento' });
  }
});

// MercadoPago webhook
app.post('/api/mercadopago/webhook', async (req, res) => {
  try {
    console.log('🔄 Received MercadoPago webhook:', req.body);
    
    // Verify webhook signature if secret is available
    if (mercadoPagoWebhookSecret) {
      const signature = req.headers['x-signature'];
      if (!signature) {
        console.warn('⚠️ Missing signature in webhook request');
        return res.status(401).json({ message: 'Unauthorized' });
      }
      
      const payload = JSON.stringify(req.body);
      const hmac = createHmac('sha256', mercadoPagoWebhookSecret);
      hmac.update(payload);
      const calculatedSignature = hmac.digest('hex');
      
      if (calculatedSignature !== signature) {
        console.warn('⚠️ Invalid signature in webhook request');
        return res.status(401).json({ message: 'Unauthorized' });
      }
    }
    
    const { action, data } = req.body;
    
    if (action === 'payment.created' || action === 'payment.updated') {
      const paymentId = data.id;
      
      if (!mercadopago) {
        console.warn('⚠️ MercadoPago not configured for webhook processing');
        return res.status(200).json({ message: 'Webhook received but MercadoPago not configured' });
      }
      
      // Get payment details
      const payment = new Payment(mercadopago);
      const paymentData = await payment.get({ id: paymentId });
      
      console.log('🔄 Payment data:', paymentData);
      
      if (paymentData.status === 'approved') {
        const { external_reference, metadata } = paymentData;
        
        if (external_reference && external_reference.startsWith('agenda-')) {
          // This is an agenda subscription payment
          const professionalId = metadata?.professional_id || external_reference.split('-')[1];
          
          if (!professionalId) {
            console.warn('⚠️ Missing professional ID in agenda payment');
            return res.status(200).json({ message: 'Webhook processed but missing professional ID' });
          }
          
          // Set expiry date to 30 days from now
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 30);
          
          // Update agenda_payments table
          await pool.query(
            `UPDATE agenda_payments 
             SET status = 'active', payment_date = NOW(), expiry_date = $1, updated_at = NOW()
             WHERE professional_id = $2 AND status = 'pending'
             ORDER BY created_at DESC
             LIMIT 1`,
            [expiryDate, professionalId]
          );
          
          console.log('✅ Updated agenda subscription for professional:', professionalId);
        } else if (external_reference && external_reference.startsWith('payment-')) {
          // This is a professional payment to the clinic
          const professionalId = metadata?.professional_id || external_reference.split('-')[1];
          
          if (!professionalId) {
            console.warn('⚠️ Missing professional ID in professional payment');
            return res.status(200).json({ message: 'Webhook processed but missing professional ID' });
          }
          
          // Update professional_payments table
          await pool.query(
            `UPDATE professional_payments 
             SET status = 'paid', payment_date = NOW(), updated_at = NOW()
             WHERE professional_id = $1 AND status = 'pending'
             ORDER BY created_at DESC
             LIMIT 1`,
            [professionalId]
          );
          
          console.log('✅ Updated professional payment for professional:', professionalId);
        } else if (external_reference && external_reference.startsWith('subscription-')) {
          // This is a client subscription payment
          const clientId = metadata?.client_id || external_reference.split('-')[1];
          
          if (!clientId) {
            console.warn('⚠️ Missing client ID in subscription payment');
            return res.status(200).json({ message: 'Webhook processed but missing client ID' });
          }
          
          // Set expiry date to 30 days from now
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 30);
          
          // Update user subscription status
          await pool.query(
            `UPDATE users 
             SET subscription_status = 'active', subscription_expiry = $1, updated_at = NOW()
             WHERE id = $2`,
            [expiryDate, clientId]
          );
          
          console.log('✅ Updated subscription for client:', clientId);
        }
      }
    }
    
    res.status(200).json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('Error processing MercadoPago webhook:', error);
    res.status(500).json({ message: 'Error processing webhook' });
  }
});

// Create subscription endpoint
app.post('/api/create-subscription', authenticate, async (req, res) => {
  try {
    // Only clients can access this endpoint
    if (req.user.currentRole !== 'client') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    if (!mercadopago) {
      return res.status(500).json({ message: 'MercadoPago não configurado' });
    }
    
    const { user_id, dependent_ids } = req.body;
    
    // Validate user ID
    if (user_id !== req.user.id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Get user data
    const userResult = await pool.query(
      'SELECT name, email FROM users WHERE id = $1',
      [user_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    const user = userResult.rows[0];
    
    // Calculate subscription amount
    const baseAmount = 250; // R$250 for the main user
    const dependentAmount = 50; // R$50 per dependent
    
    // Count dependents
    let dependentCount = 0;
    if (dependent_ids && dependent_ids.length > 0) {
      const dependentsResult = await pool.query(
        'SELECT COUNT(*) FROM dependents WHERE client_id = $1 AND id = ANY($2)',
        [user_id, dependent_ids]
      );
      dependentCount = parseInt(dependentsResult.rows[0].count);
    } else {
      const dependentsResult = await pool.query(
        'SELECT COUNT(*) FROM dependents WHERE client_id = $1',
        [user_id]
      );
      dependentCount = parseInt(dependentsResult.rows[0].count);
    }
    
    const totalAmount = baseAmount + (dependentCount * dependentAmount);
    
    // Create payment preference
    const preference = new Preference(mercadopago);
    const preferenceData = {
      items: [
        {
          id: 'subscription',
          title: 'Assinatura Convênio Quiro Ferreira',
          quantity: 1,
          unit_price: totalAmount,
          currency_id: 'BRL',
          description: `Assinatura mensal para titular + ${dependentCount} dependente(s)`
        }
      ],
      payer: {
        name: user.name,
        email: user.email || 'cliente@cartaoquiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`
      },
      auto_return: 'approved',
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/mercadopago/webhook`,
      external_reference: `subscription-${user_id}`,
      metadata: {
        client_id: user_id,
        dependent_count: dependentCount,
        payment_type: 'client_subscription'
      }
    };
    
    const result = await preference.create({ body: preferenceData });
    
    res.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ message: 'Erro ao criar assinatura' });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Create agenda_payments table if it doesn't exist
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_payments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER NOT NULL,
        amount NUMERIC NOT NULL DEFAULT 49.90,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_date TIMESTAMPTZ,
        expiry_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    console.log('✅ agenda_payments table created or already exists');
    
    // Insert sample data
    await insertSampleData();
  } catch (error) {
    console.error('❌ Error setting up database tables:', error);
  }
});