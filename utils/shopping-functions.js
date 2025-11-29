// AI Shopping Functions for E-Commerce
// Natural language shopping via WhatsApp

// Database instance will be passed from server.js
let sharedDb = null;
let sharedIo = null;
let serverBaseUrl = null;

// Set the server base URL for image URLs
function setServerBaseUrl(baseUrl) {
  serverBaseUrl = baseUrl;
  console.log('[SHOPPING] Server base URL set to:', baseUrl);
}

// Helper function to get server base URL dynamically
function getServerBaseUrl() {
  if (serverBaseUrl) {
    return serverBaseUrl;
  }
  // Fallback: detect server's external IP
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let serverIP = '127.0.0.1';
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        serverIP = iface.address;
        break;
      }
    }
  }
  const port = process.env.PORT || 3011;
  return `http://${serverIP}:${port}`;
}

// Helper function to convert relative image URLs to absolute URLs
function makeImageUrlAbsolute(imageUrl) {
  if (!imageUrl) return imageUrl;
  // If already absolute URL, return as-is
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  // Convert relative path to absolute URL
  const baseUrl = getServerBaseUrl();
  const path = imageUrl.startsWith('/') ? imageUrl : '/' + imageUrl;
  return baseUrl + path;
}

// Process product(s) to convert image URLs
function processProductImageUrls(products) {
  if (Array.isArray(products)) {
    return products.map(p => {
      if (p && p.image_url) {
        p.image_url = makeImageUrlAbsolute(p.image_url);
      }
      return p;
    });
  } else if (products && products.image_url) {
    products.image_url = makeImageUrlAbsolute(products.image_url);
  }
  return products;
}

// Set the shared database instance
function setDatabase(db) {
  sharedDb = db;
  console.log('[SHOPPING] Using shared database instance');
}

// Set the shared socket.io instance
function setSocketIO(io) {
  sharedIo = io;
  console.log('[SHOPPING] Using shared socket.io instance');
}

// Get database instance
function getDb() {
  if (!sharedDb) {
    throw new Error('Database not initialized. Call setDatabase() first.');
  }
  return sharedDb;
}

// Get socket.io instance
function getIo() {
  return sharedIo; // Can be null if not initialized
}

/**
 * Browse Categories
 * Shows all available product categories
 */
function browseCategories(customerSlug) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    db.all(
      `SELECT c.id, c.name, c.description, c.icon, COUNT(p.id) as product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.status = 'active'
       WHERE c.active = 1
       GROUP BY c.id
       ORDER BY c.sort_order`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

/**
 * Search Products
 * Search products by name, category, or description
 */
function searchProducts(customerSlug, searchTerm) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    db.all(
      `SELECT p.id, p.name, p.description, p.price, p.image_url, p.stock_quantity,
              c.name as category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.status = 'active' 
       AND (p.name LIKE ? OR p.description LIKE ? OR c.name LIKE ?)
       ORDER BY p.name
       LIMIT 10`,
      [`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`],
      (err, rows) => {
        if (err) reject(err);
        else resolve(processProductImageUrls(rows || []));
      }
    );
  });
}

/**
 * Get Products by Category
 * List all products in a specific category
 */
function getProductsByCategory(customerSlug, categoryId) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    db.all(
      `SELECT p.id, p.name, p.description, p.price, p.image_url, p.stock_quantity
       FROM products p
       WHERE p.category_id = ? AND p.status = 'active'
       ORDER BY p.name`,
      [categoryId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(processProductImageUrls(rows || []));
      }
    );
  });
}

/**
 * Get Product Details
 * Get detailed information about a specific product
 */
function getProductDetails(customerSlug, productId) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    db.get(
      `SELECT p.*, c.name as category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = ?`,
      [productId],
      (err, row) => {
        if (err) reject(err);
        else resolve(processProductImageUrls(row || null));
      }
    );
  });
}

/**
 * Add to Cart
 * Add a product to customer's shopping cart
 */
function addToCart(customerSlug, phoneNumber, productId, quantity = 1) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    // First check if product exists and has stock
    db.get(
      'SELECT id, name, price, stock_quantity FROM products WHERE id = ? AND status = "active"',
      [productId],
      (err, product) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (!product) {
          resolve({ success: false, message: 'Product not found' });
          return;
        }
        
        if (product.stock_quantity < quantity) {
          resolve({ success: false, message: 'Insufficient stock' });
          return;
        }
        
        // Check if already in cart
        db.get(
          'SELECT id, quantity FROM shopping_cart WHERE phone_number = ? AND product_id = ?',
          [phoneNumber, productId],
          (err, cartItem) => {
            if (err) {
              reject(err);
              return;
            }
            
            if (cartItem) {
              // Update quantity
              db.run(
                'UPDATE shopping_cart SET quantity = quantity + ? WHERE id = ?',
                [quantity, cartItem.id],
                (err) => {
                  if (err) reject(err);
                  else resolve({
                    success: true,
                    message: `Updated ${product.name} quantity in cart`,
                    product: product
                  });
                }
              );
            } else {
              // Add new item
              db.run(
                'INSERT INTO shopping_cart (phone_number, product_id, quantity) VALUES (?, ?, ?)',
                [phoneNumber, productId, quantity],
                (err) => {
                  if (err) reject(err);
                  else resolve({
                    success: true,
                    message: `Added ${product.name} to cart`,
                    product: product
                  });
                }
              );
            }
          }
        );
      }
    );
  });
}

/**
 * View Cart
 * Get all items in customer's shopping cart
 */
function viewCart(customerSlug, phoneNumber) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    db.all(
      `SELECT c.id, c.quantity, p.id as product_id, p.name, p.price, p.image_url,
              (c.quantity * p.price) as subtotal
       FROM shopping_cart c
       JOIN products p ON p.id = c.product_id
       WHERE c.phone_number = ?
       ORDER BY c.created_at DESC`,
      [phoneNumber],
      (err, items) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Calculate totals
        const subtotal = items.reduce((sum, item) => sum + parseFloat(item.subtotal), 0);
        
        // Get delivery fee from settings
        db.get(
          'SELECT value FROM store_settings WHERE key = "delivery_fee"',
          [],
          (err, setting) => {
            const deliveryFee = setting ? parseFloat(setting.value) : 500;
            
            // Check free delivery threshold
            db.get(
              'SELECT value FROM store_settings WHERE key = "free_delivery_above"',
              [],
              (err, freeDeliverySetting) => {
                
                const freeDeliveryAbove = freeDeliverySetting ? parseFloat(freeDeliverySetting.value) : 10000;
                const finalDeliveryFee = subtotal >= freeDeliveryAbove ? 0 : deliveryFee;
                const total = subtotal + finalDeliveryFee;
                
                resolve({
                  items: items,
                  subtotal: subtotal,
                  deliveryFee: finalDeliveryFee,
                  total: total,
                  itemCount: items.length
                });
              }
            );
          }
        );
      }
    );
  });
}

/**
 * Remove from Cart
 * Remove an item from shopping cart
 */
function removeFromCart(customerSlug, phoneNumber, cartItemId) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    db.run(
      'DELETE FROM shopping_cart WHERE id = ? AND phone_number = ?',
      [cartItemId, phoneNumber],
      (err) => {
        if (err) reject(err);
        else resolve({ success: true, message: 'Item removed from cart' });
      }
    );
  });
}

/**
 * Clear Cart
 * Remove all items from shopping cart
 */
function clearCart(customerSlug, phoneNumber) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    db.run(
      'DELETE FROM shopping_cart WHERE phone_number = ?',
      [phoneNumber],
      (err) => {
        if (err) reject(err);
        else resolve({ success: true, message: 'Cart cleared' });
      }
    );
  });
}

/**
 * Checkout
 * Create order from cart items
 */
function checkout(customerSlug, phoneNumber, customerInfo) {
  return new Promise(async (resolve, reject) => {
    const db = getDb();
    
    try {
      // Get cart items
      const cart = await viewCart(customerSlug, phoneNumber);
      
      if (cart.items.length === 0) {
        resolve({ success: false, message: 'Cart is empty' });
        return;
      }
      
      // Generate order number
      const orderNumber = 'ORD-' + Date.now();
      
      // Create order
      db.run(
        `INSERT INTO orders (order_number, phone_number, customer_name, delivery_address, 
         city, total_amount, delivery_fee, status, payment_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [
          orderNumber,
          phoneNumber,
          customerInfo.name || '',
          customerInfo.address || '',
          customerInfo.city || '',
          cart.total,
          cart.deliveryFee,
          customerInfo.paymentMethod || 'Cash on Delivery'
        ],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          
          const orderId = this.lastID;
          
          // Add order items
          const stmt = db.prepare(
            'INSERT INTO order_items (order_id, product_id, product_name, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?, ?)'
          );
          
          cart.items.forEach(item => {
            stmt.run(orderId, item.product_id, item.name, item.quantity, item.price, item.subtotal);
          });
          
          stmt.finalize();
          
          // Update product stock
          cart.items.forEach(item => {
            db.run('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?', [item.quantity, item.product_id]);
          });
          
          // Clear cart
          db.run('DELETE FROM shopping_cart WHERE phone_number = ?', [phoneNumber]);
          
          // Update or create member record
          db.run(
            `INSERT INTO registered_members (phone_number, name, address, city, total_orders, total_spent, last_order_at)
             VALUES (?, ?, ?, ?, 1, ?, datetime('now'))
             ON CONFLICT(phone_number) DO UPDATE SET
             name = COALESCE(?, name),
             address = COALESCE(?, address),
             city = COALESCE(?, city),
             total_orders = total_orders + 1,
             total_spent = total_spent + ?,
             last_order_at = datetime('now')`,
            [
              phoneNumber, customerInfo.name, customerInfo.address, customerInfo.city, cart.total,
              customerInfo.name, customerInfo.address, customerInfo.city, cart.total
            ],
            () => {
              // Emit real-time event to dashboard
              const io = getIo();
              if (io) {
                io.emit('newOrder', {
                  id: orderId,
                  orderNumber: orderNumber,
                  phoneNumber: phoneNumber,
                  customerName: customerInfo.name || '',
                  totalAmount: cart.total,
                  deliveryFee: cart.deliveryFee,
                  status: 'pending',
                  paymentMethod: customerInfo.paymentMethod || 'Cash on Delivery',
                  createdAt: new Date().toISOString()
                });
                console.log(`[SHOPPING] New order event emitted: ${orderNumber}`);
              }
              
              resolve({
                success: true,
                orderNumber: orderNumber,
                orderId: orderId,
                total: cart.total,
                items: cart.items
              });
            }
          );
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Track Order
 * Get order status and details
 */
function trackOrder(customerSlug, orderNumber) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    db.get(
      `SELECT o.*, 
              (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
       FROM orders o
       WHERE o.order_number = ?`,
      [orderNumber],
      (err, order) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (!order) {
          resolve(null);
          return;
        }
        
        // Get order items
        db.all(
          'SELECT * FROM order_items WHERE order_id = ?',
          [order.id],
          (err, items) => {
            if (err) reject(err);
            else resolve({ ...order, items: items });
          }
        );
      }
    );
  });
}

/**
 * Get Customer Orders
 * Get all orders for a customer
 */
function getCustomerOrders(customerSlug, phoneNumber) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    db.all(
      `SELECT order_number, total_amount, status, created_at,
              (SELECT COUNT(*) FROM order_items WHERE order_id = orders.id) as item_count
       FROM orders
       WHERE phone_number = ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [phoneNumber],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

module.exports = {
  browseCategories,
  searchProducts,
  getProductsByCategory,
  getProductDetails,
  addToCart,
  viewCart,
  removeFromCart,
  clearCart,
  checkout,
  trackOrder,
  getCustomerOrders,
  setDatabase,
  setSocketIO,
  setServerBaseUrl
};
