import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Log Cloudinary configuration status
console.log('🔍 Cloudinary configuration:');
console.log('Cloud Name:', process.env.CLOUDINARY_CLOUD_NAME ? '✅ Found' : '❌ Missing');
console.log('API Key:', process.env.CLOUDINARY_API_KEY ? '✅ Found' : '❌ Missing');
console.log('API Secret:', process.env.CLOUDINARY_API_SECRET ? '✅ Found' : '❌ Missing');

// Test Cloudinary connection
const testCloudinaryConnection = async () => {
  try {
    await cloudinary.api.ping();
    console.log('✅ Cloudinary connection test successful');
    return true;
  } catch (error) {
    console.error('❌ Cloudinary connection test failed:', error.message);
    return false;
  }
};

// Initialize connection test
testCloudinaryConnection();

// Configure multer storage
const storage = multer.memoryStorage();

// Create multer upload middleware
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos de imagem são permitidos'), false);
    }
  },
});

// Process upload middleware factory
const processUpload = (fieldName) => {
  return async (req, res, next) => {
    const uploadMiddleware = upload.single(fieldName);
    
    uploadMiddleware(req, res, async (err) => {
      if (err) {
        return next(err);
      }
      
      if (!req.file) {
        return next();
      }
      
      try {
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(
          `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`,
          {
            folder: 'quiro-ferreira',
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
            transformation: [
              {
                width: 800,
                crop: 'limit',
                quality: 'auto:good'
              }
            ]
          }
        );
        
        // Add Cloudinary result to request
        req.cloudinaryResult = result;
        next();
      } catch (error) {
        console.error('❌ Error uploading to Cloudinary:', error);
        next(error);
      }
    });
  };
};

// Export the middleware
export default {
  upload,
  processUpload,
  cloudinary
};