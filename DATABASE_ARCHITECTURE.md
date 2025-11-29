# Database Architecture - Production Ready

## Overview
This WhatsApp bot uses a **single, centralized SQLite database** for all operations. This ensures data consistency and eliminates synchronization issues.

## Database Location
```
/opt/wa-bots/demo/data/wa-bot.db
```

## Architecture Principles

### ✅ Single Database Instance
- **One database file** for all operations
- **Shared across all modules** (server, shopping functions, AI functions)
- **No duplicate databases** or separate instances

### ✅ Dependency Injection Pattern
All modules receive the database instance from `server.js`:
```javascript
// In server.js
const shoppingFunctions = require('./utils/shopping-functions');
const AIFunctions = require('./utils/ai-functions');

shoppingFunctions.setDatabase(db);
AIFunctions.setDatabase(db);
```

### ✅ No Database Closing
Since we use a shared instance:
- Database connections stay open for the lifetime of the application
- No `db.close()` calls in utility functions
- Graceful shutdown handled in `server.js`

## Database Tables

### Core Tables
1. **auto_replies** - Keyword-based automatic responses
2. **messages** - Message history and logs
3. **settings** - Bot configuration settings
4. **admin_users** - Dashboard authentication (optional)

### E-Commerce Tables
5. **categories** - Product categories
6. **products** - Product catalog
7. **orders** - Customer orders
8. **shopping_cart** - Active shopping carts
9. **store_settings** - Store configuration

### User Management Tables
10. **user_courses** - User enrolled courses (if using LMS)
11. **user_orders** - User order history
12. **user_profiles** - Customer profiles
13. **user_payments** - Payment records

## Module Structure

### server.js (Main)
- Creates and initializes the database
- Passes database instance to all modules
- Handles graceful shutdown

### utils/shopping-functions.js
- Receives database via `setDatabase(db)`
- Handles e-commerce operations
- No database creation

### utils/ai-functions.js
- Receives database via `setDatabase(db)`
- Handles AI function calls
- No database creation

## Production Deployment Checklist

### ✅ Database Setup
- [x] Single database file location
- [x] Proper file permissions (readable/writable by Node.js process)
- [x] Backup strategy in place
- [x] Database initialization on first run

### ✅ Code Quality
- [x] No hardcoded database paths in utility modules
- [x] Dependency injection for database instance
- [x] Error handling for database operations
- [x] No database connection leaks

### ✅ Performance
- [x] Database indexes on frequently queried columns
- [x] Connection pooling not needed (SQLite is file-based)
- [x] Prepared statements for security

## Backup Strategy

### Recommended Backup Schedule
```bash
# Daily backup
0 2 * * * cp /opt/wa-bots/demo/data/wa-bot.db /opt/wa-bots/demo/backups/wa-bot-$(date +\%Y\%m\%d).db

# Keep last 30 days
0 3 * * * find /opt/wa-bots/demo/backups/ -name "wa-bot-*.db" -mtime +30 -delete
```

### Manual Backup
```bash
# Stop the server first (optional but recommended)
pkill -f "node.*server.js"

# Copy database
cp /opt/wa-bots/demo/data/wa-bot.db /path/to/backup/wa-bot-backup.db

# Restart server
cd /opt/wa-bots/demo && nohup node server.js > /tmp/bot.log 2>&1 &
```

## Migration Guide

### From Multiple Databases to Single Database
If you have existing data in multiple database files:

1. **Identify all database files**
   ```bash
   find /opt/wa-bots -name "*.db" -type f
   ```

2. **Export data from old databases**
   ```bash
   sqlite3 old-database.db .dump > data-export.sql
   ```

3. **Import into main database**
   ```bash
   sqlite3 /opt/wa-bots/demo/data/wa-bot.db < data-export.sql
   ```

4. **Verify data**
   ```bash
   sqlite3 /opt/wa-bots/demo/data/wa-bot.db "SELECT COUNT(*) FROM categories;"
   ```

## Troubleshooting

### Issue: "Database not initialized" Error
**Solution:** Ensure `setDatabase()` is called before any database operations
```javascript
// In server.js, after db initialization
shoppingFunctions.setDatabase(db);
AIFunctions.setDatabase(db);
```

### Issue: Different data in dashboard vs WhatsApp
**Solution:** This was caused by multiple database instances. Now fixed with single database.

### Issue: Database locked
**Solution:** SQLite locks on write. Ensure only one process accesses the database.
```bash
# Check for multiple server instances
ps aux | grep "node.*server.js"

# Kill duplicates
pkill -f "node.*server.js"
```

## Security Considerations

### File Permissions
```bash
# Set proper permissions
chmod 600 /opt/wa-bots/demo/data/wa-bot.db
chown nodeuser:nodeuser /opt/wa-bots/demo/data/wa-bot.db
```

### SQL Injection Prevention
- ✅ All queries use parameterized statements
- ✅ No string concatenation in SQL queries
- ✅ Input validation on all user inputs

### Authentication
- Dashboard can be protected with `requireAuth` middleware
- Default: Authentication disabled for ease of use
- Production: Enable authentication in `server.js`

## Monitoring

### Database Size
```bash
# Check database size
ls -lh /opt/wa-bots/demo/data/wa-bot.db

# Check table sizes
sqlite3 /opt/wa-bots/demo/data/wa-bot.db "SELECT name, COUNT(*) FROM sqlite_master WHERE type='table' GROUP BY name;"
```

### Performance Metrics
```bash
# Check database integrity
sqlite3 /opt/wa-bots/demo/data/wa-bot.db "PRAGMA integrity_check;"

# Optimize database
sqlite3 /opt/wa-bots/demo/data/wa-bot.db "VACUUM;"
```

## Support

For issues or questions:
1. Check this documentation
2. Review server logs: `tail -f /tmp/bot.log`
3. Verify database: `sqlite3 /opt/wa-bots/demo/data/wa-bot.db`

---

**Last Updated:** November 23, 2025  
**Version:** 1.0 (Production Ready)
