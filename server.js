const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

// Check if WhatsApp can be initialized (requires Puppeteer/Chrome)
let WhatsAppClient = null;
let LocalAuth = null;
let WHATSAPP_ENABLED = false;

try {
  const wwjs = require('whatsapp-web.js');
  WhatsAppClient = wwjs.Client;
  LocalAuth = wwjs.LocalAuth;
  WHATSAPP_ENABLED = process.env.DISABLE_WHATSAPP !== 'true';
  console.log('✅ WhatsApp-web.js loaded successfully');
} catch (err) {
  console.log('⚠️ WhatsApp-web.js not available (Puppeteer/Chrome required)');
  console.log('   Running in API-only mode - WhatsApp features disabled');
  WHATSAPP_ENABLED = false;
}

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('✅ Created data directory:', dataDir);
}

// Import Ollama AI
const OllamaAI = require('./utils/ollama');
const ollamaAI = new OllamaAI();

// Import AI Function Calling
const AIFunctions = require('./utils/ai-functions');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3002;

// Helper function to get server base URL dynamically
function getServerBaseUrl(req) {
  // Try to get from request if available
  if (req) {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || req.headers.host;
    if (host) {
      return `${protocol}://${host}`;
    }
  }
  // Fallback: detect server's external IP
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let serverIP = '127.0.0.1';
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        serverIP = iface.address;
        break;
      }
    }
  }
  return `http://${serverIP}:${PORT}`;
}

// Helper function to convert relative image URLs to absolute URLs
function makeImageUrlAbsolute(imageUrl, req) {
  if (!imageUrl) return imageUrl;
  // If already absolute URL, return as-is
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  // Convert relative path to absolute URL
  const baseUrl = getServerBaseUrl(req);
  // Ensure path starts with /
  const path = imageUrl.startsWith('/') ? imageUrl : '/' + imageUrl;
  return baseUrl + path;
}

// Admin credentials are now handled via database
// const ADMIN_USERNAME = 'gigies';
// const ADMIN_PASSWORD = '123456';

// Middleware
app.set('trust proxy', 1); // Trust Nginx proxy for secure cookies
app.use(cors());
app.use(express.json());
// Session configuration - use environment-based secret
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'gigies-secret-key-' + Date.now(),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', 
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true
  }
};

// MemoryStore is fine for single-instance deployments
// For multi-instance, use Redis or other distributed session store
if (process.env.NODE_ENV === 'production') {
  console.log('📝 Using MemoryStore (suitable for single-instance deployment)');
}

app.use(session(sessionConfig));

// Authentication middleware
function requireAuth(req, res, next) {
  // Authentication disabled - direct access enabled
  next();
}

// Serve dashboard directly (no login required)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get('SELECT * FROM admin_users WHERE username = ? AND password = ?', [username, password], (err, user) => {
    if (err) {
      console.error('Login error:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    if (user) {
      req.session.loggedIn = true;
      req.session.username = user.username;
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
  });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check auth status
app.get('/api/auth/status', (req, res) => {
  res.json({ loggedIn: req.session && req.session.loggedIn });
});

// Serve dashboard directly (no login required)
app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Protect all other static files
app.use(express.static('public', {
  setHeaders: (res, path) => {
    if (path.endsWith('.html') && !path.endsWith('login.html')) {
      // Will be handled by requireAuth middleware
    }
  }
}));

// Serve uploads folder for product images
app.use('/uploads', express.static('uploads'));

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = './uploads/products';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'product-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
    }
  }
});

// Database setup with proper path and error handling
// Try multiple locations for database file
let db;
let usingInMemory = false;
const possibleDbPaths = [
  path.join(__dirname, 'data', 'wa-bot.db'),
  path.join('/tmp', 'wa-bot.db'),
  path.join(process.env.HOME || '/tmp', 'wa-bot-data', 'wa-bot.db')
];

let dbInitialized = false;

for (const dbPath of possibleDbPaths) {
  try {
    const dbDir = path.dirname(dbPath);
    
    // Ensure directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    // Test write permissions
    const testFile = path.join(dbDir, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    
    // Directory is writable, create database
    db = new sqlite3.Database(dbPath);
    console.log('✅ Database initialized at:', dbPath);
    dbInitialized = true;
    break;
  } catch (error) {
    console.log('⚠️  Cannot use path:', dbPath, '-', error.message);
  }
}

if (!dbInitialized) {
  // All locations failed, use in-memory database
  console.log('📝 Using in-memory SQLite database (data will not persist)');
  db = new sqlite3.Database(':memory:');
  usingInMemory = true;
}

// Initialize database tables
db.serialize(() => {
  // Auto-reply messages table
  db.run(`CREATE TABLE IF NOT EXISTS auto_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL UNIQUE,
    response TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Messages log table
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    sender_name TEXT,
    sender_number TEXT,
    message TEXT,
    is_from_me INTEGER DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Bot settings table
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default auto-replies
  const defaultReplies = [
    ['hello', 'Hello! Welcome to KCC Lanka. How can I help you today? 👋'],
    ['hi', 'Hi there! Welcome to KCC Lanka. How can I assist you? 😊'],
    ['price', 'For pricing information, please visit https://kcclanka.com/shop/ or contact our sales team.'],
    ['hours', 'Our business hours are:\nMonday - Friday: 8:00 AM - 5:00 PM\nSaturday: 9:00 AM - 2:00 PM\nSunday: Closed'],
    ['location', 'KCC Lanka\nColombo, Sri Lanka\nWebsite: https://kcclanka.com'],
    ['help', 'I can help you with:\n• Product information\n• Pricing\n• Business hours\n• Contact details\n\nJust type your question!'],
    ['temco', 'TEMCO Development Bank offers education financing up to 10 years! Visit https://kcclanka.com/temco/ to apply.']
  ];

  const stmt = db.prepare('INSERT OR IGNORE INTO auto_replies (keyword, response) VALUES (?, ?)');
  defaultReplies.forEach(([keyword, response]) => {
    stmt.run(keyword, response);
  });
  stmt.finalize();

  // Insert default settings
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['auto_reply_enabled', 'true']);
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['welcome_message', 'Welcome to KCC Lanka! 🎉']);
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['ai_mode_enabled', 'false']);
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['ai_fallback_enabled', 'true']);
  
  // Insert default AI system prompt (business information)
  const defaultSystemPrompt = `You are a helpful customer service assistant for KCC Lanka. 
Be friendly, professional, and provide detailed helpful responses.
Respond in the same language the user writes in (Sinhala, English, Tamil, etc.).

Provide information about:
- KCC Lanka services and products
- Business hours: Mon-Fri 8AM-5PM, Sat 9AM-2PM, Sunday Closed
- Location: Colombo, Sri Lanka
- Website: https://kcclanka.com
- TEMCO Development Bank: Education financing up to 10 years at https://kcclanka.com/temco/
- Online Shop: https://kcclanka.com/shop/
- Student Portal (for courses & enrollment): https://kcclanka.com/student/

IMPORTANT URL FORMATTING:
- When mentioning URLs, use PLAIN TEXT only (https://kcclanka.com/student/)
- DO NOT use markdown link format like [text](url)
- DO NOT repeat the URL twice
- Just write the URL as plain text
- For student portal, ALWAYS use ONLY https://kcclanka.com/student/ - never use index.html or any other variation

For simple greetings, keep it brief. For questions about services or products, provide detailed, helpful information.
Always be helpful and guide users to relevant pages.`;
  
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['ai_system_prompt', defaultSystemPrompt]);
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['ai_conversation_history', '10']);
  
  // Create user data tables for AI function calling
  
  // User courses/enrollments table
  db.run(`CREATE TABLE IF NOT EXISTS user_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT NOT NULL,
    course_name TEXT NOT NULL,
    enrollment_date DATE DEFAULT CURRENT_DATE,
    status TEXT DEFAULT 'active',
    completion_percentage INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // User orders table
  db.run(`CREATE TABLE IF NOT EXISTS user_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT NOT NULL,
    order_number TEXT NOT NULL UNIQUE,
    product_name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    total_amount DECIMAL(10,2),
    order_date DATE DEFAULT CURRENT_DATE,
    status TEXT DEFAULT 'pending',
    delivery_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // User profile data table
  db.run(`CREATE TABLE IF NOT EXISTS user_profiles (
    phone_number TEXT PRIMARY KEY,
    full_name TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    registration_date DATE DEFAULT CURRENT_DATE,
    customer_type TEXT DEFAULT 'regular',
    total_purchases DECIMAL(10,2) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // E-commerce categories table
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // E-commerce products table
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    image_url TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  )`);

  // Store settings table
  db.run(`CREATE TABLE IF NOT EXISTS store_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Shopping cart table
  db.run(`CREATE TABLE IF NOT EXISTS shopping_cart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  // Orders table
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    phone_number TEXT,
    customer_name TEXT,
    delivery_address TEXT,
    city TEXT,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    payment_method TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Order items table
  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  // Registered members table for order history enrichment
  db.run(`CREATE TABLE IF NOT EXISTS registered_members (
    phone_number TEXT PRIMARY KEY,
    name TEXT,
    address TEXT,
    city TEXT,
    total_orders INTEGER DEFAULT 0,
    total_spent DECIMAL(10,2) DEFAULT 0,
    last_order_at DATETIME
  )`);
  
  // Insert sample data for testing
  db.run(`INSERT OR IGNORE INTO user_courses (phone_number, course_name, status, completion_percentage) VALUES 
    ('94771234567', 'Web Development Bootcamp', 'active', 75),
    ('94771234567', 'Python for Beginners', 'completed', 100),
    ('94777654321', 'Digital Marketing', 'active', 30)`);
  
  db.run(`INSERT OR IGNORE INTO user_orders (phone_number, order_number, product_name, quantity, total_amount, status) VALUES 
    ('94771234567', 'ORD-001', 'Laptop Stand', 1, 4500.00, 'delivered'),
    ('94771234567', 'ORD-002', 'Wireless Mouse', 2, 3000.00, 'shipped'),
    ('94777654321', 'ORD-003', 'USB Cable', 3, 1500.00, 'pending')`);
  
  db.run(`INSERT OR IGNORE INTO user_profiles (phone_number, full_name, email, customer_type, total_purchases) VALUES 
    ('94771234567', 'Kasun Perera', 'kasun@email.com', 'premium', 15000.00),
    ('94777654321', 'Nimal Silva', 'nimal@email.com', 'regular', 5000.00)`);
  
  console.log('✅ Database tables initialized');
});

// Import shopping functions
const shoppingFunctions = require('./utils/shopping-functions');

// Initialize AI Functions and Shopping Functions with database
console.log('🔧 Initializing AI Functions with database...');
AIFunctions.setDatabase(db);
shoppingFunctions.setDatabase(db);
shoppingFunctions.setSocketIO(io);

// Set server base URL for absolute image URLs
// Priority: 1) SERVER_URL env var, 2) External IP detection, 3) Network interface IP
let serverBaseUrl = process.env.SERVER_URL;

if (!serverBaseUrl) {
  // Try to detect external IP using a simple HTTP request (async, with fallback)
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let detectedIP = '127.0.0.1';
  
  // First try to find eth0 or public interface
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Prefer public IPs (not 10.x, 172.16-31.x, 192.168.x)
        if (!iface.address.startsWith('10.') && 
            !iface.address.startsWith('172.') && 
            !iface.address.startsWith('192.168.')) {
          detectedIP = iface.address;
          break;
        }
        // Keep private IP as fallback
        if (detectedIP === '127.0.0.1') {
          detectedIP = iface.address;
        }
      }
    }
  }
  
  // For DigitalOcean and similar cloud providers, try to get external IP
  // This is done synchronously at startup using a simple approach
  try {
    const { execSync } = require('child_process');
    const externalIP = execSync('curl -s --max-time 2 ifconfig.me 2>/dev/null || curl -s --max-time 2 icanhazip.com 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
    if (externalIP && /^\d+\.\d+\.\d+\.\d+$/.test(externalIP)) {
      detectedIP = externalIP;
      console.log(`[SERVER] Detected external IP: ${detectedIP}`);
    }
  } catch (e) {
    console.log('[SERVER] Could not detect external IP, using network interface IP');
  }
  
  serverBaseUrl = `http://${detectedIP}:${PORT}`;
}

shoppingFunctions.setServerBaseUrl(serverBaseUrl);
console.log(`✅ AI Functions and Shopping Functions initialized (Base URL: ${serverBaseUrl})`);

// WhatsApp Client
let client;
let qrCodeData = null;
let isReady = false;
let clientInfo = null;

// Initialize WhatsApp Client
function initializeClient() {
  if (!WHATSAPP_ENABLED || !WhatsAppClient) {
    console.log('⚠️ WhatsApp client initialization skipped (not available or disabled)');
    return;
  }
  
  client = new WhatsAppClient({
    authStrategy: new LocalAuth({
      dataPath: './wa-session'
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    }
  });

  // QR Code event
  client.on('qr', (qr) => {
    console.log('QR Code received');
    qrcode.toDataURL(qr, (err, url) => {
      if (err) {
        console.error('QR Code generation error:', err);
        return;
      }
      qrCodeData = url;
      io.emit('qr', url);
    });
  });

  // Ready event
  client.on('ready', async () => {
    console.log('WhatsApp Client is ready!');
    isReady = true;
    qrCodeData = null;
    
    try {
      clientInfo = {
        user: client.info.wid.user,
        pushname: client.info.pushname,
        platform: client.info.platform
      };
      io.emit('ready', clientInfo);
    } catch (error) {
      console.error('Error getting client info:', error);
    }
  });

  // Authenticated event
  client.on('authenticated', () => {
    console.log('WhatsApp Client authenticated');
    io.emit('authenticated');
  });

  // Authentication failure event
  client.on('auth_failure', (msg) => {
    console.error('Authentication failure:', msg);
    io.emit('auth_failure', msg);
  });

  // Disconnected event
  client.on('disconnected', (reason) => {
    console.log('WhatsApp Client disconnected:', reason);
    isReady = false;
    clientInfo = null;
    qrCodeData = null;
    io.emit('disconnected', reason);
  });

  // Remote session saved (when logged out from phone)
  client.on('remote_session_saved', () => {
    console.log('Remote session saved - likely logged out from phone');
    isReady = false;
    clientInfo = null;
    qrCodeData = null;
    io.emit('disconnected', 'Logged out from phone');
  });

  // Loading screen event
  client.on('loading_screen', (percent, message) => {
    console.log('Loading screen:', percent, message);
  });

  // Change state event
  client.on('change_state', (state) => {
    console.log('Connection state changed:', state);
    if (state === 'UNPAIRED' || state === 'UNPAIRED_IDLE') {
      console.log('Device unpaired - resetting state');
      isReady = false;
      clientInfo = null;
      qrCodeData = null;
      io.emit('disconnected', 'Device unpaired');
    }
  });

  // Message event
  client.on('message', async (message) => {
    try {
      const chat = await message.getChat();
      
      // Try to get contact info with fallback
      let contact;
      let contactName = 'Unknown';
      let contactNumber = message.from;
      
      try {
        contact = await message.getContact();
        contactName = contact.name || contact.pushname || contact.number || 'Unknown';
        contactNumber = contact.number || message.from;
      } catch (contactError) {
        console.log('⚠️ Using fallback method for contact info due to:', contactError.message);
        // Fallback: extract from message object
        contactNumber = message.from.replace('@c.us', '').replace('@g.us', '');
        contactName = message._data.notifyName || contactNumber;
      }
      
      console.log(`📨 Received message from ${contactNumber} (${contactName}): ${message.body}`);
      
      // Log message to database
      db.run(
        'INSERT INTO messages (chat_id, sender_name, sender_number, message, is_from_me) VALUES (?, ?, ?, ?, ?)',
        [chat.id._serialized, contactName, contactNumber, message.body, message.fromMe ? 1 : 0],
        (err) => {
          if (err) {
            console.error('❌ Error saving message to database:', err);
          } else {
            console.log(`✅ Message saved to database from ${contactNumber}`);
          }
        }
      );

      // Emit message to web interface
      io.emit('message', {
        chatId: chat.id._serialized,
        senderName: contactName,
        senderNumber: contactNumber,
        message: message.body,
        fromMe: message.fromMe,
        timestamp: new Date()
      });

      // Don't auto-reply to own messages
      if (message.fromMe) return;
      
      // Skip @lid (Local ID) messages - these are from newsletters, channels, status updates
      // WhatsApp doesn't allow sending messages to @lid format chat IDs
      if (chat.id._serialized.includes('@lid')) {
        console.log(`⚠️ Skipping auto-reply to @lid contact (newsletter/channel/status): ${chat.id._serialized}`);
        return;
      }

      // Handle media (images) from admin for product uploads
      if (message.hasMedia) {
        console.log(`[MEDIA] Message has media attachment from ${contactNumber}`);
        
        // Check if sender is admin
        db.get('SELECT value FROM settings WHERE key = ?', ['admin_phone_number'], async (err, adminRow) => {
          if (!err && adminRow) {
            const adminPhone = adminRow.value.replace(/[\s\-\+]/g, '');
            const userPhone = contactNumber.replace(/[\s\-\+]/g, '');
            const isAdmin = adminPhone.includes(userPhone) || userPhone.includes(adminPhone);
            
            if (isAdmin) {
              try {
                console.log('[MEDIA] Admin sent media, downloading...');
                const { MessageMedia } = require('whatsapp-web.js');
                const media = await message.downloadMedia();
                
                if (media && media.mimetype && media.mimetype.startsWith('image/')) {
                  // Save image to uploads folder
                  const fs = require('fs');
                  const path = require('path');
                  
                  // Determine file extension
                  const ext = media.mimetype.split('/')[1].toLowerCase();
                  const filename = `product-${Date.now()}.${ext}`;
                  const filepath = path.join(__dirname, 'public', 'uploads', 'products', filename);
                  const imageUrl = `/uploads/products/${filename}`;
                  
                  // Convert base64 to buffer and save
                  const buffer = Buffer.from(media.data, 'base64');
                  fs.writeFileSync(filepath, buffer);
                  
                  console.log(`[MEDIA] ✅ Image saved: ${imageUrl}`);
                  
                  // Check if message caption contains product ID
                  const caption = message.body || '';
                  const productIdMatch = caption.match(/product\s*(?:id|ID|Id)?\s*(?:is|:)?\s*(\d+)/i) || 
                                        caption.match(/id\s*(?:is|:)?\s*(\d+)/i) ||
                                        caption.match(/(\d+)\s*(?:product|image)/i);
                  
                  if (productIdMatch) {
                    const productId = parseInt(productIdMatch[1]);
                    console.log(`[MEDIA] Auto-updating product ${productId} with image: ${imageUrl}`);
                    
                    // Automatically update product image in database
                    db.run('UPDATE products SET image_url = ? WHERE id = ?', [imageUrl, productId], function(updateErr) {
                      if (updateErr) {
                        console.error('[MEDIA] Error updating product image:', updateErr);
                        message.reply(`❌ Failed to update product ${productId} image: ${updateErr.message}`);
                      } else if (this.changes === 0) {
                        message.reply(`⚠️ Product ID ${productId} not found. Image saved at: ${imageUrl}`);
                      } else {
                        console.log(`[MEDIA] ✅ Product ${productId} image updated successfully`);
                        message.reply(`✅ Product ${productId} image updated successfully!\n\n📁 Image: ${imageUrl}`);
                      }
                    });
                  } else {
                    // No product ID in caption, just confirm upload
                    const confirmMsg = `✅ Image uploaded successfully!\n\n📁 Path: ${imageUrl}\n\n💡 To set this as a product image, send another image with caption:\n"Product ID 3" or "Update product 3 image"`;
                    await message.reply(confirmMsg);
                  }
                  
                  // Skip AI processing for this message since we handled the image
                  return;
                  
                } else {
                  await message.reply('⚠️ Only image files are supported for product uploads. Please send a JPG, PNG, or GIF image.');
                }
              } catch (mediaErr) {
                console.error('[MEDIA] Error processing media:', mediaErr);
                await message.reply('❌ Failed to process image. Please try again.');
              }
            } else {
              console.log('[MEDIA] Non-admin sent media, ignoring.');
            }
          }
        });
      }

      // Check if auto-reply is enabled
      db.get('SELECT value FROM settings WHERE key = ?', ['auto_reply_enabled'], async (err, row) => {
        if (err) {
          console.error('❌ Error checking auto_reply_enabled:', err);
          return;
        }
        if (!row || row.value !== 'true') {
          console.log('ℹ️ Auto-reply disabled');
          return;
        }
        console.log('✅ Auto-reply enabled, processing message...');

        const messageText = message.body.trim();
        const messageTextLower = messageText.toLowerCase();

        // Check AI mode setting
        db.get('SELECT value FROM settings WHERE key = ?', ['ai_mode_enabled'], async (err, aiModeRow) => {
          const aiModeEnabled = aiModeRow && aiModeRow.value === 'true';

          if (aiModeEnabled) {
            // AI Mode: Use Ollama for intelligent responses
            try {
              // Get AI settings (system prompt and history length)
              db.get('SELECT value FROM settings WHERE key = ?', ['ai_system_prompt'], async (err, promptRow) => {
                db.get('SELECT value FROM settings WHERE key = ?', ['ai_conversation_history'], async (err, historyLengthRow) => {
                  
                  // Enhance system prompt with function calling capabilities
                  let systemPrompt = promptRow && promptRow.value ? promptRow.value : ollamaAI.getDefaultSystemPrompt();
                  systemPrompt = AIFunctions.getSystemPromptWithFunctions(systemPrompt);
                  ollamaAI.setSystemPrompt(systemPrompt);
                  
                  // Get conversation history length (default 10)
                  const historyLength = historyLengthRow && historyLengthRow.value ? parseInt(historyLengthRow.value) : 10;
                  
                  // Get conversation history for context
                  db.all(
                    `SELECT message, is_from_me FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ${historyLength}`,
                    [chat.id._serialized],
                    async (err, history) => {
                      const conversationHistory = history ? history.reverse() : [];
                      
                      // STEP 1: Generate initial AI response
                      let aiResponse = await ollamaAI.generateResponse(messageText, conversationHistory);
                      
                      // STEP 2: Check if AI requested any functions
                      if (aiResponse.success) {
                        const functionResult = await AIFunctions.processAIResponseWithFunctions(
                          aiResponse.message, 
                          contactNumber
                        );
                        
                        if (functionResult.needsRetry) {
                          // AI requested functions - execute them and regenerate response
                          console.log(`AI requested ${functionResult.functionsExecuted.length} function(s) for ${contactNumber}`);
                          
                          // Add function results to conversation and regenerate
                          const enhancedHistory = [...conversationHistory, {
                            is_from_me: false,
                            message: messageText
                          }];
                          
                          // Create context message with function results
                          const contextMessage = `${functionResult.functionContext}\n\n⚠️ IMPORTANT: The function has ALREADY been executed. DO NOT repeat the [FUNCTION:...] tag in your response.\nInstead, use the data above to answer the user's question naturally.\n\nUser's question: "${messageText}"\n\nProvide a helpful response using ONLY the data shown above:`;
                          
                          // STEP 3: Regenerate with function data
                          aiResponse = await ollamaAI.generateResponse(contextMessage, enhancedHistory);
                          
                          console.log(`AI regenerated response with function data for ${contactNumber}`);
                        }
                      }
                  
                  if (aiResponse.success) {
                    // Remove any remaining function call tags and debug text from response
                    let cleanMessage = aiResponse.message;
                    cleanMessage = cleanMessage.replace(/\[FUNCTION:[^\]]+\]/g, '').trim();
                    
                    // Remove any debug/context markers that might leak
                    cleanMessage = cleanMessage.replace(/---\s*Retrieved Data FROM DATABASE\s*---/gi, '');
                    cleanMessage = cleanMessage.replace(/⚠️\s*CRITICAL:.*?DO NOT INVENT ANY PRODUCTS OR DETAILS\./gi, '');
                    cleanMessage = cleanMessage.replace(/⚠️\s*ONLY show products.*?DO NOT make up products\./gi, '');
                    cleanMessage = cleanMessage.replace(/If the data is empty.*?DO NOT make up products\./gi, '');
                    cleanMessage = cleanMessage.replace(/BROWSE_CATEGORIES:|SEARCH_PRODUCTS:|VIEW_CART:|ADD_TO_CART:|PRODUCTS_BY_CATEGORY:/gi, '');
                    cleanMessage = cleanMessage.trim();
                    
                    // If message is empty after removing tags, provide fallback
                    if (!cleanMessage) {
                      cleanMessage = 'I\'m processing your request. Please try rephrasing your question.';
                    }
                    
                    // Convert relative image URLs to absolute URLs in the message
                    cleanMessage = cleanMessage.replace(
                      /image_url:\s*(\/uploads\/products\/[^\s"'\n]+)/gi,
                      (match, path) => `image_url: ${serverBaseUrl}${path}`
                    );
                    cleanMessage = cleanMessage.replace(
                      /image_url:\s*(uploads\/products\/[^\s"'\n]+)/gi,
                      (match, path) => `image_url: ${serverBaseUrl}/${path}`
                    );
                    
                    // Send AI-generated reply
                    await message.reply(cleanMessage);
                    console.log(`AI reply sent to ${contactNumber}: ${cleanMessage}`);

                    // Send product images if products were shown
                    try {
                      // Extract all image_url mentions with their context
                      // Matches format: image_url: URL or image_url: "URL" or "image_url": "URL"
                      const imageUrlRegex = /image_url["']?\s*[:=]\s*["']?(https?:\/\/[^\s"'\n]+|\/uploads\/[^\s"'\n]+)/gi;
                      const imageMatches = [...cleanMessage.matchAll(imageUrlRegex)];
                      
                      console.log(`[PRODUCT-IMAGES] Checking for images in message, found ${imageMatches.length} matches`);
                      
                      if (imageMatches.length > 0) {
                        console.log(`[PRODUCT-IMAGES] Found ${imageMatches.length} image URL(s) in AI response`);
                        
                        // Extract product information for each image
                        const productsToSend = [];
                        
                        for (const match of imageMatches) {
                          const imageUrl = match[1].trim();
                          
                          // Skip invalid URLs
                          if (!imageUrl || imageUrl.startsWith('http://example') || imageUrl.length < 5) {
                            continue;
                          }
                          
                          // Find the product context before this image_url
                          const beforeImageUrl = cleanMessage.substring(0, match.index);
                          const lines = beforeImageUrl.split('\n').reverse();
                          
                          let productName = '';
                          let productPrice = '';
                          let productDescription = '';
                          let stockInfo = '';
                          
                          // Extract product details from nearby lines (search up to 10 lines before)
                          for (let i = 0; i < Math.min(lines.length, 10); i++) {
                            const line = lines[i].trim();
                            
                            // Extract product name (format: **Name** or **Name Perfume**)
                            if (!productName) {
                              const nameMatch = line.match(/\*\*([^*]+(?:Perfume|perfume)?[^*]*)\*\*(?:\s*-\s*Rs\.?\s*([\d,]+))?/);
                              if (nameMatch) {
                                productName = nameMatch[1].trim();
                                if (nameMatch[2]) {
                                  productPrice = `Rs. ${nameMatch[2]}`;
                                }
                              }
                            }
                            
                            // Extract price if not found yet
                            if (!productPrice) {
                              const priceMatch = line.match(/Rs\.?\s*([\d,]+)/);
                              if (priceMatch) {
                                productPrice = `Rs. ${priceMatch[1]}`;
                              }
                            }
                            
                            // Extract stock info
                            if (!stockInfo) {
                              const stockMatch = line.match(/\*\*Stock(?:\s+Available)?\*\*[:\s]*(\d+)(?:\s+(?:items|available))?/i);
                              if (stockMatch) {
                                stockInfo = `Stock: ${stockMatch[1]} available`;
                              }
                            }
                            
                            // Extract description (italicized text or plain description)
                            if (!productDescription) {
                              const descMatch = line.match(/\*([^*]+(?:fragrance|perfume|scent)[^*]*)\*/i) || 
                                               line.match(/Description:\s*([^\n]+)/i);
                              if (descMatch) {
                                productDescription = descMatch[1].trim();
                              }
                            }
                            
                            // Stop if we found enough info
                            if (productName && productPrice && (productDescription || stockInfo)) {
                              break;
                            }
                          }
                          
                          // Build caption with all available info
                          let caption = '';
                          if (productName) {
                            caption = `🛍️ *${productName}*`;
                            if (productPrice) {
                              caption += `\n💰 ${productPrice}`;
                            }
                            if (productDescription) {
                              caption += `\n📝 ${productDescription}`;
                            }
                            if (stockInfo) {
                              caption += `\n📦 ${stockInfo}`;
                            }
                          } else {
                            // Fallback: use generic caption
                            caption = '🛍️ Product Image';
                          }
                          
                          productsToSend.push({
                            url: imageUrl,
                            caption: caption
                          });
                        }
                        
                        // Send images with captions (limit to 5 images per message)
                        let sentCount = 0;
                        for (const product of productsToSend.slice(0, 5)) {
                          try {
                            let mediaUrl = product.url;
                            
                            // Convert local path to full URL if needed
                            if (product.url.startsWith('/uploads/')) {
                              mediaUrl = `${serverBaseUrl}${product.url}`;
                            } else if (!product.url.startsWith('http')) {
                              mediaUrl = `${serverBaseUrl}/${product.url}`;
                            }
                            
                            console.log(`[PRODUCT-IMAGES] Sending image from: ${mediaUrl}`);
                            console.log(`[PRODUCT-IMAGES] Caption: ${product.caption}`);
                            
                            const { MessageMedia } = require('whatsapp-web.js');
                            const media = await MessageMedia.fromUrl(mediaUrl);
                            
                            // Send with caption
                            await client.sendMessage(chat.id._serialized, media, { caption: product.caption });
                            
                            sentCount++;
                            console.log(`[PRODUCT-IMAGES] ✅ Successfully sent image ${sentCount}/${productsToSend.length}`);
                            
                            // Small delay between images to avoid rate limiting
                            if (sentCount < productsToSend.length) {
                              await new Promise(resolve => setTimeout(resolve, 800));
                            }
                          } catch (imgErr) {
                            console.error(`[PRODUCT-IMAGES] ❌ Failed to send image ${product.url}:`, imgErr.message);
                          }
                        }
                        
                        if (sentCount > 0) {
                          console.log(`[PRODUCT-IMAGES] 📸 Total images sent: ${sentCount}/${productsToSend.length}`);
                        }
                      } else {
                        console.log('[PRODUCT-IMAGES] No product images found in AI response');
                      }
                    } catch (imageErr) {
                      console.error('[PRODUCT-IMAGES] Error processing images:', imageErr.message);
                    }

                    // Log AI reply
                    db.run(
                      'INSERT INTO messages (chat_id, sender_name, sender_number, message, is_from_me) VALUES (?, ?, ?, ?, ?)',
                      [chat.id._serialized, 'AI Bot', 'ai', cleanMessage, 1]
                    );

                    // Emit to web interface
                    io.emit('message', {
                      chatId: chat.id._serialized,
                      senderName: 'AI Bot',
                      senderNumber: 'ai',
                      message: cleanMessage,
                      fromMe: true,
                      timestamp: new Date(),
                      isAutoReply: true,
                      isAI: true
                    });
                  } else {
                    // AI failed, try keyword fallback if enabled
                    db.get('SELECT value FROM settings WHERE key = ?', ['ai_fallback_enabled'], async (err, fallbackRow) => {
                      if (fallbackRow && fallbackRow.value === 'true') {
                        await tryKeywordMatch(messageTextLower, message, chat, contactNumber, contactName);
                      }
                    });
                  }
                    }
                  );
                });
              });
            } catch (error) {
              console.error('AI response error:', error);
              // Try keyword fallback
              db.get('SELECT value FROM settings WHERE key = ?', ['ai_fallback_enabled'], async (err, fallbackRow) => {
                if (fallbackRow && fallbackRow.value === 'true') {
                  await tryKeywordMatch(messageTextLower, message, chat, contactNumber, contactName);
                }
              });
            }
          } else {
            // Keyword Mode: Traditional keyword-based responses
            await tryKeywordMatch(messageTextLower, message, chat, contactNumber, contactName);
          }
        });
      });

      // Helper function for keyword matching
      async function tryKeywordMatch(messageTextLower, message, chat, contactNumber, contactName) {
        db.get(
          'SELECT response FROM auto_replies WHERE keyword = ? AND is_active = 1',
          [messageTextLower],
          async (err, reply) => {
            if (err || !reply) return;

            // Send keyword-based auto-reply
            await message.reply(reply.response);
            console.log(`Auto-reply sent to ${contactNumber}: ${reply.response}`);

            // Log auto-reply
            db.run(
              'INSERT INTO messages (chat_id, sender_name, sender_number, message, is_from_me) VALUES (?, ?, ?, ?, ?)',
              [chat.id._serialized, 'Bot', 'auto', reply.response, 1]
            );

            // Emit auto-reply to web interface
            io.emit('message', {
              chatId: chat.id._serialized,
              senderName: 'Bot',
              senderNumber: 'auto',
              message: reply.response,
              fromMe: true,
              timestamp: new Date(),
              isAutoReply: true
            });
          }
        );
      }
    } catch (error) {
      console.error('❌❌❌ CRITICAL Message handling error:', error);
      console.error('Error stack:', error.stack);
      
      // Write to log file for debugging
      const fs = require('fs');
      const logPath = path.join(__dirname, 'message-error.log');
      fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] Message handling error: ${error.message}\n${error.stack}\n`);
    }
  });

  // Initialize client
  client.initialize();
  console.log('🚀 WhatsApp client initialized and ready to receive messages');

  // Periodic health check (every 30 seconds)
  setInterval(async () => {
    try {
      if (isReady && client) {
        // Check if client is actually connected
        const state = await client.getState();
        if (state !== 'CONNECTED') {
          console.log('Health check: Client not connected, state:', state);
          isReady = false;
          clientInfo = null;
          qrCodeData = null;
          io.emit('disconnected', 'Connection lost (detected by health check)');
        }
      }
    } catch (error) {
      // If getState fails, client is likely disconnected
      if (isReady) {
        console.log('Health check failed - client appears disconnected:', error.message);
        isReady = false;
        clientInfo = null;
        qrCodeData = null;
        io.emit('disconnected', 'Connection lost');
      }
    }
  }, 30000); // Check every 30 seconds
}

// Socket.IO events
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Send current status
  socket.emit('status', {
    isReady,
    qrCode: qrCodeData,
    clientInfo
  });

  // Disconnect client
  socket.on('disconnect_whatsapp', async () => {
    if (client) {
      await client.destroy();
      isReady = false;
      clientInfo = null;
      qrCodeData = null;
      io.emit('disconnected', 'Manual disconnect');
    }
  });

  // Reconnect client
  socket.on('reconnect_whatsapp', () => {
    if (!client || !isReady) {
      initializeClient();
    }
  });

  // Send message
  socket.on('send_message', async (data) => {
    try {
      if (!isReady) {
        socket.emit('error', 'WhatsApp client not ready');
        return;
      }

      const { number, message } = data;
      const chatId = number.includes('@') ? number : `${number}@c.us`;
      
      // Check if trying to send to @lid (Local ID) - these cannot receive messages
      if (chatId.includes('@lid')) {
        console.error(`❌ Cannot send message to @lid contact: ${chatId}`);
        socket.emit('error', 'Cannot send messages to this contact type (newsletter/channel/status). Please use their regular phone number instead.');
        return;
      }
      
      console.log(`📤 Sending message to ${number}: ${message}`);
      
      // Send message via WhatsApp
      await client.sendMessage(chatId, message);
      
      // Save message to database immediately
      db.run(
        'INSERT INTO messages (chat_id, sender_name, sender_number, message, is_from_me) VALUES (?, ?, ?, ?, ?)',
        [chatId, 'You (Dashboard)', number, message, 1],
        (err) => {
          if (err) {
            console.error('❌ Error saving sent message to database:', err);
          } else {
            console.log(`✅ Sent message saved to database for ${number}`);
            // Broadcast the message to all connected clients so it appears in Messages tab
            io.emit('message', {
              chatId: chatId,
              senderName: 'You (Dashboard)',
              senderNumber: number,
              message: message,
              fromMe: true,
              timestamp: new Date()
            });
          }
        }
      );
      
      socket.emit('message_sent', { success: true });
    } catch (error) {
      console.error('❌ Send message error:', error);
      socket.emit('error', error.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// API Routes

// Get bot status
app.get('/api/status', async (req, res) => {
  try {
    // Check if WhatsApp is enabled
    if (!WHATSAPP_ENABLED) {
      return res.json({
        success: true,
        data: {
          isReady: false,
          hasQR: false,
          clientInfo: null,
          whatsappEnabled: false,
          message: 'WhatsApp is disabled (API-only mode)'
        }
      });
    }
    
    // Verify actual client state if we think it's ready
    if (isReady && client) {
      try {
        const state = await client.getState();
        if (state !== 'CONNECTED') {
          // Update cached state
          isReady = false;
          clientInfo = null;
          qrCodeData = null;
          console.log('Status check: Client state is', state, '- updating cached state');
        }
      } catch (error) {
        // If we can't get state, assume disconnected
        isReady = false;
        clientInfo = null;
        qrCodeData = null;
        console.log('Status check: Failed to get client state - assuming disconnected');
      }
    }

    res.json({
      success: true,
      data: {
        isReady,
        hasQR: !!qrCodeData,
        clientInfo,
        whatsappEnabled: WHATSAPP_ENABLED
      }
    });
  } catch (error) {
    res.json({
      success: true,
      data: {
        isReady: false,
        hasQR: false,
        clientInfo: null,
        whatsappEnabled: WHATSAPP_ENABLED
      }
    });
  }
});

// Get QR code
app.get('/api/qr', (req, res) => {
  if (qrCodeData) {
    res.json({
      success: true,
      qr: qrCodeData
    });
  } else {
    res.json({
      success: false,
      message: 'No QR code available'
    });
  }
});

// Get server base URL (useful for frontend to construct absolute URLs)
app.get('/api/server-info', (req, res) => {
  const baseUrl = getServerBaseUrl(req);
  res.json({
    success: true,
    baseUrl: baseUrl,
    port: PORT
  });
});

// Initialize/Reinitialize WhatsApp connection
app.post('/api/whatsapp/initialize', async (req, res) => {
  try {
    console.log('Manual WhatsApp initialization requested');
    
    // Check if client already exists and is ready
    if (client && isReady) {
      return res.json({
        success: true,
        message: 'WhatsApp is already connected and ready. No action needed.',
        status: 'connected'
      });
    }
    
    // If client exists but not ready, just report status
    if (client) {
      return res.json({
        success: true,
        message: 'WhatsApp client is initializing. Please wait or restart the service if stuck.',
        status: 'initializing'
      });
    }
    
    // No client exists - should not happen as client is created on startup
    return res.json({
      success: false,
      message: 'WhatsApp client not initialized. Please restart the service.',
      status: 'not_initialized'
    });
  } catch (error) {
    console.error('WhatsApp initialization error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking WhatsApp status: ' + error.message
    });
  }
});

// Get auto-replies
app.get('/api/auto-replies', (req, res) => {
  db.all('SELECT * FROM auto_replies ORDER BY keyword', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.json({ success: true, data: rows });
  });
});

// Add auto-reply
app.post('/api/auto-replies', (req, res) => {
  const { keyword, response } = req.body;
  
  if (!keyword || !response) {
    return res.status(400).json({ success: false, message: 'Keyword and response required' });
  }

  db.run(
    'INSERT INTO auto_replies (keyword, response) VALUES (?, ?)',
    [keyword.toLowerCase().trim(), response],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ success: false, message: 'Keyword already exists' });
        }
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      res.json({ success: true, data: { id: this.lastID } });
    }
  );
});

// Update auto-reply
app.put('/api/auto-replies/:id', (req, res) => {
  const { id } = req.params;
  const { keyword, response, is_active } = req.body;

  const updates = [];
  const values = [];

  if (keyword !== undefined) {
    updates.push('keyword = ?');
    values.push(keyword.toLowerCase().trim());
  }
  if (response !== undefined) {
    updates.push('response = ?');
    values.push(response);
  }
  if (is_active !== undefined) {
    updates.push('is_active = ?');
    values.push(is_active ? 1 : 0);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  db.run(
    `UPDATE auto_replies SET ${updates.join(', ')} WHERE id = ?`,
    values,
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      res.json({ success: true });
    }
  );
});

// Delete auto-reply
app.delete('/api/auto-replies/:id', (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM auto_replies WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.json({ success: true });
  });
});

// Get messages history
app.get('/api/messages', (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  db.all(
    'SELECT * FROM messages ORDER BY timestamp DESC LIMIT ? OFFSET ?',
    [parseInt(limit), parseInt(offset)],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      // Convert relative image URLs in messages to absolute URLs
      const processedRows = rows.map(row => {
        if (row.message) {
          // Replace relative image paths with absolute URLs
          row.message = row.message.replace(
            /(?:^|\s)(\/uploads\/products\/[^\s"'<>]+)/g,
            (match, path) => match.replace(path, makeImageUrlAbsolute(path, req))
          );
          // Also handle paths without leading slash
          row.message = row.message.replace(
            /(?:^|\s)(uploads\/products\/[^\s"'<>]+)/g,
            (match, path) => match.replace(path, makeImageUrlAbsolute('/' + path, req))
          );
        }
        return row;
      });
      res.json({ success: true, data: processedRows });
    }
  );
});

// Get settings
app.get('/api/settings', (req, res) => {
  db.all('SELECT * FROM settings', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json({ success: true, data: settings });
  });
});

// Update settings
app.put('/api/settings', (req, res) => {
  const { key, value } = req.body;

  db.run(
    'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
    [key, value],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      res.json({ success: true });
    }
  );
});

// Test AI connection
app.get('/api/ai/test', async (req, res) => {
  try {
    const result = await ollamaAI.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to test AI connection',
      error: error.message
    });
  }
});

// List available models
app.get('/api/ai/models', async (req, res) => {
  try {
    const result = await ollamaAI.listAvailableModels();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to list models',
      error: error.message
    });
  }
});

// Change AI model
app.post('/api/ai/model', (req, res) => {
  try {
    const { model } = req.body;
    if (!model) {
      return res.status(400).json({ success: false, message: 'Model name required' });
    }
    
    // Update environment variable
    process.env.OLLAMA_MODEL = model;
    
    // Reinitialize OllamaAI with new model
    const OllamaAI = require('./utils/ollama');
    global.ollamaAI = new OllamaAI();
    
    res.json({ 
      success: true, 
      message: `Model changed to ${model}`,
      model: model
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to change model',
      error: error.message
    });
  }
});

// Get user data (courses, orders, profile)
app.get('/api/user/:phoneNumber/courses', (req, res) => {
  AIFunctions.getUserCourses(req.params.phoneNumber)
    .then(data => res.json({ success: true, data }))
    .catch(err => res.status(500).json({ success: false, error: err.message }));
});

app.get('/api/user/:phoneNumber/orders', (req, res) => {
  AIFunctions.getUserOrders(req.params.phoneNumber)
    .then(data => res.json({ success: true, data }))
    .catch(err => res.status(500).json({ success: false, error: err.message }));
});

app.get('/api/user/:phoneNumber/profile', (req, res) => {
  AIFunctions.getUserProfile(req.params.phoneNumber)
    .then(data => res.json({ success: true, data }))
    .catch(err => res.status(500).json({ success: false, error: err.message }));
});

// Add user course
app.post('/api/user/course', (req, res) => {
  const { phone_number, course_name, status, completion_percentage } = req.body;
  
  db.run(
    'INSERT INTO user_courses (phone_number, course_name, status, completion_percentage) VALUES (?, ?, ?, ?)',
    [phone_number, course_name, status || 'active', completion_percentage || 0],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Add user order
app.post('/api/user/order', (req, res) => {
  const { phone_number, order_number, product_name, quantity, total_amount, status } = req.body;
  
  db.run(
    'INSERT INTO user_orders (phone_number, order_number, product_name, quantity, total_amount, status) VALUES (?, ?, ?, ?, ?, ?)',
    [phone_number, order_number, product_name, quantity || 1, total_amount, status || 'pending'],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Add/Update user profile
app.post('/api/user/profile', (req, res) => {
  const { phone_number, full_name, email, address, city, customer_type, total_purchases } = req.body;
  
  db.run(
    `INSERT INTO user_profiles (phone_number, full_name, email, address, city, customer_type, total_purchases) 
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(phone_number) DO UPDATE SET
       full_name = excluded.full_name,
       email = excluded.email,
       address = excluded.address,
       city = excluded.city,
       customer_type = excluded.customer_type,
       total_purchases = excluded.total_purchases`,
    [phone_number, full_name, email, address, city, customer_type || 'regular', total_purchases || 0],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true });
    }
  );
});

// =============================================
// E-COMMERCE API ENDPOINTS
// =============================================

// Get all products
app.get('/api/ecommerce/products', requireAuth, (req, res) => {
  db.all(`
    SELECT p.*, c.name as category_name 
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.created_at DESC
  `, [], (err, rows) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    // Convert relative image URLs to absolute URLs
    const products = (rows || []).map(product => {
      if (product.image_url) {
        product.image_url = makeImageUrlAbsolute(product.image_url, req);
      }
      return product;
    });
    res.json({ success: true, products });
  });
});

// Get single product
app.get('/api/ecommerce/products/:id', requireAuth, (req, res) => {
  db.get('SELECT * FROM products WHERE id = ?', [req.params.id], (err, row) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    // Convert relative image URL to absolute URL
    if (row && row.image_url) {
      row.image_url = makeImageUrlAbsolute(row.image_url, req);
    }
    res.json({ success: true, product: row });
  });
});

// Upload product image
app.post('/api/ecommerce/upload-image', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.json({ success: false, message: 'No file uploaded' });
  }
  const relativePath = `/uploads/products/${req.file.filename}`;
  const absoluteUrl = makeImageUrlAbsolute(relativePath, req);
  res.json({ success: true, imageUrl: absoluteUrl, url: absoluteUrl, relativePath }); // Return absolute URL
});

// Alternative endpoint path that frontend may use
app.post('/api/upload/product-image', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.json({ success: false, message: 'No file uploaded' });
  }
  const relativePath = `/uploads/products/${req.file.filename}`;
  const absoluteUrl = makeImageUrlAbsolute(relativePath, req);
  res.json({ success: true, url: absoluteUrl, imageUrl: absoluteUrl, relativePath }); // Return absolute URL
});

// Add product
app.post('/api/ecommerce/products', requireAuth, (req, res) => {
  const { name, description, price, stock_quantity, image_url, status, category_id } = req.body;
  // Default to 'active' status if not provided to ensure products show in chat
  const productStatus = status || 'active';
  db.run(`
    INSERT INTO products (name, description, price, stock_quantity, image_url, status, category_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [name, description, price, stock_quantity, image_url, productStatus, category_id], (err) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true });
  });
});

// Update product
app.put('/api/ecommerce/products/:id', requireAuth, (req, res) => {
  const { name, description, price, stock_quantity, image_url, status, category_id } = req.body;
  db.run(`
    UPDATE products 
    SET name = ?, description = ?, price = ?, stock_quantity = ?, image_url = ?, status = ?, category_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [name, description, price, stock_quantity, image_url, status, category_id, req.params.id], (err) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true });
  });
});

// Delete product
app.delete('/api/ecommerce/products/:id', requireAuth, (req, res) => {
  db.run('DELETE FROM products WHERE id = ?', [req.params.id], (err) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true });
  });
});

// Get all categories
app.get('/api/ecommerce/categories', requireAuth, (req, res) => {
  db.all(`
    SELECT c.*, COUNT(p.id) as product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id AND p.status = 'active'
    WHERE c.active = 1
    GROUP BY c.id
    ORDER BY c.sort_order, c.name
  `, [], (err, rows) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true, categories: rows || [] });
  });
});

// Get single category
app.get('/api/ecommerce/categories/:id', requireAuth, (req, res) => {
  db.get('SELECT * FROM categories WHERE id = ?', [req.params.id], (err, row) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true, category: row });
  });
});

// Add category
app.post('/api/ecommerce/categories', requireAuth, (req, res) => {
  const { name, description, icon, sort_order } = req.body;
  db.run(`
    INSERT INTO categories (name, description, icon, sort_order)
    VALUES (?, ?, ?, ?)
  `, [name, description, icon, sort_order || 0], function(err) {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true, id: this.lastID });
  });
});

// Update category
app.put('/api/ecommerce/categories/:id', requireAuth, (req, res) => {
  const { name, description, icon, sort_order } = req.body;
  db.run(`
    UPDATE categories 
    SET name = ?, description = ?, icon = ?, sort_order = ?
    WHERE id = ?
  `, [name, description, icon, sort_order, req.params.id], (err) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true });
  });
});

// Delete category
app.delete('/api/ecommerce/categories/:id', requireAuth, (req, res) => {
  // Check if category has products
  db.get('SELECT COUNT(*) as count FROM products WHERE category_id = ?', [req.params.id], (err, row) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    if (row.count > 0) {
      return res.json({ success: false, message: 'Cannot delete category with products' });
    }
    db.run('DELETE FROM categories WHERE id = ?', [req.params.id], (err) => {
      if (err) {
        return res.json({ success: false, message: err.message });
      }
      res.json({ success: true });
    });
  });
});

// Get all orders
app.get('/api/ecommerce/orders', requireAuth, (req, res) => {
  db.all(`
    SELECT * FROM orders 
    ORDER BY created_at DESC
  `, [], (err, rows) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true, orders: rows || [] });
  });
});

// Update order status
app.put('/api/ecommerce/orders/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const orderId = req.params.id;
  
  // First, get the order details before updating
  db.get(`
    SELECT order_number, phone_number, customer_name, total_amount, status as old_status
    FROM orders 
    WHERE id = ?
  `, [orderId], async (err, order) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    
    if (!order) {
      return res.json({ success: false, message: 'Order not found' });
    }
    
    // Update the order status
    db.run(`
      UPDATE orders 
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, orderId], async (updateErr) => {
      if (updateErr) {
        return res.json({ success: false, message: updateErr.message });
      }
      
      // Send WhatsApp notification to customer
      try {
        if (client && client.info && order.phone_number) {
          const phoneNumber = order.phone_number.replace(/^0/, '94'); // Convert to international format
          const chatId = phoneNumber + '@c.us';
          
          // Create status message based on status
          let statusMessage = '';
          const storeName = 'Gigies';
          const orderNum = order.order_number;
          const customerName = order.customer_name || 'Customer';
          
          switch(status) {
            case 'confirmed':
              statusMessage = `✅ *Order Confirmed!*\n\nHello ${customerName},\n\nYour order ${orderNum} has been confirmed and is being prepared.\n\n*Order Total:* Rs. ${order.total_amount}\n\nWe'll notify you once it's ready for delivery.\n\nThank you for shopping with ${storeName}! 🛍️`;
              break;
              
            case 'processing':
              statusMessage = `📦 *Order Processing*\n\nHello ${customerName},\n\nYour order ${orderNum} is now being processed.\n\nWe're carefully preparing your items for delivery.\n\nTrack your order anytime by asking about order ${orderNum}.\n\n${storeName}`;
              break;
              
            case 'shipped':
            case 'out_for_delivery':
              statusMessage = `🚚 *Order Shipped!*\n\nHello ${customerName},\n\nGreat news! Your order ${orderNum} is on its way!\n\n*Order Total:* Rs. ${order.total_amount}\n\nExpected delivery: 1-2 business days\n\nFor delivery inquiries, please contact us.\n\n${storeName}`;
              break;
              
            case 'delivered':
              statusMessage = `✅ *Order Delivered!*\n\nHello ${customerName},\n\nYour order ${orderNum} has been delivered successfully!\n\n*Order Total:* Rs. ${order.total_amount}\n\nWe hope you enjoy your purchase! 😊\n\nIf you have any issues, please let us know.\n\nThank you for choosing ${storeName}! 🎉`;
              break;
              
            case 'cancelled':
              statusMessage = `❌ *Order Cancelled*\n\nHello ${customerName},\n\nYour order ${orderNum} has been cancelled.\n\n*Order Total:* Rs. ${order.total_amount}\n\nIf this was a mistake or you have questions, please contact us.\n\nWe hope to serve you again soon.\n\n${storeName}`;
              break;
              
            case 'refunded':
              statusMessage = `💰 *Refund Processed*\n\nHello ${customerName},\n\nYour refund for order ${orderNum} has been processed.\n\n*Refund Amount:* Rs. ${order.total_amount}\n\nPlease allow 3-5 business days for the refund to reflect in your account.\n\n${storeName}`;
              break;
              
            default:
              statusMessage = `📋 *Order Status Update*\n\nHello ${customerName},\n\nYour order ${orderNum} status has been updated to: *${status}*\n\n*Order Total:* Rs. ${order.total_amount}\n\nFor more details, please ask about your order.\n\n${storeName}`;
          }
          
          // Send the message
          await client.sendMessage(chatId, statusMessage);
          console.log(`[ORDER-NOTIFICATION] Status update sent to ${order.phone_number} for order ${orderNum}: ${status}`);
        }
      } catch (notifyErr) {
        console.error(`[ORDER-NOTIFICATION] Failed to send notification: ${notifyErr.message}`);
        // Don't fail the request if notification fails
      }
      
      res.json({ success: true, message: 'Order status updated and customer notified' });
    });
  });
});

// Update order tracking ID
app.put('/api/ecommerce/orders/:id/tracking', requireAuth, (req, res) => {
  const { tracking_id } = req.body;
  const orderId = req.params.id;
  
  db.run(`
    UPDATE orders 
    SET tracking_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [tracking_id, orderId], (err) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    res.json({ success: true, message: 'Tracking ID updated' });
  });
});

// Update order payment status
app.put('/api/ecommerce/orders/:id/payment-status', requireAuth, (req, res) => {
  const { payment_status } = req.body;
  const orderId = req.params.id;
  
  // Validate payment status
  const validStatuses = ['pending', 'paid', 'failed', 'refunded'];
  if (!validStatuses.includes(payment_status)) {
    return res.json({ success: false, message: 'Invalid payment status' });
  }
  
  db.run(`
    UPDATE orders 
    SET payment_status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [payment_status, orderId], (err) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    
    console.log(`[PAYMENT-STATUS] Order ${orderId} payment status updated to: ${payment_status}`);
    res.json({ success: true, message: 'Payment status updated' });
  });
});

// Send tracking info to customer via WhatsApp
app.post('/api/ecommerce/orders/:id/send-tracking', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  
  db.get(`
    SELECT order_number, phone_number, customer_name, tracking_id, delivery_address
    FROM orders 
    WHERE id = ?
  `, [orderId], async (err, order) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    
    if (!order) {
      return res.json({ success: false, message: 'Order not found' });
    }
    
    if (!order.tracking_id) {
      return res.json({ success: false, message: 'No tracking ID available' });
    }
    
    try {
      if (!client || !client.info) {
        return res.json({ success: false, message: 'WhatsApp not connected' });
      }
      
      const phoneNumber = order.phone_number.replace(/^0/, '94'); // Convert to international format
      const chatId = phoneNumber + '@c.us';
      
      const trackingMessage = `📦 *TRACKING INFORMATION*

Hello ${order.customer_name || 'Customer'},

Your order *${order.order_number}* is on the way! 🚚

*Tracking ID:* ${order.tracking_id}

${order.delivery_address ? `*Delivery Address:*\n${order.delivery_address}` : ''}

You can track your package using the tracking ID provided above.

Thank you for shopping with us! 🙏`;

      await client.sendMessage(chatId, trackingMessage);
      
      console.log(`[TRACKING-NOTIFICATION] Sent to ${order.phone_number} for order ${order.order_number}`);
      
      res.json({ success: true, message: 'Tracking info sent to customer' });
    } catch (error) {
      console.error(`[TRACKING-NOTIFICATION] Error: ${error.message}`);
      res.json({ success: false, message: 'Failed to send tracking info: ' + error.message });
    }
  });
});

// Send invoice to customer via WhatsApp
app.post('/api/ecommerce/orders/:id/send-invoice', requireAuth, async (req, res) => {
  const orderId = req.params.id;
  
  // Get order with items
  db.get(`
    SELECT order_number, phone_number, customer_name, total_amount, delivery_fee, 
           delivery_address, city, payment_method, payment_status, created_at
    FROM orders 
    WHERE id = ?
  `, [orderId], async (err, order) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    
    if (!order) {
      return res.json({ success: false, message: 'Order not found' });
    }
    
    // Get order items
    db.all(`
      SELECT product_name, quantity, price, subtotal
      FROM order_items
      WHERE order_id = ?
    `, [orderId], async (itemsErr, items) => {
      if (itemsErr) {
        return res.json({ success: false, message: itemsErr.message });
      }
      
      try {
        if (!client || !client.info) {
          return res.json({ success: false, message: 'WhatsApp not connected' });
        }
        
        const phoneNumber = order.phone_number.replace(/^0/, '94');
        const chatId = phoneNumber + '@c.us';
        
        // Build items list
        let itemsList = '';
        items.forEach((item, index) => {
          itemsList += `${index + 1}. ${item.product_name}\n   Qty: ${item.quantity} × Rs ${item.price.toFixed(2)} = Rs ${item.subtotal.toFixed(2)}\n\n`;
        });
        
        const subtotal = order.total_amount - order.delivery_fee;
        const orderDate = new Date(order.created_at).toLocaleDateString('en-US', { 
          year: 'numeric', month: 'short', day: 'numeric' 
        });
        
        const invoiceMessage = `🧾 *INVOICE*

Hello ${order.customer_name || 'Customer'},

Thank you for your order!

*Order #:* ${order.order_number}
*Date:* ${orderDate}
*Payment:* ${order.payment_method || 'COD'}
*Status:* ${order.payment_status || 'Pending'}

━━━━━━━━━━━━━━━━━
*ORDER ITEMS:*

${itemsList}━━━━━━━━━━━━━━━━━

*Subtotal:* Rs ${subtotal.toFixed(2)}
*Delivery:* Rs ${order.delivery_fee.toFixed(2)}
*TOTAL:* Rs ${order.total_amount.toFixed(2)}

${order.delivery_address ? `*Delivery Address:*\n${order.delivery_address}${order.city ? ', ' + order.city : ''}` : ''}

Thank you for shopping with us! 🙏

For any queries, feel free to contact us.`;

        await client.sendMessage(chatId, invoiceMessage);
        
        console.log(`[INVOICE-NOTIFICATION] Sent to ${order.phone_number} for order ${order.order_number}`);
        
        res.json({ success: true, message: 'Invoice sent to customer' });
      } catch (error) {
        console.error(`[INVOICE-NOTIFICATION] Error: ${error.message}`);
        res.json({ success: false, message: 'Failed to send invoice: ' + error.message });
      }
    });
  });
});

// Get store settings
app.get('/api/ecommerce/settings', requireAuth, (req, res) => {
  db.all('SELECT key, value FROM store_settings', [], (err, rows) => {
    if (err) {
      return res.json({ success: false, message: err.message });
    }
    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json({ success: true, settings });
  });
});

// Save store settings
app.post('/api/ecommerce/settings', requireAuth, (req, res) => {
  const settings = req.body;
  const updates = Object.keys(settings).map(key => {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT OR REPLACE INTO store_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `, [key, settings[key]], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
  
  Promise.all(updates)
    .then(() => res.json({ success: true }))
    .catch(err => res.json({ success: false, message: err.message }));
});

// Analytics API endpoint
app.get('/api/analytics', requireAuth, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - 7);
    const startOfMonth = new Date(today);
    startOfMonth.setDate(today.getDate() - 30);
    const startOfPeriod = new Date(today);
    startOfPeriod.setDate(today.getDate() - days);
    
    // Summary stats
    const todaySales = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as orders, COALESCE(SUM(total_amount), 0) as revenue
        FROM orders
        WHERE DATE(created_at) = DATE('now')
      `, [], (err, row) => err ? reject(err) : resolve(row));
    });
    
    const weeklySales = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as orders, COALESCE(SUM(total_amount), 0) as revenue
        FROM orders
        WHERE created_at >= datetime('now', '-7 days')
      `, [], (err, row) => err ? reject(err) : resolve(row));
    });
    
    const monthlySales = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as orders, COALESCE(SUM(total_amount), 0) as revenue
        FROM orders
        WHERE created_at >= datetime('now', '-30 days')
      `, [], (err, row) => err ? reject(err) : resolve(row));
    });
    
    const totalSales = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as orders, COALESCE(SUM(total_amount), 0) as revenue
        FROM orders
      `, [], (err, row) => err ? reject(err) : resolve(row));
    });
    
    // Daily sales for chart
    const dailySales = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as orders,
          COALESCE(SUM(total_amount), 0) as revenue
        FROM orders
        WHERE created_at >= datetime('now', '-${days} days')
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT ${days}
      `, [], (err, rows) => err ? reject(err) : resolve(rows || []));
    });
    
    // Order status distribution
    const orderStatus = await new Promise((resolve, reject) => {
      db.all(`
        SELECT status, COUNT(*) as count
        FROM orders
        WHERE created_at >= datetime('now', '-${days} days')
        GROUP BY status
        ORDER BY count DESC
      `, [], (err, rows) => err ? reject(err) : resolve(rows || []));
    });
    
    // Top products
    const topProducts = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          oi.product_name as name,
          p.category_id,
          c.name as category,
          SUM(oi.quantity) as quantity,
          SUM(oi.subtotal) as revenue
        FROM order_items oi
        LEFT JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE o.created_at >= datetime('now', '-${days} days')
        GROUP BY oi.product_name
        ORDER BY revenue DESC
        LIMIT 10
      `, [], (err, rows) => err ? reject(err) : resolve(rows || []));
    });
    
    // Recent sales
    const recentSales = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          order_number,
          customer_name,
          total_amount,
          status,
          created_at
        FROM orders
        ORDER BY created_at DESC
        LIMIT 10
      `, [], (err, rows) => err ? reject(err) : resolve(rows || []));
    });
    
    res.json({
      success: true,
      summary: {
        today: {
          revenue: todaySales.revenue || 0,
          orders: todaySales.orders || 0
        },
        weekly: {
          revenue: weeklySales.revenue || 0,
          orders: weeklySales.orders || 0
        },
        monthly: {
          revenue: monthlySales.revenue || 0,
          orders: monthlySales.orders || 0
        },
        total: {
          revenue: totalSales.revenue || 0,
          orders: totalSales.orders || 0
        }
      },
      dailySales: dailySales.reverse(), // Oldest to newest for chart
      orderStatus,
      topProducts,
      recentSales
    });
    
  } catch (error) {
    console.error('[ANALYTICS] Error:', error);
    res.json({ success: false, message: error.message });
  }
});

// Wallet balance endpoint (stub to prevent 404 errors)
app.get('/api/wallet/balance', (req, res) => {
  // Return stub data - wallet feature not fully implemented
  res.json({ 
    success: true, 
    balance: 0,
    currency: 'LKR',
    message: 'Wallet feature coming soon'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Start server - bind to 0.0.0.0 for Docker/cloud deployments
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`✅ WhatsApp Bot Server running on ${HOST}:${PORT}`);
  console.log(`🌐 Health check: http://${HOST}:${PORT}/health`);
  initializeClient();
});

// Handle server startup errors
server.on('error', (error) => {
  console.error('❌ Server failed to start:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  if (client && WHATSAPP_ENABLED) {
    try {
      await client.destroy();
    } catch (e) {
      console.log('Error destroying client:', e.message);
    }
  }
  db.close();
  process.exit(0);
});
