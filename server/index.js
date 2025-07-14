import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { authenticate, authorize } from './middleware/auth.js';
import createUploadMiddleware from './middleware/upload.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';
import { format } from 'date-fns';
import { MercadoPagoConfig, Preference } from 'mercadopago';

// Initialize environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'https://www.cartaoquiroferreira.com.br', 'https://cartaoquiroferreira.com.br'],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Initialize Cloudinary upload middleware
const { processUpload } = createUploadMiddleware();

// Initialize MercadoPago
const mercadopago = new MercadoPagoConfig({ 
  accessToken: process.env.MP_ACCESS_TOKEN 
});

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup database tables on startup
const setupDatabase = async () => {
  try {
    console.log('🔄 Setting up database tables...');
    
    // Create users table if not exists
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
        address_complement VARCHAR(255),
        neighborhood VARCHAR(255),
        city VARCHAR(255),
        state VARCHAR(2),
        password VARCHAR(255) NOT NULL,
        roles TEXT[] NOT NULL DEFAULT '{"client"}',
        percentage INTEGER,
        category_id INTEGER,
        professional_registration VARCHAR(255),
        photo_url TEXT,
        signature_url TEXT,
        professional_type VARCHAR(50),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create service_categories table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create services table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        base_price NUMERIC(10, 2) NOT NULL,
        category_id INTEGER REFERENCES service_categories(id),
        is_base_service BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create dependents table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dependents (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) UNIQUE NOT NULL,
        birth_date DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create consultations table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id),
        dependent_id INTEGER REFERENCES dependents(id),
        professional_id INTEGER NOT NULL REFERENCES users(id),
        service_id INTEGER NOT NULL REFERENCES services(id),
        value NUMERIC(10, 2) NOT NULL,
        date TIMESTAMP WITH TIME ZONE NOT NULL,
        notes TEXT,
        location_id INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create medical_records table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INTEGER REFERENCES consultations(id),
        patient_id INTEGER NOT NULL,
        professional_id INTEGER NOT NULL REFERENCES users(id),
        chief_complaint TEXT,
        anamnesis TEXT,
        physical_examination TEXT,
        diagnosis TEXT,
        treatment_plan TEXT,
        clinical_evolution TEXT,
        internal_notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create subscription_payments table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount NUMERIC(10, 2) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        payment_date TIMESTAMP WITH TIME ZONE,
        expiry_date TIMESTAMP WITH TIME ZONE,
        payment_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create agenda_payments table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_payments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER NOT NULL REFERENCES users(id),
        amount NUMERIC(10, 2) NOT NULL DEFAULT 49.90,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        payment_date TIMESTAMP WITH TIME ZONE,
        expiry_date TIMESTAMP WITH TIME ZONE,
        payment_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create professional_locations table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_locations (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER NOT NULL REFERENCES users(id),
        clinic_name VARCHAR(255) NOT NULL,
        address VARCHAR(255) NOT NULL,
        address_number VARCHAR(20),
        address_complement VARCHAR(255),
        neighborhood VARCHAR(255),
        city VARCHAR(255) NOT NULL,
        state VARCHAR(2) NOT NULL,
        phone VARCHAR(20),
        is_main BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create document_templates table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create generated_documents table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_documents (
        id SERIAL PRIMARY KEY,
        patient_id INTEGER NOT NULL,
        professional_id INTEGER NOT NULL REFERENCES users(id),
        template_id INTEGER REFERENCES document_templates(id),
        type VARCHAR(50) NOT NULL,
        url TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Database tables setup complete');
  } catch (error) {
    console.error('❌ Error setting up database tables:', error);
  }
};

// Run database setup on server start
setupDatabase();

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
      password
    } = req.body;
    
    // Validate required fields
    if (!name || !cpf || !password) {
      return res.status(400).json({ message: 'Nome, CPF e senha são obrigatórios' });
    }
    
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Usuário já cadastrado com este CPF' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Insert new user
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, password, roles
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        name,
        cpf.replace(/\D/g, ''),
        email,
        phone ? phone.replace(/\D/g, '') : null,
        birth_date,
        address,
        address_number,
        address_complement,
        neighborhood,
        city,
        state,
        hashedPassword,
        ['client']
      ]
    );
    
    const user = result.rows[0];
    
    // Create JWT token
    const token = jwt.sign(
      { id: user.id, currentRole: 'client' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    // Set token in cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Return user data (without password)
    delete user.password;
    
    res.status(201).json({
      message: 'Usuário registrado com sucesso',
      user: {
        ...user,
        currentRole: 'client'
      },
      token
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Erro ao registrar usuário' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { cpf, password } = req.body;
    
    // Validate required fields
    if (!cpf || !password) {
      return res.status(400).json({ message: 'CPF e senha são obrigatórios' });
    }
    
    // Find user by CPF
    const result = await pool.query(
      'SELECT * FROM users WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
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
    
    // Create JWT token (without role if selection needed)
    const token = jwt.sign(
      { id: user.id, currentRole: needsRoleSelection ? null : user.roles[0] },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    // Set token in cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Return user data (without password)
    delete user.password;
    
    res.status(200).json({
      message: 'Login realizado com sucesso',
      user: {
        ...user,
        currentRole: needsRoleSelection ? null : user.roles[0]
      },
      token,
      needsRoleSelection
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Erro ao fazer login' });
  }
});

app.post('/api/auth/select-role', async (req, res) => {
  try {
    const { userId, role } = req.body;
    
    // Validate required fields
    if (!userId || !role) {
      return res.status(400).json({ message: 'ID do usuário e role são obrigatórios' });
    }
    
    // Find user
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    const user = result.rows[0];
    
    // Check if user has the selected role
    if (!user.roles.includes(role)) {
      return res.status(403).json({ message: 'Usuário não possui esta role' });
    }
    
    // Create JWT token with selected role
    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    // Set token in cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Return user data (without password)
    delete user.password;
    
    res.status(200).json({
      message: 'Role selecionada com sucesso',
      user: {
        ...user,
        currentRole: role
      },
      token
    });
  } catch (error) {
    console.error('Role selection error:', error);
    res.status(500).json({ message: 'Erro ao selecionar role' });
  }
});

app.post('/api/auth/switch-role', authenticate, async (req, res) => {
  try {
    const { role } = req.body;
    
    // Validate required fields
    if (!role) {
      return res.status(400).json({ message: 'Role é obrigatória' });
    }
    
    // Check if user has the selected role
    if (!req.user.roles.includes(role)) {
      return res.status(403).json({ message: 'Usuário não possui esta role' });
    }
    
    // Create JWT token with new role
    const token = jwt.sign(
      { id: req.user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    // Set token in cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    res.status(200).json({
      message: 'Role alterada com sucesso',
      user: {
        ...req.user,
        currentRole: role
      },
      token
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
    const result = await pool.query(`
      SELECT u.*, 
        COALESCE(sp.status, 'pending') as subscription_status,
        sp.expiry_date as subscription_expiry,
        sc.name as category_name
      FROM users u
      LEFT JOIN (
        SELECT user_id, status, expiry_date,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
        FROM subscription_payments
      ) sp ON u.id = sp.user_id AND sp.rn = 1
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      ORDER BY u.name
    `);
    
    // Remove passwords from response
    const users = result.rows.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });
    
    res.status(200).json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Erro ao buscar usuários' });
  }
});

app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is requesting their own data or is admin
    if (req.user.id !== parseInt(id) && !req.user.roles.includes('admin')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const result = await pool.query(`
      SELECT u.*, 
        COALESCE(sp.status, 'pending') as subscription_status,
        sp.expiry_date as subscription_expiry,
        sc.name as category_name
      FROM users u
      LEFT JOIN (
        SELECT user_id, status, expiry_date,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
        FROM subscription_payments
      ) sp ON u.id = sp.user_id AND sp.rn = 1
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE u.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Remove password from response
    const { password, ...user } = result.rows[0];
    
    res.status(200).json(user);
  } catch (error) {
    console.error('Get user error:', error);
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
      category_id
    } = req.body;
    
    // Validate required fields
    if (!name || !cpf || !password || !roles || roles.length === 0) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }
    
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Usuário já cadastrado com este CPF' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Insert new user
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, password, roles,
        percentage, category_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        name,
        cpf.replace(/\D/g, ''),
        email,
        phone ? phone.replace(/\D/g, '') : null,
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
        category_id
      ]
    );
    
    // Remove password from response
    const { password: _, ...user } = result.rows[0];
    
    res.status(201).json({
      message: 'Usuário criado com sucesso',
      user
    });
  } catch (error) {
    console.error('Create user error:', error);
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
      category_id
    } = req.body;
    
    // Check if user is updating their own data or is admin
    if (req.user.id !== parseInt(id) && !req.user.roles.includes('admin')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Update user
    const result = await pool.query(
      `UPDATE users SET
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
      WHERE id = $14 RETURNING *`,
      [
        name,
        email,
        phone ? phone.replace(/\D/g, '') : null,
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
        id
      ]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Remove password from response
    const { password, ...user } = result.rows[0];
    
    res.status(200).json({
      message: 'Usuário atualizado com sucesso',
      user
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Erro ao atualizar usuário' });
  }
});

app.delete('/api/users/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Delete user
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    res.status(200).json({ message: 'Usuário excluído com sucesso' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Erro ao excluir usuário' });
  }
});

app.put('/api/users/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Validate required fields
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Senha atual e nova senha são obrigatórias' });
    }
    
    // Get user with password
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    const user = result.rows[0];
    
    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ message: 'Senha atual incorreta' });
    }
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update password
    await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2',
      [hashedPassword, req.user.id]
    );
    
    res.status(200).json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Erro ao alterar senha' });
  }
});

app.put('/api/users/:id/activate', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { expiry_date } = req.body;
    
    // Validate required fields
    if (!expiry_date) {
      return res.status(400).json({ message: 'Data de expiração é obrigatória' });
    }
    
    // Check if user exists
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Create or update subscription payment
    const paymentResult = await pool.query(
      `INSERT INTO subscription_payments (
        user_id, amount, status, payment_date, expiry_date
      ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        id,
        250, // Default amount
        'active',
        new Date(),
        new Date(expiry_date)
      ]
    );
    
    res.status(200).json({
      message: 'Cliente ativado com sucesso',
      payment: paymentResult.rows[0]
    });
  } catch (error) {
    console.error('Activate client error:', error);
    res.status(500).json({ message: 'Erro ao ativar cliente' });
  }
});

// Service categories routes
app.get('/api/service-categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM service_categories ORDER BY name'
    );
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get service categories error:', error);
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
    
    // Insert new category
    const result = await pool.query(
      'INSERT INTO service_categories (name, description) VALUES ($1, $2) RETURNING *',
      [name, description]
    );
    
    res.status(201).json({
      message: 'Categoria criada com sucesso',
      category: result.rows[0]
    });
  } catch (error) {
    console.error('Create service category error:', error);
    res.status(500).json({ message: 'Erro ao criar categoria de serviço' });
  }
});

// Services routes
app.get('/api/services', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, c.name as category_name
      FROM services s
      LEFT JOIN service_categories c ON s.category_id = c.id
      ORDER BY s.name
    `);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get services error:', error);
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
    
    // Insert new service
    const result = await pool.query(
      `INSERT INTO services (
        name, description, base_price, category_id, is_base_service
      ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description, base_price, category_id, is_base_service]
    );
    
    res.status(201).json({
      message: 'Serviço criado com sucesso',
      service: result.rows[0]
    });
  } catch (error) {
    console.error('Create service error:', error);
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
        category_id = $4,
        is_base_service = COALESCE($5, is_base_service)
      WHERE id = $6 RETURNING *`,
      [name, description, base_price, category_id, is_base_service, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }
    
    res.status(200).json({
      message: 'Serviço atualizado com sucesso',
      service: result.rows[0]
    });
  } catch (error) {
    console.error('Update service error:', error);
    res.status(500).json({ message: 'Erro ao atualizar serviço' });
  }
});

app.delete('/api/services/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Delete service
    const result = await pool.query(
      'DELETE FROM services WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }
    
    res.status(200).json({ message: 'Serviço excluído com sucesso' });
  } catch (error) {
    console.error('Delete service error:', error);
    res.status(500).json({ message: 'Erro ao excluir serviço' });
  }
});

// Dependents routes
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    // Check if user is requesting their own dependents or is admin/professional
    const isAuthorized = 
      req.user.id === parseInt(clientId) || 
      req.user.roles.includes('admin') || 
      req.user.roles.includes('professional') ||
      req.user.roles.includes('clinic');
    
    if (!isAuthorized) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const result = await pool.query(
      'SELECT * FROM dependents WHERE client_id = $1 ORDER BY name',
      [clientId]
    );
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get dependents error:', error);
    res.status(500).json({ message: 'Erro ao buscar dependentes' });
  }
});

app.post('/api/dependents', authenticate, async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;
    
    // Validate required fields
    if (!client_id || !name || !cpf) {
      return res.status(400).json({ message: 'ID do cliente, nome e CPF são obrigatórios' });
    }
    
    // Check if user is adding dependent to their own account or is admin
    const isAuthorized = 
      req.user.id === parseInt(client_id) || 
      req.user.roles.includes('admin');
    
    if (!isAuthorized) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if dependent already exists
    const existingDependent = await pool.query(
      'SELECT * FROM dependents WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
    );
    
    if (existingDependent.rows.length > 0) {
      return res.status(400).json({ message: 'Dependente já cadastrado com este CPF' });
    }
    
    // Insert new dependent
    const result = await pool.query(
      'INSERT INTO dependents (client_id, name, cpf, birth_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [client_id, name, cpf.replace(/\D/g, ''), birth_date]
    );
    
    res.status(201).json({
      message: 'Dependente adicionado com sucesso',
      dependent: result.rows[0]
    });
  } catch (error) {
    console.error('Create dependent error:', error);
    res.status(500).json({ message: 'Erro ao adicionar dependente' });
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
    
    // Check if user is updating their own dependent or is admin
    const isAuthorized = 
      req.user.id === dependent.client_id || 
      req.user.roles.includes('admin');
    
    if (!isAuthorized) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Update dependent
    const result = await pool.query(
      'UPDATE dependents SET name = COALESCE($1, name), birth_date = $2 WHERE id = $3 RETURNING *',
      [name, birth_date, id]
    );
    
    res.status(200).json({
      message: 'Dependente atualizado com sucesso',
      dependent: result.rows[0]
    });
  } catch (error) {
    console.error('Update dependent error:', error);
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
    
    // Check if user is deleting their own dependent or is admin
    const isAuthorized = 
      req.user.id === dependent.client_id || 
      req.user.roles.includes('admin');
    
    if (!isAuthorized) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Delete dependent
    await pool.query(
      'DELETE FROM dependents WHERE id = $1',
      [id]
    );
    
    res.status(200).json({ message: 'Dependente excluído com sucesso' });
  } catch (error) {
    console.error('Delete dependent error:', error);
    res.status(500).json({ message: 'Erro ao excluir dependente' });
  }
});

app.get('/api/dependents/lookup/:cpf', authenticate, async (req, res) => {
  try {
    const { cpf } = req.params;
    
    // Find dependent by CPF
    const result = await pool.query(`
      SELECT d.*, c.name as client_name, 
        COALESCE(sp.status, 'pending') as client_subscription_status
      FROM dependents d
      JOIN users c ON d.client_id = c.id
      LEFT JOIN (
        SELECT user_id, status,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
        FROM subscription_payments
      ) sp ON c.id = sp.user_id AND sp.rn = 1
      WHERE d.cpf = $1
    `, [cpf.replace(/\D/g, '')]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Lookup dependent error:', error);
    res.status(500).json({ message: 'Erro ao buscar dependente' });
  }
});

// Client lookup route
app.get('/api/clients/lookup/:cpf', authenticate, async (req, res) => {
  try {
    const { cpf } = req.params;
    
    // Find client by CPF
    const result = await pool.query(`
      SELECT u.id, u.name, u.cpf, 
        COALESCE(sp.status, 'pending') as subscription_status,
        sp.expiry_date as subscription_expiry
      FROM users u
      LEFT JOIN (
        SELECT user_id, status, expiry_date,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
        FROM subscription_payments
      ) sp ON u.id = sp.user_id AND sp.rn = 1
      WHERE u.cpf = $1 AND $2 = ANY(u.roles)
    `, [cpf.replace(/\D/g, ''), 'client']);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Lookup client error:', error);
    res.status(500).json({ message: 'Erro ao buscar cliente' });
  }
});

// Consultations routes
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query = `
      SELECT c.*, 
        s.name as service_name,
        COALESCE(d.name, u.name) as client_name,
        p.name as professional_name,
        CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      JOIN users p ON c.professional_id = p.id
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
    `;
    
    const queryParams = [];
    
    // Filter by role
    if (req.user.currentRole === 'client') {
      // Clients can only see their own consultations
      query += ` WHERE c.client_id = $1`;
      queryParams.push(req.user.id);
    } else if (req.user.currentRole === 'professional') {
      // Professionals can only see their own consultations
      query += ` WHERE c.professional_id = $1`;
      queryParams.push(req.user.id);
    } else if (req.user.currentRole === 'clinic') {
      // Clinics can see all consultations of their professionals
      // This would need a relationship between clinics and professionals
      // For now, let's assume clinic can see all
    }
    
    // Add order by
    query += ` ORDER BY c.date DESC`;
    
    const result = await pool.query(query, queryParams);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get consultations error:', error);
    res.status(500).json({ message: 'Erro ao buscar consultas' });
  }
});

app.post('/api/consultations', authenticate, async (req, res) => {
  try {
    const { 
      client_id, 
      dependent_id, 
      professional_id, 
      service_id, 
      value, 
      date,
      notes,
      location_id
    } = req.body;
    
    // Validate required fields
    if ((!client_id && !dependent_id) || !professional_id || !service_id || !value || !date) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }
    
    // Check if professional exists
    const professionalResult = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND $2 = ANY(roles)',
      [professional_id, 'professional']
    );
    
    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    // Check if service exists
    const serviceResult = await pool.query(
      'SELECT * FROM services WHERE id = $1',
      [service_id]
    );
    
    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }
    
    // If dependent_id is provided, check if it exists and belongs to client
    if (dependent_id) {
      const dependentResult = await pool.query(
        'SELECT * FROM dependents WHERE id = $1',
        [dependent_id]
      );
      
      if (dependentResult.rows.length === 0) {
        return res.status(404).json({ message: 'Dependente não encontrado' });
      }
      
      // If client_id is also provided, check if dependent belongs to client
      if (client_id && dependentResult.rows[0].client_id !== parseInt(client_id)) {
        return res.status(400).json({ message: 'Dependente não pertence ao cliente informado' });
      }
    }
    
    // Insert consultation
    const result = await pool.query(
      `INSERT INTO consultations (
        client_id, dependent_id, professional_id, service_id, value, date, notes, location_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        client_id,
        dependent_id,
        professional_id,
        service_id,
        value,
        date,
        notes,
        location_id
      ]
    );
    
    res.status(201).json({
      message: 'Consulta registrada com sucesso',
      consultation: result.rows[0]
    });
  } catch (error) {
    console.error('Create consultation error:', error);
    res.status(500).json({ message: 'Erro ao registrar consulta' });
  }
});

// Clinic routes
app.post('/api/clinic/consultations', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { 
      client_id, 
      dependent_id, 
      professional_id, 
      service_id, 
      value, 
      date,
      notes,
      location_id
    } = req.body;
    
    // Validate required fields
    if ((!client_id && !dependent_id) || !professional_id || !service_id || !value || !date) {
      return res.status(400).json({ message: 'Campos obrigatórios não preenchidos' });
    }
    
    // Check if professional exists
    const professionalResult = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND $2 = ANY(roles)',
      [professional_id, 'professional']
    );
    
    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    // Insert consultation
    const result = await pool.query(
      `INSERT INTO consultations (
        client_id, dependent_id, professional_id, service_id, value, date, notes, location_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        client_id,
        dependent_id,
        professional_id,
        service_id,
        value,
        date,
        notes,
        location_id
      ]
    );
    
    res.status(201).json({
      message: 'Consulta registrada com sucesso',
      consultation: result.rows[0]
    });
  } catch (error) {
    console.error('Create clinic consultation error:', error);
    res.status(500).json({ message: 'Erro ao registrar consulta' });
  }
});

app.get('/api/clinic/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.cpf, u.email, u.phone, u.professional_registration, 
        u.photo_url, u.professional_type, u.percentage, u.is_active,
        sc.name as category_name
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE $1 = ANY(u.roles)
      ORDER BY u.name
    `, ['professional']);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get clinic professionals error:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais' });
  }
});

app.post('/api/clinic/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
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
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Usuário já cadastrado com este CPF' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Insert new professional
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, password, professional_registration,
        category_id, percentage, roles, professional_type, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        name,
        cpf.replace(/\D/g, ''),
        email,
        phone ? phone.replace(/\D/g, '') : null,
        hashedPassword,
        professional_registration,
        category_id,
        percentage || 50,
        ['professional'],
        professional_type || 'convenio',
        true
      ]
    );
    
    // Remove password from response
    const { password: _, ...professional } = result.rows[0];
    
    res.status(201).json({
      message: 'Profissional cadastrado com sucesso',
      professional
    });
  } catch (error) {
    console.error('Create clinic professional error:', error);
    res.status(500).json({ message: 'Erro ao cadastrar profissional' });
  }
});

app.put('/api/clinic/professionals/:id', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { id } = req.params;
    const { percentage, is_active } = req.body;
    
    // Update professional
    const result = await pool.query(
      `UPDATE users SET
        percentage = COALESCE($1, percentage),
        is_active = COALESCE($2, is_active)
      WHERE id = $3 AND $4 = ANY(roles) RETURNING *`,
      [percentage, is_active, id, 'professional']
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    // Remove password from response
    const { password, ...professional } = result.rows[0];
    
    res.status(200).json({
      message: 'Profissional atualizado com sucesso',
      professional
    });
  } catch (error) {
    console.error('Update clinic professional error:', error);
    res.status(500).json({ message: 'Erro ao atualizar profissional' });
  }
});

app.get('/api/clinic/patients', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const result = await pool.query(`
      WITH patient_consultations AS (
        SELECT 
          COALESCE(c.client_id, d.client_id) as patient_id,
          COALESCE(u.name, d.name) as patient_name,
          COALESCE(u.cpf, d.cpf) as patient_cpf,
          u.email as patient_email,
          u.phone as patient_phone,
          u.birth_date as patient_birth_date,
          c.professional_id,
          p.name as professional_name,
          CASE WHEN d.id IS NOT NULL THEN false ELSE true END as is_convenio_patient,
          ROW_NUMBER() OVER (PARTITION BY COALESCE(c.client_id, d.client_id) ORDER BY c.date DESC) as rn
        FROM consultations c
        LEFT JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        JOIN users p ON c.professional_id = p.id
      )
      SELECT 
        patient_id as id,
        patient_name as name,
        patient_cpf as cpf,
        patient_email as email,
        patient_phone as phone,
        patient_birth_date as birth_date,
        professional_id,
        professional_name,
        is_convenio_patient
      FROM patient_consultations
      WHERE rn = 1
      ORDER BY patient_name
    `);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get clinic patients error:', error);
    res.status(500).json({ message: 'Erro ao buscar pacientes' });
  }
});

app.get('/api/clinic/stats', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    // Get current month date range
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    // Get total professionals
    const professionalsResult = await pool.query(`
      SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active = true) as active
      FROM users
      WHERE $1 = ANY(roles)
    `, ['professional']);
    
    // Get monthly consultations
    const consultationsResult = await pool.query(`
      SELECT COUNT(*) as count, SUM(value) as revenue
      FROM consultations
      WHERE date BETWEEN $1 AND $2
    `, [firstDay, lastDay]);
    
    // Get pending payments
    const paymentsResult = await pool.query(`
      SELECT SUM(c.value * (1 - (u.percentage / 100))) as pending
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date BETWEEN $1 AND $2
    `, [firstDay, lastDay]);
    
    res.status(200).json({
      total_professionals: parseInt(professionalsResult.rows[0].total) || 0,
      active_professionals: parseInt(professionalsResult.rows[0].active) || 0,
      total_consultations: parseInt(consultationsResult.rows[0].count) || 0,
      monthly_revenue: parseFloat(consultationsResult.rows[0].revenue) || 0,
      pending_payments: parseFloat(paymentsResult.rows[0].pending) || 0
    });
  } catch (error) {
    console.error('Get clinic stats error:', error);
    res.status(500).json({ message: 'Erro ao buscar estatísticas' });
  }
});

app.get('/api/clinic/reports', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }
    
    // Get professional reports
    const result = await pool.query(`
      WITH professional_consultations AS (
        SELECT 
          c.professional_id,
          u.name as professional_name,
          u.percentage as professional_percentage,
          COUNT(c.id) as consultation_count,
          SUM(c.value) as total_revenue,
          SUM(c.value * (u.percentage / 100)) as professional_payment,
          SUM(c.value * (1 - (u.percentage / 100))) as clinic_revenue
        FROM consultations c
        JOIN users u ON c.professional_id = u.id
        WHERE c.date BETWEEN $1 AND $2
        GROUP BY c.professional_id, u.name, u.percentage
      )
      SELECT *
      FROM professional_consultations
      ORDER BY professional_name
    `, [start_date, end_date]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get clinic reports error:', error);
    res.status(500).json({ message: 'Erro ao buscar relatórios' });
  }
});

app.get('/api/clinic/reports/professional/:id', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { id } = req.params;
    const { start_date, end_date } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }
    
    // Get professional consultation details
    const result = await pool.query(`
      SELECT 
        c.id,
        c.date,
        COALESCE(d.name, u.name) as patient_name,
        s.name as service_name,
        c.value,
        c.value * (p.percentage / 100) as professional_payment,
        c.value * (1 - (p.percentage / 100)) as clinic_revenue
      FROM consultations c
      JOIN users p ON c.professional_id = p.id
      JOIN services s ON c.service_id = s.id
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE c.professional_id = $1 AND c.date BETWEEN $2 AND $3
      ORDER BY c.date DESC
    `, [id, start_date, end_date]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get professional consultation details error:', error);
    res.status(500).json({ message: 'Erro ao buscar detalhes das consultas' });
  }
});

app.get('/api/clinic/agenda/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, professional_type
      FROM users
      WHERE $1 = ANY(roles) 
      AND is_active = true
      AND (professional_type = 'agenda' OR professional_type = 'both')
      ORDER BY name
    `, ['professional']);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get agenda professionals error:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais' });
  }
});

app.get('/api/clinic/agenda/appointments', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { professional_id, start_date, end_date } = req.query;
    
    if (!professional_id || !start_date || !end_date) {
      return res.status(400).json({ message: 'ID do profissional e datas são obrigatórios' });
    }
    
    // Get appointments
    const result = await pool.query(`
      SELECT a.*, p.name as patient_name, p.phone as patient_phone, p.is_convenio_patient
      FROM appointments a
      JOIN agenda_patients p ON a.patient_id = p.id
      WHERE a.professional_id = $1 AND a.date BETWEEN $2 AND $3
      ORDER BY a.date
    `, [professional_id, start_date, end_date]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get clinic agenda appointments error:', error);
    res.status(500).json({ message: 'Erro ao buscar agendamentos' });
  }
});

app.get('/api/clinic/medical-records/patient/:id', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get medical records
    const result = await pool.query(`
      WITH patient_consultations AS (
        SELECT 
          c.id as consultation_id,
          COALESCE(c.client_id, d.client_id) as patient_id,
          COALESCE(u.name, d.name) as patient_name,
          COALESCE(u.cpf, d.cpf) as patient_cpf,
          c.date as consultation_date,
          s.name as service_name,
          c.professional_id,
          p.name as professional_name,
          p.professional_registration
        FROM consultations c
        LEFT JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        JOIN users p ON c.professional_id = p.id
        JOIN services s ON c.service_id = s.id
        WHERE COALESCE(c.client_id, d.client_id) = $1
      )
      SELECT 
        mr.id,
        pc.consultation_id,
        pc.patient_id,
        pc.patient_name,
        pc.patient_cpf,
        pc.consultation_date,
        pc.service_name,
        mr.chief_complaint,
        mr.diagnosis,
        mr.treatment_plan,
        pc.professional_id,
        pc.professional_name,
        pc.professional_registration,
        mr.created_at
      FROM medical_records mr
      JOIN patient_consultations pc ON mr.patient_id = pc.patient_id
      ORDER BY mr.created_at DESC
    `, [id]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get patient medical records error:', error);
    res.status(500).json({ message: 'Erro ao buscar prontuários' });
  }
});

// Agenda routes
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Check if agenda_payments table exists
    let tableExists = false;
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'agenda_payments'
        );
      `);
      tableExists = tableCheck.rows[0].exists;
    } catch (error) {
      console.error('Error checking agenda_payments table:', error);
      tableExists = false;
    }
    
    // If table doesn't exist, create it
    if (!tableExists) {
      try {
        await pool.query(`
          CREATE TABLE agenda_payments (
            id SERIAL PRIMARY KEY,
            professional_id INTEGER NOT NULL REFERENCES users(id),
            amount NUMERIC(10, 2) NOT NULL DEFAULT 49.90,
            status VARCHAR(50) NOT NULL DEFAULT 'pending',
            payment_date TIMESTAMP WITH TIME ZONE,
            expiry_date TIMESTAMP WITH TIME ZONE,
            payment_id VARCHAR(255),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Created agenda_payments table');
      } catch (createError) {
        console.error('Error creating agenda_payments table:', createError);
      }
    }
    
    // Get subscription status
    let subscriptionStatus = {
      status: 'pending',
      expires_at: null,
      days_remaining: 0,
      can_use_agenda: false,
      last_payment: null
    };
    
    try {
      if (tableExists) {
        const result = await pool.query(`
          SELECT status, expiry_date, payment_date
          FROM agenda_payments
          WHERE professional_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `, [req.user.id]);
        
        if (result.rows.length > 0) {
          const subscription = result.rows[0];
          const status = subscription.status.toLowerCase();
          const expiryDate = subscription.expiry_date;
          
          console.log('🔍 Found subscription:', subscription);
          console.log('🔍 Status:', status);
          console.log('🔍 Expiry date:', expiryDate);
          
          // Calculate days remaining
          let daysRemaining = 0;
          if (expiryDate) {
            const now = new Date();
            const expiry = new Date(expiryDate);
            const diffTime = expiry.getTime() - now.getTime();
            daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          }
          
          // Check if subscription is active
          const isActive = 
            status === 'active' || 
            status === 'approved' || 
            status === 'paid' || 
            status === 'completed';
          
          const isExpired = expiryDate && new Date(expiryDate) < new Date();
          
          subscriptionStatus = {
            status: isExpired ? 'expired' : status,
            expires_at: expiryDate,
            days_remaining: Math.max(0, daysRemaining),
            can_use_agenda: isActive && !isExpired,
            last_payment: subscription.payment_date
          };
        }
      }
    } catch (error) {
      console.error('Error getting subscription status:', error);
    }
    
    // TEMPORARY FIX: Force enable agenda for all professionals
    subscriptionStatus.can_use_agenda = true;
    subscriptionStatus.status = 'active';
    
    res.status(200).json(subscriptionStatus);
  } catch (error) {
    console.error('Get agenda subscription status error:', error);
    res.status(500).json({ message: 'Erro ao verificar status da assinatura' });
  }
});

app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Create MercadoPago preference
    const preference = new Preference(mercadopago);
    
    const preferenceData = {
      items: [
        {
          id: 'agenda-subscription',
          title: 'Assinatura Agenda Profissional',
          quantity: 1,
          unit_price: 49.90,
          currency_id: 'BRL',
          description: 'Assinatura mensal da agenda profissional'
        }
      ],
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`
      },
      auto_return: 'approved',
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/mercadopago/webhook`,
      external_reference: `agenda-${req.user.id}`,
      metadata: {
        payment_type: 'agenda',
        professional_id: req.user.id
      }
    };
    
    const preferenceResponse = await preference.create({ body: preferenceData });
    
    // Create pending payment record
    const now = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(now.getDate() + 30); // 30 days from now
    
    // Check if agenda_payments table exists
    let tableExists = false;
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'agenda_payments'
        );
      `);
      tableExists = tableCheck.rows[0].exists;
    } catch (error) {
      console.error('Error checking agenda_payments table:', error);
      tableExists = false;
    }
    
    // If table exists, create payment record
    if (tableExists) {
      await pool.query(`
        INSERT INTO agenda_payments (
          professional_id, amount, status, expiry_date
        ) VALUES ($1, $2, $3, $4)
      `, [req.user.id, 49.90, 'pending', expiryDate]);
    }
    
    res.status(200).json({
      message: 'Pagamento criado com sucesso',
      init_point: preferenceResponse.init_point,
      preference_id: preferenceResponse.id
    });
  } catch (error) {
    console.error('Create agenda subscription payment error:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

app.get('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { include_archived } = req.query;
    
    // Check if agenda_patients table exists
    let tableExists = false;
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'agenda_patients'
        );
      `);
      tableExists = tableCheck.rows[0].exists;
    } catch (error) {
      console.error('Error checking agenda_patients table:', error);
      tableExists = false;
    }
    
    // If table doesn't exist, create it
    if (!tableExists) {
      try {
        await pool.query(`
          CREATE TABLE agenda_patients (
            id SERIAL PRIMARY KEY,
            professional_id INTEGER NOT NULL REFERENCES users(id),
            name VARCHAR(255) NOT NULL,
            cpf VARCHAR(11) UNIQUE NOT NULL,
            email VARCHAR(255),
            phone VARCHAR(20),
            birth_date DATE,
            address VARCHAR(255),
            address_number VARCHAR(20),
            address_complement VARCHAR(255),
            neighborhood VARCHAR(255),
            city VARCHAR(255),
            state VARCHAR(2),
            notes TEXT,
            is_convenio_patient BOOLEAN DEFAULT FALSE,
            is_archived BOOLEAN DEFAULT FALSE,
            linked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Created agenda_patients table');
      } catch (createError) {
        console.error('Error creating agenda_patients table:', createError);
      }
    }
    
    // Get patients
    let query = `
      SELECT * FROM agenda_patients 
      WHERE professional_id = $1
    `;
    
    const queryParams = [req.user.id];
    
    // Filter archived patients if not explicitly included
    if (!include_archived || include_archived !== 'true') {
      query += ` AND is_archived = false`;
    }
    
    query += ` ORDER BY name`;
    
    const result = await pool.query(query, queryParams);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get agenda patients error:', error);
    res.status(500).json({ message: 'Erro ao buscar pacientes' });
  }
});

app.post('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
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
      notes
    } = req.body;
    
    // Validate required fields
    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }
    
    // Check if agenda_patients table exists
    let tableExists = false;
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'agenda_patients'
        );
      `);
      tableExists = tableCheck.rows[0].exists;
    } catch (error) {
      console.error('Error checking agenda_patients table:', error);
      tableExists = false;
    }
    
    // If table doesn't exist, create it
    if (!tableExists) {
      try {
        await pool.query(`
          CREATE TABLE agenda_patients (
            id SERIAL PRIMARY KEY,
            professional_id INTEGER NOT NULL REFERENCES users(id),
            name VARCHAR(255) NOT NULL,
            cpf VARCHAR(11) UNIQUE NOT NULL,
            email VARCHAR(255),
            phone VARCHAR(20),
            birth_date DATE,
            address VARCHAR(255),
            address_number VARCHAR(20),
            address_complement VARCHAR(255),
            neighborhood VARCHAR(255),
            city VARCHAR(255),
            state VARCHAR(2),
            notes TEXT,
            is_convenio_patient BOOLEAN DEFAULT FALSE,
            is_archived BOOLEAN DEFAULT FALSE,
            linked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Created agenda_patients table');
      } catch (createError) {
        console.error('Error creating agenda_patients table:', createError);
      }
    }
    
    // Check if patient already exists
    const existingPatient = await pool.query(
      'SELECT * FROM agenda_patients WHERE cpf = $1 AND professional_id = $2',
      [cpf.replace(/\D/g, ''), req.user.id]
    );
    
    if (existingPatient.rows.length > 0) {
      return res.status(400).json({ message: 'Paciente já cadastrado com este CPF' });
    }
    
    // Check if patient is a convenio client
    const convenioClient = await pool.query(`
      SELECT u.id FROM users u
      LEFT JOIN (
        SELECT user_id, status,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
        FROM subscription_payments
      ) sp ON u.id = sp.user_id AND sp.rn = 1
      WHERE u.cpf = $1 AND $2 = ANY(u.roles) AND COALESCE(sp.status, 'pending') = 'active'
    `, [cpf.replace(/\D/g, ''), 'client']);
    
    const isConvenioPatient = convenioClient.rows.length > 0;
    
    // Insert new patient
    const result = await pool.query(
      `INSERT INTO agenda_patients (
        professional_id, name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, notes, is_convenio_patient
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        req.user.id,
        name,
        cpf.replace(/\D/g, ''),
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
        isConvenioPatient
      ]
    );
    
    res.status(201).json({
      message: 'Paciente adicionado com sucesso',
      patient: result.rows[0]
    });
  } catch (error) {
    console.error('Create agenda patient error:', error);
    res.status(500).json({ message: 'Erro ao adicionar paciente' });
  }
});

app.put('/api/agenda/patients/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    // Update patient notes
    const result = await pool.query(
      'UPDATE agenda_patients SET notes = $1 WHERE id = $2 AND professional_id = $3 RETURNING *',
      [notes, id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    res.status(200).json({
      message: 'Paciente atualizado com sucesso',
      patient: result.rows[0]
    });
  } catch (error) {
    console.error('Update agenda patient error:', error);
    res.status(500).json({ message: 'Erro ao atualizar paciente' });
  }
});

app.put('/api/agenda/patients/:id/archive', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_archived } = req.body;
    
    // Update patient archived status
    const result = await pool.query(
      'UPDATE agenda_patients SET is_archived = $1 WHERE id = $2 AND professional_id = $3 RETURNING *',
      [is_archived, id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    res.status(200).json({
      message: is_archived ? 'Paciente arquivado com sucesso' : 'Paciente restaurado com sucesso',
      patient: result.rows[0]
    });
  } catch (error) {
    console.error('Archive agenda patient error:', error);
    res.status(500).json({ message: 'Erro ao arquivar/restaurar paciente' });
  }
});

app.get('/api/agenda/patients/lookup/:cpf', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.params;
    
    // Find patient by CPF
    const result = await pool.query(
      'SELECT * FROM agenda_patients WHERE cpf = $1 AND professional_id = $2',
      [cpf.replace(/\D/g, ''), req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Lookup agenda patient error:', error);
    res.status(500).json({ message: 'Erro ao buscar paciente' });
  }
});

app.post('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patient_id, date, notes, status, location_id } = req.body;
    
    // Validate required fields
    if (!patient_id || !date) {
      return res.status(400).json({ message: 'ID do paciente e data são obrigatórios' });
    }
    
    // Check if appointments table exists
    let tableExists = false;
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'appointments'
        );
      `);
      tableExists = tableCheck.rows[0].exists;
    } catch (error) {
      console.error('Error checking appointments table:', error);
      tableExists = false;
    }
    
    // If table doesn't exist, create it
    if (!tableExists) {
      try {
        await pool.query(`
          CREATE TABLE appointments (
            id SERIAL PRIMARY KEY,
            professional_id INTEGER NOT NULL REFERENCES users(id),
            patient_id INTEGER NOT NULL,
            date TIMESTAMP WITH TIME ZONE NOT NULL,
            status VARCHAR(50) DEFAULT 'scheduled',
            notes TEXT,
            location_id INTEGER,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Created appointments table');
      } catch (createError) {
        console.error('Error creating appointments table:', createError);
      }
    }
    
    // Insert appointment
    const result = await pool.query(
      `INSERT INTO appointments (
        professional_id, patient_id, date, status, notes, location_id
      ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.user.id,
        patient_id,
        date,
        status || 'scheduled',
        notes,
        location_id
      ]
    );
    
    res.status(201).json({
      message: 'Agendamento criado com sucesso',
      appointment: result.rows[0]
    });
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ message: 'Erro ao criar agendamento' });
  }
});

app.get('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }
    
    // Check if appointments table exists
    let tableExists = false;
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'appointments'
        );
      `);
      tableExists = tableCheck.rows[0].exists;
    } catch (error) {
      console.error('Error checking appointments table:', error);
      tableExists = false;
    }
    
    // If table doesn't exist, create it
    if (!tableExists) {
      try {
        await pool.query(`
          CREATE TABLE appointments (
            id SERIAL PRIMARY KEY,
            professional_id INTEGER NOT NULL REFERENCES users(id),
            patient_id INTEGER NOT NULL,
            date TIMESTAMP WITH TIME ZONE NOT NULL,
            status VARCHAR(50) DEFAULT 'scheduled',
            notes TEXT,
            location_id INTEGER,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Created appointments table');
        
        // Return empty array since table was just created
        return res.status(200).json([]);
      } catch (createError) {
        console.error('Error creating appointments table:', createError);
      }
    }
    
    // Get appointments
    const result = await pool.query(`
      SELECT a.*, p.name as patient_name, p.phone as patient_phone, p.is_convenio_patient
      FROM appointments a
      JOIN agenda_patients p ON a.patient_id = p.id
      WHERE a.professional_id = $1 AND a.date BETWEEN $2 AND $3
      ORDER BY a.date
    `, [req.user.id, start_date, end_date]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({ message: 'Erro ao buscar agendamentos' });
  }
});

app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Check if schedule_config table exists
    let tableExists = false;
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'schedule_config'
        );
      `);
      tableExists = tableCheck.rows[0].exists;
    } catch (error) {
      console.error('Error checking schedule_config table:', error);
      tableExists = false;
    }
    
    // If table doesn't exist, create it
    if (!tableExists) {
      try {
        await pool.query(`
          CREATE TABLE schedule_config (
            id SERIAL PRIMARY KEY,
            professional_id INTEGER NOT NULL REFERENCES users(id),
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
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Created schedule_config table');
        
        // Insert default config
        await pool.query(`
          INSERT INTO schedule_config (
            professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
            wednesday_start, wednesday_end, thursday_start, thursday_end,
            friday_start, friday_end, slot_duration
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          req.user.id, 
          '08:00', '18:00', '08:00', '18:00', 
          '08:00', '18:00', '08:00', '18:00', 
          '08:00', '18:00', 30
        ]);
      } catch (createError) {
        console.error('Error creating schedule_config table:', createError);
      }
    }
    
    // Get schedule config
    const result = await pool.query(
      'SELECT * FROM schedule_config WHERE professional_id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      // Insert default config if not found
      const defaultConfig = await pool.query(`
        INSERT INTO schedule_config (
          professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
          wednesday_start, wednesday_end, thursday_start, thursday_end,
          friday_start, friday_end, slot_duration
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `, [
        req.user.id, 
        '08:00', '18:00', '08:00', '18:00', 
        '08:00', '18:00', '08:00', '18:00', 
        '08:00', '18:00', 30
      ]);
      
      res.status(200).json(defaultConfig.rows[0]);
    } else {
      res.status(200).json(result.rows[0]);
    }
  } catch (error) {
    console.error('Get schedule config error:', error);
    res.status(500).json({ message: 'Erro ao buscar configuração de agenda' });
  }
});

// Professional locations routes
app.get('/api/professional-locations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Check if professional_locations table exists
    let tableExists = false;
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'professional_locations'
        );
      `);
      tableExists = tableCheck.rows[0].exists;
    } catch (error) {
      console.error('Error checking professional_locations table:', error);
      tableExists = false;
    }
    
    // If table doesn't exist, create it
    if (!tableExists) {
      try {
        await pool.query(`
          CREATE TABLE professional_locations (
            id SERIAL PRIMARY KEY,
            professional_id INTEGER NOT NULL REFERENCES users(id),
            clinic_name VARCHAR(255) NOT NULL,
            address VARCHAR(255) NOT NULL,
            address_number VARCHAR(20),
            address_complement VARCHAR(255),
            neighborhood VARCHAR(255),
            city VARCHAR(255) NOT NULL,
            state VARCHAR(2) NOT NULL,
            phone VARCHAR(20),
            is_main BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Created professional_locations table');
        
        // Return empty array since table was just created
        return res.status(200).json([]);
      } catch (createError) {
        console.error('Error creating professional_locations table:', createError);
      }
    }
    
    // Get locations
    const result = await pool.query(
      'SELECT * FROM professional_locations WHERE professional_id = $1 ORDER BY is_main DESC, clinic_name',
      [req.user.id]
    );
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get professional locations error:', error);
    res.status(500).json({ message: 'Erro ao buscar locais de atendimento' });
  }
});

app.post('/api/professional-locations', authenticate, authorize(['professional']), async (req, res) => {
  try {
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
    if (!clinic_name || !address || !city || !state) {
      return res.status(400).json({ message: 'Nome da clínica, endereço, cidade e estado são obrigatórios' });
    }
    
    // If setting as main, update all other locations to not be main
    if (is_main) {
      await pool.query(
        'UPDATE professional_locations SET is_main = false WHERE professional_id = $1',
        [req.user.id]
      );
    }
    
    // Insert new location
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
    
    res.status(201).json({
      message: 'Local adicionado com sucesso',
      location: result.rows[0]
    });
  } catch (error) {
    console.error('Create professional location error:', error);
    res.status(500).json({ message: 'Erro ao adicionar local' });
  }
});

app.put('/api/professional-locations/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
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
    if (!clinic_name || !address || !city || !state) {
      return res.status(400).json({ message: 'Nome da clínica, endereço, cidade e estado são obrigatórios' });
    }
    
    // Check if location exists and belongs to professional
    const locationResult = await pool.query(
      'SELECT * FROM professional_locations WHERE id = $1 AND professional_id = $2',
      [id, req.user.id]
    );
    
    if (locationResult.rows.length === 0) {
      return res.status(404).json({ message: 'Local não encontrado' });
    }
    
    // If setting as main, update all other locations to not be main
    if (is_main) {
      await pool.query(
        'UPDATE professional_locations SET is_main = false WHERE professional_id = $1',
        [req.user.id]
      );
    }
    
    // Update location
    const result = await pool.query(
      `UPDATE professional_locations SET
        clinic_name = $1,
        address = $2,
        address_number = $3,
        address_complement = $4,
        neighborhood = $5,
        city = $6,
        state = $7,
        phone = $8,
        is_main = $9
      WHERE id = $10 AND professional_id = $11 RETURNING *`,
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
    
    res.status(200).json({
      message: 'Local atualizado com sucesso',
      location: result.rows[0]
    });
  } catch (error) {
    console.error('Update professional location error:', error);
    res.status(500).json({ message: 'Erro ao atualizar local' });
  }
});

app.delete('/api/professional-locations/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Delete location
    const result = await pool.query(
      'DELETE FROM professional_locations WHERE id = $1 AND professional_id = $2 RETURNING *',
      [id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Local não encontrado' });
    }
    
    res.status(200).json({ message: 'Local excluído com sucesso' });
  } catch (error) {
    console.error('Delete professional location error:', error);
    res.status(500).json({ message: 'Erro ao excluir local' });
  }
});

// Medical records routes
app.get('/api/medical-records/patient/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if medical_records table exists
    let tableExists = false;
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'medical_records'
        );
      `);
      tableExists = tableCheck.rows[0].exists;
    } catch (error) {
      console.error('Error checking medical_records table:', error);
      tableExists = false;
    }
    
    // If table doesn't exist, create it
    if (!tableExists) {
      try {
        await pool.query(`
          CREATE TABLE medical_records (
            id SERIAL PRIMARY KEY,
            consultation_id INTEGER REFERENCES consultations(id),
            patient_id INTEGER NOT NULL,
            professional_id INTEGER NOT NULL REFERENCES users(id),
            chief_complaint TEXT,
            anamnesis TEXT,
            physical_examination TEXT,
            diagnosis TEXT,
            treatment_plan TEXT,
            clinical_evolution TEXT,
            internal_notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Created medical_records table');
        
        // Return empty array since table was just created
        return res.status(200).json([]);
      } catch (createError) {
        console.error('Error creating medical_records table:', createError);
      }
    }
    
    // Get medical records
    const result = await pool.query(`
      WITH patient_info AS (
        SELECT 
          id as patient_id,
          name as patient_name,
          cpf as patient_cpf
        FROM agenda_patients
        WHERE id = $1 AND professional_id = $2
      )
      SELECT 
        mr.id,
        mr.consultation_id,
        mr.patient_id,
        pi.patient_name,
        pi.patient_cpf,
        c.date as consultation_date,
        s.name as service_name,
        mr.chief_complaint,
        mr.anamnesis,
        mr.physical_examination,
        mr.diagnosis,
        mr.treatment_plan,
        mr.clinical_evolution,
        mr.internal_notes,
        u.name as professional_name,
        u.professional_registration,
        mr.created_at,
        mr.updated_at
      FROM medical_records mr
      JOIN patient_info pi ON mr.patient_id = pi.patient_id
      LEFT JOIN consultations c ON mr.consultation_id = c.id
      LEFT JOIN services s ON c.service_id = s.id
      JOIN users u ON mr.professional_id = u.id
      WHERE mr.patient_id = $1 AND mr.professional_id = $2
      ORDER BY mr.created_at DESC
    `, [id, req.user.id]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get patient medical records error:', error);
    res.status(500).json({ message: 'Erro ao buscar prontuários' });
  }
});

app.post('/api/medical-records', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const {
      patient_id,
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
    
    // Check if patient exists and belongs to professional
    const patientResult = await pool.query(
      'SELECT * FROM agenda_patients WHERE id = $1 AND professional_id = $2',
      [patient_id, req.user.id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    // Insert medical record
    const result = await pool.query(
      `INSERT INTO medical_records (
        patient_id, professional_id, chief_complaint, anamnesis,
        physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        patient_id,
        req.user.id,
        chief_complaint,
        anamnesis,
        physical_examination,
        diagnosis,
        treatment_plan,
        clinical_evolution,
        internal_notes
      ]
    );
    
    res.status(201).json({
      message: 'Prontuário criado com sucesso',
      medical_record: result.rows[0]
    });
  } catch (error) {
    console.error('Create medical record error:', error);
    res.status(500).json({ message: 'Erro ao criar prontuário' });
  }
});

app.put('/api/medical-records/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
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
    
    // Check if medical record exists and belongs to professional
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
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 AND professional_id = $9 RETURNING *`,
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
    
    res.status(200).json({
      message: 'Prontuário atualizado com sucesso',
      medical_record: result.rows[0]
    });
  } catch (error) {
    console.error('Update medical record error:', error);
    res.status(500).json({ message: 'Erro ao atualizar prontuário' });
  }
});

// Document templates routes
app.get('/api/document-templates', authenticate, async (req, res) => {
  try {
    // Check if document_templates table exists
    let tableExists = false;
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'document_templates'
        );
      `);
      tableExists = tableCheck.rows[0].exists;
    } catch (error) {
      console.error('Error checking document_templates table:', error);
      tableExists = false;
    }
    
    // If table doesn't exist, create it and add default templates
    if (!tableExists) {
      try {
        await pool.query(`
          CREATE TABLE document_templates (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            type VARCHAR(50) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Created document_templates table');
        
        // Add default templates
        const templatesDir = path.join(__dirname, 'templates');
        
        // Atestado template
        const atestadoPath = path.join(templatesDir, 'atestado.html');
        if (fs.existsSync(atestadoPath)) {
          const atestadoContent = fs.readFileSync(atestadoPath, 'utf8');
          await pool.query(
            'INSERT INTO document_templates (name, type, content) VALUES ($1, $2, $3)',
            ['Atestado Médico', 'atestado', atestadoContent]
          );
        }
        
        // Receituário template
        const receituarioPath = path.join(templatesDir, 'receituario.html');
        if (fs.existsSync(receituarioPath)) {
          const receituarioContent = fs.readFileSync(receituarioPath, 'utf8');
          await pool.query(
            'INSERT INTO document_templates (name, type, content) VALUES ($1, $2, $3)',
            ['Receituário', 'receituario', receituarioContent]
          );
        }
        
        // LGPD template
        const lgpdPath = path.join(templatesDir, 'lgpd.html');
        if (fs.existsSync(lgpdPath)) {
          const lgpdContent = fs.readFileSync(lgpdPath, 'utf8');
          await pool.query(
            'INSERT INTO document_templates (name, type, content) VALUES ($1, $2, $3)',
            ['Termo LGPD', 'lgpd', lgpdContent]
          );
        }
        
        // Termo de consentimento template
        const termoPath = path.join(templatesDir, 'termo_consentimento.html');
        if (fs.existsSync(termoPath)) {
          const termoContent = fs.readFileSync(termoPath, 'utf8');
          await pool.query(
            'INSERT INTO document_templates (name, type, content) VALUES ($1, $2, $3)',
            ['Termo de Consentimento', 'termo_consentimento', termoContent]
          );
        }
        
        // Solicitação de exames template
        const examesPath = path.join(templatesDir, 'solicitacao_exames.html');
        if (fs.existsSync(examesPath)) {
          const examesContent = fs.readFileSync(examesPath, 'utf8');
          await pool.query(
            'INSERT INTO document_templates (name, type, content) VALUES ($1, $2, $3)',
            ['Solicitação de Exames', 'solicitacao_exames', examesContent]
          );
        }
        
        // Declaração de comparecimento template
        const declaracaoPath = path.join(templatesDir, 'declaracao_comparecimento.html');
        if (fs.existsSync(declaracaoPath)) {
          const declaracaoContent = fs.readFileSync(declaracaoPath, 'utf8');
          await pool.query(
            'INSERT INTO document_templates (name, type, content) VALUES ($1, $2, $3)',
            ['Declaração de Comparecimento', 'declaracao_comparecimento', declaracaoContent]
          );
        }
      } catch (createError) {
        console.error('Error creating document_templates table:', createError);
      }
    }
    
    // Get templates
    const result = await pool.query(
      'SELECT * FROM document_templates ORDER BY name'
    );
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get document templates error:', error);
    res.status(500).json({ message: 'Erro ao buscar templates de documentos' });
  }
});

// Generate document route
app.post('/api/generate-document', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { template_id, patient_id, professional_id, ...data } = req.body;
    
    // Validate required fields
    if (!template_id || !patient_id) {
      return res.status(400).json({ message: 'ID do template e ID do paciente são obrigatórios' });
    }
    
    // Check if template exists
    const templateResult = await pool.query(
      'SELECT * FROM document_templates WHERE id = $1',
      [template_id]
    );
    
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ message: 'Template não encontrado' });
    }
    
    const template = templateResult.rows[0];
    
    // Check if patient exists and belongs to professional
    const patientResult = await pool.query(
      'SELECT * FROM agenda_patients WHERE id = $1 AND professional_id = $2',
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
    
    // Format CPF
    const formattedCpf = patient.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    
    // Prepare template data
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
      data_atual: format(new Date(), 'dd/MM/yyyy'),
      hora_atual: format(new Date(), 'HH:mm'),
      profissional_nome: professional.name,
      profissional_registro: professional.professional_registration,
      profissional_assinatura: professional.signature_url,
      ...data
    };
    
    // Compile template
    const compiledTemplate = Handlebars.compile(template.content);
    const html = compiledTemplate(templateData);
    
    // Generate PDF (mock implementation)
    const documentUrl = `https://example.com/documents/${Date.now()}.pdf`;
    
    // Check if generated_documents table exists
    let tableExists = false;
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'generated_documents'
        );
      `);
      tableExists = tableCheck.rows[0].exists;
    } catch (error) {
      console.error('Error checking generated_documents table:', error);
      tableExists = false;
    }
    
    // If table doesn't exist, create it
    if (!tableExists) {
      try {
        await pool.query(`
          CREATE TABLE generated_documents (
            id SERIAL PRIMARY KEY,
            patient_id INTEGER NOT NULL,
            professional_id INTEGER NOT NULL REFERENCES users(id),
            template_id INTEGER REFERENCES document_templates(id),
            type VARCHAR(50) NOT NULL,
            url TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Created generated_documents table');
      } catch (createError) {
        console.error('Error creating generated_documents table:', createError);
      }
    }
    
    // Save document record
    const result = await pool.query(
      `INSERT INTO generated_documents (
        patient_id, professional_id, template_id, type, url
      ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        patient_id,
        req.user.id,
        template_id,
        template.type,
        documentUrl
      ]
    );
    
    res.status(201).json({
      message: 'Documento gerado com sucesso',
      document: result.rows[0],
      url: documentUrl,
      html
    });
  } catch (error) {
    console.error('Generate document error:', error);
    res.status(500).json({ message: 'Erro ao gerar documento' });
  }
});

app.get('/api/generated-documents/patient/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is authorized to access patient documents
    if (req.user.currentRole === 'professional') {
      const patientResult = await pool.query(
        'SELECT * FROM agenda_patients WHERE id = $1 AND professional_id = $2',
        [id, req.user.id]
      );
      
      if (patientResult.rows.length === 0) {
        return res.status(403).json({ message: 'Acesso não autorizado' });
      }
    } else if (req.user.currentRole !== 'admin' && req.user.currentRole !== 'clinic') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Get documents
    const result = await pool.query(`
      SELECT gd.*, dt.name as template_name, ap.name as patient_name
      FROM generated_documents gd
      JOIN document_templates dt ON gd.template_id = dt.id
      JOIN agenda_patients ap ON gd.patient_id = ap.id
      WHERE gd.patient_id = $1
      ORDER BY gd.created_at DESC
    `, [id]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get patient documents error:', error);
    res.status(500).json({ message: 'Erro ao buscar documentos' });
  }
});

// Professional signature route
app.post('/api/professional/signature', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { signature_url } = req.body;
    
    // Update professional signature
    const result = await pool.query(
      'UPDATE users SET signature_url = $1 WHERE id = $2 RETURNING *',
      [signature_url, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    // Remove password from response
    const { password, ...professional } = result.rows[0];
    
    res.status(200).json({
      message: 'Assinatura atualizada com sucesso',
      professional
    });
  } catch (error) {
    console.error('Update professional signature error:', error);
    res.status(500).json({ message: 'Erro ao atualizar assinatura' });
  }
});

// Image upload route
app.post('/api/upload-image', authenticate, processUpload('image'), async (req, res) => {
  try {
    if (!req.cloudinaryResult) {
      return res.status(400).json({ message: 'Nenhuma imagem enviada' });
    }
    
    res.status(200).json({
      message: 'Imagem enviada com sucesso',
      imageUrl: req.cloudinaryResult.secure_url
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ message: 'Erro ao enviar imagem' });
  }
});

// Reports routes
app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }
    
    // Get total revenue
    const totalRevenueResult = await pool.query(`
      SELECT SUM(value) as total_revenue
      FROM consultations
      WHERE date BETWEEN $1 AND $2
    `, [start_date, end_date]);
    
    const totalRevenue = parseFloat(totalRevenueResult.rows[0].total_revenue) || 0;
    
    // Get revenue by professional
    const professionalRevenueResult = await pool.query(`
      SELECT 
        c.professional_id,
        u.name as professional_name,
        u.percentage as professional_percentage,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue,
        SUM(c.value * (u.percentage / 100)) as professional_payment,
        SUM(c.value * (1 - (u.percentage / 100))) as clinic_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY c.professional_id, u.name, u.percentage
      ORDER BY u.name
    `, [start_date, end_date]);
    
    // Get revenue by service
    const serviceRevenueResult = await pool.query(`
      SELECT 
        c.service_id,
        s.name as service_name,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY c.service_id, s.name
      ORDER BY s.name
    `, [start_date, end_date]);
    
    res.status(200).json({
      total_revenue: totalRevenue,
      revenue_by_professional: professionalRevenueResult.rows,
      revenue_by_service: serviceRevenueResult.rows
    });
  } catch (error) {
    console.error('Get revenue report error:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de faturamento' });
  }
});

app.get('/api/reports/new-clients', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }
    
    // Get total new clients
    const totalClientsResult = await pool.query(`
      SELECT COUNT(*) as total_new_clients, SUM(amount) as subscription_revenue
      FROM subscription_payments
      WHERE status = 'active' AND created_at BETWEEN $1 AND $2
    `, [start_date, end_date]);
    
    // Get clients by month
    const clientsByMonthResult = await pool.query(`
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*) as count,
        SUM(amount) as revenue
      FROM subscription_payments
      WHERE status = 'active' AND created_at BETWEEN $1 AND $2
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month
    `, [start_date, end_date]);
    
    res.status(200).json({
      total_new_clients: parseInt(totalClientsResult.rows[0].total_new_clients) || 0,
      subscription_revenue: parseFloat(totalClientsResult.rows[0].subscription_revenue) || 0,
      clients_by_month: clientsByMonthResult.rows
    });
  } catch (error) {
    console.error('Get new clients report error:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de novos clientes' });
  }
});

app.get('/api/reports/total-revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Datas de início e fim são obrigatórias' });
    }
    
    // Get subscription revenue
    const subscriptionRevenueResult = await pool.query(`
      SELECT SUM(amount) as subscription_revenue
      FROM subscription_payments
      WHERE status = 'active' AND created_at BETWEEN $1 AND $2
    `, [start_date, end_date]);
    
    const subscriptionRevenue = parseFloat(subscriptionRevenueResult.rows[0].subscription_revenue) || 0;
    
    // Get consultation revenue
    const consultationRevenueResult = await pool.query(`
      SELECT 
        SUM(c.value) as total_revenue,
        SUM(c.value * (1 - (u.percentage / 100))) as clinic_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date BETWEEN $1 AND $2
    `, [start_date, end_date]);
    
    const consultationRevenue = parseFloat(consultationRevenueResult.rows[0].clinic_revenue) || 0;
    const totalConsultationRevenue = parseFloat(consultationRevenueResult.rows[0].total_revenue) || 0;
    
    res.status(200).json({
      subscription_revenue: subscriptionRevenue,
      consultation_revenue: consultationRevenue,
      total_revenue: subscriptionRevenue + totalConsultationRevenue,
      clinic_total_revenue: subscriptionRevenue + consultationRevenue
    });
  } catch (error) {
    console.error('Get total revenue report error:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de receita total' });
  }
});

app.get('/api/reports/professional-revenue', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
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
    const consultationsResult = await pool.query(`
      SELECT 
        c.id,
        c.date,
        COALESCE(d.name, u.name) as client_name,
        s.name as service_name,
        c.value as total_value,
        c.value * ((100 - $3) / 100) as amount_to_pay
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE c.professional_id = $1 AND c.date BETWEEN $2 AND $3
      ORDER BY c.date DESC
    `, [req.user.id, start_date, end_date, percentage]);
    
    // Calculate summary
    const totalRevenue = consultationsResult.rows.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const amountToPay = consultationsResult.rows.reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0);
    
    res.status(200).json({
      summary: {
        professional_percentage: percentage,
        total_revenue: totalRevenue,
        consultation_count: consultationsResult.rows.length,
        amount_to_pay: amountToPay
      },
      consultations: consultationsResult.rows
    });
  } catch (error) {
    console.error('Get professional revenue report error:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de faturamento' });
  }
});

app.get('/api/reports/professional-consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
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
    const consultationsResult = await pool.query(`
      SELECT 
        c.id,
        c.consultation_id,
        c.date,
        c.patient_name,
        c.service_name,
        c.total_value,
        c.amount_to_pay,
        c.is_convenio_patient,
        CASE WHEN mr.id IS NOT NULL THEN true ELSE false END as has_medical_record
      FROM (
        SELECT 
          c.id as consultation_id,
          c.id,
          c.date,
          COALESCE(d.name, u.name) as patient_name,
          s.name as service_name,
          c.value as total_value,
          c.value * ((100 - $4) / 100) as amount_to_pay,
          true as is_convenio_patient,
          COALESCE(c.client_id, d.client_id) as patient_id
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        LEFT JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE c.professional_id = $1 AND c.date BETWEEN $2 AND $3
        
        UNION ALL
        
        SELECT 
          a.id as consultation_id,
          NULL as id,
          a.date,
          p.name as patient_name,
          'Consulta Particular' as service_name,
          0 as total_value,
          0 as amount_to_pay,
          false as is_convenio_patient,
          p.id as patient_id
        FROM appointments a
        JOIN agenda_patients p ON a.patient_id = p.id
        WHERE a.professional_id = $1 AND a.date BETWEEN $2 AND $3 AND a.status = 'completed'
      ) c
      LEFT JOIN medical_records mr ON c.patient_id = mr.patient_id AND mr.professional_id = $1
      ORDER BY c.date DESC
    `, [req.user.id, start_date, end_date, percentage]);
    
    // Calculate summary
    const allConsultations = consultationsResult.rows;
    const convenioConsultations = allConsultations.filter(c => c.is_convenio_patient);
    const particularConsultations = allConsultations.filter(c => !c.is_convenio_patient);
    
    const totalRevenue = convenioConsultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const convenioRevenue = convenioConsultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const amountToPay = convenioConsultations.reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0);
    
    res.status(200).json({
      summary: {
        total_consultations: allConsultations.length,
        convenio_consultations: convenioConsultations.length,
        particular_consultations: particularConsultations.length,
        total_revenue: totalRevenue,
        convenio_revenue: convenioRevenue,
        particular_revenue: 0,
        amount_to_pay: amountToPay
      },
      consultations: allConsultations
    });
  } catch (error) {
    console.error('Get professional consultations report error:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de consultas' });
  }
});

// Payment routes
app.post('/api/create-subscription', authenticate, async (req, res) => {
  try {
    const { user_id } = req.body;
    
    // Validate required fields
    if (!user_id) {
      return res.status(400).json({ message: 'ID do usuário é obrigatório' });
    }
    
    // Check if user exists
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [user_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Create MercadoPago preference
    const preference = new Preference(mercadopago);
    
    const preferenceData = {
      items: [
        {
          id: 'subscription',
          title: 'Assinatura Convênio Quiro Ferreira',
          quantity: 1,
          unit_price: 250,
          currency_id: 'BRL',
          description: 'Assinatura mensal do Convênio Quiro Ferreira'
        }
      ],
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`
      },
      auto_return: 'approved',
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/mercadopago/webhook`,
      external_reference: `subscription-${user_id}`,
      metadata: {
        payment_type: 'subscription',
        user_id
      }
    };
    
    const preferenceResponse = await preference.create({ body: preferenceData });
    
    // Create pending payment record
    const now = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(now.getDate() + 30); // 30 days from now
    
    await pool.query(`
      INSERT INTO subscription_payments (
        user_id, amount, status, expiry_date
      ) VALUES ($1, $2, $3, $4)
    `, [user_id, 250, 'pending', expiryDate]);
    
    res.status(200).json({
      message: 'Pagamento criado com sucesso',
      init_point: preferenceResponse.init_point,
      preference_id: preferenceResponse.id
    });
  } catch (error) {
    console.error('Create subscription payment error:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { amount } = req.body;
    
    // Validate required fields
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Valor válido é obrigatório' });
    }
    
    // Create MercadoPago preference
    const preference = new Preference(mercadopago);
    
    const preferenceData = {
      items: [
        {
          id: 'professional-payment',
          title: 'Pagamento ao Convênio Quiro Ferreira',
          quantity: 1,
          unit_price: parseFloat(amount),
          currency_id: 'BRL',
          description: 'Pagamento de comissão ao Convênio Quiro Ferreira'
        }
      ],
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/reports`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/reports`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/reports`
      },
      auto_return: 'approved',
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/mercadopago/webhook`,
      external_reference: `professional-payment-${req.user.id}`,
      metadata: {
        payment_type: 'professional_payment',
        professional_id: req.user.id
      }
    };
    
    const preferenceResponse = await preference.create({ body: preferenceData });
    
    res.status(200).json({
      message: 'Pagamento criado com sucesso',
      init_point: preferenceResponse.init_point,
      preference_id: preferenceResponse.id
    });
  } catch (error) {
    console.error('Create professional payment error:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

// MercadoPago webhook
app.post('/api/mercadopago/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      
      // Get payment details from MercadoPago
      const payment = await mercadopago.payment.findById({ id: paymentId });
      
      if (!payment) {
        return res.status(404).json({ message: 'Pagamento não encontrado' });
      }
      
      const { status, external_reference, metadata } = payment;
      
      // Process payment based on type
      if (external_reference.startsWith('subscription-')) {
        const userId = external_reference.split('-')[1];
        
        // Update subscription payment
        if (status === 'approved') {
          // Calculate expiry date (30 days from now)
          const now = new Date();
          const expiryDate = new Date();
          expiryDate.setDate(now.getDate() + 30);
          
          await pool.query(`
            UPDATE subscription_payments 
            SET status = 'active', payment_date = $1, expiry_date = $2, payment_id = $3
            WHERE user_id = $4 AND status = 'pending'
          `, [now, expiryDate, paymentId, userId]);
        }
      } else if (external_reference.startsWith('agenda-')) {
        const professionalId = external_reference.split('-')[1];
        
        // Update agenda payment
        if (status === 'approved') {
          // Calculate expiry date (30 days from now)
          const now = new Date();
          const expiryDate = new Date();
          expiryDate.setDate(now.getDate() + 30);
          
          await pool.query(`
            UPDATE agenda_payments 
            SET status = 'active', payment_date = $1, expiry_date = $2, payment_id = $3
            WHERE professional_id = $4 AND status = 'pending'
          `, [now, expiryDate, paymentId, professionalId]);
        }
      } else if (external_reference.startsWith('professional-payment-')) {
        // Professional payment to clinic - no need to update anything
      }
    }
    
    res.status(200).json({ message: 'Webhook processado com sucesso' });
  } catch (error) {
    console.error('MercadoPago webhook error:', error);
    res.status(500).json({ message: 'Erro ao processar webhook' });
  }
});

// Setup database endpoint
app.get('/api/setup-database', async (req, res) => {
  try {
    await setupDatabase();
    res.status(200).json({ message: 'Database setup complete' });
  } catch (error) {
    console.error('Setup database error:', error);
    res.status(500).json({ message: 'Erro ao configurar banco de dados' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});