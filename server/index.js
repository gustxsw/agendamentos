import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";
import { authenticate, authorize } from "./middleware/auth.js";
import createUpload from "./middleware/upload.js";
import mercadopago from "mercadopago";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 🔥 MERCADO PAGO SDK V2 CONFIGURATION
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

console.log("🔥 MercadoPago configured with access token:", process.env.MP_ACCESS_TOKEN ? "Found" : "Missing");

// Middleware
app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://www.cartaoquiroferreira.com.br",
    "https://cartaoquiroferreira.com.br"
  ],
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// 🔥 COMPLETE DATABASE SCHEMA CREATION
const createTables = async () => {
  try {
    console.log("🔄 Creating database tables...");

    // Users table with enhanced fields
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

    // Service categories
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

    // Consultations table
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
        status VARCHAR(20) DEFAULT 'completed',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Medical records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id SERIAL PRIMARY KEY,
        consultation_id INTEGER REFERENCES consultations(id),
        patient_id INTEGER REFERENCES users(id),
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

    // Professional patients table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_patients (
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
        is_convenio_patient BOOLEAN DEFAULT false,
        is_archived BOOLEAN DEFAULT false,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Professional schedule config table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_schedule_config (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        work_start TIME DEFAULT '08:00',
        work_end TIME DEFAULT '18:00',
        break_start TIME DEFAULT '12:00',
        break_end TIME DEFAULT '13:00',
        slot_duration INTEGER DEFAULT 30,
        monday_start TIME DEFAULT '08:00',
        monday_end TIME DEFAULT '18:00',
        tuesday_start TIME DEFAULT '08:00',
        tuesday_end TIME DEFAULT '18:00',
        wednesday_start TIME DEFAULT '08:00',
        wednesday_end TIME DEFAULT '18:00',
        thursday_start TIME DEFAULT '08:00',
        thursday_end TIME DEFAULT '18:00',
        friday_start TIME DEFAULT '08:00',
        friday_end TIME DEFAULT '18:00',
        saturday_start TIME,
        saturday_end TIME,
        sunday_start TIME,
        sunday_end TIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Professional appointments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES professional_patients(id) ON DELETE CASCADE,
        location_id INTEGER REFERENCES professional_locations(id),
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        is_recurring BOOLEAN DEFAULT false,
        recurrence_pattern VARCHAR(20),
        recurrence_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Professional subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        expires_at TIMESTAMP,
        last_payment TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default admin user
    const adminExists = await pool.query("SELECT id FROM users WHERE cpf = '00000000000'");
    if (adminExists.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(`
        INSERT INTO users (name, cpf, password_hash, roles, email)
        VALUES ('Administrador', '00000000000', $1, ARRAY['admin'], 'admin@quiroferreira.com')
      `, [hashedPassword]);
      console.log("✅ Admin user created: CPF 00000000000, Password: admin123");
    }

    // Insert default categories
    const categoriesExist = await pool.query("SELECT id FROM service_categories LIMIT 1");
    if (categoriesExist.rows.length === 0) {
      await pool.query(`
        INSERT INTO service_categories (name, description) VALUES
        ('Fisioterapia', 'Serviços de fisioterapia e reabilitação'),
        ('Quiropraxia', 'Tratamentos quiropráticos'),
        ('Massoterapia', 'Massagens terapêuticas'),
        ('Acupuntura', 'Tratamentos com acupuntura')
      `);

      // Insert default services
      await pool.query(`
        INSERT INTO services (name, description, base_price, category_id, is_base_service) VALUES
        ('Consulta Fisioterapia', 'Consulta inicial de fisioterapia', 80.00, 1, true),
        ('Sessão Fisioterapia', 'Sessão de fisioterapia', 60.00, 1, false),
        ('Consulta Quiropraxia', 'Consulta inicial de quiropraxia', 100.00, 2, true),
        ('Ajuste Quiroprático', 'Sessão de ajuste quiroprático', 80.00, 2, false),
        ('Massagem Relaxante', 'Massagem para relaxamento', 70.00, 3, false),
        ('Massagem Terapêutica', 'Massagem terapêutica', 90.00, 3, true),
        ('Consulta Acupuntura', 'Consulta inicial de acupuntura', 85.00, 4, true),
        ('Sessão Acupuntura', 'Sessão de acupuntura', 65.00, 4, false)
      `);
      console.log("✅ Default categories and services created");
    }

    console.log("✅ Database tables created successfully");
  } catch (error) {
    console.error("❌ Error creating tables:", error);
  }
};

// Initialize database
createTables();

// 🔥 AUTH ROUTES
app.post("/api/auth/login", async (req, res) => {
  try {
    const { cpf, password } = req.body;

    if (!cpf || !password) {
      return res.status(400).json({ message: "CPF e senha são obrigatórios" });
    }

    const cleanCpf = cpf.replace(/\D/g, "");
    const result = await pool.query("SELECT * FROM users WHERE cpf = $1", [cleanCpf]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    const userData = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: user.roles || ["client"],
    };

    res.json({ user: userData });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/auth/select-role", async (req, res) => {
  try {
    const { userId, role } = req.body;

    const result = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const user = result.rows[0];
    if (!user.roles.includes(role)) {
      return res.status(403).json({ message: "Role não autorizada" });
    }

    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "24h" }
    );

    const userData = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: user.roles,
      currentRole: role,
    };

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({ user: userData, token });
  } catch (error) {
    console.error("Role selection error:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/auth/switch-role", authenticate, async (req, res) => {
  try {
    const { role } = req.body;
    const userId = req.user.id;

    const result = await pool.query("SELECT roles FROM users WHERE id = $1", [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const user = result.rows[0];
    if (!user.roles.includes(role)) {
      return res.status(403).json({ message: "Role não autorizada" });
    }

    const token = jwt.sign(
      { id: userId, currentRole: role },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "24h" }
    );

    const userData = {
      id: userId,
      name: req.user.name,
      cpf: req.user.cpf,
      roles: user.roles,
      currentRole: role,
    };

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({ user: userData, token });
  } catch (error) {
    console.error("Role switch error:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, password
    } = req.body;

    if (!name || !cpf || !password) {
      return res.status(400).json({ message: "Nome, CPF e senha são obrigatórios" });
    }

    const cleanCpf = cpf.replace(/\D/g, "");
    if (cleanCpf.length !== 11) {
      return res.status(400).json({ message: "CPF deve ter 11 dígitos" });
    }

    const existingUser = await pool.query("SELECT id FROM users WHERE cpf = $1", [cleanCpf]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: "CPF já cadastrado" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password_hash, roles
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ARRAY['client'])
      RETURNING id, name, cpf, roles
    `, [
      name, cleanCpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, hashedPassword
    ]);

    const user = result.rows[0];
    res.status(201).json({ user });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logout realizado com sucesso" });
});

// 🔥 USER ROUTES
app.get("/api/users", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.*, sc.name as category_name 
      FROM users u 
      LEFT JOIN service_categories sc ON u.category_id = sc.id 
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.get("/api/users/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT u.*, sc.name as category_name 
      FROM users u 
      LEFT JOIN service_categories sc ON u.category_id = sc.id 
      WHERE u.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/users", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, password, roles,
      percentage, category_id
    } = req.body;

    const cleanCpf = cpf.replace(/\D/g, "");
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password_hash, roles,
        percentage, category_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `, [
      name, cleanCpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, hashedPassword, roles,
      percentage, category_id
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.put("/api/users/:id", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles, percentage, category_id
    } = req.body;

    const result = await pool.query(`
      UPDATE users SET 
        name = $1, email = $2, phone = $3, birth_date = $4, address = $5,
        address_number = $6, address_complement = $7, neighborhood = $8,
        city = $9, state = $10, roles = $11, percentage = $12, category_id = $13,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING *
    `, [
      name, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, roles, percentage, category_id, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.put("/api/users/:id/activate", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { expiry_date } = req.body;

    const result = await pool.query(`
      UPDATE users SET 
        subscription_status = 'active',
        subscription_expiry = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [expiry_date, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error activating user:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.delete("/api/users/:id", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM users WHERE id = $1 RETURNING *", [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }
    
    res.json({ message: "Usuário excluído com sucesso" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.put("/api/users/change-password", authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    const result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const isValidPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!isValidPassword) {
      return res.status(400).json({ message: "Senha atual incorreta" });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hashedNewPassword, userId]);

    res.json({ message: "Senha alterada com sucesso" });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// 🔥 SERVICE CATEGORIES ROUTES
app.get("/api/service-categories", authenticate, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM service_categories ORDER BY name");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
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
    console.error("Error creating category:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// 🔥 SERVICES ROUTES
app.get("/api/services", authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, sc.name as category_name 
      FROM services s 
      LEFT JOIN service_categories sc ON s.category_id = sc.id 
      ORDER BY s.name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching services:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/services", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { name, description, base_price, category_id, is_base_service } = req.body;
    const result = await pool.query(`
      INSERT INTO services (name, description, base_price, category_id, is_base_service) 
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [name, description, base_price, category_id, is_base_service]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating service:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.put("/api/services/:id", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, base_price, category_id, is_base_service } = req.body;
    
    const result = await pool.query(`
      UPDATE services SET 
        name = $1, description = $2, base_price = $3, category_id = $4, is_base_service = $5
      WHERE id = $6 RETURNING *
    `, [name, description, base_price, category_id, is_base_service, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Serviço não encontrado" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating service:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.delete("/api/services/:id", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM services WHERE id = $1 RETURNING *", [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Serviço não encontrado" });
    }
    
    res.json({ message: "Serviço excluído com sucesso" });
  } catch (error) {
    console.error("Error deleting service:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// 🔥 DEPENDENTS ROUTES
app.get("/api/dependents/:clientId", authenticate, async (req, res) => {
  try {
    const { clientId } = req.params;
    const result = await pool.query(
      "SELECT * FROM dependents WHERE client_id = $1 ORDER BY name",
      [clientId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching dependents:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.get("/api/dependents/lookup", authenticate, async (req, res) => {
  try {
    const { cpf } = req.query;
    const cleanCpf = cpf.replace(/\D/g, "");
    
    const result = await pool.query(`
      SELECT d.*, u.name as client_name, u.subscription_status as client_subscription_status
      FROM dependents d
      JOIN users u ON d.client_id = u.id
      WHERE d.cpf = $1
    `, [cleanCpf]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Dependente não encontrado" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error looking up dependent:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/dependents", authenticate, async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;
    const cleanCpf = cpf.replace(/\D/g, "");
    
    const result = await pool.query(`
      INSERT INTO dependents (client_id, name, cpf, birth_date) 
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [client_id, name, cleanCpf, birth_date]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating dependent:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.put("/api/dependents/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, birth_date } = req.body;
    
    const result = await pool.query(`
      UPDATE dependents SET name = $1, birth_date = $2 WHERE id = $3 RETURNING *
    `, [name, birth_date, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Dependente não encontrado" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating dependent:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.delete("/api/dependents/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM dependents WHERE id = $1 RETURNING *", [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Dependente não encontrado" });
    }
    
    res.json({ message: "Dependente excluído com sucesso" });
  } catch (error) {
    console.error("Error deleting dependent:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// 🔥 CONSULTATIONS ROUTES
app.get("/api/consultations", authenticate, async (req, res) => {
  try {
    let query = `
      SELECT c.*, 
             COALESCE(u.name, d.name) as client_name,
             s.name as service_name,
             p.name as professional_name,
             CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN services s ON c.service_id = s.id
      JOIN users p ON c.professional_id = p.id
    `;
    
    const params = [];
    
    if (req.user.currentRole === 'client') {
      query += ` WHERE c.client_id = $1 OR c.dependent_id IN (
        SELECT id FROM dependents WHERE client_id = $1
      )`;
      params.push(req.user.id);
    } else if (req.user.currentRole === 'professional') {
      query += ` WHERE c.professional_id = $1`;
      params.push(req.user.id);
    }
    
    query += ` ORDER BY c.date DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching consultations:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/consultations", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const { client_id, dependent_id, service_id, value, date, location_id } = req.body;
    const professional_id = req.user.id;
    
    const result = await pool.query(`
      INSERT INTO consultations (client_id, dependent_id, professional_id, service_id, location_id, value, date) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [client_id, dependent_id, professional_id, service_id, location_id, value, date]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating consultation:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// 🔥 CLIENT LOOKUP ROUTES
app.get("/api/clients/lookup", authenticate, async (req, res) => {
  try {
    const { cpf } = req.query;
    const cleanCpf = cpf.replace(/\D/g, "");
    
    const result = await pool.query(
      "SELECT id, name, cpf, subscription_status FROM users WHERE cpf = $1 AND 'client' = ANY(roles)",
      [cleanCpf]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error looking up client:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// 🔥 PROFESSIONALS ROUTES
app.get("/api/professionals", authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.phone, u.address, u.address_number, 
             u.address_complement, u.neighborhood, u.city, u.state, u.photo_url,
             sc.name as category_name
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE 'professional' = ANY(u.roles)
      ORDER BY u.name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching professionals:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// 🔥 PROFESSIONAL LOCATIONS ROUTES
app.get("/api/professional-locations", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM professional_locations WHERE professional_id = $1 ORDER BY is_main DESC, clinic_name",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching locations:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/professional-locations", authenticate, async (req, res) => {
  try {
    const {
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main
    } = req.body;
    
    // If this is main, unset other main locations
    if (is_main) {
      await pool.query(
        "UPDATE professional_locations SET is_main = false WHERE professional_id = $1",
        [req.user.id]
      );
    }
    
    const result = await pool.query(`
      INSERT INTO professional_locations (
        professional_id, clinic_name, address, address_number, address_complement,
        neighborhood, city, state, phone, is_main
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `, [
      req.user.id, clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating location:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.put("/api/professional-locations/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main
    } = req.body;
    
    // If this is main, unset other main locations
    if (is_main) {
      await pool.query(
        "UPDATE professional_locations SET is_main = false WHERE professional_id = $1 AND id != $2",
        [req.user.id, id]
      );
    }
    
    const result = await pool.query(`
      UPDATE professional_locations SET 
        clinic_name = $1, address = $2, address_number = $3, address_complement = $4,
        neighborhood = $5, city = $6, state = $7, phone = $8, is_main = $9
      WHERE id = $10 AND professional_id = $11 RETURNING *
    `, [
      clinic_name, address, address_number, address_complement,
      neighborhood, city, state, phone, is_main, id, req.user.id
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Local não encontrado" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating location:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.delete("/api/professional-locations/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM professional_locations WHERE id = $1 AND professional_id = $2 RETURNING *",
      [id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Local não encontrado" });
    }
    
    res.json({ message: "Local excluído com sucesso" });
  } catch (error) {
    console.error("Error deleting location:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// 🔥 AGENDA ROUTES
app.get("/api/agenda/subscription-status", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM professional_subscriptions WHERE professional_id = $1 ORDER BY created_at DESC LIMIT 1",
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.json({
        status: 'pending',
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: false
      });
    }
    
    const subscription = result.rows[0];
    const now = new Date();
    const expiresAt = new Date(subscription.expires_at);
    const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
    
    res.json({
      status: subscription.status,
      expires_at: subscription.expires_at,
      days_remaining: daysRemaining,
      can_use_agenda: subscription.status === 'active' && daysRemaining > 0,
      last_payment: subscription.last_payment
    });
  } catch (error) {
    console.error("Error fetching subscription status:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.get("/api/agenda/schedule-config", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM professional_schedule_config WHERE professional_id = $1",
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      // Create default config
      const defaultConfig = await pool.query(`
        INSERT INTO professional_schedule_config (professional_id) 
        VALUES ($1) RETURNING *
      `, [req.user.id]);
      return res.json(defaultConfig.rows[0]);
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching schedule config:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/agenda/schedule-config", authenticate, async (req, res) => {
  try {
    const {
      work_start, work_end, break_start, break_end, slot_duration,
      monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end
    } = req.body;
    
    const result = await pool.query(`
      INSERT INTO professional_schedule_config (
        professional_id, work_start, work_end, break_start, break_end, slot_duration,
        monday_start, monday_end, tuesday_start, tuesday_end,
        wednesday_start, wednesday_end, thursday_start, thursday_end,
        friday_start, friday_end, saturday_start, saturday_end,
        sunday_start, sunday_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      ON CONFLICT (professional_id) DO UPDATE SET
        work_start = EXCLUDED.work_start,
        work_end = EXCLUDED.work_end,
        break_start = EXCLUDED.break_start,
        break_end = EXCLUDED.break_end,
        slot_duration = EXCLUDED.slot_duration,
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
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      req.user.id, work_start, work_end, break_start, break_end, slot_duration,
      monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end,
      friday_start, friday_end, saturday_start, saturday_end,
      sunday_start, sunday_end
    ]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error saving schedule config:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.get("/api/agenda/patients", authenticate, async (req, res) => {
  try {
    const { include_archived } = req.query;
    
    let query = `
      SELECT pp.*, 
             CASE WHEN u.id IS NOT NULL THEN true ELSE false END as is_convenio_patient
      FROM professional_patients pp
      LEFT JOIN users u ON pp.cpf = u.cpf AND 'client' = ANY(u.roles)
      WHERE pp.professional_id = $1
    `;
    
    if (include_archived !== 'true') {
      query += ` AND pp.is_archived = false`;
    }
    
    query += ` ORDER BY pp.name`;
    
    const result = await pool.query(query, [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching patients:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/agenda/patients", authenticate, async (req, res) => {
  try {
    const {
      name, cpf, email, phone, birth_date, address, address_number,
      address_complement, neighborhood, city, state, notes
    } = req.body;
    
    const cleanCpf = cpf.replace(/\D/g, "");
    
    // Check if patient is a convenio client
    const convenioCheck = await pool.query(
      "SELECT id FROM users WHERE cpf = $1 AND 'client' = ANY(roles)",
      [cleanCpf]
    );
    const isConvenioPatient = convenioCheck.rows.length > 0;
    
    const result = await pool.query(`
      INSERT INTO professional_patients (
        professional_id, name, cpf, email, phone, birth_date, address,
        address_number, address_complement, neighborhood, city, state, notes,
        is_convenio_patient
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *
    `, [
      req.user.id, name, cleanCpf, email, phone, birth_date, address,
      address_number, address_complement, neighborhood, city, state, notes,
      isConvenioPatient
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating patient:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.put("/api/agenda/patients/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    const result = await pool.query(`
      UPDATE professional_patients SET notes = $1 
      WHERE id = $2 AND professional_id = $3 RETURNING *
    `, [notes, id, req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Paciente não encontrado" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating patient:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.put("/api/agenda/patients/:id/archive", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_archived } = req.body;
    
    const result = await pool.query(`
      UPDATE professional_patients SET is_archived = $1 
      WHERE id = $2 AND professional_id = $3 RETURNING *
    `, [is_archived, id, req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Paciente não encontrado" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error archiving patient:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.get("/api/agenda/appointments", authenticate, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    const result = await pool.query(`
      SELECT pa.*, pp.name as patient_name, pp.phone as patient_phone,
             pp.is_convenio_patient, pl.clinic_name as location_name
      FROM professional_appointments pa
      JOIN professional_patients pp ON pa.patient_id = pp.id
      LEFT JOIN professional_locations pl ON pa.location_id = pl.id
      WHERE pa.professional_id = $1 
        AND pa.date >= $2 AND pa.date <= $3
      ORDER BY pa.date
    `, [req.user.id, start_date, end_date]);
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching appointments:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/agenda/appointments", authenticate, async (req, res) => {
  try {
    const {
      patient_id, location_id, date, notes, is_recurring,
      recurrence_pattern, recurrence_end
    } = req.body;
    
    if (is_recurring && recurrence_end) {
      // Create recurring appointments
      const appointments = [];
      let currentDate = new Date(date);
      const endDate = new Date(recurrence_end);
      
      while (currentDate <= endDate) {
        const result = await pool.query(`
          INSERT INTO professional_appointments (
            professional_id, patient_id, location_id, date, notes,
            is_recurring, recurrence_pattern, recurrence_end
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
        `, [
          req.user.id, patient_id, location_id, currentDate.toISOString(),
          notes, is_recurring, recurrence_pattern, recurrence_end
        ]);
        
        appointments.push(result.rows[0]);
        
        // Calculate next occurrence
        switch (recurrence_pattern) {
          case 'weekly':
            currentDate.setDate(currentDate.getDate() + 7);
            break;
          case 'biweekly':
            currentDate.setDate(currentDate.getDate() + 14);
            break;
          case 'monthly':
            currentDate.setMonth(currentDate.getMonth() + 1);
            break;
        }
      }
      
      res.status(201).json(appointments);
    } else {
      // Create single appointment
      const result = await pool.query(`
        INSERT INTO professional_appointments (
          professional_id, patient_id, location_id, date, notes
        ) VALUES ($1, $2, $3, $4, $5) RETURNING *
      `, [req.user.id, patient_id, location_id, date, notes]);
      
      res.status(201).json(result.rows[0]);
    }
  } catch (error) {
    console.error("Error creating appointment:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/agenda/create-subscription-payment", authenticate, async (req, res) => {
  try {
    console.log("🔄 Creating agenda subscription payment with SDK v2...");

    const preference = {
      items: [
        {
          title: "Assinatura Agenda Profissional - 30 dias",
          description: "Acesso completo à agenda profissional por 30 dias",
          quantity: 1,
          currency_id: "BRL",
          unit_price: 49.90
        }
      ],
      payer: {
        name: req.user.name,
        email: req.user.email || "profissional@quiroferreira.com"
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/professional/agenda?payment=success`,
        failure: `${req.protocol}://${req.get('host')}/professional/agenda?payment=failure`,
        pending: `${req.protocol}://${req.get('host')}/professional/agenda?payment=pending`
      },
      auto_return: "approved",
      external_reference: `agenda_subscription_${req.user.id}_${Date.now()}`,
      notification_url: `${req.protocol}://${req.get('host')}/api/webhooks/mercadopago`
    };

    console.log("🔄 Creating preference with SDK v2:", preference);

    const response = await mercadopago.preferences.create(preference);
    console.log("✅ Preference created with SDK v2:", response.body);

    res.json({
      preference_id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point
    });
  } catch (error) {
    console.error("❌ Error creating agenda subscription payment:", error);
    res.status(500).json({ message: "Erro ao criar pagamento da assinatura" });
  }
});

// 🔥 MEDICAL RECORDS ROUTES
app.get("/api/medical-records/patient/:patientId", authenticate, async (req, res) => {
  try {
    const { patientId } = req.params;
    
    const result = await pool.query(`
      SELECT mr.*, c.date as consultation_date, s.name as service_name,
             COALESCE(u.name, pp.name) as patient_name,
             COALESCE(u.cpf, pp.cpf) as patient_cpf,
             prof.name as professional_name,
             prof.professional_registration
      FROM medical_records mr
      LEFT JOIN consultations c ON mr.consultation_id = c.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN users u ON mr.patient_id = u.id
      LEFT JOIN professional_patients pp ON mr.patient_id = pp.id
      JOIN users prof ON mr.professional_id = prof.id
      WHERE (mr.patient_id = $1 OR pp.id = $1) AND mr.professional_id = $2
      ORDER BY mr.created_at DESC
    `, [patientId, req.user.id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching medical records:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/medical-records", authenticate, async (req, res) => {
  try {
    const {
      patient_id, chief_complaint, anamnesis, physical_examination,
      diagnosis, treatment_plan, clinical_evolution, internal_notes
    } = req.body;
    
    const result = await pool.query(`
      INSERT INTO medical_records (
        patient_id, professional_id, chief_complaint, anamnesis,
        physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
    `, [
      patient_id, req.user.id, chief_complaint, anamnesis,
      physical_examination, diagnosis, treatment_plan, clinical_evolution, internal_notes
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating medical record:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.put("/api/medical-records/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      chief_complaint, anamnesis, physical_examination,
      diagnosis, treatment_plan, clinical_evolution, internal_notes
    } = req.body;
    
    const result = await pool.query(`
      UPDATE medical_records SET 
        chief_complaint = $1, anamnesis = $2, physical_examination = $3,
        diagnosis = $4, treatment_plan = $5, clinical_evolution = $6,
        internal_notes = $7, updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 AND professional_id = $9 RETURNING *
    `, [
      chief_complaint, anamnesis, physical_examination,
      diagnosis, treatment_plan, clinical_evolution, internal_notes, id, req.user.id
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Prontuário não encontrado" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating medical record:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// 🔥 REPORTS ROUTES
app.get("/api/reports/professional-revenue", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const professionalId = req.user.id;

    console.log("🔄 Generating professional revenue report for:", professionalId);
    console.log("🔄 Date range:", start_date, "to", end_date);

    // Get professional percentage - FIX: Convert to integer properly
    const profResult = await pool.query("SELECT percentage FROM users WHERE id = $1", [professionalId]);
    const professionalPercentage = profResult.rows.length > 0 ? parseInt(profResult.rows[0].percentage) : 50;

    console.log("🔄 Professional percentage:", professionalPercentage);

    // Get consultations for the period
    const consultationsResult = await pool.query(`
      SELECT c.*, 
             COALESCE(u.name, d.name) as client_name,
             s.name as service_name
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN services s ON c.service_id = s.id
      WHERE c.professional_id = $1 
        AND c.date >= $2 
        AND c.date <= $3
      ORDER BY c.date DESC
    `, [professionalId, start_date, end_date]);

    const consultations = consultationsResult.rows.map(consultation => {
      const totalValue = parseFloat(consultation.value);
      const amountToPay = totalValue * (100 - professionalPercentage) / 100;

      return {
        id: consultation.id,
        date: consultation.date,
        client_name: consultation.client_name,
        service_name: consultation.service_name,
        total_value: totalValue,
        amount_to_pay: amountToPay
      };
    });

    // Calculate summary
    const totalRevenue = consultations.reduce((sum, c) => sum + c.total_value, 0);
    const totalAmountToPay = consultations.reduce((sum, c) => sum + c.amount_to_pay, 0);

    const summary = {
      professional_percentage: professionalPercentage,
      total_revenue: totalRevenue,
      consultation_count: consultations.length,
      amount_to_pay: totalAmountToPay
    };

    console.log("✅ Professional revenue report generated:", summary);

    res.json({
      summary,
      consultations
    });
  } catch (error) {
    console.error("❌ Error generating professional revenue report:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.get("/api/reports/professional-consultations", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const professionalId = req.user.id;

    // Get professional percentage
    const profResult = await pool.query("SELECT percentage FROM users WHERE id = $1", [professionalId]);
    const professionalPercentage = profResult.rows.length > 0 ? parseInt(profResult.rows[0].percentage) : 50;

    // Get consultations with medical records info
    const consultationsResult = await pool.query(`
      SELECT c.*, 
             COALESCE(u.name, d.name) as patient_name,
             s.name as service_name,
             CASE WHEN u.id IS NOT NULL THEN true ELSE false END as is_convenio_patient,
             CASE WHEN mr.id IS NOT NULL THEN true ELSE false END as has_medical_record
      FROM consultations c
      LEFT JOIN users u ON c.client_id = u.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      JOIN services s ON c.service_id = s.id
      LEFT JOIN medical_records mr ON c.id = mr.consultation_id
      WHERE c.professional_id = $1 
        AND c.date >= $2 
        AND c.date <= $3
      ORDER BY c.date DESC
    `, [professionalId, start_date, end_date]);

    const consultations = consultationsResult.rows.map(consultation => {
      const totalValue = parseFloat(consultation.value);
      const amountToPay = consultation.is_convenio_patient ? 
        totalValue * (100 - professionalPercentage) / 100 : 0;

      return {
        id: consultation.id,
        consultation_id: consultation.id,
        date: consultation.date,
        patient_name: consultation.patient_name,
        service_name: consultation.service_name,
        total_value: totalValue,
        amount_to_pay: amountToPay,
        is_convenio_patient: consultation.is_convenio_patient,
        has_medical_record: consultation.has_medical_record
      };
    });

    // Calculate summary
    const totalConsultations = consultations.length;
    const convenioConsultations = consultations.filter(c => c.is_convenio_patient).length;
    const particularConsultations = totalConsultations - convenioConsultations;
    const totalRevenue = consultations.reduce((sum, c) => sum + c.total_value, 0);
    const convenioRevenue = consultations.filter(c => c.is_convenio_patient).reduce((sum, c) => sum + c.total_value, 0);
    const particularRevenue = totalRevenue - convenioRevenue;
    const amountToPay = consultations.reduce((sum, c) => sum + c.amount_to_pay, 0);

    const summary = {
      total_consultations: totalConsultations,
      convenio_consultations: convenioConsultations,
      particular_consultations: particularConsultations,
      total_revenue: totalRevenue,
      convenio_revenue: convenioRevenue,
      particular_revenue: particularRevenue,
      amount_to_pay: amountToPay
    };

    res.json({
      summary,
      consultations
    });
  } catch (error) {
    console.error("Error generating professional consultations report:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.get("/api/reports/revenue", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    const result = await pool.query(`
      SELECT 
        p.name as professional_name,
        p.percentage as professional_percentage,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue,
        SUM(c.value * p.percentage / 100) as professional_payment,
        SUM(c.value * (100 - p.percentage) / 100) as clinic_revenue
      FROM consultations c
      JOIN users p ON c.professional_id = p.id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY p.id, p.name, p.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    const serviceResult = await pool.query(`
      SELECT 
        s.name as service_name,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY s.id, s.name
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    const totalRevenue = result.rows.reduce((sum, row) => sum + parseFloat(row.revenue || 0), 0);

    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: result.rows.map(row => ({
        professional_name: row.professional_name,
        professional_percentage: parseInt(row.professional_percentage),
        consultation_count: parseInt(row.consultation_count),
        revenue: parseFloat(row.revenue || 0),
        professional_payment: parseFloat(row.professional_payment || 0),
        clinic_revenue: parseFloat(row.clinic_revenue || 0)
      })),
      revenue_by_service: serviceResult.rows.map(row => ({
        service_name: row.service_name,
        consultation_count: parseInt(row.consultation_count),
        revenue: parseFloat(row.revenue || 0)
      }))
    });
  } catch (error) {
    console.error("Error generating revenue report:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.get("/api/reports/new-clients", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    // Get new clients in the period
    const newClientsResult = await pool.query(`
      SELECT COUNT(*) as total_new_clients,
             SUM(250) as subscription_revenue
      FROM users 
      WHERE 'client' = ANY(roles) 
        AND created_at >= $1 
        AND created_at <= $2
    `, [start_date, end_date]);

    // Get clients by month
    const clientsByMonthResult = await pool.query(`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as count,
        SUM(250) as revenue
      FROM users 
      WHERE 'client' = ANY(roles) 
        AND created_at >= $1 
        AND created_at <= $2
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `, [start_date, end_date]);

    res.json({
      total_new_clients: parseInt(newClientsResult.rows[0].total_new_clients || 0),
      subscription_revenue: parseFloat(newClientsResult.rows[0].subscription_revenue || 0),
      clients_by_month: clientsByMonthResult.rows.map(row => ({
        month: row.month,
        count: parseInt(row.count),
        revenue: parseFloat(row.revenue || 0)
      }))
    });
  } catch (error) {
    console.error("Error generating new clients report:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.get("/api/reports/professional-revenue-summary", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    const result = await pool.query(`
      SELECT 
        p.name as professional_name,
        p.percentage as professional_percentage,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue,
        SUM(c.value * p.percentage / 100) as professional_payment,
        SUM(c.value * (100 - p.percentage) / 100) as clinic_revenue
      FROM consultations c
      JOIN users p ON c.professional_id = p.id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY p.id, p.name, p.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    const serviceResult = await pool.query(`
      SELECT 
        s.name as service_name,
        COUNT(c.id) as consultation_count,
        SUM(c.value) as revenue
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY s.id, s.name
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    const totalRevenue = result.rows.reduce((sum, row) => sum + parseFloat(row.revenue || 0), 0);

    res.json({
      total_revenue: totalRevenue,
      revenue_by_professional: result.rows.map(row => ({
        professional_name: row.professional_name,
        professional_percentage: parseInt(row.professional_percentage),
        consultation_count: parseInt(row.consultation_count),
        revenue: parseFloat(row.revenue || 0),
        professional_payment: parseFloat(row.professional_payment || 0),
        clinic_revenue: parseFloat(row.clinic_revenue || 0)
      })),
      revenue_by_service: serviceResult.rows.map(row => ({
        service_name: row.service_name,
        consultation_count: parseInt(row.consultation_count),
        revenue: parseFloat(row.revenue || 0)
      }))
    });
  } catch (error) {
    console.error("Error generating professional revenue summary:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.get("/api/reports/total-revenue", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    // Get subscription revenue (new clients)
    const subscriptionResult = await pool.query(`
      SELECT COUNT(*) * 250 as subscription_revenue
      FROM users 
      WHERE 'client' = ANY(roles) 
        AND created_at >= $1 
        AND created_at <= $2
    `, [start_date, end_date]);

    // Get consultation revenue (clinic percentage)
    const consultationResult = await pool.query(`
      SELECT SUM(c.value * (100 - p.percentage) / 100) as consultation_revenue
      FROM consultations c
      JOIN users p ON c.professional_id = p.id
      WHERE c.date >= $1 AND c.date <= $2
    `, [start_date, end_date]);

    const subscriptionRevenue = parseFloat(subscriptionResult.rows[0].subscription_revenue || 0);
    const consultationRevenue = parseFloat(consultationResult.rows[0].consultation_revenue || 0);
    const totalRevenue = subscriptionRevenue + consultationRevenue;

    res.json({
      subscription_revenue: subscriptionRevenue,
      consultation_revenue: consultationRevenue,
      total_revenue: totalRevenue,
      clinic_total_revenue: totalRevenue // Same as total for clinic
    });
  } catch (error) {
    console.error("Error generating total revenue report:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// 🔥 PAYMENT ROUTES WITH MERCADOPAGO SDK V2
app.post("/api/create-subscription", authenticate, async (req, res) => {
  try {
    console.log("🔄 Creating client subscription payment with SDK v2...");

    const preference = {
      items: [
        {
          title: "Assinatura Cartão Quiro Ferreira - Titular",
          description: "Assinatura mensal do cartão de convênio",
          quantity: 1,
          currency_id: "BRL",
          unit_price: 250.00
        }
      ],
      payer: {
        name: req.user.name,
        email: req.user.email || "cliente@quiroferreira.com"
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/client?payment=success`,
        failure: `${req.protocol}://${req.get('host')}/client?payment=failure`,
        pending: `${req.protocol}://${req.get('host')}/client?payment=pending`
      },
      auto_return: "approved",
      external_reference: `subscription_${req.user.id}_${Date.now()}`,
      notification_url: `${req.protocol}://${req.get('host')}/api/webhooks/mercadopago`
    };

    console.log("🔄 Creating preference with SDK v2:", preference);

    const response = await mercadopago.preferences.create(preference);
    console.log("✅ Preference created with SDK v2:", response.body);

    res.json({
      preference_id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point
    });
  } catch (error) {
    console.error("❌ Error creating subscription payment:", error);
    res.status(500).json({ message: "Erro ao criar pagamento da assinatura" });
  }
});

app.post("/api/professional/create-payment", authenticate, async (req, res) => {
  try {
    const { amount } = req.body;
    console.log("🔄 Creating professional payment with SDK v2 for amount:", amount);

    const preference = {
      items: [
        {
          title: "Pagamento ao Convênio Quiro Ferreira",
          description: "Repasse de valores das consultas realizadas",
          quantity: 1,
          currency_id: "BRL",
          unit_price: parseFloat(amount)
        }
      ],
      payer: {
        name: req.user.name,
        email: req.user.email || "profissional@quiroferreira.com"
      },
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/professional?payment=success`,
        failure: `${req.protocol}://${req.get('host')}/professional?payment=failure`,
        pending: `${req.protocol}://${req.get('host')}/professional?payment=pending`
      },
      auto_return: "approved",
      external_reference: `professional_payment_${req.user.id}_${Date.now()}`,
      notification_url: `${req.protocol}://${req.get('host')}/api/webhooks/mercadopago`
    };

    console.log("🔄 Creating preference with SDK v2:", preference);

    const response = await mercadopago.preferences.create(preference);
    console.log("✅ Preference created with SDK v2:", response.body);

    res.json({
      preference_id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point
    });
  } catch (error) {
    console.error("❌ Error creating professional payment:", error);
    res.status(500).json({ message: "Erro ao criar pagamento profissional" });
  }
});

// 🔥 IMAGE UPLOAD ROUTE
app.post("/api/upload-image", authenticate, async (req, res) => {
  try {
    console.log("🔄 Starting image upload process...");
    
    const upload = createUpload();
    
    upload.single('image')(req, res, async (err) => {
      if (err) {
        console.error("❌ Upload error:", err);
        return res.status(400).json({ message: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ message: "Nenhum arquivo foi enviado" });
      }

      console.log("✅ File uploaded successfully:", req.file);

      try {
        // Update user's photo_url in database
        await pool.query(
          "UPDATE users SET photo_url = $1 WHERE id = $2",
          [req.file.path, req.user.id]
        );

        console.log("✅ User photo URL updated in database");

        res.json({
          message: "Imagem enviada com sucesso",
          imageUrl: req.file.path
        });
      } catch (dbError) {
        console.error("❌ Database error:", dbError);
        res.status(500).json({ message: "Erro ao salvar URL da imagem no banco de dados" });
      }
    });
  } catch (error) {
    console.error("❌ Error in upload route:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// 🔥 WEBHOOK ROUTE FOR MERCADOPAGO
app.post("/api/webhooks/mercadopago", async (req, res) => {
  try {
    console.log("🔔 MercadoPago webhook received:", req.body);
    
    const { type, data } = req.body;
    
    if (type === "payment") {
      const paymentId = data.id;
      
      // Get payment details from MercadoPago
      const payment = await mercadopago.payment.findById(paymentId);
      console.log("💳 Payment details:", payment.body);
      
      if (payment.body.status === "approved") {
        const externalReference = payment.body.external_reference;
        
        if (externalReference.includes("subscription_")) {
          // Handle client subscription payment
          const userId = externalReference.split("_")[1];
          const expiryDate = new Date();
          expiryDate.setMonth(expiryDate.getMonth() + 1);
          
          await pool.query(`
            UPDATE users SET 
              subscription_status = 'active',
              subscription_expiry = $1
            WHERE id = $2
          `, [expiryDate, userId]);
          
          console.log("✅ Client subscription activated for user:", userId);
        } else if (externalReference.includes("agenda_subscription_")) {
          // Handle professional agenda subscription
          const userId = externalReference.split("_")[2];
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 30);
          
          await pool.query(`
            INSERT INTO professional_subscriptions (professional_id, status, expires_at, last_payment)
            VALUES ($1, 'active', $2, CURRENT_TIMESTAMP)
            ON CONFLICT (professional_id) DO UPDATE SET
              status = 'active',
              expires_at = $2,
              last_payment = CURRENT_TIMESTAMP
          `, [userId, expiryDate]);
          
          console.log("✅ Professional agenda subscription activated for user:", userId);
        }
      }
    }
    
    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.status(500).send("Error");
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ message: "Erro interno do servidor" });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 API URL: http://localhost:${PORT}`);
});