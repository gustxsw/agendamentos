import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { authenticate, authorize } from './middleware/auth.js';
import uploadMiddleware from './middleware/upload.js';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { format } from 'date-fns';
import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
// Import MercadoPago SDK v2
import { MercadoPagoConfig, Payment, Preference } from 'mercadopago';

// Initialize environment variables
dotenv.config();

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Configure MercadoPago
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
// Initialize MercadoPago client with SDK v2
let mercadoPagoClient = null;
if (MP_ACCESS_TOKEN) {
  try {
    mercadoPagoClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
    console.log('✅ MercadoPago SDK v2 configured successfully');
  } catch (error) {
    console.error('❌ Error configuring MercadoPago SDK v2:', error);
  }
} else {
  console.warn('⚠️ MercadoPago access token not found, payment features will be disabled');
}

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'https://www.cartaoquiroferreira.com.br', 'https://cartaoquiroferreira.com.br'],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Database setup - Create tables if they don't exist
const setupDatabase = async () => {
  try {
    console.log('🔄 Setting up database tables...');
    
    // Create users table
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
        percentage INT,
        category_id INT,
        professional_registration VARCHAR(255),
        photo_url TEXT,
        signature_url TEXT,
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_expiry TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create service_categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create services table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        base_price DECIMAL(10, 2) NOT NULL,
        category_id INT REFERENCES service_categories(id),
        is_base_service BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create dependents table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dependents (
        id SERIAL PRIMARY KEY,
        client_id INT NOT NULL REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) UNIQUE NOT NULL,
        birth_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create consultations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INT REFERENCES users(id),
        dependent_id INT REFERENCES dependents(id),
        professional_id INT NOT NULL REFERENCES users(id),
        service_id INT NOT NULL REFERENCES services(id),
        value DECIMAL(10, 2) NOT NULL,
        date TIMESTAMP NOT NULL,
        notes TEXT,
        location_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create medical_records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INT REFERENCES consultations(id),
        patient_id INT NOT NULL,
        professional_id INT NOT NULL REFERENCES users(id),
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
    
    // Create subscription_payments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_payments (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id),
        amount DECIMAL(10, 2) NOT NULL,
        payment_id VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        payment_date TIMESTAMP,
        expiry_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create agenda_payments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_payments (
        id SERIAL PRIMARY KEY,
        professional_id INT NOT NULL REFERENCES users(id),
        amount DECIMAL(10, 2) NOT NULL DEFAULT 49.90,
        payment_id VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        payment_date TIMESTAMP,
        expiry_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create professional_locations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_locations (
        id SERIAL PRIMARY KEY,
        professional_id INT NOT NULL REFERENCES users(id),
        clinic_name VARCHAR(255) NOT NULL,
        address VARCHAR(255) NOT NULL,
        address_number VARCHAR(20),
        address_complement VARCHAR(255),
        neighborhood VARCHAR(255),
        city VARCHAR(255),
        state VARCHAR(2),
        phone VARCHAR(20),
        is_main BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create document_templates table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create generated_documents table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_documents (
        id SERIAL PRIMARY KEY,
        patient_id INT NOT NULL,
        professional_id INT NOT NULL REFERENCES users(id),
        template_id INT REFERENCES document_templates(id),
        type VARCHAR(50) NOT NULL,
        url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create appointments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        patient_id INT NOT NULL,
        professional_id INT NOT NULL REFERENCES users(id),
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        location_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create schedule_config table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_config (
        id SERIAL PRIMARY KEY,
        professional_id INT NOT NULL REFERENCES users(id) UNIQUE,
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
        slot_duration INT DEFAULT 30,
        break_start TIME,
        break_end TIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Database tables created successfully');
  } catch (error) {
    console.error('❌ Error setting up database:', error);
  }
};

// Run database setup
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
      password,
    } = req.body;

    // Validate required fields
    if (!name || !cpf || !password) {
      return res.status(400).json({ message: 'Nome, CPF e senha são obrigatórios' });
    }

    // Check if user already exists
    const userExists = await pool.query(
      'SELECT * FROM users WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
    );

    if (userExists.rows.length > 0) {
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
        ['client'],
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

    // Return user data (without password)
    delete user.password;
    user.currentRole = 'client';

    res.status(201).json({
      user,
      token,
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

    // Generate JWT token (without role if selection needed)
    const token = jwt.sign(
      { id: user.id, currentRole: needsRoleSelection ? null : user.roles[0] },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );

    // Set token in cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    // Return user data (without password)
    delete user.password;
    if (!needsRoleSelection) {
      user.currentRole = user.roles[0];
    }

    res.json({
      user,
      token,
      needsRoleSelection,
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

    // Return user data (without password)
    delete user.password;
    user.currentRole = role;

    res.json({
      user,
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

    // Return user data (without password)
    delete user.password;
    user.currentRole = role;

    res.json({
      user,
      token,
    });
  } catch (error) {
    console.error('Role switch error:', error);
    res.status(500).json({ message: 'Erro ao trocar role' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout realizado com sucesso' });
});

// User routes
app.get('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY name');
    const users = result.rows.map(user => {
      delete user.password;
      return user;
    });
    res.json(users);
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
    
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    const user = result.rows[0];
    delete user.password;
    
    res.json(user);
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
      [cpf.replace(/\D/g, '')]
    );

    if (userExists.rows.length > 0) {
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
        category_id,
      ]
    );

    const user = result.rows[0];
    delete user.password;

    res.status(201).json(user);
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
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14 RETURNING *`,
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

    const user = result.rows[0];
    delete user.password;

    res.json(user);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Erro ao atualizar usuário' });
  }
});

app.put('/api/users/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Senha atual e nova senha são obrigatórias' });
    }

    // Find user
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

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
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
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
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    res.json({ message: 'Usuário excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Erro ao excluir usuário' });
  }
});

// Client activation route
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
        updated_at = CURRENT_TIMESTAMP 
      WHERE id = $2 RETURNING *`,
      [expiry_date, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const user = result.rows[0];
    delete user.password;

    res.json(user);
  } catch (error) {
    console.error('Error activating client:', error);
    res.status(500).json({ message: 'Erro ao ativar cliente' });
  }
});

// Service category routes
app.get('/api/service-categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM service_categories ORDER BY name');
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

    // Insert new category
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

// Service routes
app.get('/api/services', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, c.name as category_name 
      FROM services s 
      LEFT JOIN service_categories c ON s.category_id = c.id 
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
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6 RETURNING *`,
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
    const result = await pool.query('DELETE FROM services WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }

    res.json({ message: 'Serviço excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ message: 'Erro ao excluir serviço' });
  }
});

// Dependent routes
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    // Check if user is requesting their own dependents or is an admin/professional
    if (
      req.user.id !== parseInt(clientId) && 
      req.user.currentRole !== 'admin' && 
      req.user.currentRole !== 'professional' &&
      req.user.currentRole !== 'clinic'
    ) {
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
    
    // Check if user is adding their own dependent or is an admin
    if (req.user.id !== client_id && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Validate required fields
    if (!client_id || !name || !cpf) {
      return res.status(400).json({ message: 'ID do cliente, nome e CPF são obrigatórios' });
    }
    
    // Check if dependent already exists
    const dependentExists = await pool.query(
      'SELECT * FROM dependents WHERE cpf = $1',
      [cpf.replace(/\D/g, '')]
    );
    
    if (dependentExists.rows.length > 0) {
      return res.status(400).json({ message: 'Dependente já cadastrado com este CPF' });
    }
    
    // Insert new dependent
    const result = await pool.query(
      'INSERT INTO dependents (client_id, name, cpf, birth_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [client_id, name, cpf.replace(/\D/g, ''), birth_date]
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
    
    // Find dependent
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
      `UPDATE dependents SET
        name = COALESCE($1, name),
        birth_date = COALESCE($2, birth_date),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 RETURNING *`,
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
    
    // Find dependent
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
    await pool.query('DELETE FROM dependents WHERE id = $1', [id]);
    
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
    
    // Find dependent
    const result = await pool.query(
      `SELECT d.*, c.name as client_name, c.subscription_status as client_subscription_status 
       FROM dependents d 
       JOIN users c ON d.client_id = c.id 
       WHERE d.cpf = $1`,
      [cpf.replace(/\D/g, '')]
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
    
    // Find client
    const result = await pool.query(
      `SELECT id, name, cpf, subscription_status, subscription_expiry 
       FROM users 
       WHERE cpf = $1 AND $2 = ANY(roles)`,
      [cpf.replace(/\D/g, ''), 'client']
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

// Consultation routes
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query;
    let params = [];
    
    if (req.user.currentRole === 'client') {
      // Clients can only see their own consultations and their dependents'
      query = `
        SELECT c.*, s.name as service_name, p.name as professional_name, 
               CASE WHEN d.id IS NULL THEN u.name ELSE d.name END as client_name,
               CASE WHEN d.id IS NULL THEN false ELSE true END as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users p ON c.professional_id = p.id
        LEFT JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE (c.client_id = $1 OR d.client_id = $1)
        ORDER BY c.date DESC
      `;
      params = [req.user.id];
    } else if (req.user.currentRole === 'professional') {
      // Professionals can only see consultations they performed
      query = `
        SELECT c.*, s.name as service_name, p.name as professional_name, 
               CASE WHEN d.id IS NULL THEN u.name ELSE d.name END as client_name,
               CASE WHEN d.id IS NULL THEN false ELSE true END as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users p ON c.professional_id = p.id
        LEFT JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE c.professional_id = $1
        ORDER BY c.date DESC
      `;
      params = [req.user.id];
    } else if (req.user.currentRole === 'clinic') {
      // Clinics can see all consultations from their professionals
      query = `
        SELECT c.*, s.name as service_name, p.name as professional_name, 
               CASE WHEN d.id IS NULL THEN u.name ELSE d.name END as client_name,
               CASE WHEN d.id IS NULL THEN false ELSE true END as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users p ON c.professional_id = p.id
        LEFT JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        ORDER BY c.date DESC
      `;
    } else {
      // Admins can see all consultations
      query = `
        SELECT c.*, s.name as service_name, p.name as professional_name, 
               CASE WHEN d.id IS NULL THEN u.name ELSE d.name END as client_name,
               CASE WHEN d.id IS NULL THEN false ELSE true END as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users p ON c.professional_id = p.id
        LEFT JOIN users u ON c.client_id = u.id
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
    
    // Check if professional exists and has professional role
    const professionalResult = await pool.query(
      `SELECT * FROM users WHERE id = $1 AND $2 = ANY(roles)`,
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
      
      // Check if client has active subscription
      const clientResult = await pool.query(
        'SELECT subscription_status FROM users WHERE id = $1',
        [dependentResult.rows[0].client_id]
      );
      
      if (clientResult.rows[0].subscription_status !== 'active') {
        return res.status(400).json({ message: 'Cliente não possui assinatura ativa' });
      }
    }
    
    // If client_id is provided, check if it exists and has client role
    if (client_id) {
      const clientResult = await pool.query(
        `SELECT * FROM users WHERE id = $1 AND $2 = ANY(roles)`,
        [client_id, 'client']
      );
      
      if (clientResult.rows.length === 0) {
        return res.status(404).json({ message: 'Cliente não encontrado' });
      }
      
      // Check if client has active subscription
      if (clientResult.rows[0].subscription_status !== 'active') {
        return res.status(400).json({ message: 'Cliente não possui assinatura ativa' });
      }
    }
    
    // Insert consultation
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

// Professional routes
app.get('/api/professionals', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.phone, u.roles, 
             u.address, u.address_number, u.address_complement, 
             u.neighborhood, u.city, u.state, u.photo_url,
             u.professional_registration, c.name as category_name
      FROM users u
      LEFT JOIN service_categories c ON u.category_id = c.id
      WHERE $1 = ANY(u.roles)
      ORDER BY u.name
    `, ['professional']);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching professionals:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais' });
  }
});

// Professional signature upload
app.post('/api/professional/signature', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { signature_url } = req.body;
    
    if (!signature_url) {
      return res.status(400).json({ message: 'URL da assinatura é obrigatória' });
    }
    
    // Update user's signature URL
    const result = await pool.query(
      'UPDATE users SET signature_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [signature_url, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    const user = result.rows[0];
    delete user.password;
    
    res.json(user);
  } catch (error) {
    console.error('Error updating signature:', error);
    res.status(500).json({ message: 'Erro ao atualizar assinatura' });
  }
});

// Professional payment routes
app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }
    
    // Create MercadoPago preference
    const preference = {
      items: [
        {
          title: 'Pagamento ao Convênio Quiro Ferreira',
          unit_price: Number(amount),
          quantity: 1,
        }
      ],
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`
      },
      auto_return: 'approved',
      external_reference: `prof_payment_${req.user.id}_${Date.now()}`,
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`
    };
    
    const response = await MercadoPago.preferences.create(preference);
    
    res.json({
      id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point
    });
  } catch (error) {
    console.error('Error creating payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

// Agenda routes
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Check if agenda_payments table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'agenda_payments'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('⚠️ agenda_payments table does not exist, creating it...');
      
      // Create agenda_payments table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS agenda_payments (
          id SERIAL PRIMARY KEY,
          professional_id INT NOT NULL REFERENCES users(id),
          amount DECIMAL(10, 2) NOT NULL DEFAULT 49.90,
          payment_id VARCHAR(255),
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          payment_date TIMESTAMP,
          expiry_date TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      console.log('✅ agenda_payments table created successfully');
      
      // Return default response for first-time setup
      return res.json({
        status: 'pending',
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: true, // Temporarily allow access for all professionals
        last_payment: null
      });
    }
    
    // Find active subscription
    const result = await pool.query(
      `SELECT * FROM agenda_payments 
       WHERE professional_id = $1 
       AND status = 'active' 
       AND (expiry_date IS NULL OR expiry_date > CURRENT_TIMESTAMP)
       ORDER BY expiry_date DESC 
       LIMIT 1`,
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      // No active subscription found
      
      // Check if there's a pending payment
      const pendingResult = await pool.query(
        `SELECT * FROM agenda_payments 
         WHERE professional_id = $1 
         AND status = 'pending'
         ORDER BY created_at DESC 
         LIMIT 1`,
        [req.user.id]
      );
      
      // Find last payment regardless of status
      const lastPaymentResult = await pool.query(
        `SELECT payment_date FROM agenda_payments 
         WHERE professional_id = $1 
         AND payment_date IS NOT NULL
         ORDER BY payment_date DESC 
         LIMIT 1`,
        [req.user.id]
      );
      
      const lastPayment = lastPaymentResult.rows.length > 0 
        ? lastPaymentResult.rows[0].payment_date 
        : null;
      
      // TEMPORARY FIX: Allow all professionals to use the agenda
      return res.json({
        status: pendingResult.rows.length > 0 ? 'pending' : 'expired',
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: true, // Temporarily allow access for all professionals
        last_payment: lastPayment
      });
    }
    
    // Active subscription found
    const subscription = result.rows[0];
    
    // Calculate days remaining
    const now = new Date();
    const expiryDate = new Date(subscription.expiry_date);
    const daysRemaining = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
    
    res.json({
      status: subscription.status,
      expires_at: subscription.expiry_date,
      days_remaining: daysRemaining,
      can_use_agenda: true,
      last_payment: subscription.payment_date
    });
  } catch (error) {
    console.error('Error checking agenda subscription:', error);
    
    // TEMPORARY FIX: Allow all professionals to use the agenda in case of error
    res.json({
      status: 'active',
      expires_at: null,
      days_remaining: 30,
      can_use_agenda: true,
      last_payment: null
    });
  }
});

// Create subscription payment
app.post('/api/create-subscription', authenticate, async (req, res) => {
  try {
    if (!mercadoPagoClient) {
      return res.status(500).json({ message: 'MercadoPago not configured' });
    }

    const { user_id, dependent_ids = [] } = req.body;
    
    // Calculate total amount
    const dependentCount = dependent_ids.length;
    const totalAmount = 250 + (dependentCount * 50); // R$250 titular + R$50 per dependent

    // Create preference with SDK v2
    const preference = new Preference(mercadoPagoClient);
    
    const preferenceData = {
      items: [{
        title: 'Assinatura Convênio Quiro Ferreira',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: totalAmount
      }],
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`
      },
      auto_return: 'approved',
      external_reference: `subscription_${user_id}`,
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/webhook/mercadopago`
    };

    const response = await preference.create({ body: preferenceData });
    console.log('✅ MercadoPago preference created:', response);

    // Get the preference data from the response
    const preferenceResult = response.id ? response : response.response;

    // Return the preference init_point to the client
    res.json({
      id: preferenceResult.id,
      init_point: preferenceResult.init_point
    });
  } catch (error) {
    console.error('❌ Error creating subscription payment:', error);
    res.status(500).json({ message: 'Error creating subscription payment', error: error.message });
  }
});

// Create agenda subscription payment
app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    if (!mercadoPagoClient) {
      return res.status(500).json({ message: 'MercadoPago not configured' });
    }

    // Get professional ID from authenticated user
    const professionalId = req.user.id;
    const amount = 49.90; // Fixed price for agenda subscription

    // Create preference with SDK v2
    const preference = new Preference(mercadoPagoClient);
    
    const preferenceData = {
      items: [{
        title: 'Assinatura Agenda Profissional',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: amount
      }],
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`
      },
      auto_return: 'approved',
      external_reference: `agenda_${professionalId}`,
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/webhook/mercadopago`
    };

    const response = await preference.create({ body: preferenceData });
    console.log('✅ MercadoPago agenda preference created:', response);

    // Get the preference data from the response
    const preferenceResult = response.id ? response : response.response;

    // Return the preference init_point to the client
    res.json({
      id: preferenceResult.id,
      init_point: preferenceResult.init_point
    });
  } catch (error) {
    console.error('❌ Error creating agenda subscription payment:', error);
    res.status(500).json({ message: 'Error creating agenda subscription payment', error: error.message });
  }
});

// Create professional payment
app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    if (!mercadoPagoClient) {
      return res.status(500).json({ message: 'MercadoPago not configured' });
    }

    // Get professional ID from authenticated user
    const professionalId = req.user.id;
    const { amount } = req.body;

    // Create preference with SDK v2
    const preference = new Preference(mercadoPagoClient);
    
    const preferenceData = {
      items: [{
        title: 'Pagamento ao Convênio Quiro Ferreira',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: parseFloat(amount)
      }],
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/reports`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/reports`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/reports`
      },
      auto_return: 'approved',
      external_reference: `payment_${professionalId}`,
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/webhook/mercadopago`
    };

    const response = await preference.create({ body: preferenceData });
    console.log('✅ MercadoPago professional payment preference created:', response);

    // Get the preference data from the response
    const preferenceResult = response.id ? response : response.response;

    // Return the preference init_point to the client
    res.json({
      id: preferenceResult.id,
      init_point: preferenceResult.init_point
    });
  } catch (error) {
    console.error('❌ Error creating professional payment:', error);
    res.status(500).json({ message: 'Error creating professional payment', error: error.message });
  }
});

// MercadoPago webhook
app.post('/api/webhook/mercadopago', async (req, res) => {
  try {
    if (!mercadoPagoClient) {
      return res.status(500).json({ message: 'MercadoPago not configured' });
    }

    const { type, data } = req.body;
    console.log('🔔 Received MercadoPago webhook:', { type, data });

    // Only process payment notifications
    if (type !== 'payment' || !data.id) {
      console.log('⚠️ Ignoring non-payment webhook or missing payment ID');
      return res.status(200).json({ message: 'Webhook ignored' });
    }

    // Get payment data
    const payment = new Payment(mercadoPagoClient);
    const paymentData = await payment.get({ id: data.id });

    // Check if payment exists
    if (!payment) {
      console.error('❌ Payment not found:', data.id);
      return res.status(404).json({ message: 'Payment not found' });
    }

    console.log('✅ MercadoPago payment found:', paymentData);

    // Get payment status and external reference
    const { status, external_reference } = paymentData;

    // Check if payment is approved
    if (status !== 'approved') {
      console.log('⚠️ Payment not approved yet, status:', status);
      return res.status(200).json({ message: 'Payment not approved yet' });
    }

    console.log('✅ MercadoPago payment approved:', paymentData);

    // Process payment based on external reference
    if (external_reference.startsWith('subscription_')) {
      // Handle subscription payment
      const userId = external_reference.split('_')[1];

      // Get payment amount
      const amount = paymentData.transaction_amount;

      // Calculate subscription duration based on amount
      // Base price is R$250 for 30 days
      const baseDays = 30;
      const daysPerAmount = baseDays / 250;
      const subscriptionDays = Math.floor(amount * daysPerAmount);

      // Calculate expiry date
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + subscriptionDays);

      // Update user subscription status
      await pool.query(
        `UPDATE users SET 
          subscription_status = 'active', 
          subscription_expiry = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
        [expiryDate, userId]
      );

      // Record payment
      await pool.query(
        `INSERT INTO subscription_payments (
          user_id, amount, payment_id, status, payment_date, expiry_date
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)`,
        [userId, amount, data.id, 'approved', expiryDate]
      );

      console.log('✅ Subscription payment processed successfully');
    } else if (external_reference.startsWith('agenda_')) {
      // Handle agenda subscription payment
      const professionalId = external_reference.split('_')[1];

      // Get payment amount
      const amount = paymentData.transaction_amount;

      // Calculate subscription duration based on amount
      // Fixed price is R$49.90 for 30 days
      const subscriptionDays = 30;

      // Calculate expiry date
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + subscriptionDays);

      // Record payment
      await pool.query(
        `INSERT INTO agenda_payments (
          professional_id, amount, payment_id, status, payment_date, expiry_date
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)`,
        [professionalId, amount, data.id, 'approved', expiryDate]
      );

      console.log('✅ Agenda subscription payment processed successfully');
    } else if (external_reference.startsWith('payment_')) {
      // Handle professional payment to clinic
      const professionalId = external_reference.split('_')[1];

      // Get payment amount
      const amount = paymentData.transaction_amount;

      // Record payment
      await pool.query(
        `INSERT INTO professional_payments (
          professional_id, amount, payment_id, status, payment_date
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [professionalId, amount, data.id, 'approved']
      );

      console.log('✅ Professional payment processed successfully');
    } else {
      console.log('⚠️ Unknown external reference format:', external_reference);
    }

    // Return success
    res.status(200).json({ message: 'Payment processed successfully', payment: paymentData });
  } catch (error) {
    console.error('❌ Error processing MercadoPago webhook:', error);
    res.status(500).json({ message: 'Error processing webhook', error: error.message });
  }
});

// Agenda patients routes
app.get('/api/agenda/patients', authenticate, authorize(['professional', 'clinic']), async (req, res) => {
  try {
    const includeArchived = req.query.include_archived === 'true';
    
    let query;
    let params = [];
    
    if (req.user.currentRole === 'professional') {
      // Professionals can only see their own patients
      query = `
        SELECT p.*, 
               CASE WHEN u.subscription_status = 'active' THEN true ELSE false END as is_convenio_patient
        FROM (
          -- Get patients from consultations
          SELECT DISTINCT 
            CASE WHEN c.dependent_id IS NULL THEN c.client_id ELSE d.id END as id,
            CASE WHEN c.dependent_id IS NULL THEN u.name ELSE d.name END as name,
            CASE WHEN c.dependent_id IS NULL THEN u.cpf ELSE d.cpf END as cpf,
            CASE WHEN c.dependent_id IS NULL THEN u.email ELSE NULL END as email,
            CASE WHEN c.dependent_id IS NULL THEN u.phone ELSE NULL END as phone,
            CASE WHEN c.dependent_id IS NULL THEN u.birth_date ELSE d.birth_date END as birth_date,
            CASE WHEN c.dependent_id IS NULL THEN u.address ELSE NULL END as address,
            CASE WHEN c.dependent_id IS NULL THEN u.address_number ELSE NULL END as address_number,
            CASE WHEN c.dependent_id IS NULL THEN u.address_complement ELSE NULL END as address_complement,
            CASE WHEN c.dependent_id IS NULL THEN u.neighborhood ELSE NULL END as neighborhood,
            CASE WHEN c.dependent_id IS NULL THEN u.city ELSE NULL END as city,
            CASE WHEN c.dependent_id IS NULL THEN u.state ELSE NULL END as state,
            c.created_at as linked_at,
            '' as notes,
            false as is_archived,
            CASE WHEN c.dependent_id IS NULL THEN true ELSE true END as is_convenio_patient,
            c.professional_id
          FROM consultations c
          LEFT JOIN users u ON c.client_id = u.id
          LEFT JOIN dependents d ON c.dependent_id = d.id
          WHERE c.professional_id = $1
          
          UNION
          
          -- Get patients from appointments
          SELECT 
            a.patient_id as id,
            p.name,
            p.cpf,
            p.email,
            p.phone,
            p.birth_date,
            p.address,
            p.address_number,
            p.address_complement,
            p.neighborhood,
            p.city,
            p.state,
            p.created_at as linked_at,
            p.notes,
            p.is_archived,
            false as is_convenio_patient,
            a.professional_id
          FROM appointments a
          JOIN (
            SELECT * FROM agenda_patients WHERE professional_id = $1
          ) p ON a.patient_id = p.id
          WHERE a.professional_id = $1
        ) p
        LEFT JOIN users u ON p.id = u.id
        ${includeArchived ? '' : 'WHERE p.is_archived = false'}
        ORDER BY p.name
      `;
      params = [req.user.id];
    } else if (req.user.currentRole === 'clinic') {
      // Clinics can see all patients from their professionals
      query = `
        SELECT p.*, 
               CASE WHEN u.subscription_status = 'active' THEN true ELSE false END as is_convenio_patient,
               p.professional_id,
               prof.name as professional_name
        FROM (
          -- Get patients from consultations
          SELECT DISTINCT 
            CASE WHEN c.dependent_id IS NULL THEN c.client_id ELSE d.id END as id,
            CASE WHEN c.dependent_id IS NULL THEN u.name ELSE d.name END as name,
            CASE WHEN c.dependent_id IS NULL THEN u.cpf ELSE d.cpf END as cpf,
            CASE WHEN c.dependent_id IS NULL THEN u.email ELSE NULL END as email,
            CASE WHEN c.dependent_id IS NULL THEN u.phone ELSE NULL END as phone,
            CASE WHEN c.dependent_id IS NULL THEN u.birth_date ELSE d.birth_date END as birth_date,
            c.professional_id,
            CASE WHEN c.dependent_id IS NULL THEN true ELSE true END as is_convenio_patient
          FROM consultations c
          LEFT JOIN users u ON c.client_id = u.id
          LEFT JOIN dependents d ON c.dependent_id = d.id
          
          UNION
          
          -- Get patients from appointments
          SELECT 
            a.patient_id as id,
            p.name,
            p.cpf,
            p.email,
            p.phone,
            p.birth_date,
            a.professional_id,
            false as is_convenio_patient
          FROM appointments a
          JOIN agenda_patients p ON a.patient_id = p.id
        ) p
        LEFT JOIN users u ON p.id = u.id
        JOIN users prof ON p.professional_id = prof.id
        ORDER BY p.name
      `;
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching agenda patients:', error);
    res.status(500).json({ message: 'Erro ao buscar pacientes da agenda' });
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
    
    // Check if patient already exists
    const patientExists = await pool.query(
      'SELECT * FROM agenda_patients WHERE cpf = $1 AND professional_id = $2',
      [cpf.replace(/\D/g, ''), req.user.id]
    );
    
    if (patientExists.rows.length > 0) {
      return res.status(400).json({ message: 'Paciente já cadastrado com este CPF' });
    }
    
    // Insert new patient
    const result = await pool.query(
      `INSERT INTO agenda_patients (
        professional_id, name, cpf, email, phone, birth_date, 
        address, address_number, address_complement, neighborhood, city, state, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        req.user.id,
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
        notes
      ]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating agenda patient:', error);
    res.status(500).json({ message: 'Erro ao criar paciente da agenda' });
  }
});

app.put('/api/agenda/patients/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    // Find patient
    const patientResult = await pool.query(
      'SELECT * FROM agenda_patients WHERE id = $1',
      [id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    const patient = patientResult.rows[0];
    
    // Check if user is updating their own patient
    if (req.user.id !== patient.professional_id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Update patient
    const result = await pool.query(
      `UPDATE agenda_patients SET
        notes = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *`,
      [notes, id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating agenda patient:', error);
    res.status(500).json({ message: 'Erro ao atualizar paciente da agenda' });
  }
});

app.put('/api/agenda/patients/:id/archive', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_archived } = req.body;
    
    // Find patient
    const patientResult = await pool.query(
      'SELECT * FROM agenda_patients WHERE id = $1',
      [id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    const patient = patientResult.rows[0];
    
    // Check if user is updating their own patient
    if (req.user.id !== patient.professional_id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Update patient
    const result = await pool.query(
      `UPDATE agenda_patients SET
        is_archived = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *`,
      [is_archived, id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error archiving agenda patient:', error);
    res.status(500).json({ message: 'Erro ao arquivar paciente da agenda' });
  }
});

app.get('/api/agenda/patients/lookup/:cpf', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.params;
    
    // Find patient
    const result = await pool.query(
      'SELECT * FROM agenda_patients WHERE cpf = $1 AND professional_id = $2',
      [cpf.replace(/\D/g, ''), req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up agenda patient:', error);
    res.status(500).json({ message: 'Erro ao buscar paciente da agenda' });
  }
});

// Appointments routes
app.get('/api/agenda/appointments', authenticate, authorize(['professional', 'clinic']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data de início e fim são obrigatórias' });
    }
    
    let query;
    let params = [];
    
    if (req.user.currentRole === 'professional') {
      // Professionals can only see their own appointments
      query = `
        SELECT a.*, p.name as patient_name, p.phone as patient_phone, p.is_convenio_patient
        FROM appointments a
        JOIN agenda_patients p ON a.patient_id = p.id
        WHERE a.professional_id = $1
          AND a.date BETWEEN $2 AND $3
        ORDER BY a.date
      `;
      params = [req.user.id, start_date, end_date];
    } else if (req.user.currentRole === 'clinic') {
      // Clinics can see appointments for a specific professional
      const { professional_id } = req.query;
      
      if (!professional_id) {
        return res.status(400).json({ message: 'ID do profissional é obrigatório' });
      }
      
      query = `
        SELECT a.*, p.name as patient_name, p.phone as patient_phone, p.is_convenio_patient,
               u.name as professional_name
        FROM appointments a
        JOIN agenda_patients p ON a.patient_id = p.id
        JOIN users u ON a.professional_id = u.id
        WHERE a.professional_id = $1
          AND a.date BETWEEN $2 AND $3
        ORDER BY a.date
      `;
      params = [professional_id, start_date, end_date];
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro ao buscar agendamentos' });
  }
});

app.post('/api/agenda/appointments', authenticate, authorize(['professional', 'clinic']), async (req, res) => {
  try {
    const { 
      patient_id, 
      professional_id, 
      date, 
      status = 'scheduled',
      notes,
      location_id
    } = req.body;
    
    // Validate required fields
    if (!patient_id || !date) {
      return res.status(400).json({ message: 'ID do paciente e data são obrigatórios' });
    }
    
    // Determine professional ID
    const actualProfessionalId = professional_id || req.user.id;
    
    // Check if patient exists
    const patientResult = await pool.query(
      'SELECT * FROM agenda_patients WHERE id = $1',
      [patient_id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    // Insert appointment
    const result = await pool.query(
      `INSERT INTO appointments (
        patient_id, professional_id, date, status, notes, location_id
      ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [patient_id, actualProfessionalId, date, status, notes, location_id]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erro ao criar agendamento' });
  }
});

// Schedule config routes
app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Find schedule config
    const result = await pool.query(
      'SELECT * FROM schedule_config WHERE professional_id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      // Create default schedule config
      const defaultConfig = await pool.query(
        `INSERT INTO schedule_config (
          professional_id, 
          monday_start, monday_end,
          tuesday_start, tuesday_end,
          wednesday_start, wednesday_end,
          thursday_start, thursday_end,
          friday_start, friday_end,
          saturday_start, saturday_end,
          sunday_start, sunday_end,
          slot_duration, break_start, break_end
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
        [
          req.user.id,
          '08:00', '18:00',
          '08:00', '18:00',
          '08:00', '18:00',
          '08:00', '18:00',
          '08:00', '18:00',
          null, null,
          null, null,
          30, '12:00', '13:00'
        ]
      );
      
      return res.json(defaultConfig.rows[0]);
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching schedule config:', error);
    res.status(500).json({ message: 'Erro ao buscar configuração de agenda' });
  }
});

// Professional locations routes
app.get('/api/professional-locations', authenticate, authorize(['professional', 'clinic']), async (req, res) => {
  try {
    let query;
    let params = [];
    
    if (req.user.currentRole === 'professional') {
      // Professionals can only see their own locations
      query = 'SELECT * FROM professional_locations WHERE professional_id = $1 ORDER BY is_main DESC, clinic_name';
      params = [req.user.id];
    } else if (req.user.currentRole === 'clinic') {
      // Clinics can see locations for all their professionals
      query = `
        SELECT l.*, u.name as professional_name
        FROM professional_locations l
        JOIN users u ON l.professional_id = u.id
        ORDER BY l.professional_id, l.is_main DESC, l.clinic_name
      `;
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching professional locations:', error);
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
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating professional location:', error);
    res.status(500).json({ message: 'Erro ao criar local de atendimento' });
  }
});

// Medical records routes
app.get('/api/medical-records/patient/:patientId', authenticate, async (req, res) => {
  try {
    const { patientId } = req.params;
    
    let query;
    let params = [];
    
    if (req.user.currentRole === 'professional') {
      // Professionals can only see medical records they created
      query = `
        SELECT m.*, 
               c.date as consultation_date, 
               s.name as service_name,
               CASE WHEN c.dependent_id IS NULL THEN u.name ELSE d.name END as patient_name,
               CASE WHEN c.dependent_id IS NULL THEN u.cpf ELSE d.cpf END as patient_cpf,
               p.name as professional_name,
               p.professional_registration
        FROM medical_records m
        JOIN consultations c ON m.consultation_id = c.id
        JOIN services s ON c.service_id = s.id
        LEFT JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        JOIN users p ON m.professional_id = p.id
        WHERE m.patient_id = $1 AND m.professional_id = $2
        ORDER BY c.date DESC
      `;
      params = [patientId, req.user.id];
    } else if (req.user.currentRole === 'clinic') {
      // Clinics can see all medical records
      query = `
        SELECT m.*, 
               c.date as consultation_date, 
               s.name as service_name,
               CASE WHEN c.dependent_id IS NULL THEN u.name ELSE d.name END as patient_name,
               CASE WHEN c.dependent_id IS NULL THEN u.cpf ELSE d.cpf END as patient_cpf,
               p.name as professional_name,
               p.professional_registration
        FROM medical_records m
        JOIN consultations c ON m.consultation_id = c.id
        JOIN services s ON c.service_id = s.id
        LEFT JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        JOIN users p ON m.professional_id = p.id
        WHERE m.patient_id = $1
        ORDER BY c.date DESC
      `;
      params = [patientId];
    } else {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching medical records:', error);
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
    
    // Find latest consultation for this patient and professional
    const consultationResult = await pool.query(
      `SELECT c.id 
       FROM consultations c
       LEFT JOIN dependents d ON c.dependent_id = d.id
       WHERE (
         (c.client_id = $1 AND c.dependent_id IS NULL) OR
         (c.dependent_id = $1) OR
         (d.id = $1)
       )
       AND c.professional_id = $2
       ORDER BY c.date DESC
       LIMIT 1`,
      [patient_id, req.user.id]
    );
    
    if (consultationResult.rows.length === 0) {
      return res.status(404).json({ message: 'Nenhuma consulta encontrada para este paciente' });
    }
    
    const consultation_id = consultationResult.rows[0].id;
    
    // Insert medical record
    const result = await pool.query(
      `INSERT INTO medical_records (
        consultation_id, patient_id, professional_id, chief_complaint, anamnesis,
        physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        consultation_id,
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
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating medical record:', error);
    res.status(500).json({ message: 'Erro ao criar prontuário' });
  }
});

// Document generation routes
app.get('/api/document-templates', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM document_templates ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching document templates:', error);
    res.status(500).json({ message: 'Erro ao buscar templates de documentos' });
  }
});

app.get('/api/generated-documents/patient/:patientId', authenticate, async (req, res) => {
  try {
    const { patientId } = req.params;
    
    let query;
    let params = [];
    
    if (req.user.currentRole === 'professional') {
      // Professionals can only see documents they generated
      query = `
        SELECT g.*, t.name as template_name, p.name as patient_name
        FROM generated_documents g
        LEFT JOIN document_templates t ON g.template_id = t.id
        LEFT JOIN (
          SELECT id, name FROM users
          UNION
          SELECT id, name FROM dependents
          UNION
          SELECT id, name FROM agenda_patients
        ) p ON g.patient_id = p.id
        WHERE g.patient_id = $1 AND g.professional_id = $2
        ORDER BY g.created_at DESC
      `;
      params = [patientId, req.user.id];
    } else if (req.user.currentRole === 'clinic') {
      // Clinics can see all documents
      query = `
        SELECT g.*, t.name as template_name, p.name as patient_name
        FROM generated_documents g
        LEFT JOIN document_templates t ON g.template_id = t.id
        LEFT JOIN (
          SELECT id, name FROM users
          UNION
          SELECT id, name FROM dependents
          UNION
          SELECT id, name FROM agenda_patients
        ) p ON g.patient_id = p.id
        WHERE g.patient_id = $1
        ORDER BY g.created_at DESC
      `;
      params = [patientId];
    } else {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching generated documents:', error);
    res.status(500).json({ message: 'Erro ao buscar documentos gerados' });
  }
});

// Image upload route
app.post('/api/upload-image', authenticate, async (req, res) => {
  try {
    const processUpload = uploadMiddleware.processUpload('image');
    await processUpload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ message: err.message });
      }
      
      if (!req.cloudinaryResult) {
        return res.status(400).json({ message: 'Nenhuma imagem enviada' });
      }
      
      res.json({ 
        imageUrl: req.cloudinaryResult.secure_url,
        publicId: req.cloudinaryResult.public_id
      });
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ message: 'Erro ao fazer upload da imagem' });
  }
});

// Report routes
app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data de início e fim são obrigatórias' });
    }
    
    // Get total revenue
    const totalRevenueResult = await pool.query(
      'SELECT SUM(value) as total_revenue FROM consultations WHERE date BETWEEN $1 AND $2',
      [start_date, end_date]
    );
    
    const totalRevenue = parseFloat(totalRevenueResult.rows[0].total_revenue || 0);
    
    // Get revenue by professional
    const revenueByProfessionalResult = await pool.query(`
      SELECT 
        p.id as professional_id,
        p.name as professional_name,
        p.percentage as professional_percentage,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue,
        SUM(c.value * p.percentage / 100) as professional_payment,
        SUM(c.value * (100 - p.percentage) / 100) as clinic_revenue
      FROM consultations c
      JOIN users p ON c.professional_id = p.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY p.id, p.name, p.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);
    
    // Get revenue by service
    const revenueByServiceResult = await pool.query(`
      SELECT 
        s.id as service_id,
        s.name as service_name,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY s.id, s.name
      ORDER BY revenue DESC
    `, [start_date, end_date]);
    
    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: revenueByProfessionalResult.rows,
      revenue_by_service: revenueByServiceResult.rows
    });
  } catch (error) {
    console.error('Error generating revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de faturamento' });
  }
});

app.get('/api/reports/professional-revenue', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data de início e fim são obrigatórias' });
    }
    
    // Get professional percentage
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [req.user.id]
    );
    
    const percentage = professionalResult.rows[0]?.percentage || 50;
    
    // Get consultations
    const consultationsResult = await pool.query(`
      SELECT 
        c.id,
        c.date,
        CASE 
          WHEN c.dependent_id IS NULL THEN u.name 
          ELSE d.name 
        END as client_name,
        s.name as service_name,
        c.value as total_value,
        c.value * (100 - $3) / 100 as amount_to_pay
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN services s ON c.service_id = s.id
      WHERE c.professional_id = $1 AND c.date BETWEEN $2 AND $3
      ORDER BY c.date DESC
    `, [req.user.id, start_date, end_date, percentage]);
    
    // Calculate summary
    const consultations = consultationsResult.rows;
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const amountToPay = consultations.reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0);
    
    res.json({
      summary: {
        professional_percentage: percentage,
        total_revenue: totalRevenue,
        consultation_count: consultations.length,
        amount_to_pay: amountToPay
      },
      consultations
    });
  } catch (error) {
    console.error('Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de faturamento do profissional' });
  }
});

// Clinic routes
app.get('/api/clinic/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.professional_registration, u.photo_url,
             u.percentage, u.category_id, c.name as category_name,
             u.professional_type, u.is_active
      FROM users u
      LEFT JOIN service_categories c ON u.category_id = c.id
      WHERE $1 = ANY(u.roles)
      ORDER BY u.name
    `, ['professional']);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic professionals:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais da clínica' });
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
      SELECT COUNT(*) as total, 
             SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active
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
      SELECT SUM(c.value * (100 - p.percentage) / 100) as pending
      FROM consultations c
      JOIN users p ON c.professional_id = p.id
      WHERE c.date BETWEEN $1 AND $2
    `, [firstDay, lastDay]);
    
    res.json({
      total_professionals: parseInt(professionalsResult.rows[0].total) || 0,
      active_professionals: parseInt(professionalsResult.rows[0].active) || 0,
      total_consultations: parseInt(consultationsResult.rows[0].count) || 0,
      monthly_revenue: parseFloat(consultationsResult.rows[0].revenue) || 0,
      pending_payments: parseFloat(paymentsResult.rows[0].pending) || 0
    });
  } catch (error) {
    console.error('Error fetching clinic stats:', error);
    res.status(500).json({ message: 'Erro ao buscar estatísticas da clínica' });
  }
});

// Webhook routes
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    const { type, data } = req.body;
    
    console.log('🔔 Received webhook:', { type, data });
    
    if (type === 'payment' && data.id) {
      const paymentId = data.id;
      
      // Get payment details from MercadoPago
      const payment = await MercadoPago.payment.findById(paymentId);
      
      if (!payment || !payment.body) {
        return res.status(400).json({ message: 'Pagamento não encontrado' });
      }
      
      const { status, external_reference, transaction_amount, date_approved } = payment.body;
      
      console.log('💰 Payment details:', { status, external_reference, transaction_amount, date_approved });
      
      // Process payment based on external_reference
      if (external_reference) {
        if (external_reference.startsWith('agenda_')) {
          // Agenda subscription payment
          const parts = external_reference.split('_');
          const professionalId = parseInt(parts[1]);
          
          if (status === 'approved') {
            // Calculate expiry date (30 days from approval)
            const approvalDate = new Date(date_approved);
            const expiryDate = new Date(approvalDate);
            expiryDate.setDate(expiryDate.getDate() + 30);
            
            // Update agenda_payments record
            await pool.query(
              `UPDATE agenda_payments SET
                status = 'active',
                payment_id = $1,
                payment_date = $2,
                expiry_date = $3,
                updated_at = CURRENT_TIMESTAMP
              WHERE professional_id = $4 AND status = 'pending'
              ORDER BY created_at DESC
              LIMIT 1`,
              [paymentId.toString(), approvalDate, expiryDate, professionalId]
            );
            
            console.log('✅ Agenda subscription payment processed successfully');
          }
        } else if (external_reference.startsWith('prof_payment_')) {
          // Professional payment to clinic
          const parts = external_reference.split('_');
          const professionalId = parseInt(parts[2]);
          
          if (status === 'approved') {
            // Record payment in a professional_payments table if needed
            console.log('✅ Professional payment processed successfully');
          }
        } else if (external_reference.startsWith('subscription_')) {
          // Client subscription payment
          const parts = external_reference.split('_');
          const userId = parseInt(parts[1]);
          
          if (status === 'approved') {
            // Calculate expiry date (30 days from approval)
            const approvalDate = new Date(date_approved);
            const expiryDate = new Date(approvalDate);
            expiryDate.setDate(expiryDate.getDate() + 30);
            
            // Update user subscription status
            await pool.query(
              `UPDATE users SET
                subscription_status = 'active',
                subscription_expiry = $1,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = $2`,
              [expiryDate, userId]
            );
            
            // Update subscription_payments record
            await pool.query(
              `UPDATE subscription_payments SET
                status = 'active',
                payment_id = $1,
                payment_date = $2,
                expiry_date = $3,
                updated_at = CURRENT_TIMESTAMP
              WHERE user_id = $4 AND status = 'pending'
              ORDER BY created_at DESC
              LIMIT 1`,
              [paymentId.toString(), approvalDate, expiryDate, userId]
            );
            
            console.log('✅ Client subscription payment processed successfully');
          }
        }
      }
    }
    
    res.status(200).json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ message: 'Erro ao processar webhook' });
  }
});

// Document generation route
app.post('/api/generate-document', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { 
      template_id, 
      patient_id, 
      professional_id,
      ...templateData
    } = req.body;
    
    // Validate required fields
    if (!template_id || !patient_id) {
      return res.status(400).json({ message: 'ID do template e do paciente são obrigatórios' });
    }
    
    // Get template
    const templateResult = await pool.query(
      'SELECT * FROM document_templates WHERE id = $1',
      [template_id]
    );
    
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ message: 'Template não encontrado' });
    }
    
    const template = templateResult.rows[0];
    
    // Get patient data
    let patientData;
    
    // Try to find in users table (clients)
    const clientResult = await pool.query(
      'SELECT name, cpf, email, phone, address, address_number, address_complement, neighborhood, city, state FROM users WHERE id = $1',
      [patient_id]
    );
    
    if (clientResult.rows.length > 0) {
      patientData = clientResult.rows[0];
    } else {
      // Try to find in dependents table
      const dependentResult = await pool.query(
        'SELECT name, cpf, birth_date FROM dependents WHERE id = $1',
        [patient_id]
      );
      
      if (dependentResult.rows.length > 0) {
        patientData = dependentResult.rows[0];
      } else {
        // Try to find in agenda_patients table
        const agendaPatientResult = await pool.query(
          'SELECT name, cpf, email, phone, birth_date, address, address_number, address_complement, neighborhood, city, state FROM agenda_patients WHERE id = $1',
          [patient_id]
        );
        
        if (agendaPatientResult.rows.length > 0) {
          patientData = agendaPatientResult.rows[0];
        } else {
          return res.status(404).json({ message: 'Paciente não encontrado' });
        }
      }
    }
    
    // Get professional data
    const professionalResult = await pool.query(
      'SELECT name, professional_registration, signature_url FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    const professionalData = professionalResult.rows[0];
    
    // Prepare template data
    const now = new Date();
    const templateContext = {
      ...patientData,
      ...templateData,
      profissional_nome: professionalData.name,
      profissional_registro: professionalData.professional_registration,
      profissional_assinatura: professionalData.signature_url,
      data_atual: format(now, 'dd/MM/yyyy'),
      hora_atual: format(now, 'HH:mm')
    };
    
    // Compile template
    const compiledTemplate = Handlebars.compile(template.content);
    const html = compiledTemplate(templateContext);
    
    // Generate PDF
    // For this example, we'll just return the HTML and URL
    // In a real implementation, you would generate a PDF and upload it to a storage service
    
    // Generate a unique filename
    const filename = `${template.type}_${patient_id}_${Date.now()}.pdf`;
    const url = `https://example.com/documents/${filename}`;
    
    // Save document record
    const documentResult = await pool.query(
      `INSERT INTO generated_documents (
        patient_id, professional_id, template_id, type, url
      ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [patient_id, req.user.id, template_id, template.type, url]
    );
    
    res.json({
      document: documentResult.rows[0],
      html,
      url
    });
  } catch (error) {
    console.error('Error generating document:', error);
    res.status(500).json({ message: 'Erro ao gerar documento' });
  }
});

// Create agenda_patients table if it doesn't exist
const createAgendaPatientsTable = async () => {
  try {
    // Check if table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'agenda_patients'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('⚠️ agenda_patients table does not exist, creating it...');
      
      await pool.query(`
        CREATE TABLE agenda_patients (
          id SERIAL PRIMARY KEY,
          professional_id INT NOT NULL REFERENCES users(id),
          name VARCHAR(255) NOT NULL,
          cpf VARCHAR(11) NOT NULL,
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
          is_archived BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(professional_id, cpf)
        )
      `);
      
      console.log('✅ agenda_patients table created successfully');
    }
  } catch (error) {
    console.error('❌ Error creating agenda_patients table:', error);
  }
};

// Run agenda_patients table creation
createAgendaPatientsTable();

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});