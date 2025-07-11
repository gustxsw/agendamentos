import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { pool } from './db.js';
import { authenticate, authorize } from './middleware/auth.js';
import createUploadMiddleware from './middleware/upload.js';

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

// Routes
app.get('/', (req, res) => {
  res.send('API is running...');
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

// Professional signature endpoint
app.post('/api/professional/signature', authenticate, async (req, res) => {
  try {
    const { signature_url } = req.body;
    
    if (!signature_url) {
      return res.status(400).json({ message: 'Signature URL is required' });
    }
    
    // Update user's signature URL
    await pool.query(
      'UPDATE users SET signature_url = $1 WHERE id = $2',
      [signature_url, req.user.id]
    );
    
    res.json({ message: 'Signature updated successfully' });
  } catch (error) {
    console.error('Error updating signature:', error);
    res.status(500).json({ message: 'Error updating signature' });
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
       (template_id, patient_id, professional_id, type, url, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
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

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Export app for testing
export default app;