#!/bin/bash
# Cleanup script for preparing a fresh snapshot
# This removes all user data while keeping the application intact

echo "🧹 Starting cleanup for snapshot preparation..."
echo "================================================"

SCRIPT_DIR="/opt/wa-bots/demo"

# Stop service
echo "⏸️  Stopping service..."
systemctl stop wa-bot-demo 2>/dev/null || true

# 1. Clear WhatsApp session
echo "🗑️  Clearing WhatsApp session..."
rm -rf "$SCRIPT_DIR/wa-session/"*
rm -rf "$SCRIPT_DIR/.wwebjs_cache/"*
echo "   ✅ WhatsApp session cleared"

# 2. Clear database messages and user data
echo "🗑️  Clearing database messages and temporary data..."
sqlite3 "$SCRIPT_DIR/data/wa-bot.db" << 'EOF'
-- Clear messages
DELETE FROM messages;
-- Clear user sessions
DELETE FROM sessions;
-- Clear carts (if exists)
DELETE FROM carts WHERE 1=1;
-- Clear orders (keep structure)
DELETE FROM orders;
DELETE FROM order_items;
-- Reset auto-increment counters
DELETE FROM sqlite_sequence WHERE name IN ('messages', 'sessions', 'orders', 'order_items', 'carts');
-- Vacuum database to reclaim space
VACUUM;
EOF
echo "   ✅ Database messages and user data cleared"

# 3. Clear logs
echo "🗑️  Clearing logs..."
journalctl --rotate 2>/dev/null || true
journalctl --vacuum-time=1s 2>/dev/null || true
rm -f "$SCRIPT_DIR/server.log" 2>/dev/null || true
rm -f "$SCRIPT_DIR"/*.log 2>/dev/null || true
echo "   ✅ Logs cleared"

# 4. Clear temporary files
echo "🗑️  Clearing temporary files..."
rm -rf "$SCRIPT_DIR"/uploads/temp* 2>/dev/null || true
rm -rf /tmp/whatsapp-* 2>/dev/null || true
rm -rf /tmp/puppeteer-* 2>/dev/null || true
echo "   ✅ Temporary files cleared"

# 5. Clear bash history (optional)
echo "🗑️  Clearing bash history..."
cat /dev/null > ~/.bash_history
history -c
echo "   ✅ Bash history cleared"

# 6. Show what's kept
echo ""
echo "📦 What's KEPT (application files):"
echo "   ✅ Application code (server.js, etc.)"
echo "   ✅ Node modules"
echo "   ✅ Database structure (empty tables)"
echo "   ✅ Products and categories (if any)"
echo "   ✅ Auto-reply templates (if any)"
echo "   ✅ Settings"
echo ""
echo "🗑️  What's REMOVED:"
echo "   ❌ WhatsApp session (must scan QR again)"
echo "   ❌ All message history"
echo "   ❌ All user sessions"
echo "   ❌ All orders"
echo "   ❌ All carts"
echo "   ❌ System logs"
echo "   ❌ Temporary files"
echo ""

# 7. Check sizes
echo "📊 Current disk usage:"
du -sh "$SCRIPT_DIR" 2>/dev/null || true

echo ""
echo "================================================"
echo "✅ Cleanup complete! Ready for snapshot."
echo ""
echo "⚠️  IMPORTANT AFTER SNAPSHOT:"
echo "   1. New droplet will need WhatsApp QR scan"
echo "   2. All message history will be clean"
echo "   3. Service is currently STOPPED"
echo ""
echo "To start service now:"
echo "   systemctl start wa-bot-demo"
echo ""
