// 🔥 COMPLETE BACKEND WITH DATABASE TABLES AND MERCADOPAGO SDK V2 INTEGRATION
// Import required modules
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import { v2 as cloudinary } from 'cloudinary';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { authenticate, authorize } from './middleware/auth.js';
import createUploadMiddleware from './middleware/upload.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import handlebars from 'handlebars';
import puppeteer from 'puppeteer';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { format } from 'date-fns';
import handlebars from 'handlebars';
import puppeteer from 'puppeteer';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  const { upload: uploadMiddleware, processUpload } = createUploadMiddleware();
  upload = { single: processUpload };
}));
app.use(express.json());
app.use(cookieParser());

// Create upload middleware
const { upload, processUpload } = createUpload();
try {
  upload = createUpload();
} catch (error) {
  console.error('❌ Failed to create upload middleware:', error);
}

// Database initialization - Create tables if they don't exist
const initializeDatabase = async () => {
  try {
    console.log('🔄 Initializing database...');
    
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
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_expiry DATE,
        professional_registration VARCHAR(50),
        photo_url TEXT,
        clinic_id INT,
        professional_type VARCHAR(20),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Users table created or already exists');
    
    // Create service_categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Service categories table created or already exists');
    
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
      );
    `);
    console.log('✅ Services table created or already exists');
    
    // Create consultations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INT REFERENCES users(id),
        dependent_id INT,
        professional_id INT REFERENCES users(id) NOT NULL,
        service_id INT REFERENCES services(id) NOT NULL,
        value DECIMAL(10, 2) NOT NULL,
        date TIMESTAMP NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Consultations table created or already exists');
    
    // Create dependents table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dependents (
        id SERIAL PRIMARY KEY,
        client_id INT REFERENCES users(id) NOT NULL,
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) UNIQUE NOT NULL,
        birth_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Dependents table created or already exists');
    
    // Create professional_locations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_locations (
        id SERIAL PRIMARY KEY,
        professional_id INT REFERENCES users(id) NOT NULL,
        clinic_name VARCHAR(255) NOT NULL,
        address VARCHAR(255) NOT NULL,
        address_number VARCHAR(20) NOT NULL,
        address_complement VARCHAR(255),
        neighborhood VARCHAR(255) NOT NULL,
        city VARCHAR(255) NOT NULL,
        state VARCHAR(2) NOT NULL,
        phone VARCHAR(20),
        is_main BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Professional locations table created or already exists');
    
    // Create agenda_subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INT REFERENCES users(id) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMP,
        payment_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Agenda subscriptions table created or already exists');
    
    // Create schedule_configs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_configs (
        id SERIAL PRIMARY KEY,
        professional_id INT REFERENCES users(id) NOT NULL,
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
      );
    `);
    console.log('✅ Schedule configs table created or already exists');
    
    // Create appointments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INT REFERENCES users(id) NOT NULL,
        patient_id INT NOT NULL,
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Appointments table created or already exists');
    
    // Create agenda_patients table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_patients (
        id SERIAL PRIMARY KEY,
        professional_id INT REFERENCES users(id) NOT NULL,
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) NOT NULL,
        phone VARCHAR(20),
        email VARCHAR(255),
        birth_date DATE,
        address VARCHAR(255),
        address_number VARCHAR(20),
        address_complement VARCHAR(255),
        neighborhood VARCHAR(255),
        city VARCHAR(255),
        state VARCHAR(2),
        notes TEXT,
        is_archived BOOLEAN DEFAULT false,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Agenda patients table created or already exists');
    
    // Create medical_records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INT,
        patient_id INT NOT NULL,
        professional_id INT REFERENCES users(id) NOT NULL,
        chief_complaint TEXT,
        anamnesis TEXT,
        physical_examination TEXT,
        diagnosis TEXT,
        treatment_plan TEXT,
        clinical_evolution TEXT,
        internal_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Medical records table created or already exists');
    
    // Create payments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) NOT NULL,
        payment_type VARCHAR(50) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        payment_id VARCHAR(255),
        payment_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Payments table created or already exists');
    
    // Create clinic_professionals table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clinic_professionals (
        id SERIAL PRIMARY KEY,
        clinic_id INT REFERENCES users(id) NOT NULL,
        professional_id INT REFERENCES users(id) NOT NULL,
        percentage INT DEFAULT 50,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(clinic_id, professional_id)
      );
    `);
    console.log('✅ Clinic professionals table created or already exists');
    
    console.log('✅ Database initialization complete');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
};

// Initialize database on startup
initializeDatabase();

// ===== AUTHENTICATION ROUTES =====

// Register route
app.post('/api/auth/register', async (req, res) => {
  try {
    const { 
      name, cpf, email, phone, birth_date, address, address_number, 
      address_complement, neighborhood, city, state, password 
    } = req.body;
    
    // Validate required fields
    if (!name || !cpf || !password) {
      return res.status(400).json({ message: 'Nome, CPF e senha são obrigatórios' });
    }
    
    // Check if user already exists
    const userCheck = await pool.query('SELECT * FROM users WHERE cpf = $1', [cpf]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create user
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, password, roles
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, hashedPassword, ['client']
      ]
    );
    
    const user = result.rows[0];
    
    // Create JWT token
    const token = jwt.sign(
      { id: user.id, currentRole: 'client' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Return user data (without password)
    delete user.password;
    user.currentRole = 'client';
    
    res.status(201).json({
      message: 'Usuário registrado com sucesso',
      token,
      user
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Erro ao registrar usuário' });
  }
});

// Login route
app.post('/api/auth/login', async (req, res) => {
  try {
    const { cpf, password } = req.body;
    
    // Validate input
    if (!cpf || !password) {
      return res.status(400).json({ message: 'CPF e senha são obrigatórios' });
    }
    
    // Find user
    const result = await pool.query('SELECT * FROM users WHERE cpf = $1', [cpf]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }
    
    const user = result.rows[0];
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }
    
    // Create JWT token with first role as default
    const token = jwt.sign(
      { id: user.id, currentRole: user.roles[0] },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Return user data (without password)
    delete user.password;
    user.currentRole = user.roles[0];
    
    res.json({
      message: 'Login bem-sucedido',
      token,
      user
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Erro ao fazer login' });
  }
});

// Select role route
app.post('/api/auth/select-role', async (req, res) => {
  try {
    const { userId, role } = req.body;
    
    // Validate input
    if (!userId || !role) {
      return res.status(400).json({ message: 'ID do usuário e role são obrigatórios' });
    }
    
    // Find user
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    const user = result.rows[0];
    
    // Check if user has the requested role
    if (!user.roles.includes(role)) {
      return res.status(403).json({ message: 'Usuário não possui esta role' });
    }
    
    // Create JWT token with selected role
    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Return user data (without password)
    delete user.password;
    user.currentRole = role;
    
    res.json({
      message: 'Role selecionada com sucesso',
      token,
      user
    });
  } catch (error) {
    console.error('Role selection error:', error);
    res.status(500).json({ message: 'Erro ao selecionar role' });
  }
});

// Switch role route
app.post('/api/auth/switch-role', authenticate, async (req, res) => {
  try {
    const { role } = req.body;
    
    // Validate input
    if (!role) {
      return res.status(400).json({ message: 'Role é obrigatória' });
    }
    
    // Find user
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    const user = result.rows[0];
    
    // Check if user has the requested role
    if (!user.roles.includes(role)) {
      return res.status(403).json({ message: 'Usuário não possui esta role' });
    }
    
    // Create JWT token with selected role
    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Return user data (without password)
    delete user.password;
    user.currentRole = role;
    
    res.json({
      message: 'Role alterada com sucesso',
      token,
      user
    });
  } catch (error) {
    console.error('Role switch error:', error);
    res.status(500).json({ message: 'Erro ao trocar role' });
  }
});

// Logout route
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout bem-sucedido' });
});

// ===== USER ROUTES =====

// Get all users (admin only)
app.get('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY name');
    
    // Remove passwords from response
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

// Get user by ID
app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Only allow users to access their own data unless they're admins
    if (req.user.id !== parseInt(id) && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Remove password from response
    const user = result.rows[0];
    delete user.password;
    
    res.json(user);
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
    
    // Validate required fields
    if (!name || !cpf || !password || !roles || roles.length === 0) {
      return res.status(400).json({ message: 'Nome, CPF, senha e pelo menos uma role são obrigatórios' });
    }
    
    // Check if user already exists
    const userCheck = await pool.query('SELECT * FROM users WHERE cpf = $1', [cpf]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create user
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, password, roles,
        percentage, category_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, hashedPassword, roles,
        percentage, category_id
      ]
    );
    
    // Return user data (without password)
    const user = result.rows[0];
    delete user.password;
    
    res.status(201).json(user);
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
    
    // Only allow users to update their own data unless they're admins
    if (req.user.id !== parseInt(id) && req.user.currentRole !== 'admin') {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if user exists
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
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
        name, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, roles,
        percentage, category_id, id
      ]
    );
    
    // Return updated user data (without password)
    const user = result.rows[0];
    delete user.password;
    
    res.json(user);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Erro ao atualizar usuário' });
  }
});

// Change password
app.put('/api/users/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Senha atual e nova senha são obrigatórias' });
    }
    
    // Get user
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    const user = result.rows[0];
    
    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Senha atual incorreta' });
    }
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update password
    await pool.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, req.user.id]
    );
    
    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Erro ao alterar senha' });
  }
});

// Delete user (admin only)
app.delete('/api/users/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user exists
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Delete user
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    
    res.json({ message: 'Usuário excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Erro ao excluir usuário' });
  }
});

// Activate client subscription
app.put('/api/users/:id/activate', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { expiry_date } = req.body;
    
    // Validate input
    if (!expiry_date) {
      return res.status(400).json({ message: 'Data de expiração é obrigatória' });
    }
    
    // Check if user exists
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Update subscription status
    const result = await pool.query(
      `UPDATE users SET 
        subscription_status = 'active',
        subscription_expiry = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *`,
      [expiry_date, id]
    );
    
    // Return updated user data (without password)
    const user = result.rows[0];
    delete user.password;
    
    res.json(user);
  } catch (error) {
    console.error('Error activating subscription:', error);
    res.status(500).json({ message: 'Erro ao ativar assinatura' });
  }
});

// ===== SERVICE CATEGORIES ROUTES =====

// Get all service categories
app.get('/api/service-categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM service_categories ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching service categories:', error);
    res.status(500).json({ message: 'Erro ao buscar categorias de serviço' });
  }
});

// Create service category (admin only)
app.post('/api/service-categories', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description } = req.body;
    
    // Validate input
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

// ===== SERVICES ROUTES =====

// Get all services
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

// Create service (admin only)
app.post('/api/services', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description, base_price, category_id, is_base_service } = req.body;
    
    // Validate input
    if (!name || !base_price) {
      return res.status(400).json({ message: 'Nome e preço base são obrigatórios' });
    }
    
    // Create service
    const result = await pool.query(
      `INSERT INTO services (name, description, base_price, category_id, is_base_service)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description, base_price, category_id, is_base_service]
    );
    
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
    
    // Check if service exists
    const serviceCheck = await pool.query('SELECT * FROM services WHERE id = $1', [id]);
    if (serviceCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }
    
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
    
    // Check if service exists
    const serviceCheck = await pool.query('SELECT * FROM services WHERE id = $1', [id]);
    if (serviceCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }
    
    // Delete service
    await pool.query('DELETE FROM services WHERE id = $1', [id]);
    
    res.json({ message: 'Serviço excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ message: 'Erro ao excluir serviço' });
  }
});

// ===== CONSULTATIONS ROUTES =====

// Get all consultations
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query;
    let params = [];
    
    // Different queries based on user role
    if (req.user.currentRole === 'admin') {
      // Admin can see all consultations
      query = `
        SELECT c.*, 
          u1.name as client_name, 
          u2.name as professional_name,
          s.name as service_name,
          CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent,
          COALESCE(d.name, u1.name) as patient_name
        FROM consultations c
        LEFT JOIN users u1 ON c.client_id = u1.id
        LEFT JOIN users u2 ON c.professional_id = u2.id
        LEFT JOIN services s ON c.service_id = s.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        ORDER BY c.date DESC
      `;
    } else if (req.user.currentRole === 'professional') {
      // Professionals can only see their own consultations
      query = `
        SELECT c.*, 
          u1.name as client_name, 
          u2.name as professional_name,
          s.name as service_name,
          CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent,
          COALESCE(d.name, u1.name) as patient_name
        FROM consultations c
        LEFT JOIN users u1 ON c.client_id = u1.id
        LEFT JOIN users u2 ON c.professional_id = u2.id
        LEFT JOIN services s ON c.service_id = s.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE c.professional_id = $1
        ORDER BY c.date DESC
      `;
      params = [req.user.id];
    } else if (req.user.currentRole === 'clinic') {
      // Clinics can see consultations of their professionals
      query = `
        SELECT c.*, 
          u1.name as client_name, 
          u2.name as professional_name,
          s.name as service_name,
          CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent,
          COALESCE(d.name, u1.name) as patient_name
        FROM consultations c
        LEFT JOIN users u1 ON c.client_id = u1.id
        LEFT JOIN users u2 ON c.professional_id = u2.id
        LEFT JOIN services s ON c.service_id = s.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE c.professional_id IN (
          SELECT professional_id FROM clinic_professionals WHERE clinic_id = $1
        )
        ORDER BY c.date DESC
      `;
      params = [req.user.id];
    } else {
      // Clients can only see their own consultations
      query = `
        SELECT c.*, 
          u1.name as client_name, 
          u2.name as professional_name,
          s.name as service_name,
          CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent,
          COALESCE(d.name, u1.name) as patient_name
        FROM consultations c
        LEFT JOIN users u1 ON c.client_id = u1.id
        LEFT JOIN users u2 ON c.professional_id = u2.id
        LEFT JOIN services s ON c.service_id = s.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE c.client_id = $1 OR d.client_id = $1
        ORDER BY c.date DESC
      `;
      params = [req.user.id];
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching consultations:', error);
    res.status(500).json({ message: 'Erro ao buscar consultas' });
  }
});

// Create consultation
app.post('/api/consultations', authenticate, authorize(['professional', 'admin']), async (req, res) => {
  try {
    const { client_id, dependent_id, professional_id, service_id, value, date, notes } = req.body;
    
    // Validate input
    if ((!client_id && !dependent_id) || !professional_id || !service_id || !value || !date) {
      return res.status(400).json({ message: 'Cliente/dependente, profissional, serviço, valor e data são obrigatórios' });
    }
    
    // If dependent_id is provided, check if it exists and belongs to the client
    if (dependent_id) {
      const dependentCheck = await pool.query('SELECT * FROM dependents WHERE id = $1', [dependent_id]);
      if (dependentCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Dependente não encontrado' });
      }
    }
    
    // If client_id is provided, check if it exists
    if (client_id) {
      const clientCheck = await pool.query('SELECT * FROM users WHERE id = $1 AND $2 = ANY(roles)', [client_id, 'client']);
      if (clientCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Cliente não encontrado' });
      }
      
      // Check if client has active subscription
      if (clientCheck.rows[0].subscription_status !== 'active') {
        return res.status(400).json({ message: 'Cliente não possui assinatura ativa' });
      }
    }
    
    // Check if professional exists
    const professionalCheck = await pool.query('SELECT * FROM users WHERE id = $1 AND $2 = ANY(roles)', [professional_id, 'professional']);
    if (professionalCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    // Check if service exists
    const serviceCheck = await pool.query('SELECT * FROM services WHERE id = $1', [service_id]);
    if (serviceCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }
    
    // Create consultation
    const result = await pool.query(
      `INSERT INTO consultations (client_id, dependent_id, professional_id, service_id, value, date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [client_id, dependent_id, professional_id, service_id, value, date, notes]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating consultation:', error);
    res.status(500).json({ message: 'Erro ao criar consulta' });
  }
});

// Create clinic consultation
app.post('/api/clinic/consultations', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { client_id, dependent_id, professional_id, service_id, value, date, notes } = req.body;
    
    // Validate input
    if ((!client_id && !dependent_id) || !professional_id || !service_id || !value || !date) {
      return res.status(400).json({ message: 'Cliente/dependente, profissional, serviço, valor e data são obrigatórios' });
    }
    
    // Check if professional belongs to this clinic
    const professionalCheck = await pool.query(
      'SELECT * FROM clinic_professionals WHERE clinic_id = $1 AND professional_id = $2',
      [req.user.id, professional_id]
    );
    
    if (professionalCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Este profissional não pertence à sua clínica' });
    }
    
    // If dependent_id is provided, check if it exists and belongs to the client
    if (dependent_id) {
      const dependentCheck = await pool.query('SELECT * FROM dependents WHERE id = $1', [dependent_id]);
      if (dependentCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Dependente não encontrado' });
      }
    }
    
    // If client_id is provided, check if it exists
    if (client_id) {
      const clientCheck = await pool.query('SELECT * FROM users WHERE id = $1 AND $2 = ANY(roles)', [client_id, 'client']);
      if (clientCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Cliente não encontrado' });
      }
      
      // Check if client has active subscription
      if (clientCheck.rows[0].subscription_status !== 'active') {
        return res.status(400).json({ message: 'Cliente não possui assinatura ativa' });
      }
    }
    
    // Check if service exists
    const serviceCheck = await pool.query('SELECT * FROM services WHERE id = $1', [service_id]);
    if (serviceCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }
    
    // Create consultation
    const result = await pool.query(
      `INSERT INTO consultations (client_id, dependent_id, professional_id, service_id, value, date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [client_id, dependent_id, professional_id, service_id, value, date, notes]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating clinic consultation:', error);
    res.status(500).json({ message: 'Erro ao criar consulta' });
  }
});

// ===== DEPENDENTS ROUTES =====

// Get dependents by client ID
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    // Only allow clients to access their own dependents or admins to access any
    if (req.user.currentRole === 'client' && req.user.id !== parseInt(clientId)) {
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

// Create dependent
app.post('/api/dependents', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;
    
    // Validate input
    if (!client_id || !name || !cpf) {
      return res.status(400).json({ message: 'ID do cliente, nome e CPF são obrigatórios' });
    }
    
    // Only allow clients to create dependents for themselves
    if (req.user.id !== client_id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if dependent with this CPF already exists
    const dependentCheck = await pool.query('SELECT * FROM dependents WHERE cpf = $1', [cpf]);
    if (dependentCheck.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado como dependente' });
    }
    
    // Check if CPF is already registered as a user
    const userCheck = await pool.query('SELECT * FROM users WHERE cpf = $1', [cpf]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: 'CPF já cadastrado como usuário' });
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

// Update dependent
app.put('/api/dependents/:id', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, birth_date } = req.body;
    
    // Check if dependent exists and belongs to the client
    const dependentCheck = await pool.query(
      'SELECT * FROM dependents WHERE id = $1',
      [id]
    );
    
    if (dependentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }
    
    // Only allow clients to update their own dependents
    if (req.user.id !== dependentCheck.rows[0].client_id) {
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

// Delete dependent
app.delete('/api/dependents/:id', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if dependent exists and belongs to the client
    const dependentCheck = await pool.query(
      'SELECT * FROM dependents WHERE id = $1',
      [id]
    );
    
    if (dependentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }
    
    // Only allow clients to delete their own dependents
    if (req.user.id !== dependentCheck.rows[0].client_id) {
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
    
    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }
    
    // Find dependent
    const result = await pool.query(`
      SELECT d.*, u.name as client_name, u.subscription_status as client_subscription_status
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
    res.status(500).json({ message: 'Erro ao buscar dependente' });
  }
});

// ===== CLIENT ROUTES =====

// Lookup client by CPF
app.get('/api/clients/lookup/:cpf', authenticate, async (req, res) => {
  try {
    const { cpf } = req.params;
    
    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }
    
    // Find client
    const result = await pool.query(`
      SELECT id, name, cpf, subscription_status, subscription_expiry
      FROM users
      WHERE cpf = $1 AND 'client' = ANY(roles)
    `, [cpf]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up client:', error);
    res.status(500).json({ message: 'Erro ao buscar cliente' });
  }
});

// ===== PROFESSIONAL LOCATIONS ROUTES =====

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
    res.status(500).json({ message: 'Erro ao buscar locais de atendimento' });
  }
});

// Create professional location
app.post('/api/professional-locations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { 
      clinic_name, address, address_number, address_complement, 
      neighborhood, city, state, phone, is_main 
    } = req.body;
    
    // Validate input
    if (!clinic_name || !address || !address_number || !neighborhood || !city || !state) {
      return res.status(400).json({ message: 'Nome da clínica, endereço, número, bairro, cidade e estado são obrigatórios' });
    }
    
    // If this is the main location, update all others to not be main
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
        req.user.id, clinic_name, address, address_number, address_complement,
        neighborhood, city, state, phone, is_main
      ]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating professional location:', error);
    res.status(500).json({ message: 'Erro ao criar local de atendimento' });
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
    
    // Check if location exists and belongs to the professional
    const locationCheck = await pool.query(
      'SELECT * FROM professional_locations WHERE id = $1 AND professional_id = $2',
      [id, req.user.id]
    );
    
    if (locationCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Local de atendimento não encontrado' });
    }
    
    // If this is the main location, update all others to not be main
    if (is_main) {
      await pool.query(
        'UPDATE professional_locations SET is_main = false WHERE professional_id = $1',
        [req.user.id]
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
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10 AND professional_id = $11 RETURNING *`,
      [
        clinic_name, address, address_number, address_complement,
        neighborhood, city, state, phone, is_main,
        id, req.user.id
      ]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating professional location:', error);
    res.status(500).json({ message: 'Erro ao atualizar local de atendimento' });
  }
});

// Delete professional location
app.delete('/api/professional-locations/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if location exists and belongs to the professional
    const locationCheck = await pool.query(
      'SELECT * FROM professional_locations WHERE id = $1 AND professional_id = $2',
      [id, req.user.id]
    );
    
    if (locationCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Local de atendimento não encontrado' });
    }
    
    // Delete location
    await pool.query('DELETE FROM professional_locations WHERE id = $1', [id]);
    
    res.json({ message: 'Local de atendimento excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting professional location:', error);
    res.status(500).json({ message: 'Erro ao excluir local de atendimento' });
  }
});

// ===== AGENDA ROUTES =====

// Get agenda subscription status
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Check if professional has an active subscription
    const result = await pool.query(
      'SELECT * FROM agenda_subscriptions WHERE professional_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.user.id]
    );
    
    let subscription = null;
    
    if (result.rows.length > 0) {
      subscription = result.rows[0];
    }
    
    // Calculate status
    let status = 'pending';
    let expiresAt = null;
    let daysRemaining = 0;
    let canUseAgenda = false;
    
    if (subscription) {
      status = subscription.status;
      expiresAt = subscription.expires_at;
      
      if (status === 'active' && expiresAt) {
        const now = new Date();
        const expiry = new Date(expiresAt);
        
        if (expiry > now) {
          // Calculate days remaining
          const diffTime = Math.abs(expiry.getTime() - now.getTime());
          daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          canUseAgenda = true;
        } else {
          status = 'expired';
        }
      }
    }
    
    res.json({
      status,
      expires_at: expiresAt,
      days_remaining: daysRemaining,
      can_use_agenda: canUseAgenda,
      last_payment: subscription ? subscription.payment_id : null
    });
  } catch (error) {
    console.error('Error fetching agenda subscription status:', error);
    res.status(500).json({ message: 'Erro ao verificar status da assinatura da agenda' });
  }
});

// Get schedule configuration
app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Check if professional has a schedule config
    const result = await pool.query(
      'SELECT * FROM schedule_configs WHERE professional_id = $1',
      [req.user.id]
    );
    
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
        break_start: '12:00',
        break_end: '13:00'
      });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching schedule config:', error);
    res.status(500).json({ message: 'Erro ao buscar configuração de horários' });
  }
});

// Save schedule configuration
app.post('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { 
      monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end, slot_duration, break_start, break_end
    } = req.body;
    
    // Check if professional already has a schedule config
    const configCheck = await pool.query(
      'SELECT * FROM schedule_configs WHERE professional_id = $1',
      [req.user.id]
    );
    
    let result;
    
    if (configCheck.rows.length === 0) {
      // Create new config
      result = await pool.query(
        `INSERT INTO schedule_configs (
          professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
          wednesday_start, wednesday_end, thursday_start, thursday_end,
          friday_start, friday_end, saturday_start, saturday_end,
          sunday_start, sunday_end, slot_duration, break_start, break_end
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
        [
          req.user.id, monday_start, monday_end, tuesday_start, tuesday_end,
          wednesday_start, wednesday_end, thursday_start, thursday_end,
          friday_start, friday_end, saturday_start, saturday_end,
          sunday_start, sunday_end, slot_duration, break_start, break_end
        ]
      );
    } else {
      // Update existing config
      result = await pool.query(
        `UPDATE schedule_configs SET 
          monday_start = $1, monday_end = $2, tuesday_start = $3, tuesday_end = $4,
          wednesday_start = $5, wednesday_end = $6, thursday_start = $7, thursday_end = $8,
          friday_start = $9, friday_end = $10, saturday_start = $11, saturday_end = $12,
          sunday_start = $13, sunday_end = $14, slot_duration = $15, break_start = $16, break_end = $17,
          updated_at = CURRENT_TIMESTAMP
        WHERE professional_id = $18 RETURNING *`,
        [
          monday_start, monday_end, tuesday_start, tuesday_end,
          wednesday_start, wednesday_end, thursday_start, thursday_end,
          friday_start, friday_end, saturday_start, saturday_end,
          sunday_start, sunday_end, slot_duration, break_start, break_end,
          req.user.id
        ]
      );
    }
    
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
    
    let query = 'SELECT * FROM agenda_patients WHERE professional_id = $1';
    
    // Only include non-archived patients by default
    if (!include_archived || include_archived !== 'true') {
      query += ' AND is_archived = false';
    }
    
    query += ' ORDER BY name';
    
    const result = await pool.query(query, [req.user.id]);
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
      name, cpf, phone, email, birth_date, address, address_number,
      address_complement, neighborhood, city, state, notes
    } = req.body;
    
    // Validate input
    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }
    
    // Check if patient with this CPF already exists for this professional
    const patientCheck = await pool.query(
      'SELECT * FROM agenda_patients WHERE professional_id = $1 AND cpf = $2',
      [req.user.id, cpf]
    );
    
    if (patientCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Paciente com este CPF já cadastrado' });
    }
    
    // Create patient
    const result = await pool.query(
      `INSERT INTO agenda_patients (
        professional_id, name, cpf, phone, email, birth_date, address, address_number,
        address_complement, neighborhood, city, state, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        req.user.id, name, cpf, phone, email, birth_date, address, address_number,
        address_complement, neighborhood, city, state, notes
      ]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating agenda patient:', error);
    res.status(500).json({ message: 'Erro ao criar paciente' });
  }
});

// Update agenda patient
app.put('/api/agenda/patients/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    // Check if patient exists and belongs to the professional
    const patientCheck = await pool.query(
      'SELECT * FROM agenda_patients WHERE id = $1 AND professional_id = $2',
      [id, req.user.id]
    );
    
    if (patientCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    // Update patient
    const result = await pool.query(
      `UPDATE agenda_patients SET 
        notes = COALESCE($1, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND professional_id = $3 RETURNING *`,
      [notes, id, req.user.id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating agenda patient:', error);
    res.status(500).json({ message: 'Erro ao atualizar paciente' });
  }
});

// Archive/unarchive agenda patient
app.put('/api/agenda/patients/:id/archive', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_archived } = req.body;
    
    // Check if patient exists and belongs to the professional
    const patientCheck = await pool.query(
      'SELECT * FROM agenda_patients WHERE id = $1 AND professional_id = $2',
      [id, req.user.id]
    );
    
    if (patientCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    // Update patient
    const result = await pool.query(
      `UPDATE agenda_patients SET 
        is_archived = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND professional_id = $3 RETURNING *`,
      [is_archived, id, req.user.id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error archiving agenda patient:', error);
    res.status(500).json({ message: 'Erro ao arquivar paciente' });
  }
});

// Lookup agenda patient by CPF
app.get('/api/agenda/patients/lookup/:cpf', authenticate, async (req, res) => {
  try {
    const { cpf } = req.params;
    
    if (!cpf) {
      return res.status(400).json({ message: 'CPF é obrigatório' });
    }
    
    // Find patient
    const result = await pool.query(
      'SELECT * FROM agenda_patients WHERE professional_id = $1 AND cpf = $2',
      [req.user.id, cpf]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error looking up agenda patient:', error);
    res.status(500).json({ message: 'Erro ao buscar paciente' });
  }
});

// Get appointments
app.get('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate input
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e final são obrigatórias' });
    }
    
    // Get appointments
    const result = await pool.query(`
      SELECT a.*, p.name as patient_name, p.phone as patient_phone, 
        CASE WHEN p.id IN (
          SELECT id FROM agenda_patients WHERE professional_id = $1
        ) THEN false ELSE true END as is_convenio_patient
      FROM appointments a
      LEFT JOIN agenda_patients p ON a.patient_id = p.id
      WHERE a.professional_id = $1 AND a.date BETWEEN $2 AND $3
      ORDER BY a.date
    `, [req.user.id, start_date, end_date]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro ao buscar agendamentos' });
  }
});

// Get clinic appointments
app.get('/api/clinic/agenda/appointments', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { professional_id, start_date, end_date } = req.query;
    
    // Validate input
    if (!professional_id || !start_date || !end_date) {
      return res.status(400).json({ message: 'ID do profissional, data inicial e final são obrigatórias' });
    }
    
    // Check if professional belongs to this clinic
    const professionalCheck = await pool.query(
      'SELECT * FROM clinic_professionals WHERE clinic_id = $1 AND professional_id = $2',
      [req.user.id, professional_id]
    );
    
    if (professionalCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Este profissional não pertence à sua clínica' });
    }
    
    // Get appointments
    const result = await pool.query(`
      SELECT a.*, p.name as patient_name, p.phone as patient_phone, 
        CASE WHEN p.id IN (
          SELECT id FROM agenda_patients WHERE professional_id = $1
        ) THEN false ELSE true END as is_convenio_patient,
        u.name as professional_name
      FROM appointments a
      LEFT JOIN agenda_patients p ON a.patient_id = p.id
      LEFT JOIN users u ON a.professional_id = u.id
      WHERE a.professional_id = $1 AND a.date BETWEEN $2 AND $3
      ORDER BY a.date
    `, [professional_id, start_date, end_date]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic appointments:', error);
    res.status(500).json({ message: 'Erro ao buscar agendamentos' });
  }
});

// Create appointment
app.post('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patient_id, date, status, notes } = req.body;
    
    // Validate input
    if (!patient_id || !date) {
      return res.status(400).json({ message: 'ID do paciente e data são obrigatórios' });
    }
    
    // Check if patient exists and belongs to the professional
    const patientCheck = await pool.query(
      'SELECT * FROM agenda_patients WHERE id = $1 AND professional_id = $2',
      [patient_id, req.user.id]
    );
    
    if (patientCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    // Create appointment
    const result = await pool.query(
      `INSERT INTO appointments (professional_id, patient_id, date, status, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, patient_id, date, status || 'scheduled', notes]
    );
    
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
    const { status, notes } = req.body;
    
    // Check if appointment exists and belongs to the professional
    const appointmentCheck = await pool.query(
      'SELECT * FROM appointments WHERE id = $1 AND professional_id = $2',
      [id, req.user.id]
    );
    
    if (appointmentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }
    
    // Update appointment
    const result = await pool.query(
      `UPDATE appointments SET 
        status = COALESCE($1, status),
        notes = COALESCE($2, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND professional_id = $4 RETURNING *`,
      [status, notes, id, req.user.id]
    );
    
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
    
    // Check if appointment exists and belongs to the professional
    const appointmentCheck = await pool.query(
      'SELECT * FROM appointments WHERE id = $1 AND professional_id = $2',
      [id, req.user.id]
    );
    
    if (appointmentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Agendamento não encontrado' });
    }
    
    // Delete appointment
    await pool.query('DELETE FROM appointments WHERE id = $1', [id]);
    
    res.json({ message: 'Agendamento excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting appointment:', error);
    res.status(500).json({ message: 'Erro ao excluir agendamento' });
  }
});

// ===== MEDICAL RECORDS ROUTES =====

// Get medical records by patient ID
app.get('/api/medical-records/patient/:patientId', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patientId } = req.params;
    
    // Get medical records
    const result = await pool.query(`
      SELECT mr.*, 
        u.name as professional_name,
        u.professional_registration,
        s.name as service_name,
        COALESCE(ap.name, COALESCE(d.name, c.name)) as patient_name,
        COALESCE(ap.cpf, COALESCE(d.cpf, c.cpf)) as patient_cpf,
        COALESCE(cons.date, app.date) as consultation_date
      FROM medical_records mr
      LEFT JOIN users u ON mr.professional_id = u.id
      LEFT JOIN agenda_patients ap ON mr.patient_id = ap.id AND mr.professional_id = ap.professional_id
      LEFT JOIN consultations cons ON mr.consultation_id = cons.id
      LEFT JOIN appointments app ON mr.consultation_id = app.id
      LEFT JOIN services s ON cons.service_id = s.id
      LEFT JOIN users c ON cons.client_id = c.id
      LEFT JOIN dependents d ON cons.dependent_id = d.id
      WHERE mr.patient_id = $1 AND mr.professional_id = $2
      ORDER BY mr.created_at DESC
    `, [patientId, req.user.id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching medical records:', error);
    res.status(500).json({ message: 'Erro ao buscar prontuários' });
  }
});

// Get clinic medical records by patient ID
app.get('/api/clinic/medical-records/patient/:patientId', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { patientId } = req.params;
    
    // Get medical records
    const result = await pool.query(`
      SELECT mr.*, 
        u.name as professional_name,
        u.professional_registration,
        s.name as service_name,
        COALESCE(ap.name, COALESCE(d.name, c.name)) as patient_name,
        COALESCE(ap.cpf, COALESCE(d.cpf, c.cpf)) as patient_cpf,
        COALESCE(cons.date, app.date) as consultation_date
      FROM medical_records mr
      LEFT JOIN users u ON mr.professional_id = u.id
      LEFT JOIN agenda_patients ap ON mr.patient_id = ap.id AND mr.professional_id = ap.professional_id
      LEFT JOIN consultations cons ON mr.consultation_id = cons.id
      LEFT JOIN appointments app ON mr.consultation_id = app.id
      LEFT JOIN services s ON cons.service_id = s.id
      LEFT JOIN users c ON cons.client_id = c.id
      LEFT JOIN dependents d ON cons.dependent_id = d.id
      WHERE mr.patient_id = $1 AND mr.professional_id IN (
        SELECT professional_id FROM clinic_professionals WHERE clinic_id = $2
      )
      ORDER BY mr.created_at DESC
    `, [patientId, req.user.id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic medical records:', error);
    res.status(500).json({ message: 'Erro ao buscar prontuários' });
  }
});

// Create medical record
app.post('/api/medical-records', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { 
      patient_id, consultation_id, chief_complaint, anamnesis, physical_examination,
      diagnosis, treatment_plan, clinical_evolution, internal_notes
    } = req.body;
    
    // Validate input
    if (!patient_id) {
      return res.status(400).json({ message: 'ID do paciente é obrigatório' });
    }
    
    // Create medical record
    const result = await pool.query(
      `INSERT INTO medical_records (
        patient_id, professional_id, consultation_id, chief_complaint, anamnesis,
        physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        patient_id, req.user.id, consultation_id, chief_complaint, anamnesis,
        physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
      ]
    );
    
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
    
    // Check if medical record exists and belongs to the professional
    const recordCheck = await pool.query(
      'SELECT * FROM medical_records WHERE id = $1 AND professional_id = $2',
      [id, req.user.id]
    );
    
    if (recordCheck.rows.length === 0) {
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
        chief_complaint, anamnesis, physical_examination,
        diagnosis, treatment_plan, clinical_evolution, internal_notes,
        id, req.user.id
      ]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating medical record:', error);
    res.status(500).json({ message: 'Erro ao atualizar prontuário' });
  }
});

// ===== REPORTS ROUTES =====

// Get professional revenue report
app.get('/api/reports/professional-revenue', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate input
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e final são obrigatórias' });
    }
    
    // Get professional percentage
    const professionalResult = await pool.query(
      'SELECT percentage FROM users WHERE id = $1',
      [req.user.id]
    );
    
    const percentage = professionalResult.rows[0]?.percentage || 50;
    
    // Get consultations
    const consultationsResult = await pool.query(`
      SELECT c.*, 
        s.name as service_name,
        COALESCE(d.name, u.name) as client_name,
        (c.value * $1 / 100) as professional_payment,
        (c.value * (100 - $1) / 100) as amount_to_pay
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN services s ON c.service_id = s.id
      WHERE c.professional_id = $2 AND c.date BETWEEN $3 AND $4
      ORDER BY c.date DESC
    `, [percentage, req.user.id, start_date, end_date]);
    
    // Calculate summary
    const consultations = consultationsResult.rows;
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.value), 0);
    const consultationCount = consultations.length;
    const amountToPay = consultations.reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0);
    
    res.json({
      summary: {
        professional_percentage: percentage,
        total_revenue: totalRevenue,
        consultation_count: consultationCount,
        amount_to_pay: amountToPay
      },
      consultations
    });
  } catch (error) {
    console.error('Error fetching professional revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de faturamento' });
  }
});

// Get professional consultations report
app.get('/api/reports/professional-consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate input
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e final são obrigatórias' });
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
        c.id as consultation_id,
        c.date,
        COALESCE(d.name, u.name) as patient_name,
        s.name as service_name,
        c.value as total_value,
        (c.value * (100 - $1) / 100) as amount_to_pay,
        CASE WHEN d.id IS NULL THEN false ELSE true END as is_convenio_patient,
        CASE WHEN EXISTS (
          SELECT 1 FROM medical_records mr WHERE mr.consultation_id = c.id
        ) THEN true ELSE false END as has_medical_record
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN services s ON c.service_id = s.id
      WHERE c.professional_id = $2 AND c.date BETWEEN $3 AND $4
      ORDER BY c.date DESC
    `, [percentage, req.user.id, start_date, end_date]);
    
    // Calculate summary
    const consultations = consultationsResult.rows;
    const totalConsultations = consultations.length;
    const convenioConsultations = consultations.filter(c => c.is_convenio_patient).length;
    const particularConsultations = totalConsultations - convenioConsultations;
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const convenioRevenue = consultations.filter(c => c.is_convenio_patient).reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const particularRevenue = totalRevenue - convenioRevenue;
    const amountToPay = consultations.filter(c => c.is_convenio_patient).reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0);
    
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
      consultations
    });
  } catch (error) {
    console.error('Error fetching professional consultations report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de consultas' });
  }
});

// Get admin revenue report
app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate input
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e final são obrigatórias' });
    }
    
    // Get consultations with professional data
    const result = await pool.query(`
      SELECT 
        c.*,
        u.name as professional_name,
        u.percentage as professional_percentage,
        s.name as service_name,
        (c.value * u.percentage / 100) as professional_payment,
        (c.value * (100 - u.percentage) / 100) as clinic_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      JOIN services s ON c.service_id = s.id
      WHERE c.date BETWEEN $1 AND $2
      ORDER BY c.date DESC
    `, [start_date, end_date]);
    
    const consultations = result.rows;
    
    // Calculate total revenue
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.value), 0);
    
    // Group by professional
    const professionalRevenue = {};
    consultations.forEach(c => {
      if (!professionalRevenue[c.professional_id]) {
        professionalRevenue[c.professional_id] = {
          professional_id: c.professional_id,
          professional_name: c.professional_name,
          professional_percentage: c.professional_percentage,
          revenue: 0,
          consultation_count: 0,
          professional_payment: 0,
          clinic_revenue: 0
        };
      }
      
      professionalRevenue[c.professional_id].revenue += parseFloat(c.value);
      professionalRevenue[c.professional_id].consultation_count += 1;
      professionalRevenue[c.professional_id].professional_payment += parseFloat(c.professional_payment);
      professionalRevenue[c.professional_id].clinic_revenue += parseFloat(c.clinic_revenue);
    });
    
    // Group by service
    const serviceRevenue = {};
    consultations.forEach(c => {
      if (!serviceRevenue[c.service_id]) {
        serviceRevenue[c.service_id] = {
          service_id: c.service_id,
          service_name: c.service_name,
          revenue: 0,
          consultation_count: 0
        };
      }
      
      serviceRevenue[c.service_id].revenue += parseFloat(c.value);
      serviceRevenue[c.service_id].consultation_count += 1;
    });
    
    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: Object.values(professionalRevenue),
      revenue_by_service: Object.values(serviceRevenue)
    });
  } catch (error) {
    console.error('Error fetching revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de faturamento' });
  }
});

// Get admin professional revenue summary
app.get('/api/reports/professional-revenue-summary', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate input
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e final são obrigatórias' });
    }
    
    // Get consultations with professional data
    const result = await pool.query(`
      SELECT 
        c.*,
        u.name as professional_name,
        u.percentage as professional_percentage,
        s.name as service_name,
        (c.value * u.percentage / 100) as professional_payment,
        (c.value * (100 - u.percentage) / 100) as clinic_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      JOIN services s ON c.service_id = s.id
      WHERE c.date BETWEEN $1 AND $2
      ORDER BY c.date DESC
    `, [start_date, end_date]);
    
    const consultations = result.rows;
    
    // Calculate total revenue
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.value), 0);
    
    // Group by professional
    const professionalRevenue = {};
    consultations.forEach(c => {
      if (!professionalRevenue[c.professional_id]) {
        professionalRevenue[c.professional_id] = {
          professional_id: c.professional_id,
          professional_name: c.professional_name,
          professional_percentage: c.professional_percentage,
          revenue: 0,
          consultation_count: 0,
          professional_payment: 0,
          clinic_revenue: 0
        };
      }
      
      professionalRevenue[c.professional_id].revenue += parseFloat(c.value);
      professionalRevenue[c.professional_id].consultation_count += 1;
      professionalRevenue[c.professional_id].professional_payment += parseFloat(c.professional_payment);
      professionalRevenue[c.professional_id].clinic_revenue += parseFloat(c.clinic_revenue);
    });
    
    // Group by service
    const serviceRevenue = {};
    consultations.forEach(c => {
      if (!serviceRevenue[c.service_id]) {
        serviceRevenue[c.service_id] = {
          service_id: c.service_id,
          service_name: c.service_name,
          revenue: 0,
          consultation_count: 0
        };
      }
      
      serviceRevenue[c.service_id].revenue += parseFloat(c.value);
      serviceRevenue[c.service_id].consultation_count += 1;
    });
    
    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: Object.values(professionalRevenue),
      revenue_by_service: Object.values(serviceRevenue)
    });
  } catch (error) {
    console.error('Error fetching professional revenue summary:', error);
    res.status(500).json({ message: 'Erro ao gerar resumo de faturamento por profissional' });
  }
});

// Get admin new clients report
app.get('/api/reports/new-clients', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate input
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e final são obrigatórias' });
    }
    
    // Get new clients
    const result = await pool.query(`
      SELECT 
        id, name, cpf, email, phone, created_at,
        subscription_status, subscription_expiry
      FROM users
      WHERE 'client' = ANY(roles)
        AND created_at BETWEEN $1 AND $2
      ORDER BY created_at DESC
    `, [start_date, end_date]);
    
    const clients = result.rows;
    
    // Calculate subscription revenue (R$250 per client)
    const subscriptionRevenue = clients.length * 250;
    
    // Group by month
    const clientsByMonth = {};
    clients.forEach(client => {
      const date = new Date(client.created_at);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!clientsByMonth[month]) {
        clientsByMonth[month] = {
          month,
          count: 0,
          revenue: 0
        };
      }
      
      clientsByMonth[month].count += 1;
      clientsByMonth[month].revenue += 250; // R$250 per client
    });
    
    res.json({
      total_new_clients: clients.length,
      subscription_revenue: subscriptionRevenue,
      clients_by_month: Object.values(clientsByMonth).sort((a, b) => a.month.localeCompare(b.month))
    });
  } catch (error) {
    console.error('Error fetching new clients report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de novos clientes' });
  }
});

// Get admin total revenue report
app.get('/api/reports/total-revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate input
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e final são obrigatórias' });
    }
    
    // Get new clients (subscription revenue)
    const clientsResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM users
      WHERE 'client' = ANY(roles)
        AND created_at BETWEEN $1 AND $2
    `, [start_date, end_date]);
    
    const newClientsCount = parseInt(clientsResult.rows[0].count);
    const subscriptionRevenue = newClientsCount * 250; // R$250 per client
    
    // Get consultations revenue (clinic's portion)
    const consultationsResult = await pool.query(`
      SELECT SUM(c.value * (100 - u.percentage) / 100) as clinic_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date BETWEEN $1 AND $2
    `, [start_date, end_date]);
    
    const consultationRevenue = parseFloat(consultationsResult.rows[0].clinic_revenue) || 0;
    
    // Calculate total revenue
    const totalRevenue = subscriptionRevenue + consultationRevenue;
    
    res.json({
      subscription_revenue: subscriptionRevenue,
      consultation_revenue: consultationRevenue,
      total_revenue: totalRevenue,
      clinic_total_revenue: totalRevenue
    });
  } catch (error) {
    console.error('Error fetching total revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de faturamento total' });
  }
});

// ===== CLINIC ROUTES =====

// Get clinic stats
app.get('/api/clinic/stats', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    // Get professionals count
    const professionalsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_professionals,
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_professionals
      FROM clinic_professionals
      WHERE clinic_id = $1
    `, [req.user.id]);
    
    const totalProfessionals = parseInt(professionalsResult.rows[0].total_professionals) || 0;
    const activeProfessionals = parseInt(professionalsResult.rows[0].active_professionals) || 0;
    
    // Get current month's consultations
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const consultationsResult = await pool.query(`
      SELECT COUNT(*) as count, SUM(value) as revenue
      FROM consultations
      WHERE professional_id IN (
        SELECT professional_id FROM clinic_professionals WHERE clinic_id = $1
      )
      AND date BETWEEN $2 AND $3
    `, [req.user.id, firstDayOfMonth, lastDayOfMonth]);
    
    const totalConsultations = parseInt(consultationsResult.rows[0].count) || 0;
    const monthlyRevenue = parseFloat(consultationsResult.rows[0].revenue) || 0;
    
    // Get pending payments
    const paymentsResult = await pool.query(`
      SELECT SUM(c.value * (100 - cp.percentage) / 100) as pending_payments
      FROM consultations c
      JOIN clinic_professionals cp ON c.professional_id = cp.professional_id AND cp.clinic_id = $1
      WHERE c.date BETWEEN $2 AND $3
    `, [req.user.id, firstDayOfMonth, lastDayOfMonth]);
    
    const pendingPayments = parseFloat(paymentsResult.rows[0].pending_payments) || 0;
    
    res.json({
      total_professionals: totalProfessionals,
      active_professionals: activeProfessionals,
      total_consultations: totalConsultations,
      monthly_revenue: monthlyRevenue,
      pending_payments: pendingPayments
    });
  } catch (error) {
    console.error('Error fetching clinic stats:', error);
    res.status(500).json({ message: 'Erro ao buscar estatísticas da clínica' });
  }
});

// Get clinic professionals
app.get('/api/clinic/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.cpf, u.email, u.phone, u.professional_registration,
        u.photo_url, u.professional_type, cp.percentage, cp.is_active,
        sc.name as category_name
      FROM clinic_professionals cp
      JOIN users u ON cp.professional_id = u.id
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE cp.clinic_id = $1
      ORDER BY u.name
    `, [req.user.id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic professionals:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais da clínica' });
  }
});

// Get clinic agenda professionals
app.get('/api/clinic/agenda/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.professional_type
      FROM clinic_professionals cp
      JOIN users u ON cp.professional_id = u.id
      WHERE cp.clinic_id = $1 AND cp.is_active = true
        AND (u.professional_type = 'agenda' OR u.professional_type = 'both')
      ORDER BY u.name
    `, [req.user.id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic agenda professionals:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais da agenda' });
  }
});

// Get clinic patients
app.get('/api/clinic/patients', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    // Get all patients from professionals in this clinic
    const result = await pool.query(`
      SELECT 
        ap.id, ap.name, ap.cpf, ap.email, ap.phone, ap.birth_date,
        ap.professional_id, u.name as professional_name,
        false as is_convenio_patient
      FROM agenda_patients ap
      JOIN users u ON ap.professional_id = u.id
      WHERE ap.professional_id IN (
        SELECT professional_id FROM clinic_professionals WHERE clinic_id = $1
      )
      UNION
      SELECT 
        COALESCE(d.id, c.id) as id,
        COALESCE(d.name, c.name) as name,
        COALESCE(d.cpf, c.cpf) as cpf,
        c.email, c.phone, COALESCE(d.birth_date, c.birth_date) as birth_date,
        cons.professional_id, u.name as professional_name,
        true as is_convenio_patient
      FROM consultations cons
      JOIN users u ON cons.professional_id = u.id
      LEFT JOIN users c ON cons.client_id = c.id
      LEFT JOIN dependents d ON cons.dependent_id = d.id
      WHERE cons.professional_id IN (
        SELECT professional_id FROM clinic_professionals WHERE clinic_id = $1
      )
      ORDER BY name
    `, [req.user.id]);
    
    // Remove duplicates (same patient might have multiple consultations)
    const patientsMap = {};
    result.rows.forEach(patient => {
      const key = `${patient.cpf}-${patient.professional_id}`;
      if (!patientsMap[key]) {
        patientsMap[key] = patient;
      }
    });
    
    res.json(Object.values(patientsMap));
  } catch (error) {
    console.error('Error fetching clinic patients:', error);
    res.status(500).json({ message: 'Erro ao buscar pacientes da clínica' });
  }
});

// Create clinic professional
app.post('/api/clinic/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { 
      name, cpf, email, phone, password, professional_registration,
      category_id, percentage, professional_type
    } = req.body;
    
    // Validate input
    if (!name || !cpf || !password) {
      return res.status(400).json({ message: 'Nome, CPF e senha são obrigatórios' });
    }
    
    // Start a transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Check if user already exists
      const userCheck = await client.query('SELECT * FROM users WHERE cpf = $1', [cpf]);
      
      let userId;
      
      if (userCheck.rows.length > 0) {
        // User exists, check if already a professional
        const user = userCheck.rows[0];
        
        if (user.roles.includes('professional')) {
          // Already a professional, check if already linked to this clinic
          const linkCheck = await client.query(
            'SELECT * FROM clinic_professionals WHERE clinic_id = $1 AND professional_id = $2',
            [req.user.id, user.id]
          );
          
          if (linkCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Este profissional já está vinculado à sua clínica' });
          }
          
          userId = user.id;
        } else {
          // User exists but not a professional, add professional role
          const roles = [...user.roles, 'professional'];
          
          await client.query(
            `UPDATE users SET 
              roles = $1,
              professional_registration = $2,
              category_id = $3,
              professional_type = $4,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $5`,
            [roles, professional_registration, category_id, professional_type, user.id]
          );
          
          userId = user.id;
        }
      } else {
        // User doesn't exist, create new user
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const userResult = await client.query(
          `INSERT INTO users (
            name, cpf, email, phone, password, roles, professional_registration,
            category_id, professional_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            name, cpf, email, phone, hashedPassword, ['professional'],
            professional_registration, category_id, professional_type
          ]
        );
        
        userId = userResult.rows[0].id;
      }
      
      // Link professional to clinic
      await client.query(
        'INSERT INTO clinic_professionals (clinic_id, professional_id, percentage) VALUES ($1, $2, $3)',
        [req.user.id, userId, percentage]
      );
      
      await client.query('COMMIT');
      
      res.status(201).json({
        message: 'Profissional adicionado com sucesso',
        professional_id: userId
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating clinic professional:', error);
    res.status(500).json({ message: 'Erro ao adicionar profissional' });
  }
});

// Update clinic professional
app.put('/api/clinic/professionals/:id', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { id } = req.params;
    const { percentage, is_active } = req.body;
    
    // Check if professional is linked to this clinic
    const linkCheck = await pool.query(
      'SELECT * FROM clinic_professionals WHERE clinic_id = $1 AND professional_id = $2',
      [req.user.id, id]
    );
    
    if (linkCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    // Update link
    await pool.query(
      `UPDATE clinic_professionals SET 
        percentage = COALESCE($1, percentage),
        is_active = COALESCE($2, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE clinic_id = $3 AND professional_id = $4`,
      [percentage, is_active, req.user.id, id]
    );
    
    res.json({ message: 'Profissional atualizado com sucesso' });
  } catch (error) {
    console.error('Error updating clinic professional:', error);
    res.status(500).json({ message: 'Erro ao atualizar profissional' });
  }
});

// ===== PAYMENT ROUTES =====

// Create client subscription payment (MercadoPago SDK v2)
app.post('/api/create-subscription', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { user_id } = req.body;
    
    // Validate input
    if (!user_id) {
      return res.status(400).json({ message: 'ID do usuário é obrigatório' });
    }
    
    // Check if user exists and is a client
    const userCheck = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND $2 = ANY(roles)',
      [user_id, 'client']
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }
    
    // Get dependents count
    const dependentsResult = await pool.query(
      'SELECT COUNT(*) as count FROM dependents WHERE client_id = $1',
      [user_id]
    );
    
    const dependentsCount = parseInt(dependentsResult.rows[0].count);
    
    // Calculate subscription amount (R$250 + R$50 per dependent)
    const amount = 250 + (dependentsCount * 50);
    
    // Create MercadoPago preference using SDK v2
    const { MercadoPagoConfig, Preference } = await import('mercadopago');
    
    // Initialize the client object
    const client = new MercadoPagoConfig({ 
      accessToken: process.env.MP_ACCESS_TOKEN,
      options: { timeout: 5000 }
    });
    
    const preference = new Preference(client);
    
    // Create preference object
    const preferenceData = {
      items: [
        {
          id: `subscription-${user_id}`,
          title: 'Assinatura Cartão Quiro Ferreira',
          description: `Assinatura mensal para ${dependentsCount} dependente(s)`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: amount
        }
      ],
      payer: {
        name: userCheck.rows[0].name,
        email: userCheck.rows[0].email || 'cliente@cartaoquiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`
      },
      auto_return: 'approved',
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      metadata: {
        user_id,
        payment_type: 'client_subscription'
      }
    };
    
    // Create preference
    const result = await preference.create({ body: preferenceData });
    
    // Save payment record
    await pool.query(
      `INSERT INTO payments (user_id, payment_type, amount, payment_id, payment_data)
       VALUES ($1, $2, $3, $4, $5)`,
      [user_id, 'client_subscription', amount, result.id, JSON.stringify(result)]
    );
    
    res.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error('Error creating client subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento de assinatura' });
  }
});

// Create professional payment (MercadoPago SDK v2)
app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { amount } = req.body;
    
    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor deve ser maior que zero' });
    }
    
    // Create MercadoPago preference using SDK v2
    const { MercadoPagoConfig, Preference } = await import('mercadopago');
    
    // Initialize the client object
    const client = new MercadoPagoConfig({ 
      accessToken: process.env.MP_ACCESS_TOKEN,
      options: { timeout: 5000 }
    });
    
    const preference = new Preference(client);
    
    // Create preference object
    const preferenceData = {
      items: [
        {
          id: `professional-payment-${req.user.id}`,
          title: 'Pagamento ao Convênio Quiro Ferreira',
          description: 'Repasse de valor referente às consultas realizadas',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: parseFloat(amount)
        }
      ],
      payer: {
        name: req.user.name,
        email: req.user.email || 'profissional@cartaoquiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`
      },
      auto_return: 'approved',
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      metadata: {
        user_id: req.user.id,
        payment_type: 'professional_payment'
      }
    };
    
    // Create preference
    const result = await preference.create({ body: preferenceData });
    
    // Save payment record
    await pool.query(
      `INSERT INTO payments (user_id, payment_type, amount, payment_id, payment_data)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'professional_payment', amount, result.id, JSON.stringify(result)]
    );
    
    res.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error('Error creating professional payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

// Create agenda subscription payment (MercadoPago SDK v2)
app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Fixed amount for agenda subscription
    const amount = 49.90;
    
    // Create MercadoPago preference using SDK v2
    const { MercadoPagoConfig, Preference } = await import('mercadopago');
    
    // Initialize the client object
    const client = new MercadoPagoConfig({ 
      accessToken: process.env.MP_ACCESS_TOKEN,
      options: { timeout: 5000 }
    });
    
    const preference = new Preference(client);
    
    // Create preference object
    const preferenceData = {
      items: [
        {
          id: `agenda-subscription-${req.user.id}`,
          title: 'Assinatura da Agenda Profissional',
          description: 'Assinatura mensal da agenda profissional',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: amount
        }
      ],
      payer: {
        name: req.user.name,
        email: req.user.email || 'profissional@cartaoquiroferreira.com.br'
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`
      },
      auto_return: 'approved',
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      metadata: {
        user_id: req.user.id,
        payment_type: 'agenda_subscription'
      }
    };
    
    // Create preference
    const result = await preference.create({ body: preferenceData });
    
    // Save payment record
    await pool.query(
      `INSERT INTO payments (user_id, payment_type, amount, payment_id, payment_data)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'agenda_subscription', amount, result.id, JSON.stringify(result)]
    );
    
    res.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error('Error creating agenda subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento de assinatura da agenda' });
  }
});

// ===== WEBHOOK ROUTES =====

// MercadoPago webhook (SDK v2)
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    const { type, data } = req.body;
    
    console.log('🔔 Received MercadoPago webhook:', { type, data });
    
    if (type === 'payment') {
      const paymentId = data.id;
      
      // Get payment details using SDK v2
      const { MercadoPagoConfig, Payment } = await import('mercadopago');
      
      // Initialize the client object
      const client = new MercadoPagoConfig({ 
        accessToken: process.env.MP_ACCESS_TOKEN,
        options: { timeout: 5000 }
      });
      
      const payment = new Payment(client);
      
      // Get payment details
      const paymentData = await payment.get({ id: paymentId });
      
      console.log('💰 Payment data:', paymentData);
      
      // Check if payment is approved
      if (paymentData.status === 'approved') {
        // Get metadata
        const metadata = paymentData.metadata || {};
        const userId = metadata.user_id;
        const paymentType = metadata.payment_type;
        
        if (!userId || !paymentType) {
          console.error('❌ Missing metadata in payment:', paymentData);
          return res.status(400).json({ message: 'Metadados ausentes no pagamento' });
        }
        
        // Update payment record
        await pool.query(
          `UPDATE payments SET 
            status = 'approved',
            payment_data = $1,
            updated_at = CURRENT_TIMESTAMP
          WHERE payment_id = $2`,
          [JSON.stringify(paymentData), paymentData.id]
        );
        
        // Process based on payment type
        if (paymentType === 'client_subscription') {
          // Set subscription as active for 30 days
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 30);
          
          await pool.query(
            `UPDATE users SET 
              subscription_status = 'active',
              subscription_expiry = $1,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $2`,
            [expiryDate, userId]
          );
          
          console.log('✅ Client subscription activated:', { userId, expiryDate });
        } else if (paymentType === 'agenda_subscription') {
          // Set agenda subscription as active for 30 days
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 30);
          
          // Check if subscription exists
          const subscriptionCheck = await pool.query(
            'SELECT * FROM agenda_subscriptions WHERE professional_id = $1',
            [userId]
          );
          
          if (subscriptionCheck.rows.length === 0) {
            // Create new subscription
            await pool.query(
              `INSERT INTO agenda_subscriptions (professional_id, status, expires_at, payment_id)
               VALUES ($1, 'active', $2, $3)`,
              [userId, expiryDate, paymentData.id]
            );
          } else {
            // Update existing subscription
            await pool.query(
              `UPDATE agenda_subscriptions SET 
                status = 'active',
                expires_at = $1,
                payment_id = $2,
                updated_at = CURRENT_TIMESTAMP
              WHERE professional_id = $3`,
              [expiryDate, paymentData.id, userId]
            );
          }
          
          console.log('✅ Agenda subscription activated:', { userId, expiryDate });
        } else if (paymentType === 'professional_payment') {
          // Mark professional payment as completed
          console.log('✅ Professional payment completed:', { userId, amount: paymentData.transaction_amount });
        }
      }
    }
    
    res.status(200).json({ message: 'Webhook processado com sucesso' });
  } catch (error) {
    console.error('Error processing MercadoPago webhook:', error);
    res.status(500).json({ message: 'Erro ao processar webhook' });
  }
});

// Document Templates API
// Create document template
app.post("/api/document-templates", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { name, type, content } = req.body;
    
    if (!name || !type || !content) {
      return res.status(400).json({ message: "Nome, tipo e conteúdo são obrigatórios" });
    }
    
    const result = await pool.query(
      `INSERT INTO document_templates (name, type, content) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [name, type, content]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating document template:", error);
    res.status(500).json({ message: "Erro ao criar template de documento" });
  }
});

// Get all document templates
app.get("/api/document-templates", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM document_templates ORDER BY type, name`
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching document templates:", error);
    res.status(500).json({ message: "Erro ao buscar templates de documentos" });
  }
});

// Get document templates by type
app.get("/api/document-templates/type/:type", authenticate, async (req, res) => {
  try {
    const { type } = req.params;
    
    const result = await pool.query(
      `SELECT * FROM document_templates WHERE type = $1 ORDER BY name`,
      [type]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching document templates by type:", error);
    res.status(500).json({ message: "Erro ao buscar templates de documentos" });
  }
});

// Get document template by id
app.get("/api/document-templates/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT * FROM document_templates WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Template não encontrado" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching document template:", error);
    res.status(500).json({ message: "Erro ao buscar template de documento" });
  }
});

// Update document template
app.put("/api/document-templates/:id", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, content } = req.body;
    
    if (!name || !type || !content) {
      return res.status(400).json({ message: "Nome, tipo e conteúdo são obrigatórios" });
    }
    
    const result = await pool.query(
      `UPDATE document_templates 
       SET name = $1, type = $2, content = $3, updated_at = NOW() 
       WHERE id = $4 
       RETURNING *`,
      [name, type, content, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Template não encontrado" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating document template:", error);
    res.status(500).json({ message: "Erro ao atualizar template de documento" });
  }
});

// Delete document template
app.delete("/api/document-templates/:id", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `DELETE FROM document_templates WHERE id = $1 RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Template não encontrado" });
    }
    
    res.json({ message: "Template excluído com sucesso" });
  } catch (error) {
    console.error("Error deleting document template:", error);
    res.status(500).json({ message: "Erro ao excluir template de documento" });
  }
});

// Generate document from template
app.post("/api/generate-document", authenticate, async (req, res) => {
  try {
    const { template_id, patient_id, professional_id, ...templateData } = req.body;
    
    if (!template_id || !patient_id) {
      return res.status(400).json({ message: "ID do template e ID do paciente são obrigatórios" });
    }
    
    // Get template
    const templateResult = await pool.query(
      `SELECT * FROM document_templates WHERE id = $1`,
      [template_id]
    );
    
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ message: "Template não encontrado" });
    }
    
    const template = templateResult.rows[0];
    
    // Get patient data
    const patientResult = await pool.query(
      `SELECT * FROM users WHERE id = $1`,
      [patient_id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: "Paciente não encontrado" });
    }
    
    const patient = patientResult.rows[0];
    
    // Get professional data if provided
    let professional = null;
    if (professional_id) {
      const professionalResult = await pool.query(
        `SELECT * FROM users WHERE id = $1`,
        [professional_id]
      );
      
      if (professionalResult.rows.length > 0) {
        professional = professionalResult.rows[0];
      }
    }
    
    // Prepare data for template
    const data = {
      nome: patient.name,
      cpf: patient.cpf,
      email: patient.email,
      telefone: patient.phone,
      endereco: patient.address,
      numero: patient.address_number,
      complemento: patient.address_complement,
      bairro: patient.neighborhood,
      cidade: patient.city,
      estado: patient.state,
      data_atual: new Date().toLocaleDateString('pt-BR'),
      hora_atual: new Date().toLocaleTimeString('pt-BR'),
      ...templateData
    };
    
    // Add professional data if available
    if (professional) {
      data.profissional_nome = professional.name;
      data.profissional_registro = professional.professional_registration || '';
      data.profissional_assinatura = professional.signature_url || '';
    }
    
    // Compile template with Handlebars
    const compiledTemplate = handlebars.compile(template.content);
    const html = compiledTemplate(data);
    
    // Generate PDF with puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    // Add page numbers if document has multiple pages
    await page.evaluateHandle(() => {
      const style = document.createElement('style');
      style.innerHTML = `
        @media print {
          .pageNumber:after {
            content: counter(page);
          }
          
          .pageCount:before {
            content: counter(pages);
          }
          
          footer {
            position: fixed;
            bottom: 0;
            width: 100%;
            text-align: center;
            font-size: 10px;
            color: #666;
          }
        }
      `;
      document.head.appendChild(style);
    });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
      displayHeaderFooter: true,
      footerTemplate: `
        <footer style="width: 100%; text-align: center; font-size: 10px; color: #666;">
          <span>Página <span class="pageNumber"></span> de <span class="pageCount"></span></span>
        </footer>
      `
    });
    
    await browser.close();
    
    // Upload PDF to Cloudinary
    const { v2: cloudinary } = await import('cloudinary');
    
    // Configure Cloudinary
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });
    
    // Convert PDF buffer to base64
    const base64Pdf = pdfBuffer.toString('base64');
    
    // Generate a unique filename
    const filename = `${template.type}_${patient_id}_${Date.now()}`;
    
    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload(
        `data:application/pdf;base64,${base64Pdf}`,
        {
          resource_type: 'raw',
          public_id: filename,
          folder: 'quiro-ferreira/documents',
          format: 'pdf',
          type: 'private'
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
    });
    
    // Save document to database
    const documentResult = await pool.query(
      `INSERT INTO generated_documents (patient_id, professional_id, type, url) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [patient_id, professional_id, template.type, uploadResult.secure_url]
    );
    
    const generatedDocument = documentResult.rows[0];
    
    res.json({
      document: generatedDocument,
      url: uploadResult.secure_url
    });
  } catch (error) {
    console.error("Error generating document:", error);
    res.status(500).json({ message: "Erro ao gerar documento", error: error.message });
  }
});

// Get generated documents for a patient
app.get("/api/generated-documents/patient/:patientId", authenticate, async (req, res) => {
  try {
    const { patientId } = req.params;
    
    const result = await pool.query(
      `SELECT gd.*, dt.name as template_name, u.name as professional_name
       FROM generated_documents gd
       LEFT JOIN users u ON gd.professional_id = u.id
       LEFT JOIN document_templates dt ON gd.type = dt.type
       WHERE gd.patient_id = $1
       ORDER BY gd.created_at DESC`,
      [patientId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching patient documents:", error);
    res.status(500).json({ message: "Erro ao buscar documentos do paciente" });
  }
});

// Get generated documents for a professional
app.get("/api/generated-documents/professional/:professionalId", authenticate, async (req, res) => {
  try {
    const { professionalId } = req.params;
    
    const result = await pool.query(
      `SELECT gd.*, dt.name as template_name, u.name as patient_name
       FROM generated_documents gd
       LEFT JOIN users u ON gd.patient_id = u.id
       LEFT JOIN document_templates dt ON gd.type = dt.type
       WHERE gd.professional_id = $1
       ORDER BY gd.created_at DESC`,
      [professionalId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching professional documents:", error);
    res.status(500).json({ message: "Erro ao buscar documentos do profissional" });
  }
});

// Get document by id
app.get("/api/generated-documents/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT gd.*, dt.name as template_name, 
              p.name as patient_name, p.cpf as patient_cpf,
              u.name as professional_name, u.professional_registration
       FROM generated_documents gd
       LEFT JOIN users p ON gd.patient_id = p.id
       LEFT JOIN users u ON gd.professional_id = u.id
       LEFT JOIN document_templates dt ON gd.type = dt.type
       WHERE gd.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Documento não encontrado" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching document:", error);
    res.status(500).json({ message: "Erro ao buscar documento" });
  }
});

// Save professional signature
app.post("/api/professional/signature", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const { signature_url } = req.body;
    
    if (!signature_url) {
      return res.status(400).json({ message: "URL da assinatura é obrigatória" });
    }
    
    const result = await pool.query(
      `UPDATE users SET signature_url = $1 WHERE id = $2 RETURNING id, signature_url`,
      [signature_url, req.user.id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error saving signature:", error);
    res.status(500).json({ message: "Erro ao salvar assinatura" });
  }
});

// ===== FILE UPLOAD ROUTES =====

// Upload image
app.post('/api/upload-image', authenticate, async (req, res) => {
  try {
    // Use the existing upload middleware
    const uploadMiddleware = createUpload();
    
    if (!uploadMiddleware) {
      return res.status(500).json({ message: 'Erro ao configurar upload' });
    }
    
    // Use the middleware
    uploadMiddleware.single('image')(req, res, async (err) => {
      if (err) {
        console.error('❌ Upload error:', err);
      }
    }
    )
    // Use the processUpload middleware
    processUpload('image')(req, res, async (err) => {
      if (err) return res.status(400).json({ message: err.message });
      
      if (!req.cloudinaryResult) {
        return res.status(400).json({ message: 'Falha ao fazer upload da imagem' });
      }
      
      // Return the secure URL
      res.json({ 
        imageUrl: req.cloudinaryResult.secure_url 
      });
    });
  } catch (error) {
    console.error('❌ Error uploading image:', error);
    res.status(500).json({ message: 'Erro ao fazer upload da imagem' });
  }
});

// Document Templates API

// Create document template table if not exists
app.get('/api/setup-document-tables', authenticate, authorize(['admin']), async (req, res) => {
  try {
    // Create document_templates table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        type text NOT NULL,
        content text NOT NULL,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `);
    
    // Create generated_documents table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        professional_id integer REFERENCES users(id) ON DELETE SET NULL,
        type text NOT NULL,
        url text NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `);
    
    // Add signature_url column to users table if not exists
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'signature_url'
        ) THEN
          ALTER TABLE users ADD COLUMN signature_url text;
        END IF;
      END $$;
    `);
    
    res.json({ message: 'Document tables created successfully' });
  } catch (error) {
    console.error('Error creating document tables:', error);
    res.status(500).json({ message: 'Error creating document tables' });
  }
});

// Get all document templates
app.get('/api/document-templates', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM document_templates ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching document templates:', error);
    res.status(500).json({ message: 'Error fetching document templates' });
  }
});

// Create document template
app.post('/api/document-templates', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, type, content } = req.body;
    
    if (!name || !type || !content) {
      return res.status(400).json({ message: 'Name, type, and content are required' });
    }
    
    const result = await pool.query(
      'INSERT INTO document_templates (name, type, content) VALUES ($1, $2, $3) RETURNING *',
      [name, type, content]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating document template:', error);
    res.status(500).json({ message: 'Error creating document template' });
  }
});

// Update document template
app.put('/api/document-templates/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, content } = req.body;
    
    if (!name || !type || !content) {
      return res.status(400).json({ message: 'Name, type, and content are required' });
    }
    
    const result = await pool.query(
      'UPDATE document_templates SET name = $1, type = $2, content = $3, updated_at = now() WHERE id = $4 RETURNING *',
      [name, type, content, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document template not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating document template:', error);
    res.status(500).json({ message: 'Error updating document template' });
  }
});

// Delete document template
app.delete('/api/document-templates/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM document_templates WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document template not found' });
    }
    
    res.json({ message: 'Document template deleted successfully' });
  } catch (error) {
    console.error('Error deleting document template:', error);
    res.status(500).json({ message: 'Error deleting document template' });
  }
});

// Get generated documents for a patient
app.get('/api/generated-documents/patient/:patientId', authenticate, async (req, res) => {
  try {
    const { patientId } = req.params;
    
    // Check if user is authorized (admin, professional who created the document, or the patient)
    if (
      !req.user.roles.includes('admin') && 
      req.user.id !== parseInt(patientId) &&
      !req.user.roles.includes('professional')
    ) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    
    let query = `
      SELECT gd.*, dt.name as template_name, u.name as patient_name
      FROM generated_documents gd
      LEFT JOIN document_templates dt ON gd.type = dt.type
      LEFT JOIN users u ON gd.patient_id = u.id
      WHERE gd.patient_id = $1
    `;
    
    // If user is a professional, only show documents they created
    const params = [patientId];
    if (req.user.roles.includes('professional') && req.user.id !== parseInt(patientId)) {
      query += ' AND gd.professional_id = $2';
      params.push(req.user.id);
    }
    
    query += ' ORDER BY gd.created_at DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching generated documents:', error);
    res.status(500).json({ message: 'Error fetching generated documents' });
  }
});

// Save professional signature
app.post('/api/professional/signature', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { signature_url } = req.body;
    
    if (!signature_url) {
      return res.status(400).json({ message: 'Signature URL is required' });
    }
    
    await pool.query(
      'UPDATE users SET signature_url = $1 WHERE id = $2',
      [signature_url, req.user.id]
    );
    
    res.json({ message: 'Signature saved successfully' });
  } catch (error) {
    console.error('Error saving signature:', error);
    res.status(500).json({ message: 'Error saving signature' });
  }
});

// Generate document from template
app.post('/api/generate-document', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { template_id, patient_id, professional_id, ...templateData } = req.body;
    
    if (!template_id || !patient_id) {
      return res.status(400).json({ message: 'Template ID and patient ID are required' });
    }
    
    // Get template
    const templateResult = await pool.query('SELECT * FROM document_templates WHERE id = $1', [template_id]);
    
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ message: 'Template not found' });
    }
    
    const template = templateResult.rows[0];
    
    // Get patient data
    const patientResult = await pool.query(
      'SELECT name, cpf, email, phone, address, address_number, address_complement, neighborhood, city, state FROM users WHERE id = $1',
      [patient_id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    
    const patient = patientResult.rows[0];
    
    // Get professional data
    const professionalId = professional_id || req.user.id;
    const professionalResult = await pool.query(
      'SELECT name, professional_registration, signature_url FROM users WHERE id = $1',
      [professionalId]
    );
    
    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Professional not found' });
    }
    
    const professional = professionalResult.rows[0];
    
    // Prepare template data
    const now = new Date();
    const templateContext = {
      nome: patient.name,
      cpf: patient.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
      email: patient.email,
      telefone: patient.phone,
      endereco: patient.address,
      numero: patient.address_number,
      complemento: patient.address_complement,
      bairro: patient.neighborhood,
      cidade: patient.city,
      estado: patient.state,
      data_atual: format(now, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }),
      hora_atual: format(now, "HH:mm", { locale: ptBR }),
      profissional_nome: professional.name,
      profissional_registro: professional.professional_registration,
      profissional_assinatura: professional.signature_url,
      ...templateData
    };
    
    // Load template from file if it exists, otherwise use the template from the database
    let templateContent = template.content;
    const templatePath = path.join(__dirname, 'templates', `${template.type}.html`);
    
    if (fs.existsSync(templatePath)) {
      templateContent = fs.readFileSync(templatePath, 'utf8');
    }
    
    // Compile template
    const compiledTemplate = handlebars.compile(templateContent);
    const html = compiledTemplate(templateContext);
    
    // Generate PDF
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: 'new'
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    // Generate PDF buffer
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
    });
    
    await browser.close();
    
    // Upload PDF to Cloudinary
    const pdfUpload = await cloudinary.uploader.upload(
      `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
      {
        folder: 'quiro-ferreira/documents',
        resource_type: 'raw',
        format: 'pdf',
        public_id: `${template.type}_${patient_id}_${Date.now()}`
      }
    );
    
    // Save document to database
    const documentResult = await pool.query(
      'INSERT INTO generated_documents (patient_id, professional_id, type, url) VALUES ($1, $2, $3, $4) RETURNING *',
      [patient_id, professionalId, template.type, pdfUpload.secure_url]
    );
    
    const document = documentResult.rows[0];
    
    res.json({
      id: document.id,
      patient_id: document.patient_id,
      professional_id: document.professional_id,
      type: document.type,
      url: document.url,
      created_at: document.created_at
    });
  } catch (error) {
    console.error('Error generating document:', error);
    res.status(500).json({ message: 'Error generating document' });
  }
});
// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});