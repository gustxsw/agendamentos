import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { authenticate, authorize } from './middleware/auth.js';
import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import mercadopago from 'mercadopago';

// Load environment variables
dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Configure MercadoPago
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'https://cartaoquiroferreira.com.br', 'https://www.cartaoquiroferreira.com.br'],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Database setup function
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
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_expiry TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        photo_url TEXT,
        signature_url TEXT,
        professional_registration TEXT,
        professional_type VARCHAR(20) DEFAULT 'convenio',
        is_active BOOLEAN DEFAULT TRUE
      );
    `);
    
    // Create service_categories table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create services table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        base_price DECIMAL(10, 2) NOT NULL,
        category_id INTEGER REFERENCES service_categories(id),
        is_base_service BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create dependents table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dependents (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) UNIQUE NOT NULL,
        birth_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create consultations table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id),
        dependent_id INTEGER REFERENCES dependents(id),
        professional_id INTEGER REFERENCES users(id),
        service_id INTEGER REFERENCES services(id),
        value DECIMAL(10, 2) NOT NULL,
        date TIMESTAMP NOT NULL,
        notes TEXT,
        location_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create medical_records table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INTEGER REFERENCES consultations(id),
        patient_id INTEGER NOT NULL,
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
      );
    `);
    
    // Create subscription_payments table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        payment_id VARCHAR(255),
        status VARCHAR(20),
        amount DECIMAL(10, 2),
        payment_method VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP
      );
    `);
    
    // Create agenda_payments table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_payments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id),
        payment_id VARCHAR(255),
        status VARCHAR(20),
        amount DECIMAL(10, 2),
        payment_method VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP
      );
    `);
    
    // Create professional_locations table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_locations (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id),
        clinic_name VARCHAR(255) NOT NULL,
        address VARCHAR(255),
        address_number VARCHAR(20),
        address_complement VARCHAR(255),
        neighborhood VARCHAR(255),
        city VARCHAR(255),
        state VARCHAR(2),
        phone VARCHAR(20),
        is_main BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create document_templates table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create generated_documents table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_documents (
        id SERIAL PRIMARY KEY,
        patient_id INTEGER NOT NULL,
        professional_id INTEGER REFERENCES users(id),
        template_id INTEGER REFERENCES document_templates(id),
        type VARCHAR(50) NOT NULL,
        url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create agenda_patients table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_patients (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id),
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
        is_convenio_patient BOOLEAN DEFAULT FALSE,
        is_archived BOOLEAN DEFAULT FALSE,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create appointments table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id),
        patient_id INTEGER NOT NULL,
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        service_id INTEGER REFERENCES services(id),
        value DECIMAL(10, 2),
        location_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create schedule_config table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_config (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id),
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
      );
    `);

    // Check if columns exist and add them if they don't
    try {
      // Check if professional_type column exists in users table
      const professionalTypeCheck = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'professional_type';
      `);
      
      if (professionalTypeCheck.rows.length === 0) {
        console.log('Adding professional_type column to users table');
        await pool.query(`
          ALTER TABLE users ADD COLUMN professional_type VARCHAR(20) DEFAULT 'convenio';
        `);
      }
      
      // Check if is_active column exists in users table
      const isActiveCheck = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'is_active';
      `);
      
      if (isActiveCheck.rows.length === 0) {
        console.log('Adding is_active column to users table');
        await pool.query(`
          ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
        `);
      }
      
      // Check if is_convenio_patient column exists in agenda_patients table
      const isConvenioPatientCheck = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'agenda_patients' AND column_name = 'is_convenio_patient';
      `);
      
      if (isConvenioPatientCheck.rows.length === 0) {
        console.log('Adding is_convenio_patient column to agenda_patients table');
        await pool.query(`
          ALTER TABLE agenda_patients ADD COLUMN is_convenio_patient BOOLEAN DEFAULT FALSE;
        `);
      }
      
      // Check if linked_at column exists in agenda_patients table
      const linkedAtCheck = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'agenda_patients' AND column_name = 'linked_at';
      `);
      
      if (linkedAtCheck.rows.length === 0) {
        console.log('Adding linked_at column to agenda_patients table');
        await pool.query(`
          ALTER TABLE agenda_patients ADD COLUMN linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        `);
      }
      
      // Check if is_archived column exists in agenda_patients table
      const isArchivedCheck = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'agenda_patients' AND column_name = 'is_archived';
      `);
      
      if (isArchivedCheck.rows.length === 0) {
        console.log('Adding is_archived column to agenda_patients table');
        await pool.query(`
          ALTER TABLE agenda_patients ADD COLUMN is_archived BOOLEAN DEFAULT FALSE;
        `);
      }
      
      // Check if expires_at column exists in agenda_payments table
      const expiresAtCheck = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'agenda_payments' AND column_name = 'expires_at';
      `);
      
      if (expiresAtCheck.rows.length === 0) {
        console.log('Adding expires_at column to agenda_payments table');
        await pool.query(`
          ALTER TABLE agenda_payments ADD COLUMN expires_at TIMESTAMP;
        `);
      }
      
    } catch (error) {
      console.error('Error checking or adding columns:', error);
    }
    
    console.log('✅ Database setup completed successfully');
  } catch (error) {
    console.error('❌ Database setup error:', error);
  }
};

// Run database setup
setupDatabase();

// ===== AUTH ROUTES =====

// Register new user
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
      return res.status(400).json({ message: 'Usuário com este CPF já existe' });
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
        name, cpf, email, phone, birth_date || null, address, address_number, 
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
      user,
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Erro ao registrar usuário' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { cpf, password } = req.body;
    
    // Validate required fields
    if (!cpf || !password) {
      return res.status(400).json({ message: 'CPF e senha são obrigatórios' });
    }
    
    // Find user
    const result = await pool.query('SELECT * FROM users WHERE cpf = $1', [cpf]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }
    
    const user = result.rows[0];
    
    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }
    
    // Determine if role selection is needed
    const needsRoleSelection = user.roles && user.roles.length > 1;
    
    // Return user data (without password)
    delete user.password;
    
    // If only one role, set it as current
    if (user.roles && user.roles.length === 1) {
      // Create JWT token with role
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
      
      user.currentRole = user.roles[0];
      
      return res.status(200).json({ 
        message: 'Login bem-sucedido',
        user,
        token,
        needsRoleSelection: false
      });
    }
    
    // Return without setting current role if multiple roles
    res.status(200).json({ 
      message: 'Login bem-sucedido',
      user,
      needsRoleSelection
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Erro ao fazer login' });
  }
});

// Select role
app.post('/api/auth/select-role', async (req, res) => {
  try {
    const { userId, role } = req.body;
    
    // Validate required fields
    if (!userId || !role) {
      return res.status(400).json({ message: 'ID do usuário e role são obrigatórios' });
    }
    
    // Find user
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    const user = result.rows[0];
    
    // Check if user has the selected role
    if (!user.roles || !user.roles.includes(role)) {
      return res.status(403).json({ message: 'Usuário não possui esta role' });
    }
    
    // Create JWT token with role
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
    
    res.status(200).json({ 
      message: 'Role selecionada com sucesso',
      user,
      token
    });
  } catch (error) {
    console.error('Role selection error:', error);
    res.status(500).json({ message: 'Erro ao selecionar role' });
  }
});

// Switch role
app.post('/api/auth/switch-role', authenticate, async (req, res) => {
  try {
    const { role } = req.body;
    const userId = req.user.id;
    
    // Validate required fields
    if (!role) {
      return res.status(400).json({ message: 'Role é obrigatória' });
    }
    
    // Find user
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    const user = result.rows[0];
    
    // Check if user has the selected role
    if (!user.roles || !user.roles.includes(role)) {
      return res.status(403).json({ message: 'Usuário não possui esta role' });
    }
    
    // Create JWT token with role
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
    
    res.status(200).json({ 
      message: 'Role alterada com sucesso',
      user,
      token
    });
  } catch (error) {
    console.error('Role switch error:', error);
    res.status(500).json({ message: 'Erro ao trocar role' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.status(200).json({ message: 'Logout bem-sucedido' });
});

// ===== USER ROUTES =====

// Get all users (admin only)
app.get('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.*, sc.name as category_name 
      FROM users u
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
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Erro ao buscar usuários' });
  }
});

// Get user by ID
app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Only allow users to access their own data or admins to access any data
    if (req.user.id !== parseInt(id) && !req.user.roles.includes('admin')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const result = await pool.query(`
      SELECT u.*, sc.name as category_name 
      FROM users u
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
      return res.status(400).json({ message: 'Nome, CPF, senha e roles são obrigatórios' });
    }
    
    // Check if user already exists
    const userCheck = await pool.query('SELECT * FROM users WHERE cpf = $1', [cpf]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Usuário com este CPF já existe' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create user
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, password, roles,
        percentage, category_id, professional_type, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
      [
        name, cpf, email, phone, birth_date || null, address, address_number, 
        address_complement, neighborhood, city, state, hashedPassword, roles,
        percentage, category_id, 'convenio', true
      ]
    );
    
    const user = result.rows[0];
    
    // Return user data (without password)
    delete user.password;
    
    res.status(201).json({ 
      message: 'Usuário criado com sucesso',
      user
    });
  } catch (error) {
    console.error('User creation error:', error);
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
      percentage, category_id, professional_type, is_active
    } = req.body;
    
    // Only allow users to update their own data or admins to update any data
    if (req.user.id !== parseInt(id) && !req.user.roles.includes('admin')) {
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
        professional_type = COALESCE($14, professional_type),
        is_active = COALESCE($15, is_active)
      WHERE id = $16 RETURNING *`,
      [
        name, email, phone, birth_date || null, address, address_number, 
        address_complement, neighborhood, city, state, roles,
        percentage, category_id, professional_type, is_active, id
      ]
    );
    
    const user = result.rows[0];
    
    // Return user data (without password)
    delete user.password;
    
    res.status(200).json({ 
      message: 'Usuário atualizado com sucesso',
      user
    });
  } catch (error) {
    console.error('User update error:', error);
    res.status(500).json({ message: 'Erro ao atualizar usuário' });
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
    
    res.status(200).json({ message: 'Usuário excluído com sucesso' });
  } catch (error) {
    console.error('User deletion error:', error);
    res.status(500).json({ message: 'Erro ao excluir usuário' });
  }
});

// Change password
app.put('/api/users/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    
    // Validate required fields
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Senha atual e nova senha são obrigatórias' });
    }
    
    // Check if user exists
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    const user = userResult.rows[0];
    
    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Senha atual incorreta' });
    }
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update password
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);
    
    res.status(200).json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ message: 'Erro ao alterar senha' });
  }
});

// Activate client (admin only)
app.put('/api/users/:id/activate', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { expiry_date } = req.body;
    
    // Validate required fields
    if (!expiry_date) {
      return res.status(400).json({ message: 'Data de expiração é obrigatória' });
    }
    
    // Check if user exists
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Update user subscription status
    await pool.query(
      `UPDATE users SET 
        subscription_status = 'active',
        subscription_expiry = $1
      WHERE id = $2`,
      [expiry_date, id]
    );
    
    res.status(200).json({ message: 'Cliente ativado com sucesso' });
  } catch (error) {
    console.error('Client activation error:', error);
    res.status(500).json({ message: 'Erro ao ativar cliente' });
  }
});

// ===== SERVICE CATEGORY ROUTES =====

// Get all service categories
app.get('/api/service-categories', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM service_categories ORDER BY name');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching service categories:', error);
    res.status(500).json({ message: 'Erro ao buscar categorias de serviço' });
  }
});

// Create service category (admin only)
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
    console.error('Service category creation error:', error);
    res.status(500).json({ message: 'Erro ao criar categoria de serviço' });
  }
});

// ===== SERVICE ROUTES =====

// Get all services
app.get('/api/services', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, sc.name as category_name 
      FROM services s
      LEFT JOIN service_categories sc ON s.category_id = sc.id
      ORDER BY s.name
    `);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ message: 'Erro ao buscar serviços' });
  }
});

// Create service (admin only)
app.post('/api/services', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, description, base_price, category_id, is_base_service } = req.body;
    
    // Validate required fields
    if (!name || !base_price) {
      return res.status(400).json({ message: 'Nome e preço base são obrigatórios' });
    }
    
    // Create service
    const result = await pool.query(
      `INSERT INTO services (name, description, base_price, category_id, is_base_service) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description, base_price, category_id, is_base_service || false]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Service creation error:', error);
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
        description = $2,
        base_price = COALESCE($3, base_price),
        category_id = $4,
        is_base_service = COALESCE($5, is_base_service)
      WHERE id = $6 RETURNING *`,
      [name, description, base_price, category_id, is_base_service, id]
    );
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Service update error:', error);
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
    
    res.status(200).json({ message: 'Serviço excluído com sucesso' });
  } catch (error) {
    console.error('Service deletion error:', error);
    res.status(500).json({ message: 'Erro ao excluir serviço' });
  }
});

// ===== DEPENDENT ROUTES =====

// Get dependents by client ID
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    // Only allow users to access their own dependents or admins to access any dependents
    if (req.user.id !== parseInt(clientId) && !req.user.roles.includes('admin')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const result = await pool.query(
      'SELECT * FROM dependents WHERE client_id = $1 ORDER BY name',
      [clientId]
    );
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching dependents:', error);
    res.status(500).json({ message: 'Erro ao buscar dependentes' });
  }
});

// Create dependent
app.post('/api/dependents', authenticate, async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;
    
    // Validate required fields
    if (!client_id || !name || !cpf) {
      return res.status(400).json({ message: 'ID do cliente, nome e CPF são obrigatórios' });
    }
    
    // Only allow users to create their own dependents or admins to create any dependents
    if (req.user.id !== parseInt(client_id) && !req.user.roles.includes('admin')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if dependent already exists
    const dependentCheck = await pool.query('SELECT * FROM dependents WHERE cpf = $1', [cpf]);
    if (dependentCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Dependente com este CPF já existe' });
    }
    
    // Create dependent
    const result = await pool.query(
      'INSERT INTO dependents (client_id, name, cpf, birth_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [client_id, name, cpf, birth_date || null]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Dependent creation error:', error);
    res.status(500).json({ message: 'Erro ao criar dependente' });
  }
});

// Update dependent
app.put('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, birth_date } = req.body;
    
    // Check if dependent exists
    const dependentCheck = await pool.query('SELECT * FROM dependents WHERE id = $1', [id]);
    if (dependentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }
    
    const dependent = dependentCheck.rows[0];
    
    // Only allow users to update their own dependents or admins to update any dependents
    if (req.user.id !== dependent.client_id && !req.user.roles.includes('admin')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Update dependent
    const result = await pool.query(
      'UPDATE dependents SET name = COALESCE($1, name), birth_date = $2 WHERE id = $3 RETURNING *',
      [name, birth_date || null, id]
    );
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Dependent update error:', error);
    res.status(500).json({ message: 'Erro ao atualizar dependente' });
  }
});

// Delete dependent
app.delete('/api/dependents/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if dependent exists
    const dependentCheck = await pool.query('SELECT * FROM dependents WHERE id = $1', [id]);
    if (dependentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }
    
    const dependent = dependentCheck.rows[0];
    
    // Only allow users to delete their own dependents or admins to delete any dependents
    if (req.user.id !== dependent.client_id && !req.user.roles.includes('admin')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Delete dependent
    await pool.query('DELETE FROM dependents WHERE id = $1', [id]);
    
    res.status(200).json({ message: 'Dependente excluído com sucesso' });
  } catch (error) {
    console.error('Dependent deletion error:', error);
    res.status(500).json({ message: 'Erro ao excluir dependente' });
  }
});

// Lookup dependent by CPF
app.get('/api/dependents/lookup/:cpf', authenticate, async (req, res) => {
  try {
    const { cpf } = req.params;
    
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
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Dependent lookup error:', error);
    res.status(500).json({ message: 'Erro ao buscar dependente' });
  }
});

// ===== CLIENT ROUTES =====

// Lookup client by CPF
app.get('/api/clients/lookup/:cpf', authenticate, async (req, res) => {
  try {
    const { cpf } = req.params;
    
    // Find client
    const result = await pool.query(`
      SELECT id, name, cpf, subscription_status, subscription_expiry
      FROM users
      WHERE cpf = $1 AND 'client' = ANY(roles)
    `, [cpf]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Client lookup error:', error);
    res.status(500).json({ message: 'Erro ao buscar cliente' });
  }
});

// ===== CONSULTATION ROUTES =====

// Get consultations
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query;
    let params = [];
    
    // Different queries based on user role
    if (req.user.currentRole === 'client') {
      // Clients can only see their own consultations and their dependents'
      query = `
        SELECT c.*, s.name as service_name, u.name as professional_name, 
               CASE WHEN c.client_id IS NOT NULL THEN u2.name ELSE d.name END as client_name,
               c.dependent_id IS NOT NULL as is_dependent
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
      // Professionals can only see consultations they performed
      query = `
        SELECT c.*, s.name as service_name, 
               CASE WHEN c.client_id IS NOT NULL THEN u2.name ELSE d.name END as client_name,
               c.dependent_id IS NOT NULL as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        LEFT JOIN users u2 ON c.client_id = u2.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE c.professional_id = $1
        ORDER BY c.date DESC
      `;
      params = [req.user.id];
    } else if (req.user.currentRole === 'clinic') {
      // Clinics can see all consultations by their professionals
      query = `
        SELECT c.*, s.name as service_name, u.name as professional_name, 
               CASE WHEN c.client_id IS NOT NULL THEN u2.name ELSE d.name END as client_name,
               c.dependent_id IS NOT NULL as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users u ON c.professional_id = u.id
        LEFT JOIN users u2 ON c.client_id = u2.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        ORDER BY c.date DESC
      `;
    } else {
      // Admins can see all consultations
      query = `
        SELECT c.*, s.name as service_name, u.name as professional_name, 
               CASE WHEN c.client_id IS NOT NULL THEN u2.name ELSE d.name END as client_name,
               c.dependent_id IS NOT NULL as is_dependent
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        JOIN users u ON c.professional_id = u.id
        LEFT JOIN users u2 ON c.client_id = u2.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        ORDER BY c.date DESC
      `;
    }
    
    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching consultations:', error);
    res.status(500).json({ message: 'Erro ao buscar consultas' });
  }
});

// Create consultation
app.post('/api/consultations', authenticate, async (req, res) => {
  try {
    const { 
      client_id, dependent_id, professional_id, service_id, 
      value, date, notes, location_id 
    } = req.body;
    
    // Validate required fields
    if ((!client_id && !dependent_id) || !professional_id || !service_id || !value || !date) {
      return res.status(400).json({ 
        message: 'Cliente/dependente, profissional, serviço, valor e data são obrigatórios' 
      });
    }
    
    // Only professionals, clinics, and admins can create consultations
    if (!['professional', 'clinic', 'admin'].includes(req.user.currentRole)) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // If professional role, can only create consultations for themselves
    if (req.user.currentRole === 'professional' && req.user.id !== professional_id) {
      return res.status(403).json({ message: 'Você só pode registrar consultas para você mesmo' });
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
    console.error('Consultation creation error:', error);
    res.status(500).json({ message: 'Erro ao criar consulta' });
  }
});

// ===== PROFESSIONAL ROUTES =====

// Get all professionals
app.get('/api/professionals', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.cpf, u.email, u.phone, u.address, u.address_number, 
             u.address_complement, u.neighborhood, u.city, u.state, u.photo_url,
             u.professional_registration, sc.name as category_name,
             COALESCE(u.professional_type, 'convenio') as professional_type,
             COALESCE(u.percentage, 50) as percentage
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE 'professional' = ANY(u.roles)
      AND COALESCE(u.is_active, TRUE) = TRUE
      ORDER BY u.name
    `);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching professionals:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais' });
  }
});

// ===== CLINIC ROUTES =====

// Get clinic stats
app.get('/api/clinic/stats', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    // Get current month date range
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    // Get total professionals
    const professionalsResult = await pool.query(`
      SELECT COUNT(*) as total_professionals,
             COUNT(CASE WHEN COALESCE(is_active, TRUE) = TRUE THEN 1 END) as active_professionals
      FROM users
      WHERE 'professional' = ANY(roles)
    `);
    
    // Get total consultations for current month
    const consultationsResult = await pool.query(`
      SELECT COUNT(*) as total_consultations
      FROM consultations
      WHERE date >= $1 AND date <= $2
    `, [firstDay.toISOString(), lastDay.toISOString()]);
    
    // Get monthly revenue
    const revenueResult = await pool.query(`
      SELECT COALESCE(SUM(value), 0) as monthly_revenue
      FROM consultations
      WHERE date >= $1 AND date <= $2
    `, [firstDay.toISOString(), lastDay.toISOString()]);
    
    // Get pending payments (amount to be paid to professionals)
    const paymentsResult = await pool.query(`
      SELECT COALESCE(SUM(c.value * (u.percentage / 100)), 0) as pending_payments
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date >= $1 AND c.date <= $2
    `, [firstDay.toISOString(), lastDay.toISOString()]);
    
    const stats = {
      total_professionals: parseInt(professionalsResult.rows[0].total_professionals),
      active_professionals: parseInt(professionalsResult.rows[0].active_professionals),
      total_consultations: parseInt(consultationsResult.rows[0].total_consultations),
      monthly_revenue: parseFloat(revenueResult.rows[0].monthly_revenue),
      pending_payments: parseFloat(paymentsResult.rows[0].pending_payments)
    };
    
    res.status(200).json(stats);
  } catch (error) {
    console.error('Error fetching clinic stats:', error);
    res.status(500).json({ message: 'Erro ao buscar estatísticas da clínica' });
  }
});

// Get clinic professionals
app.get('/api/clinic/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.cpf, u.email, u.phone, u.photo_url,
             u.professional_registration, sc.name as category_name,
             COALESCE(u.professional_type, 'convenio') as professional_type,
             COALESCE(u.percentage, 50) as percentage,
             COALESCE(u.is_active, TRUE) as is_active
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE 'professional' = ANY(u.roles)
      ORDER BY u.name
    `);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic professionals:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais da clínica' });
  }
});

// Add professional to clinic
app.post('/api/clinic/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { 
      name, cpf, email, phone, password, professional_registration,
      category_id, percentage, professional_type
    } = req.body;
    
    // Validate required fields
    if (!name || !cpf || !password) {
      return res.status(400).json({ message: 'Nome, CPF e senha são obrigatórios' });
    }
    
    // Check if user already exists
    const userCheck = await pool.query('SELECT * FROM users WHERE cpf = $1', [cpf]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Usuário com este CPF já existe' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create professional
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, password, roles, professional_registration,
        category_id, percentage, professional_type, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        name, cpf, email, phone, hashedPassword, ['professional'], 
        professional_registration, category_id, percentage || 50, 
        professional_type || 'convenio', true
      ]
    );
    
    const professional = result.rows[0];
    
    // Return professional data (without password)
    delete professional.password;
    
    res.status(201).json({ 
      message: 'Profissional cadastrado com sucesso',
      professional
    });
  } catch (error) {
    console.error('Professional creation error:', error);
    res.status(500).json({ message: 'Erro ao cadastrar profissional' });
  }
});

// Update professional
app.put('/api/clinic/professionals/:id', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { id } = req.params;
    const { percentage, is_active } = req.body;
    
    // Check if professional exists
    const professionalCheck = await pool.query(`
      SELECT * FROM users 
      WHERE id = $1 AND 'professional' = ANY(roles)
    `, [id]);
    
    if (professionalCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    // Update professional
    const result = await pool.query(
      `UPDATE users SET 
        percentage = COALESCE($1, percentage),
        is_active = COALESCE($2, is_active)
      WHERE id = $3 RETURNING *`,
      [percentage, is_active, id]
    );
    
    const professional = result.rows[0];
    
    // Return professional data (without password)
    delete professional.password;
    
    res.status(200).json({ 
      message: 'Profissional atualizado com sucesso',
      professional
    });
  } catch (error) {
    console.error('Professional update error:', error);
    res.status(500).json({ message: 'Erro ao atualizar profissional' });
  }
});

// Get clinic patients
app.get('/api/clinic/patients', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    // Get all patients from consultations
    const result = await pool.query(`
      WITH unique_patients AS (
        SELECT 
          CASE 
            WHEN c.client_id IS NOT NULL THEN c.client_id
            ELSE d.id
          END as id,
          CASE 
            WHEN c.client_id IS NOT NULL THEN u.name
            ELSE d.name
          END as name,
          CASE 
            WHEN c.client_id IS NOT NULL THEN u.cpf
            ELSE d.cpf
          END as cpf,
          u.email,
          u.phone,
          CASE 
            WHEN c.client_id IS NOT NULL THEN u.birth_date
            ELSE d.birth_date
          END as birth_date,
          TRUE as is_convenio_patient,
          c.professional_id,
          up.name as professional_name
        FROM consultations c
        LEFT JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        LEFT JOIN users up ON c.professional_id = up.id
        GROUP BY 
          CASE WHEN c.client_id IS NOT NULL THEN c.client_id ELSE d.id END,
          CASE WHEN c.client_id IS NOT NULL THEN u.name ELSE d.name END,
          CASE WHEN c.client_id IS NOT NULL THEN u.cpf ELSE d.cpf END,
          u.email, u.phone,
          CASE WHEN c.client_id IS NOT NULL THEN u.birth_date ELSE d.birth_date END,
          c.professional_id, up.name
      )
      SELECT * FROM unique_patients
      ORDER BY name
    `);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic patients:', error);
    res.status(500).json({ message: 'Erro ao buscar pacientes da clínica' });
  }
});

// Get clinic agenda professionals
app.get('/api/clinic/agenda/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, COALESCE(u.professional_type, 'convenio') as professional_type
      FROM users u
      WHERE 'professional' = ANY(u.roles)
      AND COALESCE(u.is_active, TRUE) = TRUE
      AND (COALESCE(u.professional_type, 'convenio') = 'agenda' 
           OR COALESCE(u.professional_type, 'convenio') = 'both')
      ORDER BY u.name
    `);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic agenda professionals:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais da agenda' });
  }
});

// Get clinic agenda appointments
app.get('/api/clinic/agenda/appointments', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { professional_id, start_date, end_date } = req.query;
    
    // Validate required fields
    if (!professional_id || !start_date || !end_date) {
      return res.status(400).json({ 
        message: 'ID do profissional, data inicial e data final são obrigatórios' 
      });
    }
    
    // Parse dates
    const parsedStartDate = new Date(start_date);
    const parsedEndDate = new Date(end_date);
    
    if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
      return res.status(400).json({ message: 'Datas inválidas' });
    }
    
    // Get appointments
    const result = await pool.query(`
      SELECT a.*, p.name as patient_name, p.phone as patient_phone, 
             COALESCE(p.is_convenio_patient, FALSE) as is_convenio_patient
      FROM appointments a
      JOIN agenda_patients p ON a.patient_id = p.id
      WHERE a.professional_id = $1
      AND a.date >= $2::timestamp
      AND a.date <= $3::timestamp
      ORDER BY a.date
    `, [professional_id, parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic agenda appointments:', error);
    res.status(500).json({ message: 'Erro ao buscar agendamentos' });
  }
});

// Register clinic consultation
app.post('/api/clinic/consultations', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { 
      client_id, dependent_id, professional_id, service_id, 
      value, date, notes, location_id 
    } = req.body;
    
    // Validate required fields
    if ((!client_id && !dependent_id) || !professional_id || !service_id || !value || !date) {
      return res.status(400).json({ 
        message: 'Cliente/dependente, profissional, serviço, valor e data são obrigatórios' 
      });
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
    console.error('Clinic consultation creation error:', error);
    res.status(500).json({ message: 'Erro ao registrar consulta' });
  }
});

// Get clinic reports
app.get('/api/clinic/reports', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Parse dates
    const parsedStartDate = new Date(start_date);
    const parsedEndDate = new Date(end_date);
    
    if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
      return res.status(400).json({ message: 'Datas inválidas' });
    }
    
    // Get professional reports
    const result = await pool.query(`
      SELECT 
        c.professional_id,
        u.name as professional_name,
        COUNT(c.id) as total_consultations,
        SUM(c.value) as total_revenue,
        SUM(c.value * (COALESCE(u.percentage, 50) / 100)) as professional_payment,
        SUM(c.value * (1 - COALESCE(u.percentage, 50) / 100)) as clinic_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date >= $1::timestamp
      AND c.date <= $2::timestamp
      GROUP BY c.professional_id, u.name, u.percentage
      ORDER BY u.name
    `, [parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error generating clinic reports:', error);
    res.status(500).json({ message: 'Erro ao gerar relatórios' });
  }
});

// Get professional consultation details
app.get('/api/clinic/reports/professional/:professionalId', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { professionalId } = req.params;
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Parse dates
    const parsedStartDate = new Date(start_date);
    const parsedEndDate = new Date(end_date);
    
    if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
      return res.status(400).json({ message: 'Datas inválidas' });
    }
    
    // Get consultation details
    const result = await pool.query(`
      SELECT 
        c.id,
        c.date,
        CASE 
          WHEN c.client_id IS NOT NULL THEN u2.name
          ELSE d.name
        END as patient_name,
        s.name as service_name,
        c.value,
        c.value * (COALESCE(u.percentage, 50) / 100) as professional_payment,
        c.value * (1 - COALESCE(u.percentage, 50) / 100) as clinic_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      JOIN services s ON c.service_id = s.id
      LEFT JOIN users u2 ON c.client_id = u2.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE c.professional_id = $1
      AND c.date >= $2::timestamp
      AND c.date <= $3::timestamp
      ORDER BY c.date
    `, [professionalId, parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching professional consultation details:', error);
    res.status(500).json({ message: 'Erro ao buscar detalhes das consultas' });
  }
});

// Get clinic medical records
app.get('/api/clinic/medical-records/patient/:patientId', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { patientId } = req.params;
    
    // Get medical records
    const result = await pool.query(`
      SELECT 
        mr.id,
        mr.consultation_id,
        mr.patient_id,
        CASE 
          WHEN c.client_id IS NOT NULL THEN u2.name
          ELSE d.name
        END as patient_name,
        CASE 
          WHEN c.client_id IS NOT NULL THEN u2.cpf
          ELSE d.cpf
        END as patient_cpf,
        c.date as consultation_date,
        s.name as service_name,
        mr.chief_complaint,
        mr.diagnosis,
        mr.treatment_plan,
        u.name as professional_name,
        u.professional_registration,
        mr.created_at
      FROM medical_records mr
      JOIN consultations c ON mr.consultation_id = c.id
      JOIN services s ON c.service_id = s.id
      JOIN users u ON c.professional_id = u.id
      LEFT JOIN users u2 ON c.client_id = u2.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE mr.patient_id = $1
      ORDER BY c.date DESC
    `, [patientId]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic medical records:', error);
    res.status(500).json({ message: 'Erro ao buscar prontuários' });
  }
});

// ===== REPORT ROUTES =====

// Get revenue report
app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Parse dates
    const parsedStartDate = new Date(start_date);
    const parsedEndDate = new Date(end_date);
    
    if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
      return res.status(400).json({ message: 'Datas inválidas' });
    }
    
    // Get total revenue
    const totalRevenueResult = await pool.query(`
      SELECT COALESCE(SUM(value), 0) as total_revenue
      FROM consultations
      WHERE date >= $1::timestamp
      AND date <= $2::timestamp
    `, [parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    const totalRevenue = parseFloat(totalRevenueResult.rows[0].total_revenue);
    
    // Get revenue by professional
    const professionalRevenueResult = await pool.query(`
      SELECT 
        u.id as professional_id,
        u.name as professional_name,
        COALESCE(u.percentage, 50) as professional_percentage,
        COUNT(c.id) as consultation_count,
        COALESCE(SUM(c.value), 0) as revenue,
        COALESCE(SUM(c.value * (COALESCE(u.percentage, 50) / 100)), 0) as professional_payment,
        COALESCE(SUM(c.value * (1 - COALESCE(u.percentage, 50) / 100)), 0) as clinic_revenue
      FROM users u
      LEFT JOIN consultations c ON u.id = c.professional_id
        AND c.date >= $1::timestamp
        AND c.date <= $2::timestamp
      WHERE 'professional' = ANY(u.roles)
      GROUP BY u.id, u.name, u.percentage
      ORDER BY u.name
    `, [parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    // Get revenue by service
    const serviceRevenueResult = await pool.query(`
      SELECT 
        s.id as service_id,
        s.name as service_name,
        COUNT(c.id) as consultation_count,
        COALESCE(SUM(c.value), 0) as revenue
      FROM services s
      LEFT JOIN consultations c ON s.id = c.service_id
        AND c.date >= $1::timestamp
        AND c.date <= $2::timestamp
      GROUP BY s.id, s.name
      ORDER BY s.name
    `, [parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    const report = {
      total_revenue: totalRevenue,
      revenue_by_professional: professionalRevenueResult.rows,
      revenue_by_service: serviceRevenueResult.rows
    };
    
    res.status(200).json(report);
  } catch (error) {
    console.error('Error generating revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de faturamento' });
  }
});

// Get new clients report
app.get('/api/reports/new-clients', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Parse dates
    const parsedStartDate = new Date(start_date);
    const parsedEndDate = new Date(end_date);
    
    if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
      return res.status(400).json({ message: 'Datas inválidas' });
    }
    
    // Get total new clients
    const totalNewClientsResult = await pool.query(`
      SELECT COUNT(*) as total_new_clients
      FROM users
      WHERE 'client' = ANY(roles)
      AND created_at >= $1::timestamp
      AND created_at <= $2::timestamp
    `, [parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    const totalNewClients = parseInt(totalNewClientsResult.rows[0].total_new_clients);
    
    // Get subscription revenue
    const subscriptionRevenueResult = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as subscription_revenue
      FROM subscription_payments
      WHERE created_at >= $1::timestamp
      AND created_at <= $2::timestamp
      AND status = 'approved'
    `, [parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    const subscriptionRevenue = parseFloat(subscriptionRevenueResult.rows[0].subscription_revenue);
    
    // Get clients by month
    const clientsByMonthResult = await pool.query(`
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*) as count,
        COALESCE(SUM(250), 0) as revenue
      FROM users
      WHERE 'client' = ANY(roles)
      AND created_at >= $1::timestamp
      AND created_at <= $2::timestamp
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month
    `, [parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    const report = {
      total_new_clients: totalNewClients,
      subscription_revenue: subscriptionRevenue,
      clients_by_month: clientsByMonthResult.rows
    };
    
    res.status(200).json(report);
  } catch (error) {
    console.error('Error generating new clients report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de novos clientes' });
  }
});

// Get professional revenue summary
app.get('/api/reports/professional-revenue-summary', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Parse dates
    const parsedStartDate = new Date(start_date);
    const parsedEndDate = new Date(end_date);
    
    if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
      return res.status(400).json({ message: 'Datas inválidas' });
    }
    
    // Get total revenue
    const totalRevenueResult = await pool.query(`
      SELECT COALESCE(SUM(value), 0) as total_revenue
      FROM consultations
      WHERE date >= $1::timestamp
      AND date <= $2::timestamp
    `, [parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    const totalRevenue = parseFloat(totalRevenueResult.rows[0].total_revenue);
    
    // Get revenue by professional
    const professionalRevenueResult = await pool.query(`
      SELECT 
        u.id as professional_id,
        u.name as professional_name,
        COALESCE(u.percentage, 50) as professional_percentage,
        COUNT(c.id) as consultation_count,
        COALESCE(SUM(c.value), 0) as revenue,
        COALESCE(SUM(c.value * (COALESCE(u.percentage, 50) / 100)), 0) as professional_payment,
        COALESCE(SUM(c.value * (1 - COALESCE(u.percentage, 50) / 100)), 0) as clinic_revenue
      FROM users u
      LEFT JOIN consultations c ON u.id = c.professional_id
        AND c.date >= $1::timestamp
        AND c.date <= $2::timestamp
      WHERE 'professional' = ANY(u.roles)
      GROUP BY u.id, u.name, u.percentage
      ORDER BY u.name
    `, [parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    // Get revenue by service
    const serviceRevenueResult = await pool.query(`
      SELECT 
        s.id as service_id,
        s.name as service_name,
        COUNT(c.id) as consultation_count,
        COALESCE(SUM(c.value), 0) as revenue
      FROM services s
      LEFT JOIN consultations c ON s.id = c.service_id
        AND c.date >= $1::timestamp
        AND c.date <= $2::timestamp
      GROUP BY s.id, s.name
      ORDER BY s.name
    `, [parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    const report = {
      total_revenue: totalRevenue,
      revenue_by_professional: professionalRevenueResult.rows,
      revenue_by_service: serviceRevenueResult.rows
    };
    
    res.status(200).json(report);
  } catch (error) {
    console.error('Error generating professional revenue summary:', error);
    res.status(500).json({ message: 'Erro ao gerar resumo de faturamento por profissional' });
  }
});

// Get total revenue report
app.get('/api/reports/total-revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Parse dates
    const parsedStartDate = new Date(start_date);
    const parsedEndDate = new Date(end_date);
    
    if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
      return res.status(400).json({ message: 'Datas inválidas' });
    }
    
    // Get subscription revenue
    const subscriptionRevenueResult = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as subscription_revenue
      FROM subscription_payments
      WHERE created_at >= $1::timestamp
      AND created_at <= $2::timestamp
      AND status = 'approved'
    `, [parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    const subscriptionRevenue = parseFloat(subscriptionRevenueResult.rows[0].subscription_revenue);
    
    // Get consultation revenue (clinic's portion)
    const consultationRevenueResult = await pool.query(`
      SELECT COALESCE(SUM(c.value * (1 - COALESCE(u.percentage, 50) / 100)), 0) as consultation_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date >= $1::timestamp
      AND c.date <= $2::timestamp
    `, [parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    const consultationRevenue = parseFloat(consultationRevenueResult.rows[0].consultation_revenue);
    
    // Calculate total revenue
    const totalRevenue = subscriptionRevenue + consultationRevenue;
    
    const report = {
      subscription_revenue: subscriptionRevenue,
      consultation_revenue: consultationRevenue,
      total_revenue: totalRevenue,
      clinic_total_revenue: totalRevenue
    };
    
    res.status(200).json(report);
  } catch (error) {
    console.error('Error generating total revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de receita total' });
  }
});

// Get professional revenue report
app.get('/api/reports/professional-revenue', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const professionalId = req.user.id;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Parse dates
    const parsedStartDate = new Date(start_date);
    const parsedEndDate = new Date(end_date);
    
    if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
      return res.status(400).json({ message: 'Datas inválidas' });
    }
    
    // Get professional percentage
    const professionalResult = await pool.query(`
      SELECT COALESCE(percentage, 50) as percentage
      FROM users
      WHERE id = $1
    `, [professionalId]);
    
    const percentage = parseFloat(professionalResult.rows[0].percentage);
    
    // Get summary
    const summaryResult = await pool.query(`
      SELECT 
        COUNT(c.id) as consultation_count,
        COALESCE(SUM(c.value), 0) as total_revenue,
        COALESCE(SUM(c.value * (1 - $1 / 100)), 0) as amount_to_pay
      FROM consultations c
      WHERE c.professional_id = $2
      AND c.date >= $3::timestamp
      AND c.date <= $4::timestamp
    `, [percentage, professionalId, parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    // Get consultations
    const consultationsResult = await pool.query(`
      SELECT 
        c.id as consultation_id,
        c.date,
        CASE 
          WHEN c.client_id IS NOT NULL THEN u2.name
          ELSE d.name
        END as client_name,
        s.name as service_name,
        c.value as total_value,
        c.value * (1 - $1 / 100) as amount_to_pay
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      LEFT JOIN users u2 ON c.client_id = u2.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE c.professional_id = $2
      AND c.date >= $3::timestamp
      AND c.date <= $4::timestamp
      ORDER BY c.date DESC
    `, [percentage, professionalId, parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    const report = {
      summary: {
        professional_percentage: percentage,
        ...summaryResult.rows[0]
      },
      consultations: consultationsResult.rows
    };
    
    res.status(200).json(report);
  } catch (error) {
    console.error('Error generating professional revenue report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de faturamento' });
  }
});

// Get professional consultations report
app.get('/api/reports/professional-consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const professionalId = req.user.id;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Parse dates
    const parsedStartDate = new Date(start_date);
    const parsedEndDate = new Date(end_date);
    
    if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
      return res.status(400).json({ message: 'Datas inválidas' });
    }
    
    // Get professional percentage
    const professionalResult = await pool.query(`
      SELECT COALESCE(percentage, 50) as percentage
      FROM users
      WHERE id = $1
    `, [professionalId]);
    
    const percentage = parseFloat(professionalResult.rows[0].percentage);
    
    // Get summary
    const summaryResult = await pool.query(`
      SELECT 
        COUNT(c.id) as total_consultations,
        COUNT(CASE WHEN c.client_id IS NOT NULL THEN 1 END) as convenio_consultations,
        COUNT(CASE WHEN c.client_id IS NULL THEN 1 END) as particular_consultations,
        COALESCE(SUM(c.value), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN c.client_id IS NOT NULL THEN c.value ELSE 0 END), 0) as convenio_revenue,
        COALESCE(SUM(CASE WHEN c.client_id IS NULL THEN c.value ELSE 0 END), 0) as particular_revenue,
        COALESCE(SUM(CASE WHEN c.client_id IS NOT NULL THEN c.value * (1 - $1 / 100) ELSE 0 END), 0) as amount_to_pay
      FROM consultations c
      WHERE c.professional_id = $2
      AND c.date >= $3::timestamp
      AND c.date <= $4::timestamp
    `, [percentage, professionalId, parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
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
        CASE WHEN mr.id IS NOT NULL THEN TRUE ELSE FALSE END as has_medical_record
      FROM (
        SELECT 
          c.id,
          c.id as consultation_id,
          c.date,
          CASE 
            WHEN c.client_id IS NOT NULL THEN u2.name
            ELSE d.name
          END as patient_name,
          CASE 
            WHEN c.client_id IS NOT NULL THEN TRUE
            ELSE FALSE
          END as is_convenio_patient,
          s.name as service_name,
          c.value as total_value,
          CASE 
            WHEN c.client_id IS NOT NULL THEN c.value * (1 - $1 / 100)
            ELSE 0
          END as amount_to_pay,
          CASE 
            WHEN c.client_id IS NOT NULL THEN c.client_id
            ELSE d.id
          END as patient_id
        FROM consultations c
        JOIN services s ON c.service_id = s.id
        LEFT JOIN users u2 ON c.client_id = u2.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        WHERE c.professional_id = $2
        AND c.date >= $3::timestamp
        AND c.date <= $4::timestamp
      ) c
      LEFT JOIN medical_records mr ON c.id = mr.consultation_id
      ORDER BY c.date DESC
    `, [percentage, professionalId, parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    const report = {
      summary: summaryResult.rows[0],
      consultations: consultationsResult.rows
    };
    
    res.status(200).json(report);
  } catch (error) {
    console.error('Error generating professional consultations report:', error);
    res.status(500).json({ message: 'Erro ao gerar relatório de consultas' });
  }
});

// ===== MEDICAL RECORD ROUTES =====

// Get medical records by patient ID
app.get('/api/medical-records/patient/:patientId', authenticate, async (req, res) => {
  try {
    const { patientId } = req.params;
    
    // Get medical records
    const result = await pool.query(`
      SELECT 
        mr.id,
        mr.consultation_id,
        mr.patient_id,
        CASE 
          WHEN c.client_id IS NOT NULL THEN u2.name
          ELSE d.name
        END as patient_name,
        CASE 
          WHEN c.client_id IS NOT NULL THEN u2.cpf
          ELSE d.cpf
        END as patient_cpf,
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
      JOIN consultations c ON mr.consultation_id = c.id
      JOIN services s ON c.service_id = s.id
      JOIN users u ON c.professional_id = u.id
      LEFT JOIN users u2 ON c.client_id = u2.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE mr.patient_id = $1
      ORDER BY c.date DESC
    `, [patientId]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching medical records:', error);
    res.status(500).json({ message: 'Erro ao buscar prontuários' });
  }
});

// Create medical record
app.post('/api/medical-records', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { 
      patient_id, chief_complaint, anamnesis, physical_examination,
      diagnosis, treatment_plan, clinical_evolution, internal_notes
    } = req.body;
    
    // Validate required fields
    if (!patient_id) {
      return res.status(400).json({ message: 'ID do paciente é obrigatório' });
    }
    
    // Find the most recent consultation for this patient by this professional
    const consultationResult = await pool.query(`
      SELECT c.id
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE (
        (c.client_id = $1) OR
        (c.dependent_id = $1) OR
        (u.id = $1) OR
        (d.id = $1)
      )
      AND c.professional_id = $2
      ORDER BY c.date DESC
      LIMIT 1
    `, [patient_id, req.user.id]);
    
    if (consultationResult.rows.length === 0) {
      return res.status(404).json({ message: 'Nenhuma consulta encontrada para este paciente' });
    }
    
    const consultation_id = consultationResult.rows[0].id;
    
    // Create medical record
    const result = await pool.query(
      `INSERT INTO medical_records (
        consultation_id, patient_id, professional_id, chief_complaint, anamnesis,
        physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        consultation_id, patient_id, req.user.id, chief_complaint, anamnesis,
        physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
      ]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Medical record creation error:', error);
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
    
    // Check if medical record exists and belongs to this professional
    const recordCheck = await pool.query(`
      SELECT mr.*
      FROM medical_records mr
      WHERE mr.id = $1
      AND mr.professional_id = $2
    `, [id, req.user.id]);
    
    if (recordCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Prontuário não encontrado ou não pertence a este profissional' });
    }
    
    // Update medical record
    const result = await pool.query(
      `UPDATE medical_records SET 
        chief_complaint = $1,
        anamnesis = $2,
        physical_examination = $3,
        diagnosis = $4,
        treatment_plan = $5,
        clinical_evolution = $6,
        internal_notes = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 RETURNING *`,
      [
        chief_complaint, anamnesis, physical_examination,
        diagnosis, treatment_plan, clinical_evolution, internal_notes, id
      ]
    );
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Medical record update error:', error);
    res.status(500).json({ message: 'Erro ao atualizar prontuário' });
  }
});

// ===== AGENDA ROUTES =====

// Get agenda subscription status
app.get('/api/agenda/subscription-status', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Check if agenda_payments table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'agenda_payments'
      ) as exists
    `);
    
    if (!tableCheck.rows[0].exists) {
      // Create agenda_payments table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS agenda_payments (
          id SERIAL PRIMARY KEY,
          professional_id INTEGER REFERENCES users(id),
          payment_id VARCHAR(255),
          status VARCHAR(20),
          amount DECIMAL(10, 2),
          payment_method VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP
        );
      `);
    }
    
    // Check if expires_at column exists
    const columnCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'agenda_payments' AND column_name = 'expires_at'
      ) as exists
    `);
    
    if (!columnCheck.rows[0].exists) {
      // Add expires_at column if it doesn't exist
      await pool.query(`
        ALTER TABLE agenda_payments ADD COLUMN expires_at TIMESTAMP;
      `);
    }
    
    // Get subscription status
    const result = await pool.query(`
      SELECT status, expires_at
      FROM agenda_payments
      WHERE professional_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [req.user.id]);
    
    let status = 'none';
    let expires_at = null;
    let days_remaining = 0;
    let can_use_agenda = false;
    
    if (result.rows.length > 0) {
      status = result.rows[0].status;
      expires_at = result.rows[0].expires_at;
      
      // Calculate days remaining
      if (expires_at) {
        const expiryDate = new Date(expires_at);
        const now = new Date();
        const diffTime = expiryDate.getTime() - now.getTime();
        days_remaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Check if subscription is active
        if (status === 'active' && days_remaining > 0) {
          can_use_agenda = true;
        } else if (days_remaining <= 0) {
          status = 'expired';
        }
      }
    }
    
    res.status(200).json({
      status,
      expires_at,
      days_remaining,
      can_use_agenda
    });
  } catch (error) {
    console.error('Error getting agenda subscription status:', error);
    res.status(500).json({ message: 'Erro ao verificar status da assinatura da agenda' });
  }
});

// Create agenda subscription payment
app.post('/api/agenda/create-subscription-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Create preference
    const preference = {
      items: [
        {
          title: 'Assinatura Mensal da Agenda Profissional',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: 49.90
        }
      ],
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda`
      },
      auto_return: 'approved',
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/agenda/webhook`,
      external_reference: `professional_${req.user.id}`,
      metadata: {
        professional_id: req.user.id,
        payment_type: 'agenda_subscription'
      }
    };
    
    const response = await mercadopago.preferences.create(preference);
    
    res.status(200).json({
      id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point
    });
  } catch (error) {
    console.error('Error creating agenda subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento da assinatura da agenda' });
  }
});

// Agenda webhook
app.post('/api/agenda/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      
      // Get payment details
      const payment = await mercadopago.payment.findById(paymentId);
      
      if (payment.body.status === 'approved') {
        const metadata = payment.body.metadata || {};
        const externalReference = payment.body.external_reference || '';
        
        // Check if it's an agenda subscription payment
        if (metadata.payment_type === 'agenda_subscription' || externalReference.startsWith('professional_')) {
          const professionalId = metadata.professional_id || externalReference.split('_')[1];
          
          if (!professionalId) {
            console.error('Professional ID not found in payment metadata or external reference');
            return res.status(400).json({ message: 'Professional ID not found' });
          }
          
          // Calculate expiry date (30 days from now)
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 30);
          
          // Save payment
          await pool.query(`
            INSERT INTO agenda_payments (
              professional_id, payment_id, status, amount, payment_method, expires_at
            ) VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            professionalId, 
            paymentId, 
            'active', 
            payment.body.transaction_amount, 
            payment.body.payment_method_id,
            expiryDate.toISOString()
          ]);
          
          console.log(`Agenda subscription payment approved for professional ${professionalId}`);
        }
      }
    }
    
    res.status(200).send();
  } catch (error) {
    console.error('Agenda webhook error:', error);
    res.status(500).json({ message: 'Erro ao processar webhook da agenda' });
  }
});

// Get schedule config
app.get('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Check if schedule_config table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'schedule_config'
      ) as exists
    `);
    
    if (!tableCheck.rows[0].exists) {
      // Create schedule_config table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS schedule_config (
          id SERIAL PRIMARY KEY,
          professional_id INTEGER REFERENCES users(id),
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
        );
      `);
    }
    
    // Get schedule config
    const result = await pool.query(`
      SELECT *
      FROM schedule_config
      WHERE professional_id = $1
    `, [req.user.id]);
    
    if (result.rows.length === 0) {
      // Create default schedule config
      const defaultConfig = await pool.query(`
        INSERT INTO schedule_config (
          professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
          wednesday_start, wednesday_end, thursday_start, thursday_end,
          friday_start, friday_end, saturday_start, saturday_end,
          sunday_start, sunday_end, slot_duration
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *
      `, [
        req.user.id, 
        '08:00', '18:00', '08:00', '18:00', 
        '08:00', '18:00', '08:00', '18:00', 
        '08:00', '18:00', null, null, 
        null, null, 30
      ]);
      
      res.status(200).json(defaultConfig.rows[0]);
    } else {
      res.status(200).json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error getting schedule config:', error);
    res.status(500).json({ message: 'Erro ao buscar configuração de agenda' });
  }
});

// Update schedule config
app.put('/api/agenda/schedule-config', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { 
      monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end, slot_duration, break_start, break_end
    } = req.body;
    
    // Update schedule config
    const result = await pool.query(`
      UPDATE schedule_config SET
        monday_start = $1,
        monday_end = $2,
        tuesday_start = $3,
        tuesday_end = $4,
        wednesday_start = $5,
        wednesday_end = $6,
        thursday_start = $7,
        thursday_end = $8,
        friday_start = $9,
        friday_end = $10,
        saturday_start = $11,
        saturday_end = $12,
        sunday_start = $13,
        sunday_end = $14,
        slot_duration = $15,
        break_start = $16,
        break_end = $17,
        updated_at = CURRENT_TIMESTAMP
      WHERE professional_id = $18
      RETURNING *
    `, [
      monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end, slot_duration, break_start, break_end,
      req.user.id
    ]);
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error updating schedule config:', error);
    res.status(500).json({ message: 'Erro ao atualizar configuração de agenda' });
  }
});

// Get agenda patients
app.get('/api/agenda/patients', authenticate, async (req, res) => {
  try {
    const { include_archived } = req.query;
    
    // Check if agenda_patients table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'agenda_patients'
      ) as exists
    `);
    
    if (!tableCheck.rows[0].exists) {
      // Create agenda_patients table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS agenda_patients (
          id SERIAL PRIMARY KEY,
          professional_id INTEGER REFERENCES users(id),
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
          is_convenio_patient BOOLEAN DEFAULT FALSE,
          is_archived BOOLEAN DEFAULT FALSE,
          linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      // Check if is_convenio_patient column exists
      const isConvenioPatientCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'agenda_patients' AND column_name = 'is_convenio_patient'
        ) as exists
      `);
      
      if (!isConvenioPatientCheck.rows[0].exists) {
        // Add is_convenio_patient column if it doesn't exist
        await pool.query(`
          ALTER TABLE agenda_patients ADD COLUMN is_convenio_patient BOOLEAN DEFAULT FALSE;
        `);
      }
      
      // Check if is_archived column exists
      const isArchivedCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'agenda_patients' AND column_name = 'is_archived'
        ) as exists
      `);
      
      if (!isArchivedCheck.rows[0].exists) {
        // Add is_archived column if it doesn't exist
        await pool.query(`
          ALTER TABLE agenda_patients ADD COLUMN is_archived BOOLEAN DEFAULT FALSE;
        `);
      }
      
      // Check if linked_at column exists
      const linkedAtCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'agenda_patients' AND column_name = 'linked_at'
        ) as exists
      `);
      
      if (!linkedAtCheck.rows[0].exists) {
        // Add linked_at column if it doesn't exist
        await pool.query(`
          ALTER TABLE agenda_patients ADD COLUMN linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        `);
      }
    }
    
    // Get patients
    let query = `
      SELECT *
      FROM agenda_patients
      WHERE professional_id = $1
    `;
    
    const params = [req.user.id];
    
    if (include_archived !== 'true') {
      query += ` AND COALESCE(is_archived, FALSE) = FALSE`;
    }
    
    query += ` ORDER BY name`;
    
    const result = await pool.query(query, params);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching agenda patients:', error);
    res.status(500).json({ message: 'Erro ao buscar pacientes da agenda' });
  }
});

// Create agenda patient
app.post('/api/agenda/patients', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { 
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, notes
    } = req.body;
    
    // Validate required fields
    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }
    
    // Check if patient already exists
    const patientCheck = await pool.query(`
      SELECT * FROM agenda_patients
      WHERE professional_id = $1 AND cpf = $2
    `, [req.user.id, cpf]);
    
    if (patientCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Paciente com este CPF já existe' });
    }
    
    // Create patient
    const result = await pool.query(`
      INSERT INTO agenda_patients (
        professional_id, name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, notes, is_convenio_patient,
        is_archived, linked_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
      RETURNING *
    `, [
      req.user.id, name, cpf, email, phone, 
      birth_date || null, // Handle empty birth_date
      address, address_number, address_complement, neighborhood, city, state, notes,
      false, // is_convenio_patient
      false  // is_archived
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating agenda patient:', error);
    res.status(500).json({ message: 'Erro ao criar paciente da agenda' });
  }
});

// Update agenda patient
app.put('/api/agenda/patients/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    // Check if patient exists and belongs to this professional
    const patientCheck = await pool.query(`
      SELECT * FROM agenda_patients
      WHERE id = $1 AND professional_id = $2
    `, [id, req.user.id]);
    
    if (patientCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado ou não pertence a este profissional' });
    }
    
    // Update patient
    const result = await pool.query(`
      UPDATE agenda_patients SET
        notes = $1
      WHERE id = $2 AND professional_id = $3
      RETURNING *
    `, [notes, id, req.user.id]);
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error updating agenda patient:', error);
    res.status(500).json({ message: 'Erro ao atualizar paciente da agenda' });
  }
});

// Archive/unarchive agenda patient
app.put('/api/agenda/patients/:id/archive', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_archived } = req.body;
    
    // Check if patient exists and belongs to this professional
    const patientCheck = await pool.query(`
      SELECT * FROM agenda_patients
      WHERE id = $1 AND professional_id = $2
    `, [id, req.user.id]);
    
    if (patientCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado ou não pertence a este profissional' });
    }
    
    // Update patient
    const result = await pool.query(`
      UPDATE agenda_patients SET
        is_archived = $1
      WHERE id = $2 AND professional_id = $3
      RETURNING *
    `, [is_archived, id, req.user.id]);
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error archiving agenda patient:', error);
    res.status(500).json({ message: 'Erro ao arquivar paciente da agenda' });
  }
});

// Lookup agenda patient by CPF
app.get('/api/agenda/patients/lookup/:cpf', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { cpf } = req.params;
    
    // Find patient
    const result = await pool.query(`
      SELECT *
      FROM agenda_patients
      WHERE professional_id = $1 AND cpf = $2
    `, [req.user.id, cpf]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Agenda patient lookup error:', error);
    res.status(500).json({ message: 'Erro ao buscar paciente da agenda' });
  }
});

// Get appointments
app.get('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Parse dates
    const parsedStartDate = new Date(start_date);
    const parsedEndDate = new Date(end_date);
    
    if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
      return res.status(400).json({ message: 'Datas inválidas' });
    }
    
    // Get appointments
    const result = await pool.query(`
      SELECT a.*, p.name as patient_name, p.phone as patient_phone, 
             COALESCE(p.is_convenio_patient, FALSE) as is_convenio_patient
      FROM appointments a
      JOIN agenda_patients p ON a.patient_id = p.id
      WHERE a.professional_id = $1
      AND a.date >= $2::timestamp
      AND a.date <= $3::timestamp
      ORDER BY a.date
    `, [req.user.id, parsedStartDate.toISOString(), parsedEndDate.toISOString()]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro ao buscar agendamentos' });
  }
});

// Create appointment
app.post('/api/agenda/appointments', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patient_id, date, notes, service_id, value, location_id } = req.body;
    
    // Validate required fields
    if (!patient_id || !date) {
      return res.status(400).json({ message: 'ID do paciente e data são obrigatórios' });
    }
    
    // Check if patient exists and belongs to this professional
    const patientCheck = await pool.query(`
      SELECT * FROM agenda_patients
      WHERE id = $1 AND professional_id = $2
    `, [patient_id, req.user.id]);
    
    if (patientCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado ou não pertence a este profissional' });
    }
    
    // Create appointment
    const result = await pool.query(`
      INSERT INTO appointments (
        professional_id, patient_id, date, status, notes, service_id, value, location_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [req.user.id, patient_id, date, 'scheduled', notes, service_id, value, location_id]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Appointment creation error:', error);
    res.status(500).json({ message: 'Erro ao criar agendamento' });
  }
});

// ===== PROFESSIONAL LOCATION ROUTES =====

// Get professional locations
app.get('/api/professional-locations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Check if professional_locations table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'professional_locations'
      ) as exists
    `);
    
    if (!tableCheck.rows[0].exists) {
      // Create professional_locations table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS professional_locations (
          id SERIAL PRIMARY KEY,
          professional_id INTEGER REFERENCES users(id),
          clinic_name VARCHAR(255) NOT NULL,
          address VARCHAR(255),
          address_number VARCHAR(20),
          address_complement VARCHAR(255),
          neighborhood VARCHAR(255),
          city VARCHAR(255),
          state VARCHAR(2),
          phone VARCHAR(20),
          is_main BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
    
    // Get locations
    const result = await pool.query(`
      SELECT *
      FROM professional_locations
      WHERE professional_id = $1
      ORDER BY is_main DESC, clinic_name
    `, [req.user.id]);
    
    res.status(200).json(result.rows);
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
    
    // Validate required fields
    if (!clinic_name || !address || !address_number || !neighborhood || !city || !state) {
      return res.status(400).json({ 
        message: 'Nome da clínica, endereço, número, bairro, cidade e estado são obrigatórios' 
      });
    }
    
    // If this is the main location, unset other main locations
    if (is_main) {
      await pool.query(`
        UPDATE professional_locations
        SET is_main = FALSE
        WHERE professional_id = $1
      `, [req.user.id]);
    }
    
    // Create location
    const result = await pool.query(`
      INSERT INTO professional_locations (
        professional_id, clinic_name, address, address_number, address_complement,
        neighborhood, city, state, phone, is_main
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      req.user.id, clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Professional location creation error:', error);
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
    
    // Check if location exists and belongs to this professional
    const locationCheck = await pool.query(`
      SELECT * FROM professional_locations
      WHERE id = $1 AND professional_id = $2
    `, [id, req.user.id]);
    
    if (locationCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Local não encontrado ou não pertence a este profissional' });
    }
    
    // If this is the main location, unset other main locations
    if (is_main) {
      await pool.query(`
        UPDATE professional_locations
        SET is_main = FALSE
        WHERE professional_id = $1 AND id != $2
      `, [req.user.id, id]);
    }
    
    // Update location
    const result = await pool.query(`
      UPDATE professional_locations SET
        clinic_name = COALESCE($1, clinic_name),
        address = COALESCE($2, address),
        address_number = COALESCE($3, address_number),
        address_complement = $4,
        neighborhood = COALESCE($5, neighborhood),
        city = COALESCE($6, city),
        state = COALESCE($7, state),
        phone = $8,
        is_main = $9
      WHERE id = $10 AND professional_id = $11
      RETURNING *
    `, [
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main,
      id, req.user.id
    ]);
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Professional location update error:', error);
    res.status(500).json({ message: 'Erro ao atualizar local de atendimento' });
  }
});

// Delete professional location
app.delete('/api/professional-locations/:id', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if location exists and belongs to this professional
    const locationCheck = await pool.query(`
      SELECT * FROM professional_locations
      WHERE id = $1 AND professional_id = $2
    `, [id, req.user.id]);
    
    if (locationCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Local não encontrado ou não pertence a este profissional' });
    }
    
    // Delete location
    await pool.query(`
      DELETE FROM professional_locations
      WHERE id = $1 AND professional_id = $2
    `, [id, req.user.id]);
    
    res.status(200).json({ message: 'Local excluído com sucesso' });
  } catch (error) {
    console.error('Professional location deletion error:', error);
    res.status(500).json({ message: 'Erro ao excluir local de atendimento' });
  }
});

// ===== DOCUMENT ROUTES =====

// Get document templates
app.get('/api/document-templates', authenticate, authorize(['professional']), async (req, res) => {
  try {
    // Check if document_templates table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'document_templates'
      ) as exists
    `);
    
    if (!tableCheck.rows[0].exists) {
      // Create document_templates table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS document_templates (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          type VARCHAR(50) NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      // Insert default templates
      await pool.query(`
        INSERT INTO document_templates (name, type, content) VALUES
        ('Atestado Médico', 'atestado', 'Template de atestado médico'),
        ('Receituário', 'receituario', 'Template de receituário'),
        ('Termo de Consentimento', 'termo_consentimento', 'Template de termo de consentimento'),
        ('Termo LGPD', 'lgpd', 'Template de termo LGPD'),
        ('Solicitação de Exames', 'solicitacao_exames', 'Template de solicitação de exames'),
        ('Declaração de Comparecimento', 'declaracao_comparecimento', 'Template de declaração de comparecimento')
      `);
    }
    
    // Get templates
    const result = await pool.query(`
      SELECT *
      FROM document_templates
      ORDER BY name
    `);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching document templates:', error);
    res.status(500).json({ message: 'Erro ao buscar templates de documentos' });
  }
});

// Generate document
app.post('/api/generate-document', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { template_id, patient_id, professional_id, ...data } = req.body;
    
    // Validate required fields
    if (!template_id || !patient_id || !professional_id) {
      return res.status(400).json({ 
        message: 'ID do template, ID do paciente e ID do profissional são obrigatórios' 
      });
    }
    
    // Get template
    const templateResult = await pool.query(`
      SELECT * FROM document_templates
      WHERE id = $1
    `, [template_id]);
    
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ message: 'Template não encontrado' });
    }
    
    const template = templateResult.rows[0];
    
    // Get patient data
    const patientResult = await pool.query(`
      SELECT * FROM agenda_patients
      WHERE id = $1 AND professional_id = $2
    `, [patient_id, req.user.id]);
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado ou não pertence a este profissional' });
    }
    
    const patient = patientResult.rows[0];
    
    // Get professional data
    const professionalResult = await pool.query(`
      SELECT * FROM users
      WHERE id = $1
    `, [professional_id]);
    
    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Profissional não encontrado' });
    }
    
    const professional = professionalResult.rows[0];
    
    // Format CPF
    const formattedCpf = patient.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    
    // Get current date and time
    const now = new Date();
    const formattedDate = format(now, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    const formattedTime = format(now, "HH:mm", { locale: ptBR });
    
    // Prepare template data
    const templateData = {
      nome: patient.name,
      cpf: formattedCpf,
      email: patient.email || '',
      telefone: patient.phone || '',
      endereco: patient.address || '',
      numero: patient.address_number || '',
      complemento: patient.address_complement || '',
      bairro: patient.neighborhood || '',
      cidade: patient.city || '',
      estado: patient.state || '',
      data_atual: formattedDate,
      hora_atual: formattedTime,
      profissional_nome: professional.name,
      profissional_registro: professional.professional_registration || '',
      profissional_assinatura: professional.signature_url || '',
      ...data
    };
    
    // Compile template
    const compiledTemplate = Handlebars.compile(template.content);
    const html = compiledTemplate(templateData);
    
    // Generate PDF
    const pdfOptions = { format: 'A4', margin: { top: 20, right: 20, bottom: 20, left: 20 } };
    
    // Generate unique filename
    const filename = `${template.type}_${patient_id}_${Date.now()}.pdf`;
    const filePath = path.join(__dirname, 'temp', filename);
    
    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, 'temp'))) {
      fs.mkdirSync(path.join(__dirname, 'temp'));
    }
    
    // Write HTML to file
    fs.writeFileSync(filePath, html);
    
    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'quiro-ferreira/documents',
      resource_type: 'raw',
      public_id: filename.replace('.pdf', ''),
      format: 'pdf'
    });
    
    // Delete temporary file
    fs.unlinkSync(filePath);
    
    // Save document record
    const documentResult = await pool.query(`
      INSERT INTO generated_documents (
        patient_id, professional_id, template_id, type, url
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [patient_id, professional_id, template_id, template.type, result.secure_url]);
    
    res.status(200).json({
      message: 'Documento gerado com sucesso',
      document: documentResult.rows[0],
      url: result.secure_url
    });
  } catch (error) {
    console.error('Error generating document:', error);
    res.status(500).json({ message: 'Erro ao gerar documento' });
  }
});

// Get generated documents by patient
app.get('/api/generated-documents/patient/:patientId', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { patientId } = req.params;
    
    // Check if patient exists and belongs to this professional
    const patientCheck = await pool.query(`
      SELECT * FROM agenda_patients
      WHERE id = $1 AND professional_id = $2
    `, [patientId, req.user.id]);
    
    if (patientCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado ou não pertence a este profissional' });
    }
    
    // Get documents
    const result = await pool.query(`
      SELECT gd.*, dt.name as template_name, ap.name as patient_name
      FROM generated_documents gd
      JOIN document_templates dt ON gd.template_id = dt.id
      JOIN agenda_patients ap ON gd.patient_id = ap.id
      WHERE gd.patient_id = $1 AND gd.professional_id = $2
      ORDER BY gd.created_at DESC
    `, [patientId, req.user.id]);
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching generated documents:', error);
    res.status(500).json({ message: 'Erro ao buscar documentos gerados' });
  }
});

// ===== SUBSCRIPTION ROUTES =====

// Create subscription payment
app.post('/api/create-subscription', authenticate, async (req, res) => {
  try {
    const { user_id } = req.body;
    
    // Validate required fields
    if (!user_id) {
      return res.status(400).json({ message: 'ID do usuário é obrigatório' });
    }
    
    // Check if user exists
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Create preference
    const preference = {
      items: [
        {
          title: 'Assinatura Mensal do Convênio Quiro Ferreira',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: 250.00
        }
      ],
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`
      },
      auto_return: 'approved',
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/subscription/webhook`,
      external_reference: `client_${user_id}`,
      metadata: {
        user_id,
        payment_type: 'subscription'
      }
    };
    
    const response = await mercadopago.preferences.create(preference);
    
    res.status(200).json({
      id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point
    });
  } catch (error) {
    console.error('Error creating subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento da assinatura' });
  }
});

// Subscription webhook
app.post('/api/subscription/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      
      // Get payment details
      const payment = await mercadopago.payment.findById(paymentId);
      
      if (payment.body.status === 'approved') {
        const metadata = payment.body.metadata || {};
        const externalReference = payment.body.external_reference || '';
        
        // Check if it's a subscription payment
        if (metadata.payment_type === 'subscription' || externalReference.startsWith('client_')) {
          const userId = metadata.user_id || externalReference.split('_')[1];
          
          if (!userId) {
            console.error('User ID not found in payment metadata or external reference');
            return res.status(400).json({ message: 'User ID not found' });
          }
          
          // Calculate expiry date (30 days from now)
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 30);
          
          // Update user subscription status
          await pool.query(`
            UPDATE users SET
              subscription_status = 'active',
              subscription_expiry = $1
            WHERE id = $2
          `, [expiryDate.toISOString(), userId]);
          
          // Save payment
          await pool.query(`
            INSERT INTO subscription_payments (
              user_id, payment_id, status, amount, payment_method, expires_at
            ) VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            userId, 
            paymentId, 
            'approved', 
            payment.body.transaction_amount, 
            payment.body.payment_method_id,
            expiryDate.toISOString()
          ]);
          
          console.log(`Subscription payment approved for user ${userId}`);
        }
      }
    }
    
    res.status(200).send();
  } catch (error) {
    console.error('Subscription webhook error:', error);
    res.status(500).json({ message: 'Erro ao processar webhook da assinatura' });
  }
});

// ===== PROFESSIONAL PAYMENT ROUTES =====

// Create professional payment
app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { amount } = req.body;
    
    // Validate required fields
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor deve ser maior que zero' });
    }
    
    // Create preference
    const preference = {
      items: [
        {
          title: 'Pagamento ao Convênio Quiro Ferreira',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: parseFloat(amount)
        }
      ],
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`
      },
      auto_return: 'approved',
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/professional/payment/webhook`,
      external_reference: `professional_payment_${req.user.id}`,
      metadata: {
        professional_id: req.user.id,
        payment_type: 'professional_payment'
      }
    };
    
    const response = await mercadopago.preferences.create(preference);
    
    res.status(200).json({
      id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point
    });
  } catch (error) {
    console.error('Error creating professional payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

// Professional payment webhook
app.post('/api/professional/payment/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      
      // Get payment details
      const payment = await mercadopago.payment.findById(paymentId);
      
      if (payment.body.status === 'approved') {
        const metadata = payment.body.metadata || {};
        const externalReference = payment.body.external_reference || '';
        
        // Check if it's a professional payment
        if (metadata.payment_type === 'professional_payment' || externalReference.startsWith('professional_payment_')) {
          const professionalId = metadata.professional_id || externalReference.split('_')[2];
          
          if (!professionalId) {
            console.error('Professional ID not found in payment metadata or external reference');
            return res.status(400).json({ message: 'Professional ID not found' });
          }
          
          console.log(`Professional payment approved for professional ${professionalId}`);
          
          // Here you could update a payments table or mark consultations as paid
        }
      }
    }
    
    res.status(200).send();
  } catch (error) {
    console.error('Professional payment webhook error:', error);
    res.status(500).json({ message: 'Erro ao processar webhook do pagamento profissional' });
  }
});

// Save professional signature
app.post('/api/professional/signature', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { signature_url } = req.body;
    
    // Validate required fields
    if (!signature_url) {
      return res.status(400).json({ message: 'URL da assinatura é obrigatória' });
    }
    
    // Update user
    await pool.query(`
      UPDATE users SET
        signature_url = $1
      WHERE id = $2
    `, [signature_url, req.user.id]);
    
    res.status(200).json({ message: 'Assinatura salva com sucesso' });
  } catch (error) {
    console.error('Error saving professional signature:', error);
    res.status(500).json({ message: 'Erro ao salvar assinatura' });
  }
});

// ===== IMAGE UPLOAD ROUTES =====

// Upload image
app.post('/api/upload-image', authenticate, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Nenhuma imagem enviada' });
    }
    
    // Convert buffer to base64
    const base64Image = req.file.buffer.toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${base64Image}`;
    
    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(dataURI, {
      folder: 'quiro-ferreira',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [
        {
          width: 800,
          crop: 'limit',
          quality: 'auto:good'
        }
      ]
    });
    
    res.status(200).json({
      message: 'Imagem enviada com sucesso',
      imageUrl: result.secure_url
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ message: 'Erro ao enviar imagem' });
  }
});

// ===== SERVER START =====

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});