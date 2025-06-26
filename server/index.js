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

console.log("🔥 MercadoPago configured with SDK v2");
console.log("🔑 Access Token:", process.env.MP_ACCESS_TOKEN ? "Found" : "Missing");

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://www.cartaoquiroferreira.com.br",
      "https://cartaoquiroferreira.com.br",
    ],
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// 🔥 CREATE ALL NECESSARY TABLES
const createTables = async () => {
  try {
    console.log("🔄 Creating database tables...");

    // 1. Users table (enhanced)
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
        password_hash VARCHAR(255),
        roles TEXT[] DEFAULT '{}',
        percentage DECIMAL(5,2),
        category_id INTEGER,
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_expiry TIMESTAMP,
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Service Categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Services table
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

    // 4. Dependents table
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

    // 5. Consultations table (convênio)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id),
        dependent_id INTEGER REFERENCES dependents(id),
        professional_id INTEGER REFERENCES users(id) NOT NULL,
        service_id INTEGER REFERENCES services(id) NOT NULL,
        value DECIMAL(10,2) NOT NULL,
        date TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🆕 6. Professional Patients table (agenda)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professional_patients (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        notes TEXT,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(professional_id, patient_id)
      )
    `);

    // 🆕 7. Schedule Configs table
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

    // 🆕 8. Appointments table (agenda)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'scheduled',
        notes TEXT,
        medical_record TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🆕 9. Blocked Times table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_times (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🆕 10. Agenda Payments table (separate from convênio)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_payments (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL DEFAULT 49.90,
        status VARCHAR(20) DEFAULT 'pending',
        payment_id VARCHAR(255),
        payment_method VARCHAR(50),
        period_start DATE,
        period_end DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🆕 11. Agenda Subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda_subscriptions (
        id SERIAL PRIMARY KEY,
        professional_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        status VARCHAR(20) DEFAULT 'inactive',
        expires_at TIMESTAMP,
        last_payment_id INTEGER REFERENCES agenda_payments(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🔥 CREATE INDEXES FOR PERFORMANCE
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_cpf ON users(cpf);
      CREATE INDEX IF NOT EXISTS idx_users_roles ON users USING GIN(roles);
      CREATE INDEX IF NOT EXISTS idx_consultations_professional ON consultations(professional_id);
      CREATE INDEX IF NOT EXISTS idx_consultations_date ON consultations(date);
      CREATE INDEX IF NOT EXISTS idx_appointments_professional ON appointments(professional_id);
      CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
      CREATE INDEX IF NOT EXISTS idx_professional_patients_professional ON professional_patients(professional_id);
      CREATE INDEX IF NOT EXISTS idx_agenda_subscriptions_professional ON agenda_subscriptions(professional_id);
    `);

    console.log("✅ All database tables created successfully");

    // 🔥 INSERT DEFAULT DATA
    await insertDefaultData();

  } catch (error) {
    console.error("❌ Error creating tables:", error);
  }
};

// 🔥 INSERT DEFAULT DATA INCLUDING TEST ADMIN
const insertDefaultData = async () => {
  try {
    console.log("🔄 Inserting default data...");

    // Insert default service categories
    const categoryResult = await pool.query(`
      INSERT INTO service_categories (name, description) 
      VALUES 
        ('Fisioterapia', 'Serviços de fisioterapia e reabilitação'),
        ('Psicologia', 'Atendimento psicológico e terapias'),
        ('Nutrição', 'Consultas nutricionais e acompanhamento'),
        ('Odontologia', 'Serviços odontológicos diversos')
      ON CONFLICT DO NOTHING
      RETURNING id
    `);

    if (categoryResult.rows.length > 0) {
      console.log("✅ Default categories inserted");

      // Insert default services
      await pool.query(`
        INSERT INTO services (name, description, base_price, category_id, is_base_service) 
        VALUES 
          ('Consulta Fisioterapia', 'Consulta inicial de fisioterapia', 80.00, 1, true),
          ('Sessão Fisioterapia', 'Sessão de fisioterapia', 60.00, 1, false),
          ('Consulta Psicológica', 'Consulta psicológica individual', 120.00, 2, true),
          ('Consulta Nutricional', 'Consulta com nutricionista', 100.00, 3, true),
          ('Limpeza Dental', 'Limpeza e profilaxia dental', 80.00, 4, true)
        ON CONFLICT DO NOTHING
      `);

      console.log("✅ Default services inserted");
    }

    // 🔥 CREATE TEST ADMIN USER
    const adminExists = await pool.query(
      "SELECT id FROM users WHERE cpf = '00000000000'"
    );

    if (adminExists.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      
      await pool.query(`
        INSERT INTO users (
          name, 
          cpf, 
          email, 
          phone, 
          password_hash, 
          roles,
          subscription_status
        ) VALUES (
          'Administrador Teste',
          '00000000000',
          'admin@quiroferreira.com.br',
          '64981249199',
          $1,
          ARRAY['admin'],
          'active'
        )
      `, [hashedPassword]);

      console.log("🔥 TEST ADMIN USER CREATED:");
      console.log("   📧 Email: admin@quiroferreira.com.br");
      console.log("   🆔 CPF: 000.000.000-00");
      console.log("   🔑 Senha: admin123");
      console.log("   👑 Role: admin");
    } else {
      console.log("ℹ️ Test admin user already exists");
    }

    // 🔥 CREATE TEST PROFESSIONAL USER
    const professionalExists = await pool.query(
      "SELECT id FROM users WHERE cpf = '11111111111'"
    );

    if (professionalExists.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('prof123', 10);
      
      const profResult = await pool.query(`
        INSERT INTO users (
          name, 
          cpf, 
          email, 
          phone, 
          password_hash, 
          roles,
          percentage,
          category_id,
          subscription_status
        ) VALUES (
          'Dr. João Silva',
          '11111111111',
          'joao@quiroferreira.com.br',
          '64987654321',
          $1,
          ARRAY['professional'],
          50.00,
          1,
          'active'
        )
        RETURNING id
      `, [hashedPassword]);

      const professionalId = profResult.rows[0].id;

      // Create default schedule config for professional
      await pool.query(`
        INSERT INTO schedule_configs (
          professional_id,
          monday_start, monday_end,
          tuesday_start, tuesday_end,
          wednesday_start, wednesday_end,
          thursday_start, thursday_end,
          friday_start, friday_end,
          slot_duration
        ) VALUES (
          $1,
          '08:00', '18:00',
          '08:00', '18:00',
          '08:00', '18:00',
          '08:00', '18:00',
          '08:00', '17:00',
          30
        )
      `, [professionalId]);

      // Create active agenda subscription for professional
      await pool.query(`
        INSERT INTO agenda_subscriptions (
          professional_id,
          status,
          expires_at
        ) VALUES (
          $1,
          'active',
          $2
        )
      `, [professionalId, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]); // 30 days from now

      console.log("🔥 TEST PROFESSIONAL USER CREATED:");
      console.log("   📧 Email: joao@quiroferreira.com.br");
      console.log("   🆔 CPF: 111.111.111-11");
      console.log("   🔑 Senha: prof123");
      console.log("   👨‍⚕️ Role: professional");
      console.log("   📅 Agenda: Ativa por 30 dias");
    } else {
      console.log("ℹ️ Test professional user already exists");
    }

    // 🔥 CREATE TEST CLIENT USER
    const clientExists = await pool.query(
      "SELECT id FROM users WHERE cpf = '22222222222'"
    );

    if (clientExists.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('client123', 10);
      
      await pool.query(`
        INSERT INTO users (
          name, 
          cpf, 
          email, 
          phone, 
          password_hash, 
          roles,
          subscription_status,
          subscription_expiry
        ) VALUES (
          'Maria Santos',
          '22222222222',
          'maria@cliente.com.br',
          '64999887766',
          $1,
          ARRAY['client'],
          'active',
          $2
        )
      `, [hashedPassword, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]); // 30 days from now

      console.log("🔥 TEST CLIENT USER CREATED:");
      console.log("   📧 Email: maria@cliente.com.br");
      console.log("   🆔 CPF: 222.222.222-22");
      console.log("   🔑 Senha: client123");
      console.log("   👤 Role: client");
      console.log("   💳 Assinatura: Ativa por 30 dias");
    } else {
      console.log("ℹ️ Test client user already exists");
    }

    console.log("✅ Default data insertion completed");

  } catch (error) {
    console.error("❌ Error inserting default data:", error);
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

    const result = await pool.query(
      "SELECT id, name, cpf, password_hash, roles FROM users WHERE cpf = $1",
      [cleanCpf]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      return res.status(401).json({ message: "Usuário sem senha definida" });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    const userData = {
      id: user.id,
      name: user.name,
      cpf: user.cpf,
      roles: user.roles || [],
    };

    const needsRoleSelection = userData.roles.length > 1;

    res.json({
      user: userData,
      needsRoleSelection,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/auth/select-role", async (req, res) => {
  try {
    const { userId, role } = req.body;

    if (!userId || !role) {
      return res.status(400).json({ message: "User ID e role são obrigatórios" });
    }

    const result = await pool.query(
      "SELECT id, name, cpf, roles FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const user = result.rows[0];

    if (!user.roles || !user.roles.includes(role)) {
      return res.status(403).json({ message: "Role não autorizada para este usuário" });
    }

    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "7d" }
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
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      user: userData,
      token,
    });
  } catch (error) {
    console.error("Role selection error:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/auth/switch-role", authenticate, async (req, res) => {
  try {
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ message: "Role é obrigatória" });
    }

    const result = await pool.query(
      "SELECT id, name, cpf, roles FROM users WHERE id = $1",
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const user = result.rows[0];

    if (!user.roles || !user.roles.includes(role)) {
      return res.status(403).json({ message: "Role não autorizada para este usuário" });
    }

    const token = jwt.sign(
      { id: user.id, currentRole: role },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "7d" }
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
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      user: userData,
      token,
    });
  } catch (error) {
    console.error("Role switch error:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/auth/register", async (req, res) => {
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

    if (!name || !cpf || !password) {
      return res.status(400).json({ message: "Nome, CPF e senha são obrigatórios" });
    }

    const cleanCpf = cpf.replace(/\D/g, "");

    if (cleanCpf.length !== 11) {
      return res.status(400).json({ message: "CPF deve ter 11 dígitos" });
    }

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE cpf = $1",
      [cleanCpf]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: "CPF já cadastrado" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number, 
        address_complement, neighborhood, city, state, password_hash, roles
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
      RETURNING id, name, cpf`,
      [
        name,
        cleanCpf,
        email,
        phone?.replace(/\D/g, ""),
        birth_date,
        address,
        address_number,
        address_complement,
        neighborhood,
        city,
        state,
        hashedPassword,
        ["client"],
      ]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { id: user.id, currentRole: "client" },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        roles: ["client"],
        currentRole: "client",
      },
      token,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logout realizado com sucesso" });
});

// 🔥 AGENDA ROUTES

// Get subscription status
app.get("/api/agenda/subscription-status", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.status,
        s.expires_at,
        CASE 
          WHEN s.expires_at > NOW() THEN EXTRACT(DAY FROM s.expires_at - NOW())::INTEGER
          ELSE 0
        END as days_remaining,
        CASE 
          WHEN s.status = 'active' AND s.expires_at > NOW() THEN true
          ELSE false
        END as can_use_agenda,
        p.created_at as last_payment
      FROM agenda_subscriptions s
      LEFT JOIN agenda_payments p ON s.last_payment_id = p.id
      WHERE s.professional_id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.json({
        status: 'inactive',
        expires_at: null,
        days_remaining: 0,
        can_use_agenda: false
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching subscription status:", error);
    res.status(500).json({ message: "Erro ao verificar status da assinatura" });
  }
});

// Create subscription payment
app.post("/api/agenda/create-subscription-payment", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    console.log("🔄 Creating agenda subscription payment for professional:", req.user.id);

    const preference = {
      items: [
        {
          title: "Assinatura Agenda Profissional - Quiro Ferreira",
          description: "Acesso completo à agenda profissional por 30 dias",
          quantity: 1,
          currency_id: "BRL",
          unit_price: 49.90,
        },
      ],
      payer: {
        name: req.user.name,
        email: "agenda@quiroferreira.com.br",
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional/agenda?payment=pending`,
      },
      auto_return: "approved",
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/agenda/webhook`,
      external_reference: `agenda_${req.user.id}_${Date.now()}`,
      statement_descriptor: "QUIRO FERREIRA AGENDA",
    };

    console.log("🔄 Creating MercadoPago preference:", preference);

    const response = await mercadopago.preferences.create(preference);
    
    console.log("✅ MercadoPago preference created:", response.body.id);

    // Save payment record
    await pool.query(`
      INSERT INTO agenda_payments (
        professional_id, 
        amount, 
        status, 
        payment_id
      ) VALUES ($1, $2, 'pending', $3)
    `, [req.user.id, 49.90, response.body.id]);

    res.json({
      preference_id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point,
    });
  } catch (error) {
    console.error("❌ Error creating agenda subscription payment:", error);
    res.status(500).json({ message: "Erro ao criar pagamento da assinatura" });
  }
});

// Agenda webhook
app.post("/api/agenda/webhook", async (req, res) => {
  try {
    console.log("🔔 Agenda webhook received:", req.body);

    const { type, data } = req.body;

    if (type === "payment") {
      const paymentId = data.id;
      
      console.log("🔄 Processing agenda payment:", paymentId);

      const payment = await mercadopago.payment.findById(paymentId);
      
      console.log("💳 Payment details:", payment.body);

      if (payment.body.status === "approved") {
        const externalReference = payment.body.external_reference;
        const professionalId = externalReference.split('_')[1];

        console.log("✅ Payment approved for professional:", professionalId);

        // Update payment status
        await pool.query(`
          UPDATE agenda_payments 
          SET status = 'paid', payment_method = $1, updated_at = NOW()
          WHERE payment_id = $2
        `, [payment.body.payment_method_id, payment.body.preference_id]);

        // Calculate subscription period
        const periodStart = new Date();
        const periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + 30);

        // Update or create subscription
        await pool.query(`
          INSERT INTO agenda_subscriptions (professional_id, status, expires_at)
          VALUES ($1, 'active', $2)
          ON CONFLICT (professional_id) 
          DO UPDATE SET 
            status = 'active',
            expires_at = $2,
            updated_at = NOW()
        `, [professionalId, periodEnd]);

        console.log("✅ Agenda subscription activated for professional:", professionalId);
      }
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Agenda webhook error:", error);
    res.status(500).send("Error");
  }
});

// Get schedule config
app.get("/api/agenda/schedule-config", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM schedule_configs WHERE professional_id = $1",
      [req.user.id]
    );

    if (result.rows.length === 0) {
      // Create default config
      await pool.query(`
        INSERT INTO schedule_configs (
          professional_id, slot_duration,
          monday_start, monday_end,
          tuesday_start, tuesday_end,
          wednesday_start, wednesday_end,
          thursday_start, thursday_end,
          friday_start, friday_end
        ) VALUES ($1, 30, '08:00', '18:00', '08:00', '18:00', '08:00', '18:00', '08:00', '18:00', '08:00', '17:00')
        RETURNING *
      `, [req.user.id]);

      const newResult = await pool.query(
        "SELECT * FROM schedule_configs WHERE professional_id = $1",
        [req.user.id]
      );

      return res.json(newResult.rows[0]);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching schedule config:", error);
    res.status(500).json({ message: "Erro ao carregar configuração de horários" });
  }
});

// Get professional patients
app.get("/api/agenda/patients", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    // Check subscription
    const subscriptionCheck = await pool.query(`
      SELECT can_use_agenda FROM (
        SELECT 
          CASE 
            WHEN s.status = 'active' AND s.expires_at > NOW() THEN true
            ELSE false
          END as can_use_agenda
        FROM agenda_subscriptions s
        WHERE s.professional_id = $1
      ) sub
    `, [req.user.id]);

    if (subscriptionCheck.rows.length === 0 || !subscriptionCheck.rows[0].can_use_agenda) {
      return res.status(403).json({ message: "Assinatura da agenda necessária" });
    }

    const result = await pool.query(`
      SELECT 
        u.id,
        u.name,
        u.cpf,
        u.email,
        u.phone,
        u.birth_date,
        u.address,
        u.address_number,
        u.address_complement,
        u.neighborhood,
        u.city,
        u.state,
        pp.notes,
        pp.linked_at,
        CASE 
          WHEN u.roles && ARRAY['client'] THEN true
          ELSE false
        END as is_convenio_patient
      FROM professional_patients pp
      JOIN users u ON pp.patient_id = u.id
      WHERE pp.professional_id = $1
      ORDER BY u.name
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching patients:", error);
    res.status(500).json({ message: "Erro ao carregar pacientes" });
  }
});

// Add patient
app.post("/api/agenda/patients", authenticate, authorize(["professional"]), async (req, res) => {
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

    if (!name || !cpf) {
      return res.status(400).json({ message: "Nome e CPF são obrigatórios" });
    }

    const cleanCpf = cpf.replace(/\D/g, "");

    // Check if user already exists
    let userResult = await pool.query(
      "SELECT id FROM users WHERE cpf = $1",
      [cleanCpf]
    );

    let patientId;

    if (userResult.rows.length === 0) {
      // Create new patient (without password - particular patient)
      const newUserResult = await pool.query(`
        INSERT INTO users (
          name, cpf, email, phone, birth_date, address, address_number,
          address_complement, neighborhood, city, state, roles
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `, [
        name,
        cleanCpf,
        email,
        phone?.replace(/\D/g, ""),
        birth_date,
        address,
        address_number,
        address_complement,
        neighborhood,
        city,
        state,
        [] // No roles for particular patients
      ]);

      patientId = newUserResult.rows[0].id;
    } else {
      patientId = userResult.rows[0].id;
    }

    // Link patient to professional
    await pool.query(`
      INSERT INTO professional_patients (professional_id, patient_id, notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (professional_id, patient_id) DO NOTHING
    `, [req.user.id, patientId, notes]);

    // Return patient data
    const patientResult = await pool.query(`
      SELECT 
        u.id,
        u.name,
        u.cpf,
        u.email,
        u.phone,
        u.birth_date,
        u.address,
        u.address_number,
        u.address_complement,
        u.neighborhood,
        u.city,
        u.state,
        pp.notes,
        pp.linked_at,
        CASE 
          WHEN u.roles && ARRAY['client'] THEN true
          ELSE false
        END as is_convenio_patient
      FROM professional_patients pp
      JOIN users u ON pp.patient_id = u.id
      WHERE pp.professional_id = $1 AND pp.patient_id = $2
    `, [req.user.id, patientId]);

    res.status(201).json(patientResult.rows[0]);
  } catch (error) {
    console.error("Error adding patient:", error);
    res.status(500).json({ message: "Erro ao adicionar paciente" });
  }
});

// Update patient notes
app.put("/api/agenda/patients/:id", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const { notes } = req.body;
    const patientId = req.params.id;

    await pool.query(`
      UPDATE professional_patients 
      SET notes = $1, updated_at = NOW()
      WHERE professional_id = $2 AND patient_id = $3
    `, [notes, req.user.id, patientId]);

    res.json({ message: "Observações atualizadas com sucesso" });
  } catch (error) {
    console.error("Error updating patient notes:", error);
    res.status(500).json({ message: "Erro ao atualizar observações" });
  }
});

// Get appointments
app.get("/api/agenda/appointments", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    const result = await pool.query(`
      SELECT 
        a.id,
        a.date,
        a.status,
        a.notes,
        a.medical_record,
        u.id as patient_id,
        u.name as patient_name,
        u.phone as patient_phone,
        CASE 
          WHEN u.roles && ARRAY['client'] THEN true
          ELSE false
        END as is_convenio_patient
      FROM appointments a
      JOIN users u ON a.patient_id = u.id
      WHERE a.professional_id = $1
        AND a.date >= $2
        AND a.date <= $3
      ORDER BY a.date
    `, [req.user.id, start_date, end_date]);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching appointments:", error);
    res.status(500).json({ message: "Erro ao carregar agendamentos" });
  }
});

// Create appointment
app.post("/api/agenda/appointments", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const { patient_id, date, notes } = req.body;

    if (!patient_id || !date) {
      return res.status(400).json({ message: "Paciente e data são obrigatórios" });
    }

    // Check if patient is linked to professional
    const linkCheck = await pool.query(
      "SELECT id FROM professional_patients WHERE professional_id = $1 AND patient_id = $2",
      [req.user.id, patient_id]
    );

    if (linkCheck.rows.length === 0) {
      return res.status(403).json({ message: "Paciente não vinculado a este profissional" });
    }

    // Check for conflicts
    const conflictCheck = await pool.query(`
      SELECT id FROM appointments 
      WHERE professional_id = $1 
        AND date = $2 
        AND status NOT IN ('cancelled')
    `, [req.user.id, date]);

    if (conflictCheck.rows.length > 0) {
      return res.status(409).json({ message: "Já existe um agendamento neste horário" });
    }

    const result = await pool.query(`
      INSERT INTO appointments (professional_id, patient_id, date, notes)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [req.user.id, patient_id, date, notes]);

    res.status(201).json({ id: result.rows[0].id, message: "Agendamento criado com sucesso" });
  } catch (error) {
    console.error("Error creating appointment:", error);
    res.status(500).json({ message: "Erro ao criar agendamento" });
  }
});

// 🔥 EXISTING ROUTES (keeping all existing functionality)

// Users routes
app.get("/api/users", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, roles, percentage,
        category_id, subscription_status, subscription_expiry, created_at
      FROM users 
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Erro ao carregar usuários" });
  }
});

app.get("/api/users/:id", authenticate, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Users can only access their own data, unless they're admin
    if (req.user.currentRole !== 'admin' && req.user.id !== parseInt(userId)) {
      return res.status(403).json({ message: "Acesso não autorizado" });
    }

    const result = await pool.query(`
      SELECT 
        id, name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, roles, percentage,
        category_id, subscription_status, subscription_expiry, photo_url, created_at
      FROM users 
      WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "Erro ao carregar usuário" });
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

    if (!name || !cpf || !password || !roles || roles.length === 0) {
      return res.status(400).json({ message: "Campos obrigatórios não preenchidos" });
    }

    const cleanCpf = cpf.replace(/\D/g, "");

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE cpf = $1",
      [cleanCpf]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: "CPF já cadastrado" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (
        name, cpf, email, phone, birth_date, address, address_number,
        address_complement, neighborhood, city, state, password_hash, roles,
        percentage, category_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id`,
      [
        name,
        cleanCpf,
        email,
        phone?.replace(/\D/g, ""),
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

    res.status(201).json({ id: result.rows[0].id, message: "Usuário criado com sucesso" });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ message: "Erro ao criar usuário" });
  }
});

app.put("/api/users/:id", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const userId = req.params.id;
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

    if (!name || !roles || roles.length === 0) {
      return res.status(400).json({ message: "Nome e roles são obrigatórios" });
    }

    await pool.query(
      `UPDATE users SET 
        name = $1, email = $2, phone = $3, birth_date = $4, address = $5,
        address_number = $6, address_complement = $7, neighborhood = $8,
        city = $9, state = $10, roles = $11, percentage = $12, category_id = $13,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14`,
      [
        name,
        email,
        phone?.replace(/\D/g, ""),
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
        userId,
      ]
    );

    res.json({ message: "Usuário atualizado com sucesso" });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Erro ao atualizar usuário" });
  }
});

app.put("/api/users/:id/activate", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const userId = req.params.id;
    const { expiry_date } = req.body;

    if (!expiry_date) {
      return res.status(400).json({ message: "Data de expiração é obrigatória" });
    }

    await pool.query(
      `UPDATE users SET 
        subscription_status = 'active',
        subscription_expiry = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
      [expiry_date, userId]
    );

    res.json({ message: "Cliente ativado com sucesso" });
  } catch (error) {
    console.error("Error activating user:", error);
    res.status(500).json({ message: "Erro ao ativar cliente" });
  }
});

app.delete("/api/users/:id", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const userId = req.params.id;

    await pool.query("DELETE FROM users WHERE id = $1", [userId]);

    res.json({ message: "Usuário excluído com sucesso" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Erro ao excluir usuário" });
  }
});

// Service categories routes
app.get("/api/service-categories", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM service_categories ORDER BY name"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching service categories:", error);
    res.status(500).json({ message: "Erro ao carregar categorias" });
  }
});

app.post("/api/service-categories", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Nome é obrigatório" });
    }

    const result = await pool.query(
      "INSERT INTO service_categories (name, description) VALUES ($1, $2) RETURNING id",
      [name, description]
    );

    res.status(201).json({ id: result.rows[0].id, message: "Categoria criada com sucesso" });
  } catch (error) {
    console.error("Error creating service category:", error);
    res.status(500).json({ message: "Erro ao criar categoria" });
  }
});

// Services routes
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
    res.status(500).json({ message: "Erro ao carregar serviços" });
  }
});

app.post("/api/services", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { name, description, base_price, category_id, is_base_service } = req.body;

    if (!name || !base_price) {
      return res.status(400).json({ message: "Nome e preço são obrigatórios" });
    }

    const result = await pool.query(
      `INSERT INTO services (name, description, base_price, category_id, is_base_service) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, description, base_price, category_id, is_base_service]
    );

    res.status(201).json({ id: result.rows[0].id, message: "Serviço criado com sucesso" });
  } catch (error) {
    console.error("Error creating service:", error);
    res.status(500).json({ message: "Erro ao criar serviço" });
  }
});

app.put("/api/services/:id", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const serviceId = req.params.id;
    const { name, description, base_price, category_id, is_base_service } = req.body;

    if (!name || !base_price) {
      return res.status(400).json({ message: "Nome e preço são obrigatórios" });
    }

    await pool.query(
      `UPDATE services SET 
        name = $1, description = $2, base_price = $3, category_id = $4, is_base_service = $5
       WHERE id = $6`,
      [name, description, base_price, category_id, is_base_service, serviceId]
    );

    res.json({ message: "Serviço atualizado com sucesso" });
  } catch (error) {
    console.error("Error updating service:", error);
    res.status(500).json({ message: "Erro ao atualizar serviço" });
  }
});

app.delete("/api/services/:id", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const serviceId = req.params.id;

    await pool.query("DELETE FROM services WHERE id = $1", [serviceId]);

    res.json({ message: "Serviço excluído com sucesso" });
  } catch (error) {
    console.error("Error deleting service:", error);
    res.status(500).json({ message: "Erro ao excluir serviço" });
  }
});

// Professionals routes
app.get("/api/professionals", authenticate, authorize(["client"]), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.email, u.phone, u.address, u.address_number,
        u.address_complement, u.neighborhood, u.city, u.state, u.photo_url,
        sc.name as category_name
      FROM users u
      LEFT JOIN service_categories sc ON u.category_id = sc.id
      WHERE u.roles && ARRAY['professional']
      ORDER BY u.name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching professionals:", error);
    res.status(500).json({ message: "Erro ao carregar profissionais" });
  }
});

// Dependents routes
app.get("/api/dependents/:clientId", authenticate, async (req, res) => {
  try {
    const clientId = req.params.clientId;

    // Check if user can access this client's dependents
    if (req.user.currentRole !== 'admin' && req.user.id !== parseInt(clientId)) {
      return res.status(403).json({ message: "Acesso não autorizado" });
    }

    const result = await pool.query(
      "SELECT * FROM dependents WHERE client_id = $1 ORDER BY name",
      [clientId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching dependents:", error);
    res.status(500).json({ message: "Erro ao carregar dependentes" });
  }
});

app.get("/api/dependents/lookup", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: "CPF é obrigatório" });
    }

    const cleanCpf = cpf.replace(/\D/g, "");

    const result = await pool.query(`
      SELECT 
        d.id, d.name, d.cpf, d.birth_date, d.client_id,
        u.name as client_name, u.subscription_status as client_subscription_status
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
    res.status(500).json({ message: "Erro ao buscar dependente" });
  }
});

app.post("/api/dependents", authenticate, async (req, res) => {
  try {
    const { client_id, name, cpf, birth_date } = req.body;

    // Check if user can add dependents for this client
    if (req.user.currentRole !== 'admin' && req.user.id !== client_id) {
      return res.status(403).json({ message: "Acesso não autorizado" });
    }

    if (!client_id || !name || !cpf) {
      return res.status(400).json({ message: "Campos obrigatórios não preenchidos" });
    }

    const cleanCpf = cpf.replace(/\D/g, "");

    const existingDependent = await pool.query(
      "SELECT id FROM dependents WHERE cpf = $1",
      [cleanCpf]
    );

    if (existingDependent.rows.length > 0) {
      return res.status(409).json({ message: "CPF já cadastrado" });
    }

    const result = await pool.query(
      "INSERT INTO dependents (client_id, name, cpf, birth_date) VALUES ($1, $2, $3, $4) RETURNING id",
      [client_id, name, cleanCpf, birth_date]
    );

    res.status(201).json({ id: result.rows[0].id, message: "Dependente criado com sucesso" });
  } catch (error) {
    console.error("Error creating dependent:", error);
    res.status(500).json({ message: "Erro ao criar dependente" });
  }
});

app.put("/api/dependents/:id", authenticate, async (req, res) => {
  try {
    const dependentId = req.params.id;
    const { name, birth_date } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Nome é obrigatório" });
    }

    // Check if user can edit this dependent
    const dependent = await pool.query(
      "SELECT client_id FROM dependents WHERE id = $1",
      [dependentId]
    );

    if (dependent.rows.length === 0) {
      return res.status(404).json({ message: "Dependente não encontrado" });
    }

    if (req.user.currentRole !== 'admin' && req.user.id !== dependent.rows[0].client_id) {
      return res.status(403).json({ message: "Acesso não autorizado" });
    }

    await pool.query(
      "UPDATE dependents SET name = $1, birth_date = $2 WHERE id = $3",
      [name, birth_date, dependentId]
    );

    res.json({ message: "Dependente atualizado com sucesso" });
  } catch (error) {
    console.error("Error updating dependent:", error);
    res.status(500).json({ message: "Erro ao atualizar dependente" });
  }
});

app.delete("/api/dependents/:id", authenticate, async (req, res) => {
  try {
    const dependentId = req.params.id;

    // Check if user can delete this dependent
    const dependent = await pool.query(
      "SELECT client_id FROM dependents WHERE id = $1",
      [dependentId]
    );

    if (dependent.rows.length === 0) {
      return res.status(404).json({ message: "Dependente não encontrado" });
    }

    if (req.user.currentRole !== 'admin' && req.user.id !== dependent.rows[0].client_id) {
      return res.status(403).json({ message: "Acesso não autorizado" });
    }

    await pool.query("DELETE FROM dependents WHERE id = $1", [dependentId]);

    res.json({ message: "Dependente excluído com sucesso" });
  } catch (error) {
    console.error("Error deleting dependent:", error);
    res.status(500).json({ message: "Erro ao excluir dependente" });
  }
});

// Consultations routes
app.get("/api/consultations", authenticate, async (req, res) => {
  try {
    let query = `
      SELECT 
        c.id, c.value, c.date, c.created_at,
        s.name as service_name,
        u_prof.name as professional_name,
        COALESCE(u_client.name, d.name) as client_name,
        CASE WHEN d.id IS NOT NULL THEN true ELSE false END as is_dependent
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      JOIN users u_prof ON c.professional_id = u_prof.id
      LEFT JOIN users u_client ON c.client_id = u_client.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
    `;

    const params = [];

    if (req.user.currentRole === 'client') {
      query += ` WHERE (c.client_id = $1 OR d.client_id = $1)`;
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
    res.status(500).json({ message: "Erro ao carregar consultas" });
  }
});

app.post("/api/consultations", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const { client_id, dependent_id, service_id, value, date } = req.body;

    if ((!client_id && !dependent_id) || !service_id || !value || !date) {
      return res.status(400).json({ message: "Campos obrigatórios não preenchidos" });
    }

    const result = await pool.query(
      `INSERT INTO consultations (client_id, dependent_id, professional_id, service_id, value, date) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [client_id, dependent_id, req.user.id, service_id, value, date]
    );

    res.status(201).json({ id: result.rows[0].id, message: "Consulta registrada com sucesso" });
  } catch (error) {
    console.error("Error creating consultation:", error);
    res.status(500).json({ message: "Erro ao registrar consulta" });
  }
});

// Client lookup route
app.get("/api/clients/lookup", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const { cpf } = req.query;

    if (!cpf) {
      return res.status(400).json({ message: "CPF é obrigatório" });
    }

    const cleanCpf = cpf.replace(/\D/g, "");

    const result = await pool.query(
      `SELECT id, name, cpf, subscription_status 
       FROM users 
       WHERE cpf = $1 AND roles && ARRAY['client']`,
      [cleanCpf]
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

// Reports routes
app.get("/api/reports/revenue", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: "Datas de início e fim são obrigatórias" });
    }

    // Revenue by professional
    const professionalRevenue = await pool.query(`
      SELECT 
        u.name as professional_name,
        u.percentage as professional_percentage,
        SUM(c.value) as revenue,
        COUNT(c.id) as consultation_count,
        SUM(c.value * u.percentage / 100) as professional_payment,
        SUM(c.value * (100 - u.percentage) / 100) as clinic_revenue
      FROM consultations c
      JOIN users u ON c.professional_id = u.id
      WHERE c.date >= $1 AND c.date <= $2
      GROUP BY u.id, u.name, u.percentage
      ORDER BY revenue DESC
    `, [start_date, end_date]);

    // Revenue by service
    const serviceRevenue = await pool.query(`
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
    const totalRevenue = await pool.query(`
      SELECT SUM(value) as total_revenue
      FROM consultations
      WHERE date >= $1 AND date <= $2
    `, [start_date, end_date]);

    res.json({
      total_revenue: totalRevenue.rows[0].total_revenue || 0,
      revenue_by_professional: professionalRevenue.rows,
      revenue_by_service: serviceRevenue.rows,
    });
  } catch (error) {
    console.error("Error generating revenue report:", error);
    res.status(500).json({ message: "Erro ao gerar relatório" });
  }
});

app.get("/api/reports/professional-revenue", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ message: "Datas de início e fim são obrigatórias" });
    }

    // Get professional data
    const professionalData = await pool.query(
      "SELECT percentage FROM users WHERE id = $1",
      [req.user.id]
    );

    if (professionalData.rows.length === 0) {
      return res.status(404).json({ message: "Profissional não encontrado" });
    }

    const percentage = professionalData.rows[0].percentage || 50;

    // Get consultations summary
    const summary = await pool.query(`
      SELECT 
        $1 as professional_percentage,
        SUM(c.value) as total_revenue,
        COUNT(c.id) as consultation_count,
        SUM(c.value * (100 - $1) / 100) as amount_to_pay
      FROM consultations c
      WHERE c.professional_id = $2 AND c.date >= $3 AND c.date <= $4
    `, [percentage, req.user.id, start_date, end_date]);

    // Get individual consultations
    const consultations = await pool.query(`
      SELECT 
        c.date,
        COALESCE(u_client.name, d.name) as client_name,
        s.name as service_name,
        c.value as total_value,
        (c.value * (100 - $1) / 100) as amount_to_pay
      FROM consultations c
      JOIN services s ON c.service_id = s.id
      LEFT JOIN users u_client ON c.client_id = u_client.id
      LEFT JOIN dependents d ON c.dependent_id = d.id
      WHERE c.professional_id = $2 AND c.date >= $3 AND c.date <= $4
      ORDER BY c.date DESC
    `, [percentage, req.user.id, start_date, end_date]);

    res.json({
      summary: summary.rows[0],
      consultations: consultations.rows,
    });
  } catch (error) {
    console.error("Error generating professional revenue report:", error);
    res.status(500).json({ message: "Erro ao gerar relatório" });
  }
});

// 🔥 CONVÊNIO PAYMENT ROUTES (existing)
app.post("/api/create-subscription", authenticate, authorize(["client"]), async (req, res) => {
  try {
    const { user_id, dependent_ids } = req.body;

    if (req.user.id !== user_id) {
      return res.status(403).json({ message: "Acesso não autorizado" });
    }

    const dependentCount = dependent_ids ? dependent_ids.length : 0;
    const totalAmount = 250 + (dependentCount * 50);

    const preference = {
      items: [
        {
          title: "Assinatura Convênio Quiro Ferreira",
          description: `Titular + ${dependentCount} dependente(s)`,
          quantity: 1,
          currency_id: "BRL",
          unit_price: totalAmount,
        },
      ],
      payer: {
        name: req.user.name,
        email: "convenio@quiroferreira.com.br",
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/client?payment=pending`,
      },
      auto_return: "approved",
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhook`,
      external_reference: `convenio_${user_id}_${Date.now()}`,
      statement_descriptor: "QUIRO FERREIRA CONVENIO",
    };

    const response = await mercadopago.preferences.create(preference);

    res.json({
      preference_id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point,
    });
  } catch (error) {
    console.error("Error creating subscription:", error);
    res.status(500).json({ message: "Erro ao criar assinatura" });
  }
});

// Convênio webhook
app.post("/api/webhook", async (req, res) => {
  try {
    console.log("🔔 Convênio webhook received:", req.body);

    const { type, data } = req.body;

    if (type === "payment") {
      const paymentId = data.id;
      
      const payment = await mercadopago.payment.findById(paymentId);
      
      if (payment.body.status === "approved") {
        const externalReference = payment.body.external_reference;
        const userId = externalReference.split('_')[1];

        await pool.query(`
          UPDATE users 
          SET subscription_status = 'active', 
              subscription_expiry = $1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), userId]);

        console.log("✅ Convênio subscription activated for user:", userId);
      }
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Convênio webhook error:", error);
    res.status(500).send("Error");
  }
});

// Professional payment route (existing)
app.post("/api/professional/create-payment", authenticate, authorize(["professional"]), async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Valor inválido" });
    }

    const preference = {
      items: [
        {
          title: "Repasse ao Convênio Quiro Ferreira",
          description: "Pagamento de repasse mensal",
          quantity: 1,
          currency_id: "BRL",
          unit_price: parseFloat(amount),
        },
      ],
      payer: {
        name: req.user.name,
        email: "repasse@quiroferreira.com.br",
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/professional?payment=pending`,
      },
      auto_return: "approved",
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/professional/webhook`,
      external_reference: `repasse_${req.user.id}_${Date.now()}`,
      statement_descriptor: "QUIRO FERREIRA REPASSE",
    };

    const response = await mercadopago.preferences.create(preference);

    res.json({
      preference_id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point,
    });
  } catch (error) {
    console.error("Error creating professional payment:", error);
    res.status(500).json({ message: "Erro ao criar pagamento" });
  }
});

// Professional webhook
app.post("/api/professional/webhook", async (req, res) => {
  try {
    console.log("🔔 Professional webhook received:", req.body);
    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Professional webhook error:", error);
    res.status(500).send("Error");
  }
});

// Image upload route
app.post("/api/upload-image", authenticate, async (req, res) => {
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

      console.log('✅ Image uploaded successfully:', req.file.path);

      // Update user's photo_url
      await pool.query(
        'UPDATE users SET photo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [req.file.path, req.user.id]
      );

      res.json({
        message: 'Imagem enviada com sucesso',
        imageUrl: req.file.path
      });
    });
  } catch (error) {
    console.error('Error in upload route:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    message: "🔥 Quiro Ferreira API with Agenda System - Running with SDK v2" 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔥 Quiro Ferreira API with Complete Agenda System`);
  console.log(`📅 Agenda subscription: R$ 49,90/month`);
  console.log(`💳 Convênio subscription: R$ 250 + R$ 50/dependent`);
  console.log(`🔧 MercadoPago SDK v2 configured`);
});