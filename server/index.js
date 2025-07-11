import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { pool } from './db.js';
import { authenticate, authorize } from './middleware/auth.js';
import createUploadMiddleware from './middleware/upload.js';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://cartaoquiroferreira.com.br', 'https://www.cartaoquiroferreira.com.br'] 
    : 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Create upload middleware
let uploadMiddleware;
try {
  uploadMiddleware = createUploadMiddleware();
  console.log('✅ Upload middleware created successfully');
} catch (error) {
  console.error('❌ Failed to create upload middleware:', error);
}

// Initialize MercadoPago
let mercadopago;
try {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (accessToken) {
    mercadopago = new MercadoPagoConfig({ accessToken });
    console.log('✅ MercadoPago initialized successfully');
  } else {
    console.warn('⚠️ MercadoPago access token not found');
  }
} catch (error) {
  console.error('❌ Failed to initialize MercadoPago:', error);
}

// Create database tables if they don't exist
const createTables = async () => {
  try {
    // Users table
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
        subscription_expiry TIMESTAMP,
        signature_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Users table created or already exists');

    // Dependents table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dependents (
        id SERIAL PRIMARY KEY,
        client_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) UNIQUE NOT NULL,
        birth_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Dependents table created or already exists');

    // Service categories table
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

    // Services table
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

    // Professionals table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professionals (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        professional_registration VARCHAR(255),
        professional_type VARCHAR(20) DEFAULT 'convenio',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Professionals table created or already exists');

    // Professional locations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_locations (
        id SERIAL PRIMARY KEY,
        professional_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        clinic_name VARCHAR(255) NOT NULL,
        address VARCHAR(255) NOT NULL,
        address_number VARCHAR(20),
        address_complement VARCHAR(255),
        neighborhood VARCHAR(255),
        city VARCHAR(255) NOT NULL,
        state VARCHAR(2) NOT NULL,
        phone VARCHAR(20),
        is_main BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Professional locations table created or already exists');

    // Consultations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INT REFERENCES users(id),
        dependent_id INT REFERENCES dependents(id),
        professional_id INT NOT NULL REFERENCES users(id),
        service_id INT NOT NULL REFERENCES services(id),
        value DECIMAL(10, 2) NOT NULL,
        date TIMESTAMP NOT NULL,
        location_id INT REFERENCES professional_locations(id),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Consultations table created or already exists');

    // Patients table (for agenda)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS patients (
        id SERIAL PRIMARY KEY,
        professional_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
        is_convenio_patient BOOLEAN DEFAULT false,
        is_archived BOOLEAN DEFAULT false,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(professional_id, cpf)
      );
    `);
    console.log('✅ Patients table created or already exists');

    // Appointments table (for agenda)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        patient_id INT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        location_id INT REFERENCES professional_locations(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Appointments table created or already exists');

    // Professional subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        start_date TIMESTAMP,
        expiry_date TIMESTAMP,
        payment_id VARCHAR(255),
        payment_status VARCHAR(20),
        payment_amount DECIMAL(10, 2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Professional subscriptions table created or already exists');

    // Client subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_subscriptions (
        id SERIAL PRIMARY KEY,
        client_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        start_date TIMESTAMP,
        expiry_date TIMESTAMP,
        payment_id VARCHAR(255),
        payment_status VARCHAR(20),
        payment_amount DECIMAL(10, 2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Client subscriptions table created or already exists');

    // Medical records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        professional_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        patient_id INT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        consultation_id INT REFERENCES consultations(id),
        appointment_id INT REFERENCES appointments(id),
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

    // Document templates table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_templates (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Document templates table created or already exists');

    // Generated documents table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_documents (
        id VARCHAR(50) PRIMARY KEY,
        template_id VARCHAR(50) REFERENCES document_templates(id),
        patient_id INT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        professional_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        url TEXT NOT NULL,
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Generated documents table created or already exists');

    // Insert default document templates if they don't exist
    const templateTypes = ['atestado', 'receituario', 'termo_consentimento', 'lgpd', 'solicitacao_exames', 'declaracao_comparecimento'];
    
    for (const type of templateTypes) {
      const templateExists = await pool.query(
        'SELECT COUNT(*) FROM document_templates WHERE id = $1',
        [`default_${type}`]
      );
      
      if (parseInt(templateExists.rows[0].count) === 0) {
        try {
          // Read template file
          const templatePath = path.join(__dirname, 'templates', `${type}.html`);
          const templateContent = fs.readFileSync(templatePath, 'utf8');
          
          // Insert template
          await pool.query(
            `INSERT INTO document_templates (id, name, type, content) 
             VALUES ($1, $2, $3, $4)`,
            [`default_${type}`, `Modelo Padrão de ${type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`, type, templateContent]
          );
          
          console.log(`✅ Default template for ${type} created`);
        } catch (error) {
          console.error(`❌ Error creating default template for ${type}:`, error);
        }
      }
    }

    // Insert default service categories if they don't exist
    const defaultCategories = [
      { name: 'Fisioterapia', description: 'Serviços de fisioterapia' },
      { name: 'Quiropraxia', description: 'Serviços de quiropraxia' },
      { name: 'Massoterapia', description: 'Serviços de massoterapia' },
      { name: 'Acupuntura', description: 'Serviços de acupuntura' },
      { name: 'Pilates', description: 'Serviços de pilates' },
      { name: 'Psicologia', description: 'Serviços de psicologia' },
      { name: 'Nutrição', description: 'Serviços de nutrição' }
    ];
    
    for (const category of defaultCategories) {
      const categoryExists = await pool.query(
        'SELECT COUNT(*) FROM service_categories WHERE name = $1',
        [category.name]
      );
      
      if (parseInt(categoryExists.rows[0].count) === 0) {
        await pool.query(
          `INSERT INTO service_categories (name, description) 
           VALUES ($1, $2)`,
          [category.name, category.description]
        );
        
        console.log(`✅ Default category ${category.name} created`);
      }
    }

    // Insert default admin user if it doesn't exist
    const adminExists = await pool.query(
      'SELECT COUNT(*) FROM users WHERE cpf = $1',
      ['00000000000']
    );
    
    if (parseInt(adminExists.rows[0].count) === 0) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('admin123', salt);
      
      await pool.query(
        `INSERT INTO users (name, cpf, email, password, roles, subscription_status) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['Administrador', '00000000000', 'admin@cartaoquiroferreira.com.br', hashedPassword, ['admin'], 'active']
      );
      
      console.log('✅ Default admin user created');
    }

  } catch (error) {
    console.error('❌ Error creating tables:', error);
  }
};

// Create tables on startup
createTables();

// Routes
app.get('/', (req, res) => {
  res.send('API is running...');
});

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { 
      name, cpf, email, phone, birth_date, 
      address, address_number, address_complement, 
      neighborhood, city, state, password 
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
    
    // Create user
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, 
        address, address_number, address_complement, 
        neighborhood, city, state, password, roles
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        name, cpf, email, phone, birth_date, 
        address, address_number, address_complement, 
        neighborhood, city, state, hashedPassword, ['client']
      ]
    );
    
    const user = result.rows[0];
    
    // Create JWT token
    const token = jwt.sign(
      { id: user.id, currentRole: 'client' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );
    
    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });
    
    // Return user data (without password)
    const { password: _, ...userData } = user;
    
    res.status(201).json({
      user: { ...userData, currentRole: 'client' },
      token
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
      'SELECT * FROM users WHERE cpf = $1',
      [cpf]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }
    
    const user = result.rows[0];
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }
    
    // Return user data (without password)
    const { password: _, ...userData } = user;
    
    // Check if user has multiple roles
    const needsRoleSelection = user.roles && user.roles.length > 1;
    
    res.json({
      user: userData,
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
    
    // Validate input
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
    if (!user.roles || !user.roles.includes(role)) {
      return res.status(403).json({ message: 'Usuário não possui esta role' });
    }
    
    // Create JWT token with selected role
    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );
    
    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });
    
    // Return user data with current role
    const { password: _, ...userData } = user;
    
    res.json({
      user: { ...userData, currentRole: role },
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
    
    // Validate input
    if (!role) {
      return res.status(400).json({ message: 'Role é obrigatória' });
    }
    
    // Check if user has the selected role
    if (!req.user.roles || !req.user.roles.includes(role)) {
      return res.status(403).json({ message: 'Usuário não possui esta role' });
    }
    
    // Create JWT token with new role
    const token = jwt.sign(
      { id: req.user.id, currentRole: role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );
    
    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });
    
    // Return user data with new current role
    res.json({
      user: { ...req.user, currentRole: role },
      token
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
    const result = await pool.query(
      `SELECT u.*, 
        (SELECT json_agg(d.*) FROM dependents d WHERE d.client_id = u.id) as dependents,
        p.professional_registration, p.professional_type, p.is_active
       FROM users u
       LEFT JOIN professionals p ON u.id = p.user_id
       ORDER BY u.name`
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
    if (req.user.id !== parseInt(id) && !req.user.roles.includes('admin')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const result = await pool.query(
      `SELECT u.*, 
        p.professional_registration, p.professional_type, p.is_active
       FROM users u
       LEFT JOIN professionals p ON u.id = p.user_id
       WHERE u.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Remove password from response
    const { password, ...userData } = result.rows[0];
    
    res.json(userData);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Erro ao buscar usuário' });
  }
});

app.post('/api/users', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { 
      name, cpf, email, phone, birth_date, 
      address, address_number, address_complement, 
      neighborhood, city, state, password, roles,
      percentage, category_id
    } = req.body;
    
    // Validate required fields
    if (!name || !cpf || !password || !roles || roles.length === 0) {
      return res.status(400).json({ message: 'Nome, CPF, senha e pelo menos uma role são obrigatórios' });
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
    
    // Start transaction
    await pool.query('BEGIN');
    
    try {
      // Create user
      const userResult = await pool.query(
        `INSERT INTO users (
          name, cpf, email, phone, birth_date, 
          address, address_number, address_complement, 
          neighborhood, city, state, password, roles,
          percentage, category_id, subscription_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
        [
          name, cpf, email, phone, birth_date, 
          address, address_number, address_complement, 
          neighborhood, city, state, hashedPassword, roles,
          percentage, category_id,
          roles.includes('client') ? 'pending' : 'active'
        ]
      );
      
      const user = userResult.rows[0];
      
      // If user is a professional, create professional record
      if (roles.includes('professional')) {
        await pool.query(
          `INSERT INTO professionals (user_id, professional_type)
           VALUES ($1, $2)`,
          [user.id, 'convenio']
        );
      }
      
      // Commit transaction
      await pool.query('COMMIT');
      
      // Return user data (without password)
      const { password: _, ...userData } = user;
      
      res.status(201).json(userData);
    } catch (error) {
      // Rollback transaction on error
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ message: 'Erro ao criar usuário' });
  }
});

app.put('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, email, phone, birth_date, 
      address, address_number, address_complement, 
      neighborhood, city, state, roles,
      percentage, category_id
    } = req.body;
    
    // Check if user is updating their own data or is an admin
    if (req.user.id !== parseInt(id) && !req.user.roles.includes('admin')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Start transaction
    await pool.query('BEGIN');
    
    try {
      // Update user
      const userResult = await pool.query(
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
          name, email, phone, birth_date, 
          address, address_number, address_complement, 
          neighborhood, city, state, roles,
          percentage, category_id, id
        ]
      );
      
      if (userResult.rows.length === 0) {
        await pool.query('ROLLBACK');
        return res.status(404).json({ message: 'Usuário não encontrado' });
      }
      
      const user = userResult.rows[0];
      
      // If user is a professional, update or create professional record
      if (roles && roles.includes('professional')) {
        const professionalExists = await pool.query(
          'SELECT * FROM professionals WHERE user_id = $1',
          [id]
        );
        
        if (professionalExists.rows.length === 0) {
          await pool.query(
            `INSERT INTO professionals (user_id, professional_type)
             VALUES ($1, $2)`,
            [id, 'convenio']
          );
        }
      }
      
      // Commit transaction
      await pool.query('COMMIT');
      
      // Return user data (without password)
      const { password: _, ...userData } = user;
      
      res.json(userData);
    } catch (error) {
      // Rollback transaction on error
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Erro ao atualizar usuário' });
  }
});

app.delete('/api/users/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user exists
    const userExists = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    
    if (userExists.rows.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Delete user
    await pool.query(
      'DELETE FROM users WHERE id = $1',
      [id]
    );
    
    res.json({ message: 'Usuário excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Erro ao excluir usuário' });
  }
});

app.put('/api/users/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Validate input
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

// Activate client
app.put('/api/users/:id/activate', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { expiry_date } = req.body;
    
    // Validate input
    if (!expiry_date) {
      return res.status(400).json({ message: 'Data de expiração é obrigatória' });
    }
    
    // Check if user exists and is a client
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND $2 = ANY(roles)',
      [id, 'client']
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }
    
    // Update user subscription status
    await pool.query(
      `UPDATE users SET 
        subscription_status = 'active',
        subscription_expiry = $1,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [expiry_date, id]
    );
    
    // Create or update client subscription record
    const subscriptionExists = await pool.query(
      'SELECT * FROM client_subscriptions WHERE client_id = $1',
      [id]
    );
    
    if (subscriptionExists.rows.length === 0) {
      await pool.query(
        `INSERT INTO client_subscriptions (
          client_id, status, start_date, expiry_date, payment_status, payment_amount
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, 'active', new Date(), new Date(expiry_date), 'completed', 250]
      );
    } else {
      await pool.query(
        `UPDATE client_subscriptions SET
          status = 'active',
          start_date = CURRENT_TIMESTAMP,
          expiry_date = $1,
          payment_status = 'completed',
          updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $2`,
        [expiry_date, id]
      );
    }
    
    res.json({ message: 'Cliente ativado com sucesso' });
  } catch (error) {
    console.error('Error activating client:', error);
    res.status(500).json({ message: 'Erro ao ativar cliente' });
  }
});

// Dependent routes
app.get('/api/dependents/:clientId', authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    // Check if user is requesting their own dependents or is an admin/clinic
    if (
      req.user.id !== parseInt(clientId) && 
      !req.user.roles.includes('admin') && 
      !req.user.roles.includes('clinic') &&
      !req.user.roles.includes('professional')
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
    
    // Validate required fields
    if (!client_id || !name || !cpf) {
      return res.status(400).json({ message: 'ID do cliente, nome e CPF são obrigatórios' });
    }
    
    // Check if user is adding their own dependent or is an admin
    if (req.user.id !== parseInt(client_id) && !req.user.roles.includes('admin')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if dependent already exists
    const dependentExists = await pool.query(
      'SELECT * FROM dependents WHERE cpf = $1',
      [cpf]
    );
    
    if (dependentExists.rows.length > 0) {
      return res.status(400).json({ message: 'Dependente já cadastrado com este CPF' });
    }
    
    // Create dependent
    const result = await pool.query(
      `INSERT INTO dependents (client_id, name, cpf, birth_date)
       VALUES ($1, $2, $3, $4) RETURNING *`,
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
    if (req.user.id !== dependent.client_id && !req.user.roles.includes('admin')) {
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
    if (req.user.id !== dependent.client_id && !req.user.roles.includes('admin')) {
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
    
    // Find dependent
    const dependentResult = await pool.query(
      `SELECT d.*, u.name as client_name, u.subscription_status as client_subscription_status
       FROM dependents d
       JOIN users u ON d.client_id = u.id
       WHERE d.cpf = $1`,
      [cpf]
    );
    
    if (dependentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Dependente não encontrado' });
    }
    
    res.json(dependentResult.rows[0]);
  } catch (error) {
    console.error('Error looking up dependent:', error);
    res.status(500).json({ message: 'Erro ao buscar dependente' });
  }
});

// Client lookup by CPF
app.get('/api/clients/lookup/:cpf', authenticate, async (req, res) => {
  try {
    const { cpf } = req.params;
    
    // Find client
    const clientResult = await pool.query(
      `SELECT id, name, cpf, subscription_status, subscription_expiry
       FROM users
       WHERE cpf = $1 AND 'client' = ANY(roles)`,
      [cpf]
    );
    
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }
    
    res.json(clientResult.rows[0]);
  } catch (error) {
    console.error('Error looking up client:', error);
    res.status(500).json({ message: 'Erro ao buscar cliente' });
  }
});

// Service category routes
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
    
    // Check if category already exists
    const categoryExists = await pool.query(
      'SELECT * FROM service_categories WHERE name = $1',
      [name]
    );
    
    if (categoryExists.rows.length > 0) {
      return res.status(400).json({ message: 'Categoria já existe com este nome' });
    }
    
    // Create category
    const result = await pool.query(
      `INSERT INTO service_categories (name, description)
       VALUES ($1, $2) RETURNING *`,
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
    
    // Check if service exists
    const serviceExists = await pool.query(
      'SELECT * FROM services WHERE id = $1',
      [id]
    );
    
    if (serviceExists.rows.length === 0) {
      return res.status(404).json({ message: 'Serviço não encontrado' });
    }
    
    // Delete service
    await pool.query(
      'DELETE FROM services WHERE id = $1',
      [id]
    );
    
    res.json({ message: 'Serviço excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ message: 'Erro ao excluir serviço' });
  }
});

// Consultation routes
app.get('/api/consultations', authenticate, async (req, res) => {
  try {
    let query;
    let params = [];
    
    if (req.user.roles.includes('admin') || req.user.roles.includes('clinic')) {
      // Admin and clinic can see all consultations
      query = `
        SELECT c.*, 
          s.name as service_name,
          COALESCE(d.name, u.name) as client_name,
          p.name as professional_name,
          CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent
        FROM consultations c
        LEFT JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        LEFT JOIN users p ON c.professional_id = p.id
        LEFT JOIN services s ON c.service_id = s.id
        ORDER BY c.date DESC
      `;
    } else if (req.user.roles.includes('professional')) {
      // Professionals can only see their own consultations
      query = `
        SELECT c.*, 
          s.name as service_name,
          COALESCE(d.name, u.name) as client_name,
          p.name as professional_name,
          CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent
        FROM consultations c
        LEFT JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        LEFT JOIN users p ON c.professional_id = p.id
        LEFT JOIN services s ON c.service_id = s.id
        WHERE c.professional_id = $1
        ORDER BY c.date DESC
      `;
      params.push(req.user.id);
    } else {
      // Clients can only see their own consultations and their dependents'
      query = `
        SELECT c.*, 
          s.name as service_name,
          COALESCE(d.name, u.name) as client_name,
          p.name as professional_name,
          CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent
        FROM consultations c
        LEFT JOIN users u ON c.client_id = u.id
        LEFT JOIN dependents d ON c.dependent_id = d.id
        LEFT JOIN users p ON c.professional_id = p.id
        LEFT JOIN services s ON c.service_id = s.id
        WHERE c.client_id = $1 OR d.client_id = $1
        ORDER BY c.date DESC
      `;
      params.push(req.user.id);
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
      client_id, dependent_id, professional_id, 
      service_id, value, date, location_id, notes 
    } = req.body;
    
    // Validate required fields
    if ((!client_id && !dependent_id) || !professional_id || !service_id || !value || !date) {
      return res.status(400).json({ message: 'Cliente/dependente, profissional, serviço, valor e data são obrigatórios' });
    }
    
    // Check if user is authorized
    if (
      req.user.id !== professional_id && 
      !req.user.roles.includes('admin') && 
      !req.user.roles.includes('clinic')
    ) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Create consultation
    const result = await pool.query(
      `INSERT INTO consultations (
        client_id, dependent_id, professional_id, 
        service_id, value, date, location_id, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        client_id, dependent_id, professional_id, 
        service_id, value, date, location_id, notes
      ]
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
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.roles, u.address, u.address_number, 
        u.address_complement, u.neighborhood, u.city, u.state, u.photo_url,
        p.professional_registration, p.professional_type, p.is_active,
        c.name as category_name
       FROM users u
       JOIN professionals p ON u.id = p.user_id
       LEFT JOIN service_categories c ON u.category_id = c.id
       WHERE 'professional' = ANY(u.roles) AND p.is_active = true
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
    const result = await pool.query(
      `SELECT * FROM professional_locations
       WHERE professional_id = $1
       ORDER BY is_main DESC, clinic_name`,
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
    const { 
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main
    } = req.body;
    
    // Validate required fields
    if (!clinic_name || !address || !city || !state) {
      return res.status(400).json({ message: 'Nome da clínica, endereço, cidade e estado são obrigatórios' });
    }
    
    // Start transaction
    await pool.query('BEGIN');
    
    try {
      // If this is the main location, update all other locations to not be main
      if (is_main) {
        await pool.query(
          `UPDATE professional_locations
           SET is_main = false
           WHERE professional_id = $1`,
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
      
      // Commit transaction
      await pool.query('COMMIT');
      
      res.status(201).json(result.rows[0]);
    } catch (error) {
      // Rollback transaction on error
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error creating professional location:', error);
    res.status(500).json({ message: 'Erro ao criar local de atendimento' });
  }
});

app.put('/api/professional-locations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main
    } = req.body;
    
    // Check if location exists and belongs to the user
    const locationResult = await pool.query(
      'SELECT * FROM professional_locations WHERE id = $1',
      [id]
    );
    
    if (locationResult.rows.length === 0) {
      return res.status(404).json({ message: 'Local não encontrado' });
    }
    
    const location = locationResult.rows[0];
    
    if (location.professional_id !== req.user.id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Start transaction
    await pool.query('BEGIN');
    
    try {
      // If this is the main location, update all other locations to not be main
      if (is_main) {
        await pool.query(
          `UPDATE professional_locations
           SET is_main = false
           WHERE professional_id = $1 AND id != $2`,
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
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $10 RETURNING *`,
        [
          clinic_name, address, address_number, address_complement,
          neighborhood, city, state, phone, is_main, id
        ]
      );
      
      // Commit transaction
      await pool.query('COMMIT');
      
      res.json(result.rows[0]);
    } catch (error) {
      // Rollback transaction on error
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error updating professional location:', error);
    res.status(500).json({ message: 'Erro ao atualizar local de atendimento' });
  }
});

app.delete('/api/professional-locations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if location exists and belongs to the user
    const locationResult = await pool.query(
      'SELECT * FROM professional_locations WHERE id = $1',
      [id]
    );
    
    if (locationResult.rows.length === 0) {
      return res.status(404).json({ message: 'Local não encontrado' });
    }
    
    const location = locationResult.rows[0];
    
    if (location.professional_id !== req.user.id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Delete location
    await pool.query(
      'DELETE FROM professional_locations WHERE id = $1',
      [id]
    );
    
    res.json({ message: 'Local excluído com sucesso' });
  } catch (error) {
    console.error('Error deleting professional location:', error);
    res.status(500).json({ message: 'Erro ao excluir local de atendimento' });
  }
});

// Agenda routes
app.get('/api/agenda/subscription-status', authenticate, async (req, res) => {
  try {
    // Check if user is a professional
    if (!req.user.roles.includes('professional')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Get professional subscription
    const subscriptionResult = await pool.query(
      `SELECT * FROM professional_subscriptions
       WHERE professional_id = $1
       ORDER BY expiry_date DESC
       LIMIT 1`,
      [req.user.id]
    );
    
    let status = 'pending';
    let expiryDate = null;
    let daysRemaining = 0;
    let canUseAgenda = false;
    
    if (subscriptionResult.rows.length > 0) {
      const subscription = subscriptionResult.rows[0];
      expiryDate = subscription.expiry_date;
    // Consider payment active if status is 'active' OR if status is 'approved' and not expired
    const isActive = (payment.status === 'active') || (payment.status === 'approved' && expiryDate > now);
      if (subscription.status === 'active' && new Date(subscription.expiry_date) > new Date()) {
        status = 'active';
        
        // Calculate days remaining
        const today = new Date();
        const expiry = new Date(subscription.expiry_date);
        const diffTime = Math.abs(expiry - today);
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        canUseAgenda = true;
      } else {
        status = 'expired';
      }
    }
    
    res.json({
      status,
      expires_at: expiryDate,
      days_remaining: daysRemaining,
      can_use_agenda: canUseAgenda,
      last_payment: subscriptionResult.rows[0]?.created_at
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ message: 'Erro ao buscar status da assinatura' });
  }
});

app.post('/api/agenda/create-subscription-payment', authenticate, async (req, res) => {
  try {
    // Check if user is a professional
    if (!req.user.roles.includes('professional')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if MercadoPago is initialized
    if (!mercadopago) {
      return res.status(500).json({ message: 'Serviço de pagamento não disponível' });
    }
    
    // Create preference
    const preference = new Preference(mercadopago);
    
    const preferenceData = {
      items: [
        {
          id: 'agenda-subscription',
          title: 'Assinatura Agenda Profissional',
          quantity: 1,
          unit_price: 49.9,
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
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      external_reference: `professional_subscription_${req.user.id}`,
      metadata: {
        professional_id: req.user.id,
        type: 'agenda_subscription'
      }
    };
    
    const result = await preference.create({ body: preferenceData });
    
    res.json({
      id: result.id,
      init_point: result.init_point
    });
  } catch (error) {
    console.error('Error creating subscription payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento da assinatura' });
  }
});

// Patients routes (for agenda)
app.get('/api/agenda/patients', authenticate, async (req, res) => {
  try {
    // Check if user is a professional
    if (!req.user.roles.includes('professional') && !req.user.roles.includes('clinic')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if professional has active subscription
    if (req.user.roles.includes('professional')) {
      const subscriptionResult = await pool.query(
        `SELECT * FROM professional_subscriptions
         WHERE professional_id = $1 AND status = 'active' AND expiry_date > CURRENT_TIMESTAMP
         LIMIT 1`,
        [req.user.id]
      );
      
      if (subscriptionResult.rows.length === 0) {
        return res.status(403).json({ message: 'Assinatura da agenda necessária' });
      }
    }
    
    const includeArchived = req.query.include_archived === 'true';
    
    let query;
    let params = [];
    
    if (req.user.roles.includes('clinic')) {
      // Clinic can see all patients
      query = `
        SELECT p.*, u.name as professional_name
        FROM patients p
        JOIN users u ON p.professional_id = u.id
        ${!includeArchived ? 'WHERE p.is_archived = false' : ''}
        ORDER BY p.name
      `;
    } else {
      // Professional can only see their own patients
      query = `
        SELECT p.*, u.name as professional_name
        FROM patients p
        JOIN users u ON p.professional_id = u.id
        WHERE p.professional_id = $1 ${!includeArchived ? 'AND p.is_archived = false' : ''}
        ORDER BY p.name
      `;
      params.push(req.user.id);
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
    // Check if user is a professional
    if (!req.user.roles.includes('professional') && !req.user.roles.includes('clinic')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { cpf } = req.params;
    
    let query;
    let params = [];
    
    if (req.user.roles.includes('clinic')) {
      // Clinic can see all patients
      query = `
        SELECT p.*, u.name as professional_name
        FROM patients p
        JOIN users u ON p.professional_id = u.id
        WHERE p.cpf = $1
        LIMIT 1
      `;
      params.push(cpf);
    } else {
      // Professional can only see their own patients
      query = `
        SELECT p.*, u.name as professional_name
        FROM patients p
        JOIN users u ON p.professional_id = u.id
        WHERE p.cpf = $1 AND p.professional_id = $2
        LIMIT 1
      `;
      params.push(cpf, req.user.id);
    }
    
    const result = await pool.query(query, params);
    
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
    // Check if user is a professional
    if (!req.user.roles.includes('professional') && !req.user.roles.includes('clinic')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if professional has active subscription
    if (req.user.roles.includes('professional')) {
      const subscriptionResult = await pool.query(
        `SELECT * FROM professional_subscriptions
         WHERE professional_id = $1 AND status = 'active' AND expiry_date > CURRENT_TIMESTAMP
         LIMIT 1`,
        [req.user.id]
      );
      
      if (subscriptionResult.rows.length === 0) {
        return res.status(403).json({ message: 'Assinatura da agenda necessária' });
      }
    }
    
    const { 
      name, cpf, email, phone, birth_date, 
      address, address_number, address_complement, 
      neighborhood, city, state, notes 
    } = req.body;
    
    // Validate required fields
    if (!name || !cpf) {
      return res.status(400).json({ message: 'Nome e CPF são obrigatórios' });
    }
    
    // Check if patient already exists for this professional
    const patientExists = await pool.query(
      'SELECT * FROM patients WHERE cpf = $1 AND professional_id = $2',
      [cpf, req.user.id]
    );
    
    if (patientExists.rows.length > 0) {
      return res.status(400).json({ message: 'Paciente já cadastrado com este CPF' });
    }
    
    // Create patient
    const result = await pool.query(
      `INSERT INTO patients (
        professional_id, name, cpf, email, phone, birth_date, 
        address, address_number, address_complement, 
        neighborhood, city, state, notes, is_convenio_patient
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        req.user.id, name, cpf, email, phone, birth_date, 
        address, address_number, address_complement, 
        neighborhood, city, state, notes, false
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
    const { id } = req.params;
    const { 
      name, email, phone, birth_date, 
      address, address_number, address_complement, 
      neighborhood, city, state, notes 
    } = req.body;
    
    // Check if patient exists and belongs to the user
    const patientResult = await pool.query(
      'SELECT * FROM patients WHERE id = $1',
      [id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    const patient = patientResult.rows[0];
    
    // Check if user is authorized
    if (
      patient.professional_id !== req.user.id && 
      !req.user.roles.includes('admin') && 
      !req.user.roles.includes('clinic')
    ) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Update patient
    const result = await pool.query(
      `UPDATE patients SET
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
        notes = COALESCE($11, notes),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $12 RETURNING *`,
      [
        name, email, phone, birth_date, 
        address, address_number, address_complement, 
        neighborhood, city, state, notes, id
      ]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating patient:', error);
    res.status(500).json({ message: 'Erro ao atualizar paciente' });
  }
});

app.put('/api/agenda/patients/:id/archive', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_archived } = req.body;
    
    // Check if patient exists and belongs to the user
    const patientResult = await pool.query(
      'SELECT * FROM patients WHERE id = $1',
      [id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    const patient = patientResult.rows[0];
    
    // Check if user is authorized
    if (
      patient.professional_id !== req.user.id && 
      !req.user.roles.includes('admin') && 
      !req.user.roles.includes('clinic')
    ) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Update patient
    const result = await pool.query(
      `UPDATE patients SET
        is_archived = $1,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [is_archived, id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error archiving patient:', error);
    res.status(500).json({ message: 'Erro ao arquivar paciente' });
  }
});

// Appointments routes
app.get('/api/agenda/appointments', authenticate, async (req, res) => {
  try {
    // Check if user is a professional
    if (!req.user.roles.includes('professional') && !req.user.roles.includes('clinic')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if professional has active subscription
    if (req.user.roles.includes('professional')) {
      const subscriptionResult = await pool.query(
        `SELECT * FROM professional_subscriptions
         WHERE professional_id = $1 AND status = 'active' AND expiry_date > CURRENT_TIMESTAMP
         LIMIT 1`,
        [req.user.id]
      );
      
      if (subscriptionResult.rows.length === 0) {
        return res.status(403).json({ message: 'Assinatura da agenda necessária' });
      }
    }
    
    const { start_date, end_date, professional_id } = req.query;
    
    let query;
    let params = [];
    
    if (req.user.roles.includes('clinic')) {
      // Clinic can see appointments for specific professional
      query = `
        SELECT a.*, 
          p.name as patient_name, 
          p.phone as patient_phone,
          p.is_convenio_patient,
          u.name as professional_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users u ON a.professional_id = u.id
        WHERE 1=1
      `;
      
      if (professional_id) {
        query += ` AND a.professional_id = $${params.length + 1}`;
        params.push(professional_id);
      }
      
      if (start_date) {
        query += ` AND a.date >= $${params.length + 1}`;
        params.push(start_date);
      }
      
      if (end_date) {
        query += ` AND a.date <= $${params.length + 1}`;
        params.push(end_date);
      }
      
      query += ' ORDER BY a.date DESC';
    } else {
      // Professional can only see their own appointments
      query = `
        SELECT a.*, 
          p.name as patient_name, 
          p.phone as patient_phone,
          p.is_convenio_patient
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.professional_id = $1
      `;
      params.push(req.user.id);
      
      if (start_date) {
        query += ` AND a.date >= $${params.length + 1}`;
        params.push(start_date);
      }
      
      if (end_date) {
        query += ` AND a.date <= $${params.length + 1}`;
        params.push(end_date);
      }
      
      query += ' ORDER BY a.date DESC';
    }
    
    const result = await pool.query(query, params);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Erro ao buscar agendamentos' });
  }
});

app.post('/api/agenda/appointments', authenticate, async (req, res) => {
  try {
    // Check if user is a professional
    if (!req.user.roles.includes('professional') && !req.user.roles.includes('clinic')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if professional has active subscription
    if (req.user.roles.includes('professional')) {
      const subscriptionResult = await pool.query(
        `SELECT * FROM professional_subscriptions
         WHERE professional_id = $1 AND status = 'active' AND expiry_date > CURRENT_TIMESTAMP
         LIMIT 1`,
        [req.user.id]
      );
      
      if (subscriptionResult.rows.length === 0) {
        return res.status(403).json({ message: 'Assinatura da agenda necessária' });
      }
    }
    
    const { 
      patient_id, date, status, notes, location_id 
    } = req.body;
    
    // Validate required fields
    if (!patient_id || !date) {
      return res.status(400).json({ message: 'Paciente e data são obrigatórios' });
    }
    
    // Check if patient exists and belongs to the user
    const patientResult = await pool.query(
      'SELECT * FROM patients WHERE id = $1',
      [patient_id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    const patient = patientResult.rows[0];
    
    // Check if user is authorized
    if (
      patient.professional_id !== req.user.id && 
      !req.user.roles.includes('admin') && 
      !req.user.roles.includes('clinic')
    ) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Create appointment
    const result = await pool.query(
      `INSERT INTO appointments (
        professional_id, patient_id, date, status, notes, location_id
      ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.user.id, patient_id, date, status || 'scheduled', notes, location_id
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
    // Check if user is a professional
    if (!req.user.roles.includes('professional') && !req.user.roles.includes('clinic')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { patientId } = req.params;
    
    // Check if patient exists
    const patientResult = await pool.query(
      'SELECT * FROM patients WHERE id = $1',
      [patientId]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    const patient = patientResult.rows[0];
    
    // Check if user is authorized
    if (
      patient.professional_id !== req.user.id && 
      !req.user.roles.includes('admin') && 
      !req.user.roles.includes('clinic')
    ) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Get medical records
    const result = await pool.query(
      `SELECT mr.*, 
        p.name as patient_name, 
        p.cpf as patient_cpf,
        u.name as professional_name,
        u.professional_registration,
        COALESCE(c.date, a.date) as consultation_date,
        COALESCE(s.name, 'Consulta') as service_name
       FROM medical_records mr
       JOIN patients p ON mr.patient_id = p.id
       JOIN users u ON mr.professional_id = u.id
       LEFT JOIN consultations c ON mr.consultation_id = c.id
       LEFT JOIN appointments a ON mr.appointment_id = a.id
       LEFT JOIN services s ON c.service_id = s.id
       WHERE mr.patient_id = $1
       ORDER BY mr.created_at DESC`,
      [patientId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching medical records:', error);
    res.status(500).json({ message: 'Erro ao buscar prontuários' });
  }
});

app.post('/api/medical-records', authenticate, async (req, res) => {
  try {
    // Check if user is a professional
    if (!req.user.roles.includes('professional')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { 
      patient_id, consultation_id, appointment_id,
      chief_complaint, anamnesis, physical_examination,
      diagnosis, treatment_plan, clinical_evolution, internal_notes
    } = req.body;
    
    // Validate required fields
    if (!patient_id) {
      return res.status(400).json({ message: 'Paciente é obrigatório' });
    }
    
    // Check if patient exists and belongs to the user
    const patientResult = await pool.query(
      'SELECT * FROM patients WHERE id = $1',
      [patient_id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Paciente não encontrado' });
    }
    
    const patient = patientResult.rows[0];
    
    if (patient.professional_id !== req.user.id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Create medical record
    const result = await pool.query(
      `INSERT INTO medical_records (
        professional_id, patient_id, consultation_id, appointment_id,
        chief_complaint, anamnesis, physical_examination,
        diagnosis, treatment_plan, clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        req.user.id, patient_id, consultation_id, appointment_id,
        chief_complaint, anamnesis, physical_examination,
        diagnosis, treatment_plan, clinical_evolution, internal_notes
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
    // Check if user is a professional
    if (!req.user.roles.includes('professional')) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    const { id } = req.params;
    const { 
      chief_complaint, anamnesis, physical_examination,
      diagnosis, treatment_plan, clinical_evolution, internal_notes
    } = req.body;
    
    // Check if medical record exists and belongs to the user
    const recordResult = await pool.query(
      'SELECT * FROM medical_records WHERE id = $1',
      [id]
    );
    
    if (recordResult.rows.length === 0) {
      return res.status(404).json({ message: 'Prontuário não encontrado' });
    }
    
    const record = recordResult.rows[0];
    
    if (record.professional_id !== req.user.id) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
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
       WHERE id = $8 RETURNING *`,
      [
        chief_complaint, anamnesis, physical_examination,
        diagnosis, treatment_plan, clinical_evolution, internal_notes, id
      ]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating medical record:', error);
    res.status(500).json({ message: 'Erro ao atualizar prontuário' });
  }
});

// Clinic routes
app.get('/api/clinic/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.percentage, p.professional_type, p.is_active
       FROM users u
       JOIN professionals p ON u.id = p.user_id
       WHERE 'professional' = ANY(u.roles)
       ORDER BY u.name`
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic professionals:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais da clínica' });
  }
});

app.post('/api/clinic/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { 
      name, cpf, email, phone, password, 
      professional_registration, category_id, 
      percentage, professional_type 
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
    
    // Start transaction
    await pool.query('BEGIN');
    
    try {
      // Create user
      const userResult = await pool.query(
        `INSERT INTO users (
          name, cpf, email, phone, password, roles,
          percentage, category_id, subscription_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          name, cpf, email, phone, hashedPassword, 
          ['professional'], percentage, category_id, 'active'
        ]
      );
      
      const user = userResult.rows[0];
      
      // Create professional record
      await pool.query(
        `INSERT INTO professionals (user_id, professional_registration, professional_type)
         VALUES ($1, $2, $3)`,
        [user.id, professional_registration, professional_type || 'convenio']
      );
      
      // Commit transaction
      await pool.query('COMMIT');
      
      // Return user data (without password)
      const { password: _, ...userData } = user;
      
      res.status(201).json(userData);
    } catch (error) {
      // Rollback transaction on error
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error creating professional:', error);
    res.status(500).json({ message: 'Erro ao criar profissional' });
  }
});

app.put('/api/clinic/professionals/:id', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { id } = req.params;
    const { percentage, is_active } = req.body;
    
    // Start transaction
    await pool.query('BEGIN');
    
    try {
      // Update user
      if (percentage !== undefined) {
        await pool.query(
          `UPDATE users SET
            percentage = $1,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [percentage, id]
        );
      }
      
      // Update professional
      if (is_active !== undefined) {
        await pool.query(
          `UPDATE professionals SET
            is_active = $1,
            updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $2`,
          [is_active, id]
        );
      }
      
      // Commit transaction
      await pool.query('COMMIT');
      
      res.json({ message: 'Profissional atualizado com sucesso' });
    } catch (error) {
      // Rollback transaction on error
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error updating professional:', error);
    res.status(500).json({ message: 'Erro ao atualizar profissional' });
  }
});

app.get('/api/clinic/patients', authenticate, authorize(['clinic']), async (req, res) => {
  try {
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

app.get('/api/clinic/agenda/professionals', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, p.professional_type, p.is_active
       FROM users u
       JOIN professionals p ON u.id = p.user_id
       WHERE 'professional' = ANY(u.roles)
         AND p.is_active = true
         AND (p.professional_type = 'agenda' OR p.professional_type = 'both')
       ORDER BY u.name`
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching agenda professionals:', error);
    res.status(500).json({ message: 'Erro ao buscar profissionais da agenda' });
  }
});

app.get('/api/clinic/agenda/appointments', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { professional_id, start_date, end_date } = req.query;
    
    // Validate required fields
    if (!professional_id || !start_date || !end_date) {
      return res.status(400).json({ message: 'ID do profissional, data inicial e data final são obrigatórios' });
    }
    
    const result = await pool.query(
      `SELECT a.*, 
        p.name as patient_name, 
        p.phone as patient_phone,
        p.is_convenio_patient
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       WHERE a.professional_id = $1
         AND a.date >= $2
         AND a.date <= $3
       ORDER BY a.date`,
      [professional_id, start_date, end_date]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic appointments:', error);
    res.status(500).json({ message: 'Erro ao buscar agendamentos da clínica' });
  }
});

app.post('/api/clinic/consultations', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { 
      client_id, dependent_id, professional_id, 
      service_id, value, date, location_id, notes 
    } = req.body;
    
    // Validate required fields
    if ((!client_id && !dependent_id) || !professional_id || !service_id || !value || !date) {
      return res.status(400).json({ message: 'Cliente/dependente, profissional, serviço, valor e data são obrigatórios' });
    }
    
    // Create consultation
    const result = await pool.query(
      `INSERT INTO consultations (
        client_id, dependent_id, professional_id, 
        service_id, value, date, location_id, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        client_id, dependent_id, professional_id, 
        service_id, value, date, location_id, notes
      ]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating clinic consultation:', error);
    res.status(500).json({ message: 'Erro ao criar consulta' });
  }
});

app.get('/api/clinic/stats', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    // Get total professionals
    const professionalsResult = await pool.query(
      `SELECT COUNT(*) as total,
        SUM(CASE WHEN p.is_active = true THEN 1 ELSE 0 END) as active
       FROM users u
       JOIN professionals p ON u.id = p.user_id
       WHERE 'professional' = ANY(u.roles)`
    );
    
    // Get monthly consultations
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    
    const consultationsResult = await pool.query(
      `SELECT COUNT(*) as count, SUM(value) as revenue
       FROM consultations
       WHERE date >= $1 AND date <= $2`,
      [firstDayOfMonth, lastDayOfMonth]
    );
    
    // Get pending payments
    const pendingPaymentsResult = await pool.query(
      `SELECT SUM(c.value * (1 - (u.percentage / 100))) as pending
       FROM consultations c
       JOIN users u ON c.professional_id = u.id
       WHERE c.date >= $1 AND c.date <= $2`,
      [firstDayOfMonth, lastDayOfMonth]
    );
    
    res.json({
      total_professionals: parseInt(professionalsResult.rows[0].total) || 0,
      active_professionals: parseInt(professionalsResult.rows[0].active) || 0,
      total_consultations: parseInt(consultationsResult.rows[0].count) || 0,
      monthly_revenue: parseFloat(consultationsResult.rows[0].revenue) || 0,
      pending_payments: parseFloat(pendingPaymentsResult.rows[0].pending) || 0
    });
  } catch (error) {
    console.error('Error fetching clinic stats:', error);
    res.status(500).json({ message: 'Erro ao buscar estatísticas da clínica' });
  }
});

app.get('/api/clinic/reports', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Get professional reports
    const result = await pool.query(
      `SELECT 
        u.id as professional_id,
        u.name as professional_name,
        u.percentage as professional_percentage,
        COUNT(c.id) as total_consultations,
        SUM(c.value) as total_revenue,
        SUM(c.value * (u.percentage / 100)) as professional_payment,
        SUM(c.value * (1 - (u.percentage / 100))) as clinic_revenue
       FROM consultations c
       JOIN users u ON c.professional_id = u.id
       WHERE c.date >= $1 AND c.date <= $2
       GROUP BY u.id, u.name, u.percentage
       ORDER BY u.name`,
      [start_date, end_date]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic reports:', error);
    res.status(500).json({ message: 'Erro ao buscar relatórios da clínica' });
  }
});

app.get('/api/clinic/reports/professional/:professionalId', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { professionalId } = req.params;
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Get consultation details
    const result = await pool.query(
      `SELECT 
        c.id,
        c.date,
        COALESCE(d.name, u.name) as patient_name,
        s.name as service_name,
        c.value,
        c.value * (p.percentage / 100) as professional_payment,
        c.value * (1 - (p.percentage / 100)) as clinic_revenue
       FROM consultations c
       LEFT JOIN users u ON c.client_id = u.id
       LEFT JOIN dependents d ON c.dependent_id = d.id
       JOIN users p ON c.professional_id = p.id
       JOIN services s ON c.service_id = s.id
       WHERE c.professional_id = $1
         AND c.date >= $2 AND c.date <= $3
       ORDER BY c.date DESC`,
      [professionalId, start_date, end_date]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching professional consultations:', error);
    res.status(500).json({ message: 'Erro ao buscar consultas do profissional' });
  }
});

app.get('/api/clinic/medical-records/patient/:patientId', authenticate, authorize(['clinic']), async (req, res) => {
  try {
    const { patientId } = req.params;
    
    // Get medical records
    const result = await pool.query(
      `SELECT mr.*, 
        p.name as patient_name, 
        p.cpf as patient_cpf,
        u.name as professional_name,
        COALESCE(c.date, a.date) as consultation_date,
        COALESCE(s.name, 'Consulta') as service_name
       FROM medical_records mr
       JOIN patients p ON mr.patient_id = p.id
       JOIN users u ON mr.professional_id = u.id
       LEFT JOIN consultations c ON mr.consultation_id = c.id
       LEFT JOIN appointments a ON mr.appointment_id = a.id
       LEFT JOIN services s ON c.service_id = s.id
       WHERE mr.patient_id = $1
       ORDER BY mr.created_at DESC`,
      [patientId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clinic medical records:', error);
    res.status(500).json({ message: 'Erro ao buscar prontuários da clínica' });
  }
});

// Report routes
app.get('/api/reports/professional-revenue', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Get professional percentage
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
        c.id,
        c.date,
        COALESCE(d.name, u.name) as client_name,
        s.name as service_name,
        c.value as total_value,
        c.value * (1 - ($1 / 100)) as amount_to_pay
       FROM consultations c
       LEFT JOIN users u ON c.client_id = u.id
       LEFT JOIN dependents d ON c.dependent_id = d.id
       JOIN services s ON c.service_id = s.id
       WHERE c.professional_id = $2
         AND c.date >= $3 AND c.date <= $4
       ORDER BY c.date DESC`,
      [percentage, req.user.id, start_date, end_date]
    );
    
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
    console.error('Error fetching professional revenue:', error);
    res.status(500).json({ message: 'Erro ao buscar receita do profissional' });
  }
});

app.get('/api/reports/professional-consultations', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Get professional percentage
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
        c.id as consultation_id,
        c.date,
        COALESCE(d.name, u.name) as patient_name,
        s.name as service_name,
        c.value as total_value,
        c.value * (1 - ($1 / 100)) as amount_to_pay,
        CASE WHEN d.id IS NOT NULL OR u.roles @> ARRAY['client']::text[] THEN true ELSE false END as is_convenio_patient,
        EXISTS (
          SELECT 1 FROM medical_records mr 
          WHERE mr.consultation_id = c.id OR 
                (mr.patient_id = COALESCE(
                  (SELECT p.id FROM patients p WHERE p.cpf = COALESCE(d.cpf, u.cpf) AND p.professional_id = $2),
                  0
                ))
        ) as has_medical_record
       FROM consultations c
       LEFT JOIN users u ON c.client_id = u.id
       LEFT JOIN dependents d ON c.dependent_id = d.id
       JOIN services s ON c.service_id = s.id
       WHERE c.professional_id = $2
         AND c.date >= $3 AND c.date <= $4
       ORDER BY c.date DESC`,
      [percentage, req.user.id, start_date, end_date]
    );
    
    // Calculate summary
    const consultations = consultationsResult.rows;
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const convenioConsultations = consultations.filter(c => c.is_convenio_patient);
    const particularConsultations = consultations.filter(c => !c.is_convenio_patient);
    const convenioRevenue = convenioConsultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const particularRevenue = particularConsultations.reduce((sum, c) => sum + parseFloat(c.total_value), 0);
    const amountToPay = convenioConsultations.reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0);
    
    res.json({
      summary: {
        total_consultations: consultations.length,
        convenio_consultations: convenioConsultations.length,
        particular_consultations: particularConsultations.length,
        total_revenue: totalRevenue,
        convenio_revenue: convenioRevenue,
        particular_revenue: particularRevenue,
        amount_to_pay: amountToPay
      },
      consultations
    });
  } catch (error) {
    console.error('Error fetching professional consultations:', error);
    res.status(500).json({ message: 'Erro ao buscar consultas do profissional' });
  }
});

app.get('/api/reports/revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Get revenue by professional
    const professionalRevenueResult = await pool.query(
      `SELECT 
        u.id as professional_id,
        u.name as professional_name,
        u.percentage as professional_percentage,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue,
        SUM(c.value * (u.percentage / 100)) as professional_payment,
        SUM(c.value * (1 - (u.percentage / 100))) as clinic_revenue
       FROM consultations c
       JOIN users u ON c.professional_id = u.id
       WHERE c.date >= $1 AND c.date <= $2
       GROUP BY u.id, u.name, u.percentage
       ORDER BY u.name`,
      [start_date, end_date]
    );
    
    // Get revenue by service
    const serviceRevenueResult = await pool.query(
      `SELECT 
        s.id as service_id,
        s.name as service_name,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue
       FROM consultations c
       JOIN services s ON c.service_id = s.id
       WHERE c.date >= $1 AND c.date <= $2
       GROUP BY s.id, s.name
       ORDER BY s.name`,
      [start_date, end_date]
    );
    
    // Calculate total revenue
    const totalRevenueResult = await pool.query(
      `SELECT SUM(value) as total_revenue
       FROM consultations
       WHERE date >= $1 AND date <= $2`,
      [start_date, end_date]
    );
    
    const totalRevenue = parseFloat(totalRevenueResult.rows[0]?.total_revenue) || 0;
    
    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: professionalRevenueResult.rows,
      revenue_by_service: serviceRevenueResult.rows
    });
  } catch (error) {
    console.error('Error fetching revenue report:', error);
    res.status(500).json({ message: 'Erro ao buscar relatório de receita' });
  }
});

app.get('/api/reports/new-clients', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Get new clients count
    const newClientsResult = await pool.query(
      `SELECT COUNT(*) as count, SUM(250) as revenue
       FROM users
       WHERE 'client' = ANY(roles)
         AND created_at >= $1 AND created_at <= $2`,
      [start_date, end_date]
    );
    
    // Get clients by month
    const clientsByMonthResult = await pool.query(
      `SELECT 
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*) as count,
        SUM(250) as revenue
       FROM users
       WHERE 'client' = ANY(roles)
         AND created_at >= $1 AND created_at <= $2
       GROUP BY TO_CHAR(created_at, 'YYYY-MM')
       ORDER BY month`,
      [start_date, end_date]
    );
    
    res.json({
      total_new_clients: parseInt(newClientsResult.rows[0]?.count) || 0,
      subscription_revenue: parseFloat(newClientsResult.rows[0]?.revenue) || 0,
      clients_by_month: clientsByMonthResult.rows
    });
  } catch (error) {
    console.error('Error fetching new clients report:', error);
    res.status(500).json({ message: 'Erro ao buscar relatório de novos clientes' });
  }
});

app.get('/api/reports/professional-revenue-summary', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Get revenue by professional
    const professionalRevenueResult = await pool.query(
      `SELECT 
        u.id as professional_id,
        u.name as professional_name,
        u.percentage as professional_percentage,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue,
        SUM(c.value * (u.percentage / 100)) as professional_payment,
        SUM(c.value * (1 - (u.percentage / 100))) as clinic_revenue
       FROM consultations c
       JOIN users u ON c.professional_id = u.id
       WHERE c.date >= $1 AND c.date <= $2
       GROUP BY u.id, u.name, u.percentage
       ORDER BY u.name`,
      [start_date, end_date]
    );
    
    // Get revenue by service
    const serviceRevenueResult = await pool.query(
      `SELECT 
        s.id as service_id,
        s.name as service_name,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue
       FROM consultations c
       JOIN services s ON c.service_id = s.id
       WHERE c.date >= $1 AND c.date <= $2
       GROUP BY s.id, s.name
       ORDER BY s.name`,
      [start_date, end_date]
    );
    
    // Calculate total revenue
    const totalRevenueResult = await pool.query(
      `SELECT SUM(value) as total_revenue
       FROM consultations
       WHERE date >= $1 AND date <= $2`,
      [start_date, end_date]
    );
    
    const totalRevenue = parseFloat(totalRevenueResult.rows[0]?.total_revenue) || 0;
    
    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: professionalRevenueResult.rows,
      revenue_by_service: serviceRevenueResult.rows
    });
  } catch (error) {
    console.error('Error fetching professional revenue summary:', error);
    res.status(500).json({ message: 'Erro ao buscar resumo de receita por profissional' });
  }
});

app.get('/api/reports/total-revenue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data inicial e data final são obrigatórias' });
    }
    
    // Get subscription revenue
    const subscriptionRevenueResult = await pool.query(
      `SELECT SUM(250) as revenue
       FROM users
       WHERE 'client' = ANY(roles)
         AND created_at >= $1 AND created_at <= $2`,
      [start_date, end_date]
    );
    
    // Get consultation revenue (clinic's portion)
    const consultationRevenueResult = await pool.query(
      `SELECT SUM(c.value * (1 - (u.percentage / 100))) as revenue
       FROM consultations c
       JOIN users u ON c.professional_id = u.id
       WHERE c.date >= $1 AND c.date <= $2`,
      [start_date, end_date]
    );
    
    const subscriptionRevenue = parseFloat(subscriptionRevenueResult.rows[0]?.revenue) || 0;
    const consultationRevenue = parseFloat(consultationRevenueResult.rows[0]?.revenue) || 0;
    const totalRevenue = subscriptionRevenue + consultationRevenue;
    
    res.json({
      subscription_revenue: subscriptionRevenue,
      consultation_revenue: consultationRevenue,
      total_revenue: totalRevenue,
      clinic_total_revenue: totalRevenue
    });
  } catch (error) {
    console.error('Error fetching total revenue report:', error);
    res.status(500).json({ message: 'Erro ao buscar relatório de receita total' });
  }
});

// Professional payment routes
app.post('/api/professional/create-payment', authenticate, authorize(['professional']), async (req, res) => {
  try {
    const { amount } = req.body;
    
    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }
    
    // Check if MercadoPago is initialized
    if (!mercadopago) {
      return res.status(500).json({ message: 'Serviço de pagamento não disponível' });
    }
    
    // Create preference
    const preference = new Preference(mercadopago);
    
    const preferenceData = {
      items: [
        {
          id: 'professional-payment',
          title: 'Pagamento ao Convênio',
          quantity: 1,
          unit_price: parseFloat(amount),
          currency_id: 'BRL',
          description: 'Pagamento de comissão ao Convênio Quiro Ferreira'
        }
      ],
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional`
      },
      auto_return: 'approved',
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      external_reference: `professional_payment_${req.user.id}`,
      metadata: {
        professional_id: req.user.id,
        type: 'professional_payment'
      }
    };
    
    const result = await preference.create({ body: preferenceData });
    
    res.json({
      id: result.id,
      init_point: result.init_point
    });
  } catch (error) {
    console.error('Error creating professional payment:', error);
    res.status(500).json({ message: 'Erro ao criar pagamento' });
  }
});

app.post('/api/professional/signature', authenticate, async (req, res) => {
  try {
    const { signature_url } = req.body;
    
    if (!signature_url) {
      return res.status(400).json({ message: 'URL da assinatura é obrigatória' });
    }
    
    // Update user's signature URL
    await pool.query(
      'UPDATE users SET signature_url = $1 WHERE id = $2',
      [signature_url, req.user.id]
    );
    
    res.json({ message: 'Assinatura atualizada com sucesso' });
  } catch (error) {
    console.error('Error updating signature:', error);
    res.status(500).json({ message: 'Erro ao atualizar assinatura' });
  }
});

// Client subscription routes
app.post('/api/create-subscription', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { user_id } = req.body;
    
    // Check if user is creating their own subscription
    if (req.user.id !== parseInt(user_id)) {
      return res.status(403).json({ message: 'Acesso não autorizado' });
    }
    
    // Check if MercadoPago is initialized
    if (!mercadopago) {
      return res.status(500).json({ message: 'Serviço de pagamento não disponível' });
    }
    
    // Get dependents count
    const dependentsResult = await pool.query(
      'SELECT COUNT(*) as count FROM dependents WHERE client_id = $1',
      [user_id]
    );
    
    const dependentsCount = parseInt(dependentsResult.rows[0].count) || 0;
    const basePrice = 250;
    const dependentPrice = 50;
    const totalPrice = basePrice + (dependentsCount * dependentPrice);
    
    // Create preference
    const preference = new Preference(mercadopago);
    
    const preferenceData = {
      items: [
        {
          id: 'client-subscription',
          title: 'Assinatura Convênio Quiro Ferreira',
          quantity: 1,
          unit_price: totalPrice,
          currency_id: 'BRL',
          description: `Assinatura mensal do Convênio Quiro Ferreira (Titular + ${dependentsCount} dependentes)`
        }
      ],
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client`
      },
      auto_return: 'approved',
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/api/webhooks/mercadopago`,
      external_reference: `client_subscription_${user_id}`,
      metadata: {
        client_id: user_id,
        dependents_count: dependentsCount,
        type: 'client_subscription'
      }
    };
    
    const result = await preference.create({ body: preferenceData });
    
    res.json({
      id: result.id,
      init_point: result.init_point
    });
  } catch (error) {
    console.error('Error creating client subscription:', error);
    res.status(500).json({ message: 'Erro ao criar assinatura' });
  }
});

// Image upload endpoint
app.post('/api/upload-image', authenticate, async (req, res) => {
  try {
    if (!uploadMiddleware) {
      throw new Error('Upload middleware not available');
    }
    
    // Use the processUpload middleware
    uploadMiddleware.processUpload('image')(req, res, async (err) => {
      if (err) {
        console.error('❌ Error in upload middleware:', err);
        return res.status(400).json({ message: err.message });
      }
      
      if (!req.cloudinaryResult) {
        return res.status(400).json({ message: 'No image uploaded' });
      }
      
      // Return the Cloudinary URL
      res.json({ 
        imageUrl: req.cloudinaryResult.secure_url,
        publicId: req.cloudinaryResult.public_id
      });
    });
  } catch (error) {
    console.error('❌ Error uploading image:', error);
    res.status(500).json({ message: 'Error uploading image' });
  }
});

// Document templates endpoints
app.get('/api/document-templates', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM document_templates ORDER BY name'
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching document templates:', error);
    res.status(500).json({ message: 'Error fetching document templates' });
  }
});

// Generated documents endpoints
app.get('/api/generated-documents/patient/:patientId', authenticate, async (req, res) => {
  try {
    const { patientId } = req.params;
    
    const result = await pool.query(
      `SELECT gd.*, dt.name as template_name, p.name as patient_name
       FROM generated_documents gd
       JOIN document_templates dt ON gd.template_id = dt.id
       JOIN patients p ON gd.patient_id = p.id
       WHERE gd.patient_id = $1 AND gd.professional_id = $2
       ORDER BY gd.created_at DESC`,
      [patientId, req.user.id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching generated documents:', error);
    res.status(500).json({ message: 'Error fetching generated documents' });
  }
});

// Generate document endpoint
app.post('/api/generate-document', authenticate, async (req, res) => {
  try {
    const { template_id, patient_id, professional_id, ...templateData } = req.body;
    
    // Validate required fields
    if (!template_id || !patient_id || !professional_id) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    // Get template
    const templateResult = await pool.query(
      'SELECT * FROM document_templates WHERE id = $1',
      [template_id]
    );
    
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ message: 'Template not found' });
    }
    
    const template = templateResult.rows[0];
    
    // Get patient data
    const patientResult = await pool.query(
      'SELECT * FROM patients WHERE id = $1',
      [patient_id]
    );
    
    if (patientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    
    const patient = patientResult.rows[0];
    
    // Get professional data
    const professionalResult = await pool.query(
      'SELECT u.*, p.professional_registration FROM users u LEFT JOIN professionals p ON u.id = p.user_id WHERE u.id = $1',
      [professional_id]
    );
    
    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: 'Professional not found' });
    }
    
    const professional = professionalResult.rows[0];
    
    // Prepare data for template
    const data = {
      nome: patient.name,
      cpf: patient.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
      email: patient.email || '',
      telefone: patient.phone || '',
      endereco: patient.address || '',
      numero: patient.address_number || '',
      complemento: patient.address_complement || '',
      bairro: patient.neighborhood || '',
      cidade: patient.city || '',
      estado: patient.state || '',
      data_atual: new Date().toLocaleDateString('pt-BR'),
      hora_atual: new Date().toLocaleTimeString('pt-BR'),
      profissional_nome: professional.name,
      profissional_registro: professional.professional_registration || '',
      profissional_assinatura: professional.signature_url || '',
      ...templateData
    };
    
    // Generate PDF using template
    // For this example, we'll just return a success message
    // In a real implementation, you would use a PDF generation library
    
    // Save generated document
    const documentResult = await pool.query(
      `INSERT INTO generated_documents 
       (id, template_id, patient_id, professional_id, type, url, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        `doc_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        template_id, 
        patient_id, 
        professional_id, 
        template.type,
        'https://example.com/document.pdf', // Replace with actual URL
        JSON.stringify(data)
      ]
    );
    
    const document = documentResult.rows[0];
    
    res.json({
      id: document.id,
      url: document.url,
      message: 'Document generated successfully'
    });
  } catch (error) {
    console.error('Error generating document:', error);
    res.status(500).json({ message: 'Error generating document' });
  }
});

// MercadoPago webhook
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      
      // Get payment details from MercadoPago
      // In a real implementation, you would use the MercadoPago API to get payment details
      
      // For this example, we'll just acknowledge the webhook
      console.log('Received payment webhook:', paymentId);
    }
    
    res.status(200).send();
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send();
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Export app for testing
export default app;