import multer from 'multer';

// 🔥 FIXED: Import cloudinary properly and validate credentials
const createCloudinaryConfig = async () => {
  try {
    const { v2: cloudinary } = await import('cloudinary');
    
    // Get credentials from environment variables
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    
    console.log('🔍 Cloudinary credentials check:');
    console.log('Cloud Name:', cloudName ? '✅ Found' : '❌ Missing');
    console.log('API Key:', apiKey ? '✅ Found' : '❌ Missing');
    console.log('API Secret:', apiSecret ? '✅ Found' : '❌ Missing');
    
    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error('Cloudinary credentials are missing. Please check your .env file.');
    }
    
    // Configure Cloudinary
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true
    });

    // Test the configuration
    try {
      await cloudinary.api.ping();
      console.log('✅ Cloudinary connection test successful');
    } catch (testError) {
      console.error('❌ Cloudinary connection test failed:', testError);
      throw new Error(`Cloudinary connection failed: ${testError.message}`);
    }

    console.log('✅ Cloudinary configured successfully');
    return cloudinary;
  } catch (error) {
    console.error('❌ Error configuring Cloudinary:', error);
    throw error;
  }
};

// Initialize cloudinary
let cloudinary;
try {
  cloudinary = await createCloudinaryConfig();
} catch (error) {
  console.error('❌ Failed to initialize Cloudinary:', error);
  // Don't throw here, let the route handle the error
}

// Configure Cloudinary storage for multer
const createStorage = () => {
  if (!cloudinary) {
    throw new Error('Cloudinary not properly configured');
  }
  
  // Create custom storage engine without CloudinaryStorage
  const storage = multer.memoryStorage();
  return storage;
};

// Create multer instance
const createUpload = () => {
  try {
    const storage = createStorage();
    
    const upload = multer({
      storage: storage,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
      },
      fileFilter: (req, file, cb) => {
        console.log('🔄 File filter - File type:', file.mimetype);
        
        // Check file type
        if (file.mimetype.startsWith('image/')) {
          cb(null, true);
        } else {
          cb(new Error('Apenas arquivos de imagem são permitidos'), false);
        }
      },
    });
    
    // Add middleware to handle Cloudinary upload after multer processes the file
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
                folder: 'quiro-ferreira/professionals',
                allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
                transformation: [
                  {
                    width: 400,
                    height: 400,
                    crop: 'fill',
                    gravity: 'face',
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
    
    return { upload, processUpload };
  } catch (error) {
    console.error('❌ Error creating upload middleware:', error);
    throw error;
  }
};

export default createUpload;