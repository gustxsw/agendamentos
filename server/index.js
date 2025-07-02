import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";
import { authenticate, authorize } from "./middleware/auth.js";
import createUpload from "./middleware/upload.js";
import { v2 as cloudinary } from "cloudinary";
import mercadopago from "mercadopago";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://www.cartaoquiroferreira.com.br",
    "https://cartaoquiroferreira.com.br",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Configure MercadoPago
if (process.env.MP_ACCESS_TOKEN) {
  mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN,
  });
  console.log("✅ MercadoPago configured successfully");
} else {
  console.warn("⚠️ MercadoPago access token not found");
}

// Configure Cloudinary
if (
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  console.log("✅ Cloudinary configured successfully");
} else {
  console.warn("⚠️ Cloudinary credentials not found");
}

// Create tables function
const createTables = async () => {
  try {
    console.log("🔄 Creating database tables...");

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
        password_hash VARCHAR(255) NOT NULL,
        roles TEXT[] DEFAULT ARRAY['client'],
        percentage INTEGER DEFAULT 50,
        category_id INTEGER,
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_expiry TIMESTAMP,
        photo_url TEXT,
        professional_registration VARCHAR(50),
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
        value DECIMAL(10,2) NOT NULL,
        date TIMESTAMP NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT check_client_or_dependent CHECK (
          (client_id IS NOT NULL AND dependent_id IS NULL) OR
          (client_id IS NULL AND dependent_id IS NOT NULL)
        )
      )
    `);

    // Professional locations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_locations (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        clinic_name VARCHAR(255) NOT NULL,
        address TEXT NOT NULL,
        address_number VARCHAR(20) NOT NULL,
        address_complement VARCHAR(100),
        neighborhood VARCHAR(100) NOT NULL,
        city VARCHAR(100) NOT NULL,
        state VARCHAR(2) NOT NULL,
        phone VARCHAR(20),
        is_main BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Agenda subscription table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        expires_at TIMESTAMP,
        payment_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Schedule config table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_configs (
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

    // Particular patients table (for professionals with agenda subscription)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS particular_patients (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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
        is_archived BOOLEAN DEFAULT false,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(professional_id, cpf)
      )
    `);

    // Appointments table (for agenda system)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES particular_patients(id) ON DELETE CASCADE,
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Medical records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INTEGER REFERENCES consultations(id),
        patient_id INTEGER REFERENCES particular_patients(id),
        professional_id INTEGER REFERENCES users(id) NOT NULL,
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

    // Insert default service categories
    await pool.query(`
      INSERT INTO service_categories (name, description) 
      VALUES 
        ('Fisioterapia', 'Serviços de fisioterapia e reabilitação'),
        ('Quiropraxia', 'Tratamentos quiropráticos'),
        ('Massoterapia', 'Massagens terapêuticas'),
        ('Acupuntura', 'Tratamentos com acupuntura'),
        ('Pilates', 'Aulas e sessões de pilates')
      ON CONFLICT DO NOTHING
    `);

    // Insert default services
    await pool.query(`
      INSERT INTO services (name, description, base_price, category_id, is_base_service)
      SELECT 
        'Consulta de Fisioterapia', 
        'Consulta padrão de fisioterapia', 
        100.00, 
        sc.id, 
        true
      FROM service_categories sc WHERE sc.name = 'Fisioterapia'
      ON CONFLICT DO NOTHING
    `);

    await pool.query(`
      INSERT INTO services (name, description, base_price, category_id, is_base_service)
      SELECT 
        'Sessão de Quiropraxia', 
        'Sessão padrão de quiropraxia', 
        120.00, 
        sc.id, 
        true
      FROM service_categories sc WHERE sc.name = 'Quiropraxia'
      ON CONFLICT DO NOTHING
    `);

    console.log("✅ Database tables created successfully");
  } catch (error) {
    console.error("❌ Error creating tables:", error);
    throw error;
  }
};

// Initialize database
createTables().catch(console.error);

// Helper function to generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      currentRole: user.currentRole || user.roles[0],
    },
    process.env.JWT_SECRET || "your-secret-key",
    { expiresIn: "7d" }
  );
};

// Auth routes
app.post("/api/auth/register", async (req, res) => {
  try {
    console.log("🔄 Registration request received:", req.body);

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
      return res.status(400).json({
        message: "Nome, CPF e senha são obrigatórios",
      });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE cpf = $1",
      [cpf]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        message: "CPF já cadastrado no sistema",
      });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert new user
    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, password_hash, roles
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
      RETURNING id, name, cpf, email, roles, subscription_status`,
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
        passwordHash,
        ["client"],
      ]
    );

    const newUser = result.rows[0];
    newUser.currentRole = "client";

    // Generate token
    const token = generateToken(newUser);

    // Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    console.log("✅ User registered successfully:", newUser.id);

    res.status(201).json({
      message: "Usuário criado com sucesso",
      user: newUser,
      token: token,
    });
  } catch (error) {
    console.error("❌ Registration error:", error);
    res.status(500).json({
      message: "Erro interno do servidor",
      error: error.message,
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { cpf, password } = req.body;

    console.log("🔄 Login attempt for CPF:", cpf);

    if (!cpf || !password) {
      return res.status(400).json({
        message: "CPF e senha são obrigatórios",
      });
    }

    // Find user by CPF
    const result = await pool.query(
      "SELECT id, name, cpf, password_hash, roles FROM users WHERE cpf = $1",
      [cpf]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "CPF ou senha incorretos",
      });
    }

    const user = result.rows[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        message: "CPF ou senha incorretos",
      });
    }

    // Remove password hash from user object
    delete user.password_hash;

    console.log("✅ Login successful for user:", user.id);

    res.json({
      message: "Login realizado com sucesso",
      user: user,
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({
      message: "Erro interno do servidor",
    });
  }
});

app.post("/api/auth/select-role", async (req, res) => {
  try {
    const { userId, role } = req.body;

    console.log("🎯 Role selection:", { userId, role });

    if (!userId || !role) {
      return res.status(400).json({
        message: "ID do usuário e role são obrigatórios",
      });
    }

    // Get user data
    const result = await pool.query(
      "SELECT id, name, cpf, roles FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Usuário não encontrado",
      });
    }

    const user = result.rows[0];

    // Verify user has the requested role
    if (!user.roles.includes(role)) {
      return res.status(403).json({
        message: "Usuário não possui esta role",
      });
    }

    // Set current role
    user.currentRole = role;

    // Generate token
    const token = generateToken(user);

    // Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    console.log("✅ Role selected successfully:", { userId, role });

    res.json({
      message: "Role selecionada com sucesso",
      user: user,
      token: token,
    });
  } catch (error) {
    console.error("❌ Role selection error:", error);
    res.status(500).json({
      message: "Erro interno do servidor",
    });
  }
});

app.post("/api/auth/switch-role", authenticate, async (req, res) => {
  try {
    const { role } = req.body;
    const userId = req.user.id;

    console.log("🔄 Role switch request:", { userId, role });

    // Get user data
    const result = await pool.query(
      "SELECT id, name, cpf, roles FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Usuário não encontrado",
      });
    }

    const user = result.rows[0];

    // Verify user has the requested role
    if (!user.roles.includes(role)) {
      return res.status(403).json({
        message: "Usuário não possui esta role",
      });
    }

    // Set current role
    user.currentRole = role;

    // Generate new token
    const token = generateToken(user);

    // Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    console.log("✅ Role switched successfully:", { userId, role });

    res.json({
      message: "Role alterada com sucesso",
      user: user,
      token: token,
    });
  } catch (error) {
    console.error("❌ Role switch error:", error);
    res.status(500).json({
      message: "Erro interno do servidor",
    });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logout realizado com sucesso" });
});

// User management routes
app.get("/api/users", authenticate, authorize(["admin"]), async (req, res) => {
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
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Erro ao buscar usuários" });
  }
});

app.get("/api/users/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        id, name, cpf, email, phone, birth_date,
        address, address_number, address_complement,
        neighborhood, city, state, roles, percentage,
        category_id, subscription_status, subscription_expiry,
        photo_url, professional_registration, created_at
      FROM users WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "Erro ao buscar usuário" });
  }
});

app.post("/api/users", authenticate, authorize(["admin"]), async (req, res) => {
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

    // Check if CPF already exists
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE cpf = $1",
      [cpf]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: "CPF já cadastrado" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password_hash,
        roles, percentage, category_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
        passwordHash,
        roles,
        percentage,
        category_id,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ message: "Erro ao criar usuário" });
  }
});

app.put("/api/users/:id", authenticate, authorize(["admin"]), async (req, res) => {
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

    const result = await pool.query(
      `UPDATE users SET 
        name = $1, email = $2, phone = $3, birth_date = $4,
        address = $5, address_number = $6, address_complement = $7,
        neighborhood = $8, city = $9, state = $10, roles = $11,
        percentage = $12, category_id = $13, updated_at = CURRENT_TIMESTAMP
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
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Erro ao atualizar usuário" });
  }
});

app.put("/api/users/:id/activate", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { expiry_date } = req.body;

    if (!expiry_date) {
      return res.status(400).json({ message: "Data de expiração é obrigatória" });
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
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error activating user:", error);
    res.status(500).json({ message: "Erro ao ativar usuário" });
  }
});

app.delete("/api/users/:id", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query("DELETE FROM users WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    res.json({ message: "Usuário excluído com sucesso" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Erro ao excluir usuário" });
  }
});

// Client lookup routes
app.get("/api/clients/lookup", authenticate, async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: "CPF é obrigatório" });
    }

    const result = await pool.query(
      `SELECT id, name, cpf, subscription_status, subscription_expiry
       FROM users 
       WHERE cpf = $1 AND 'client' = ANY(roles)`,
      [cpf]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error looking up client:", error);
    res.status(500).json({ message: "Erro ao buscar cliente" });
  }
});

// Dependents routes
app.get("/api/dependents/:clientId", authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;

    const result = await pool.query(
      "SELECT id, name, cpf, birth_date, created_at FROM dependents WHERE client_id = $1 ORDER BY name",
      [clientId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching dependents:", error);
    res.status(500).json({ message: "Erro ao buscar dependentes" });
  }
});

app.get("/api/dependents/lookup", authenticate, async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: "CPF é obrigatório" });
    }

    const result = await pool.query(
      `SELECT 
        d.id, d.name, d.cpf, d.birth_date, d.client_id,
        u.name as client_name, u.subscription_status as client_subscription_status
       FROM dependents d
       JOIN users u ON d.client_id = u.id
       WHERE d.cpf = $1`,
      [cpf]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Dependente não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error looking up dependent:", error);
    res.status(500).json({ message: "Erro ao buscar dependente" });
  }
});

app.post("/api/dependents", authenticate, async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;

    // Check if CPF already exists
    const existingDependent = await pool.query(
      "SELECT id FROM dependents WHERE cpf = $1",
      [cpf]
    );

    if (existingDependent.rows.length > 0) {
      return res.status(400).json({ message: "CPF já cadastrado como dependente" });
    }

    // Check if it's a user CPF
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE cpf = $1",
      [cpf]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: "Este CPF já está cadastrado como usuário" });
    }

    const result = await pool.query(
      `INSERT INTO dependents (client_id, name, cpf, birth_date)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, cpf, birth_date, created_at`,
      [client_id, name, cpf, birth_date]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating dependent:", error);
    res.status(500).json({ message: "Erro ao criar dependente" });
  }
});

app.put("/api/dependents/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, birth_date } = req.body;

    const result = await pool.query(
      `UPDATE dependents SET name = $1, birth_date = $2
       WHERE id = $3
       RETURNING id, name, cpf, birth_date, created_at`,
      [name, birth_date, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Dependente não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating dependent:", error);
    res.status(500).json({ message: "Erro ao atualizar dependente" });
  }
});

app.delete("/api/dependents/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM dependents WHERE id = $1 RETURNING id",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Dependente não encontrado" });
    }

    res.json({ message: "Dependente excluído com sucesso" });
  } catch (error) {
    console.error("Error deleting dependent:", error);
    res.status(500).json({ message: "Erro ao excluir dependente" });
  }
});

// Service categories routes
app.get("/api/service-categories", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, description, created_at FROM service_categories ORDER BY name"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching service categories:", error);
    res.status(500).json({ message: "Erro ao buscar categorias" });
  }
});

app.post("/api/service-categories", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { name, description } = req.body;

    const result = await pool.query(
      "INSERT INTO service_categories (name, description) VALUES ($1, $2) RETURNING *",
      [name, description]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating service category:", error);
    res.status(500).json({ message: "Erro ao criar categoria" });
  }
});

// Services routes
app.get("/api/services", authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.id, s.name, s.description, s.base_price, s.category_id, s.is_base_service,
        sc.name as category_name
      FROM services s
      LEFT JOIN service_categories sc ON s.category_id = sc.id
      ORDER BY sc.name, s.name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching services:", error);
    res.status(500).json({ message: "Erro ao buscar serviços" });
  }
});

app.post("/api/services", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { name, description, base_price, category_id, is_base_service } = req.body;

    const result = await pool.query(
      `INSERT INTO services (name, description, base_price, category_id, is_base_service)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description, base_price, category_id, is_base_service]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating service:", error);
    res.status(500).json({ message: "Erro ao criar serviço" });
  }
});

app.put("/api/services/:id", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, base_price, category_id, is_base_service } = req.body;

    const result = await pool.query(
      `UPDATE services SET 
        name = $1, description = $2, base_price = $3, 
        category_id = $4, is_base_service = $5
       WHERE id = $6 RETURNING *`,
      [name, description, base_price, category_id, is_base_service, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Serviço não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating service:", error);
    res.status(500).json({ message: "Erro ao atualizar serviço" });
  }
});

app.delete("/api/services/:id", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM services WHERE id = $1 RETURNING id",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Serviço não encontrado" });
    }

    res.json({ message: "Serviço excluído com sucesso" });
  } catch (error) {
    console.error("Error deleting service:", error);
    res.status(500).json({ message: "Erro ao excluir serviço" });
  }
});

// Consultations routes
app.get("/api/consultations", authenticate, async (req, res) => {
  try {
    let query = `
      SELECT 
        c.id, c.value, c.date, c.notes, c.created_at,
        COALESCE(d.name, u_client.name) as client_name,
        u_prof.name as professional_name,
        s.name as service_name,
        CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent
      FROM consultations c
      LEFT JOIN users u_client ON c.client_id = u_client.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN users u_prof ON c.professional_id = u_prof.id
      JOIN services s ON c.service_id = s.id
    `;

    const params = [];

    // Filter by user role
    if (req.user.currentRole === "professional") {
      query += " WHERE c.professional_id = $1";
      params.push(req.user.id);
    } else if (req.user.currentRole === "client") {
      query += " WHERE (c.client_id = $1 OR d.client_id = $1)";
      params.push(req.user.id);
    }

    query += " ORDER BY c.date DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching consultations:", error);
    res.status(500).json({ message: "Erro ao buscar consultas" });
  }
});

app.post("/api/consultations", authenticate, async (req, res) => {
  try {
    const { client_id, dependent_id, professional_id, service_id, value, date, notes } = req.body;

    console.log("🔄 Creating consultation:", {
      client_id,
      dependent_id,
      professional_id,
      service_id,
      value,
      date,
    });

    // Validate that either client_id or dependent_id is provided
    if (!client_id && !dependent_id) {
      return res.status(400).json({
        message: "É necessário informar o cliente ou dependente",
      });
    }

    // If professional_id is not provided, use the authenticated user
    const finalProfessionalId = professional_id || req.user.id;

    const result = await pool.query(
      `INSERT INTO consultations (client_id, dependent_id, professional_id, service_id, value, date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, value, date, created_at`,
      [client_id, dependent_id, finalProfessionalId, service_id, value, date, notes]
    );

    console.log("✅ Consultation created:", result.rows[0]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error creating consultation:", error);
    res.status(500).json({ message: "Erro ao registrar consulta" });
  }
});

// Professional routes
app.get("/api/professionals", authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.email, u.phone, u.address, u.address_number,
        u.address_complement, u.neighborhood, u.city, u.state,
        u.photo_url, sc.name as category_name
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE 'professional' = ANY(u.roles)
      ORDER BY u.name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching professionals:", error);
    res.status(500).json({ message: "Erro ao buscar profissionais" });
  }
});

// Professional locations routes
app.get("/api/professional-locations", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM professional_locations 
       WHERE professional_id = $1 
       ORDER BY is_main DESC, clinic_name`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching professional locations:", error);
    res.status(500).json({ message: "Erro ao buscar locais" });
  }
});

app.post("/api/professional-locations", authenticate, async (req, res) => {
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
      is_main,
    } = req.body;

    // If this is set as main, unset other main locations
    if (is_main) {
      await pool.query(
        "UPDATE professional_locations SET is_main = false WHERE professional_id = $1",
        [req.user.id]
      );
    }

    const result = await pool.query(
      `INSERT INTO professional_locations 
       (professional_id, clinic_name, address, address_number, address_complement, 
        neighborhood, city, state, phone, is_main)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
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
        is_main,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating professional location:", error);
    res.status(500).json({ message: "Erro ao criar local" });
  }
});

app.put("/api/professional-locations/:id", authenticate, async (req, res) => {
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
      is_main,
    } = req.body;

    // If this is set as main, unset other main locations
    if (is_main) {
      await pool.query(
        "UPDATE professional_locations SET is_main = false WHERE professional_id = $1 AND id != $2",
        [req.user.id, id]
      );
    }

    const result = await pool.query(
      `UPDATE professional_locations SET 
       clinic_name = $1, address = $2, address_number = $3, address_complement = $4,
       neighborhood = $5, city = $6, state = $7, phone = $8, is_main = $9
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
        req.user.id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Local não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating professional location:", error);
    res.status(500).json({ message: "Erro ao atualizar local" });
  }
});

app.delete("/api/professional-locations/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM professional_locations WHERE id = $1 AND professional_id = $2 RETURNING id",
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Local não encontrado" });
    }

    res.json({ message: "Local excluído com sucesso" });
  } catch (error) {
    console.error("Error deleting professional location:", error);
    res.status(500).json({ message: "Erro ao excluir local" });
  }
});

// Agenda subscription routes
app.get("/api/agenda/subscription-status", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT status, expires_at, payment_id, created_at
       FROM agenda_subscriptions 
       WHERE professional_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.json({
        status: "none",
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: false,
      });
    }

    const subscription = result.rows[0];
    const now = new Date();
    const expiresAt = subscription.expires_at ? new Date(subscription.expires_at) : null;

    let canUseAgenda = false;
    let daysRemaining = 0;

    if (subscription.status === "active" && expiresAt && expiresAt > now) {
      canUseAgenda = true;
      daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    res.json({
      status: subscription.status,
      expires_at: subscription.expires_at,
      days_remaining: daysRemaining,
      can_use_agenda: canUseAgenda,
      last_payment: subscription.payment_id,
    });
  } catch (error) {
    console.error("Error fetching subscription status:", error);
    res.status(500).json({ message: "Erro ao buscar status da assinatura" });
  }
});

app.post("/api/agenda/create-subscription-payment", authenticate, async (req, res) => {
  try {
    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({ message: "MercadoPago não configurado" });
    }

    const preference = {
      items: [
        {
          title: "Assinatura Agenda Profissional - Mensal",
          description: "Acesso completo à agenda profissional por 30 dias",
          quantity: 1,
          currency_id: "BRL",
          unit_price: 49.9,
        },
      ],
      payer: {
        name: req.user.name,
        email: req.user.email || "noreply@quiroferreira.com.br",
      },
      back_urls: {
        success: `${req.protocol}://${req.get("host")}/professional/agenda?payment=success`,
        failure: `${req.protocol}://${req.get("host")}/professional/agenda?payment=failure`,
        pending: `${req.protocol}://${req.get("host")}/professional/agenda?payment=pending`,
      },
      auto_return: "approved",
      external_reference: `agenda_${req.user.id}_${Date.now()}`,
      notification_url: `${req.protocol}://${req.get("host")}/api/webhooks/mercadopago`,
    };

    const response = await mercadopago.preferences.create(preference);

    console.log("✅ MercadoPago preference created:", response.body.id);

    res.json({
      preference_id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point,
    });
  } catch (error) {
    console.error("❌ Error creating MercadoPago preference:", error);
    res.status(500).json({ message: "Erro ao criar preferência de pagamento" });
  }
});

// Schedule config routes
app.get("/api/agenda/schedule-config", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM schedule_configs WHERE professional_id = $1",
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.json(null);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching schedule config:", error);
    res.status(500).json({ message: "Erro ao buscar configuração" });
  }
});

app.post("/api/agenda/schedule-config", authenticate, async (req, res) => {
  try {
    const {
      monday_start,
      monday_end,
      tuesday_start,
      tuesday_end,
      wednesday_start,
      wednesday_end,
      thursday_start,
      thursday_end,
      friday_start,
      friday_end,
      saturday_start,
      saturday_end,
      sunday_start,
      sunday_end,
      slot_duration,
      break_start,
      break_end,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO schedule_configs (
        professional_id, monday_start, monday_end, tuesday_start, tuesday_end,
        wednesday_start, wednesday_end, thursday_start, thursday_end,
        friday_start, friday_end, saturday_start, saturday_end,
        sunday_start, sunday_end, slot_duration, break_start, break_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (professional_id) DO UPDATE SET
        monday_start = EXCLUDED.monday_start,
        monday_end = EXCLUDED.monday_end,
        tuesday_start = EXCLUDED.tuesday_start,
        tuesday_end = EXCLUDED.tuesday_end,
        wednesday_start = EXCLUDED.wednesday_start,
        wednesday_end = EXCLUDED.wednesday_end,
        thursday_start = EXCLUDED.thursday_start,
        thursday_end = EXCLUDED.thursday_end,
        friday_start = EXCLUDED.friday_start,
        friday_end = EXCLUDED.friday_end,
        saturday_start = EXCLUDED.saturday_start,
        saturday_end = EXCLUDED.saturday_end,
        sunday_start = EXCLUDED.sunday_start,
        sunday_end = EXCLUDED.sunday_end,
        slot_duration = EXCLUDED.slot_duration,
        break_start = EXCLUDED.break_start,
        break_end = EXCLUDED.break_end,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        req.user.id,
        monday_start,
        monday_end,
        tuesday_start,
        tuesday_end,
        wednesday_start,
        wednesday_end,
        thursday_start,
        thursday_end,
        friday_start,
        friday_end,
        saturday_start,
        saturday_end,
        sunday_start,
        sunday_end,
        slot_duration,
        break_start,
        break_end,
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error saving schedule config:", error);
    res.status(500).json({ message: "Erro ao salvar configuração" });
  }
});

// Particular patients routes (for agenda system)
app.get("/api/agenda/patients", authenticate, async (req, res) => {
  try {
    const { include_archived } = req.query;

    // Check if user has agenda subscription
    const subscriptionResult = await pool.query(
      `SELECT status, expires_at FROM agenda_subscriptions 
       WHERE professional_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [req.user.id]
    );

    let canUseAgenda = false;
    if (subscriptionResult.rows.length > 0) {
      const subscription = subscriptionResult.rows[0];
      const now = new Date();
      const expiresAt = subscription.expires_at ? new Date(subscription.expires_at) : null;

      if (subscription.status === "active" && expiresAt && expiresAt > now) {
        canUseAgenda = true;
      }
    }

    if (!canUseAgenda) {
      return res.status(403).json({ message: "Assinatura da agenda necessária" });
    }

    let query = `
      SELECT id, name, cpf, email, phone, birth_date, notes, is_archived, linked_at,
             false as is_convenio_patient
      FROM particular_patients 
      WHERE professional_id = $1
    `;

    const params = [req.user.id];

    if (include_archived !== "true") {
      query += " AND is_archived = false";
    }

    query += " ORDER BY name";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching particular patients:", error);
    res.status(500).json({ message: "Erro ao buscar pacientes" });
  }
});

app.get("/api/agenda/patients/lookup", authenticate, async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: "CPF é obrigatório" });
    }

    const result = await pool.query(
      `SELECT id, name, cpf, phone, birth_date, notes, false as is_convenio_patient
       FROM particular_patients 
       WHERE professional_id = $1 AND cpf = $2 AND is_archived = false`,
      [req.user.id, cpf]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Paciente particular não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error looking up particular patient:", error);
    res.status(500).json({ message: "Erro ao buscar paciente" });
  }
});

app.post("/api/agenda/patients", authenticate, async (req, res) => {
  try {
    const { name, cpf, email, phone, birth_date, notes } = req.body;

    // Check if CPF already exists for this professional
    const existingPatient = await pool.query(
      "SELECT id FROM particular_patients WHERE professional_id = $1 AND cpf = $2",
      [req.user.id, cpf]
    );

    if (existingPatient.rows.length > 0) {
      return res.status(400).json({ message: "CPF já cadastrado para este profissional" });
    }

    const result = await pool.query(
      `INSERT INTO particular_patients 
       (professional_id, name, cpf, email, phone, birth_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, cpf, email, phone, birth_date, notes, linked_at, 
                 false as is_convenio_patient`,
      [req.user.id, name, cpf, email, phone, birth_date, notes]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating particular patient:", error);
    res.status(500).json({ message: "Erro ao criar paciente" });
  }
});

app.put("/api/agenda/patients/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const result = await pool.query(
      `UPDATE particular_patients SET notes = $1
       WHERE id = $2 AND professional_id = $3
       RETURNING id, name, cpf, notes`,
      [notes, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Paciente não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating particular patient:", error);
    res.status(500).json({ message: "Erro ao atualizar paciente" });
  }
});

app.put("/api/agenda/patients/:id/archive", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_archived } = req.body;

    const result = await pool.query(
      `UPDATE particular_patients SET is_archived = $1
       WHERE id = $2 AND professional_id = $3
       RETURNING id, name, is_archived`,
      [is_archived, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Paciente não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error archiving particular patient:", error);
    res.status(500).json({ message: "Erro ao arquivar paciente" });
  }
});

// Appointments routes (for agenda system)
app.get("/api/agenda/appointments", authenticate, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        a.id, a.date, a.status, a.notes, a.created_at, a.updated_at,
        a.patient_id, p.name as patient_name, p.phone as patient_phone,
        p.is_convenio_patient
      FROM appointments a
      JOIN particular_patients p ON a.patient_id = p.id
      WHERE a.professional_id = $1
    `;

    const params = [req.user.id];

    if (start_date && end_date) {
      query += " AND a.date >= $2 AND a.date <= $3";
      params.push(start_date, end_date);
    }

    query += " ORDER BY a.date";

    const result = await pool.query(query, params);

    // Add is_convenio_patient as false since these are particular patients
    const appointments = result.rows.map((appointment) => ({
      ...appointment,
      is_convenio_patient: false,
    }));

    res.json(appointments);
  } catch (error) {
    console.error("Error fetching appointments:", error);
    res.status(500).json({ message: "Erro ao buscar agendamentos" });
  }
});

app.post("/api/agenda/appointments", authenticate, async (req, res) => {
  try {
    const { patient_id, date, status = "scheduled", notes } = req.body;

    console.log("🔄 Creating appointment:", { patient_id, date, status, notes });

    // Verify patient belongs to this professional
    const patientCheck = await pool.query(
      "SELECT id FROM particular_patients WHERE id = $1 AND professional_id = $2",
      [patient_id, req.user.id]
    );

    if (patientCheck.rows.length === 0) {
      return res.status(404).json({ message: "Paciente não encontrado" });
    }

    const result = await pool.query(
      `INSERT INTO appointments (professional_id, patient_id, date, status, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, date, status, notes, created_at`,
      [req.user.id, patient_id, date, status, notes]
    );

    console.log("✅ Appointment created:", result.rows[0]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error creating appointment:", error);
    res.status(500).json({ message: "Erro ao criar agendamento" });
  }
});

app.put("/api/agenda/appointments/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const result = await pool.query(
      `UPDATE appointments SET 
        status = COALESCE($1, status),
        notes = COALESCE($2, notes),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND professional_id = $4
       RETURNING id, status, notes, updated_at`,
      [status, notes, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating appointment:", error);
    res.status(500).json({ message: "Erro ao atualizar agendamento" });
  }
});

app.delete("/api/agenda/appointments/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM appointments WHERE id = $1 AND professional_id = $2 RETURNING id",
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Agendamento não encontrado" });
    }

    res.json({ message: "Agendamento excluído com sucesso" });
  } catch (error) {
    console.error("Error deleting appointment:", error);
    res.status(500).json({ message: "Erro ao excluir agendamento" });
  }
});

// Medical records routes
app.get("/api/medical-records/patient/:patientId", authenticate, async (req, res) => {
  try {
    const { patientId } = req.params;

    const result = await pool.query(
      `SELECT 
        mr.id, mr.consultation_id, mr.patient_id, mr.chief_complaint,
        mr.anamnesis, mr.physical_examination, mr.diagnosis,
        mr.treatment_plan, mr.clinical_evolution, mr.internal_notes,
        mr.created_at, mr.updated_at,
        COALESCE(c.date, a.date) as consultation_date,
        COALESCE(s.name, 'Consulta Particular') as service_name,
        COALESCE(d.name, u.name, p.name) as patient_name,
        COALESCE(d.cpf, u.cpf, p.cpf) as patient_cpf,
        prof.name as professional_name,
        prof.professional_registration
      FROM medical_records mr
      LEFT JOIN consultations c ON mr.consultation_id = c.id
      LEFT JOIN appointments a ON mr.patient_id = a.patient_id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      LEFT JOIN particular_patients p ON mr.patient_id = p.id
      JOIN users prof ON mr.professional_id = prof.id
      WHERE mr.professional_id = $1 AND (p.id = $2 OR c.client_id = $2 OR d.client_id = $2)
      ORDER BY COALESCE(c.date, a.date) DESC`,
      [req.user.id, patientId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching medical records:", error);
    res.status(500).json({ message: "Erro ao buscar prontuários" });
  }
});

app.post("/api/medical-records", authenticate, async (req, res) => {
  try {
    const {
      patient_id,
      chief_complaint,
      anamnesis,
      physical_examination,
      diagnosis,
      treatment_plan,
      clinical_evolution,
      internal_notes,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO medical_records 
       (patient_id, professional_id, chief_complaint, anamnesis, physical_examination,
        diagnosis, treatment_plan, clinical_evolution, internal_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at`,
      [
        patient_id,
        req.user.id,
        chief_complaint,
        anamnesis,
        physical_examination,
        diagnosis,
        treatment_plan,
        clinical_evolution,
        internal_notes,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating medical record:", error);
    res.status(500).json({ message: "Erro ao criar prontuário" });
  }
});

app.put("/api/medical-records/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      chief_complaint,
      anamnesis,
      physical_examination,
      diagnosis,
      treatment_plan,
      clinical_evolution,
      internal_notes,
    } = req.body;

    const result = await pool.query(
      `UPDATE medical_records SET 
        chief_complaint = $1, anamnesis = $2, physical_examination = $3,
        diagnosis = $4, treatment_plan = $5, clinical_evolution = $6,
        internal_notes = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND professional_id = $9
       RETURNING id, updated_at`,
      [
        chief_complaint,
        anamnesis,
        physical_examination,
        diagnosis,
        treatment_plan,
        clinical_evolution,
        internal_notes,
        id,
        req.user.id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Prontuário não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating medical record:", error);
    res.status(500).json({ message: "Erro ao atualizar prontuário" });
  }
});

// Reports routes
app.get("/api/reports/revenue", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: "Datas de início e fim são obrigatórias" });
    }

    // Get revenue by professional
    const professionalRevenueResult =
      await pool.query(`
      SELECT 
        u.id as professional_id,
        u.name as professional_name,
        u.percentage as professional_percentage,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue,
        SUM(c.value * (u.percentage / 100.0)) as professional_payment,
        SUM(c.value * (1 - u.percentage / 100.0)) as clinic_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date BETWEEN $1 AND $2
      GROUP BY u.id, u.name, u.percentage
      ORDER BY revenue DESC
    `,
      [start_date, end_date]
    );

    // Get revenue by service
    const serviceRevenueResult =
      await pool.query(`
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
    `,
      [start_date, end_date]
    );

    // Get total revenue
    const totalRevenueResult =
      await pool.query(`
      SELECT SUM(value) as total_revenue
      FROM consultations
      WHERE date BETWEEN $1 AND $2
    `,
      [start_date, end_date]
    );

    const totalRevenue = totalRevenueResult.rows[0]?.total_revenue || 0;

    res.json({
      total_revenue: parseFloat(totalRevenue),
      revenue_by_professional: professionalRevenueResult.rows.map((row) => ({
        ...row,
        revenue: parseFloat(row.revenue),
        professional_payment: parseFloat(row.professional_payment),
        clinic_revenue: parseFloat(row.clinic_revenue),
      })),
      revenue_by_service: serviceRevenueResult.rows.map((row) => ({
        ...row,
        revenue: parseFloat(row.revenue),
      })),
    });
  } catch (error) {
    console.error("Error generating revenue report:", error);
    res.status(500).json({ message: "Erro ao gerar relatório" });
  }
});

app.get("/api/reports/professional-revenue", authenticate, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: "Datas de início e fim são obrigatórias" });
    }

    // Get professional percentage
    const professionalResult = await pool.query(
      "SELECT percentage FROM users WHERE id = $1",
      [req.user.id]
    );

    if (professionalResult.rows.length === 0) {
      return res.status(404).json({ message: "Profissional não encontrado" });
    }

    const percentage = professionalResult.rows[0].percentage;

    // Get consultations
    const consultationsResult = await pool.query(
      `SELECT 
        c.id, c.date, c.value, c.notes,
        COALESCE(d.name, u_client.name) as client_name,
        s.name as service_name,
        c.value * (1 - $3 / 100.0) as amount_to_pay
      FROM consultations c
      LEFT JOIN users u_client ON c.client_id = u_client.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN services s ON c.service_id = s.id
      WHERE c.professional_id = $1 AND c.date BETWEEN $2 AND $3
      ORDER BY c.date DESC`,
      [req.user.id, start_date, end_date, percentage]
    );

    // Calculate summary
    const consultations = consultationsResult.rows;
    const totalRevenue = consultations.reduce((sum, c) => sum + parseFloat(c.value), 0);
    const consultationCount = consultations.length;
    const amountToPay = consultations.reduce((sum, c) => sum + parseFloat(c.amount_to_pay), 0);

    res.json({
      summary: {
        professional_percentage: percentage,
        total_revenue: parseFloat(totalRevenue.toFixed(2)),
        consultation_count: consultationCount,
        amount_to_pay: parseFloat(amountToPay.toFixed(2)),
      },
      consultations: consultations.map((c) => ({
        ...c,
        value: parseFloat(c.value),
        amount_to_pay: parseFloat(c.amount_to_pay),
      })),
    });
  } catch (error) {
    console.error("Error generating professional revenue report:", error);
    res.status(500).json({ message: "Erro ao gerar relatório" });
  }
});

// Image upload route
app.post("/api/upload-image", authenticate, async (req, res) => {
  try {
    const upload = createUpload();
    
    upload.single("image")(req, res, async (err) => {
      if (err) {
        console.error("❌ Upload error:", err);
        return res.status(400).json({ message: err.message });
      }
      
      if (!req.file) {
        return res.status(400).json({ message: "Nenhuma imagem enviada" });
      }
      
      console.log("✅ Image uploaded:", req.file);
      
      // Update user's photo_url
      await pool.query(
        "UPDATE users SET photo_url = $1 WHERE id = $2",
        [req.file.path, req.user.id]
      );
      
      res.json({ 
        message: "Imagem enviada com sucesso",
        imageUrl: req.file.path
      });
    });
  } catch (error) {
    console.error("❌ Error uploading image:", error);
    res.status(500).json({ message: "Erro ao enviar imagem" });
  }
});

// Webhook for MercadoPago
app.post("/api/webhooks/mercadopago", async (req, res) => {
  try {
    console.log("🔄 MercadoPago webhook received:", req.body);
    
    const { type, data } = req.body;
    
    if (type === "payment") {
      const paymentId = data.id;
      
      // Get payment details
      const payment = await mercadopago.payment.get(paymentId);
      
      if (payment.body.status === "approved") {
        const externalReference = payment.body.external_reference;
        
        if (externalReference.startsWith("agenda_")) {
          // Extract professional ID
          const professionalId = externalReference.split("_")[1];
          
          // Calculate expiry date (30 days from now)
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 30);
          
          // Update or create subscription
          await pool.query(
            `INSERT INTO agenda_subscriptions 
             (professional_id, status, expires_at, payment_id)
             VALUES ($1, 'active', $2, $3)
             ON CONFLICT (professional_id) DO UPDATE SET
               status = 'active',
               expires_at = $2,
               payment_id = $3,
               updated_at = CURRENT_TIMESTAMP`,
            [professionalId, expiryDate, paymentId]
          );
          
          console.log("✅ Agenda subscription activated for professional:", professionalId);
        }
      }
    }
    
    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Error processing webhook:", error);
    res.status(500).send("Error");
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});