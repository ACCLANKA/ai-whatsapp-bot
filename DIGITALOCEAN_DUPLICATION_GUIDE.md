# DigitalOcean Server Duplication Guide

## Overview
This guide explains how to duplicate your WhatsApp Bot server on DigitalOcean for:
- Creating backups
- Deploying to multiple customers
- Testing new features
- Scaling your business

## Method 1: Using Snapshots (Recommended for Selling)

### Step 1: Create a Snapshot

#### Via DigitalOcean Dashboard
1. **Log in** to DigitalOcean (https://cloud.digitalocean.com)
2. **Navigate** to Droplets → Click your droplet (178.128.62.119)
3. **Click** "Snapshots" in the left sidebar
4. **Enter** snapshot name: `whatsapp-bot-v1.0-YYYYMMDD`
5. **Click** "Take Snapshot"
6. **Wait** 5-15 minutes for completion

#### Via DigitalOcean CLI (doctl)
```bash
# Install doctl if not already installed
snap install doctl
# or
brew install doctl

# Authenticate
doctl auth init

# List your droplets
doctl compute droplet list

# Create snapshot (replace DROPLET_ID with your droplet ID)
doctl compute droplet-action snapshot DROPLET_ID --snapshot-name "whatsapp-bot-v1.0"

# Check snapshot status
doctl compute snapshot list
```

### Step 2: Create New Droplet from Snapshot

#### Via Dashboard
1. **Click** "Create" → "Droplets"
2. **Choose** "Snapshots" tab
3. **Select** your snapshot
4. **Choose** plan (same or different size)
5. **Select** datacenter region
6. **Add** SSH keys (optional but recommended)
7. **Enter** hostname: `whatsapp-bot-customer1`
8. **Click** "Create Droplet"

#### Via CLI
```bash
# Create droplet from snapshot
doctl compute droplet create whatsapp-bot-customer1 \
  --image YOUR_SNAPSHOT_ID \
  --size s-1vcpu-1gb \
  --region sgp1 \
  --ssh-keys YOUR_SSH_KEY_ID

# Get new droplet IP
doctl compute droplet list
```

### Step 3: Configure New Server

```bash
# SSH into new server
ssh root@NEW_DROPLET_IP

# Update hostname
hostnamectl set-hostname whatsapp-bot-customer1

# Update environment variables
cd /opt/wa-bots/demo
nano .env

# Change these values for each customer:
# - CUSTOMER_SLUG=customer1
# - PORT=3011 (or different port)
# - Any customer-specific settings

# Clear WhatsApp session (important!)
rm -rf /opt/wa-bots/demo/wa-session/*

# Clear database (if starting fresh for customer)
rm /opt/wa-bots/demo/data/wa-bot.db

# Restart server
pkill -f "node.*server.js"
cd /opt/wa-bots/demo
nohup node server.js > /tmp/bot.log 2>&1 &

# Verify server is running
curl http://localhost:3011/health
```

---

## Method 2: Using DigitalOcean Images (For Multiple Deployments)

### Create Custom Image
1. **Power off** your droplet (optional but recommended)
2. **Go to** Droplets → Your Droplet → Snapshots
3. **Take snapshot** with descriptive name
4. **Convert to image** (automatic in DigitalOcean)

### Deploy from Image
- Same as Method 1, but images are available across all regions
- Faster deployment than snapshots
- Can be shared with team members

---

## Method 3: Manual Duplication (For Development)

### On Source Server
```bash
# Create archive of application
cd /opt/wa-bots
tar -czf whatsapp-bot-backup.tar.gz demo/

# Exclude node_modules and sessions
tar -czf whatsapp-bot-backup.tar.gz \
  --exclude='demo/node_modules' \
  --exclude='demo/wa-session' \
  --exclude='demo/data/*.db' \
  demo/

# Download to local machine
scp root@178.128.62.119:/opt/wa-bots/whatsapp-bot-backup.tar.gz .
```

### On New Server
```bash
# Upload archive
scp whatsapp-bot-backup.tar.gz root@NEW_SERVER_IP:/opt/wa-bots/

# Extract
cd /opt/wa-bots
tar -xzf whatsapp-bot-backup.tar.gz

# Install dependencies
cd demo
npm install

# Configure environment
cp .env.example .env
nano .env

# Start server
nohup node server.js > /tmp/bot.log 2>&1 &
```

---

## Pre-Duplication Checklist

### ✅ Before Creating Snapshot
- [ ] Stop the WhatsApp bot server
- [ ] Clear sensitive data from `.env` (or use `.env.example`)
- [ ] Remove customer-specific data from database
- [ ] Clear logs: `rm /tmp/bot.log`
- [ ] Clear WhatsApp session: `rm -rf /opt/wa-bots/demo/wa-session/*`
- [ ] Update documentation
- [ ] Test the server works after cleanup

### ✅ Clean Snapshot for Selling
```bash
# Stop server
pkill -f "node.*server.js"

# Clear WhatsApp session
rm -rf /opt/wa-bots/demo/wa-session/*

# Clear database (keep structure)
cd /opt/wa-bots/demo
sqlite3 data/wa-bot.db "DELETE FROM messages;"
sqlite3 data/wa-bot.db "DELETE FROM auto_replies;"
sqlite3 data/wa-bot.db "DELETE FROM orders;"
sqlite3 data/wa-bot.db "DELETE FROM shopping_cart;"
# Keep categories and products as demo data

# Clear logs
rm /tmp/bot.log
rm /opt/wa-bots/demo/nohup.out

# Remove sensitive environment variables
cd /opt/wa-bots/demo
cp .env .env.backup
cat > .env << 'EOF'
# WhatsApp Bot Configuration
PORT=3011
CUSTOMER_SLUG=demo

# Ollama AI Configuration
OLLAMA_HOST=http://localhost:11434
OLLAMA_CLOUD=false
OLLAMA_MODEL=llama2
OLLAMA_API_KEY=

# Session Configuration
SESSION_SECRET=change-this-secret-key-in-production
EOF

# Clear bash history (optional)
history -c
```

---

## Post-Duplication Configuration

### For Each New Customer Server

#### 1. Update Environment Variables
```bash
nano /opt/wa-bots/demo/.env
```
Change:
```env
CUSTOMER_SLUG=customer-name
PORT=3011
SESSION_SECRET=unique-secret-for-this-customer
OLLAMA_HOST=http://their-ollama-server:11434
```

#### 2. Update Database
```bash
cd /opt/wa-bots/demo
sqlite3 data/wa-bot.db

-- Update admin credentials
UPDATE admin_users SET username='admin', password='newpassword' WHERE id=1;

-- Update store settings
UPDATE store_settings SET value='Customer Store Name' WHERE key='store_name';

-- Exit
.quit
```

#### 3. Configure Firewall
```bash
# Allow port 3011
ufw allow 3011/tcp

# Check status
ufw status
```

#### 4. Set Up Domain (Optional)
```bash
# Install nginx
apt update
apt install nginx

# Configure reverse proxy
nano /etc/nginx/sites-available/whatsapp-bot

# Add configuration:
server {
    listen 80;
    server_name customer.yourdomain.com;

    location / {
        proxy_pass http://localhost:3011;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Enable site
ln -s /etc/nginx/sites-available/whatsapp-bot /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx

# Install SSL (optional)
apt install certbot python3-certbot-nginx
certbot --nginx -d customer.yourdomain.com
```

---

## Automation Script for Multiple Deployments

### Create Deployment Script
```bash
nano /opt/wa-bots/deploy-customer.sh
```

```bash
#!/bin/bash
# WhatsApp Bot Customer Deployment Script

CUSTOMER_NAME=$1
CUSTOMER_PORT=${2:-3011}

if [ -z "$CUSTOMER_NAME" ]; then
    echo "Usage: ./deploy-customer.sh <customer-name> [port]"
    exit 1
fi

echo "🚀 Deploying WhatsApp Bot for: $CUSTOMER_NAME"

# Update environment
cd /opt/wa-bots/demo
sed -i "s/CUSTOMER_SLUG=.*/CUSTOMER_SLUG=$CUSTOMER_NAME/" .env
sed -i "s/PORT=.*/PORT=$CUSTOMER_PORT/" .env

# Generate new session secret
NEW_SECRET=$(openssl rand -hex 32)
sed -i "s/SESSION_SECRET=.*/SESSION_SECRET=$NEW_SECRET/" .env

# Clear WhatsApp session
rm -rf wa-session/*

# Restart server
pkill -f "node.*server.js"
nohup node server.js > /tmp/bot-$CUSTOMER_NAME.log 2>&1 &

echo "✅ Deployment complete!"
echo "📱 Access at: http://$(hostname -I | awk '{print $1}'):$CUSTOMER_PORT"
echo "📋 Logs: tail -f /tmp/bot-$CUSTOMER_NAME.log"
```

```bash
# Make executable
chmod +x /opt/wa-bots/deploy-customer.sh

# Use it
./deploy-customer.sh customer1 3011
./deploy-customer.sh customer2 3012
```

---

## Cost Optimization

### Snapshot Pricing
- **First 25 GB**: Free
- **Additional storage**: $0.05/GB/month
- **Transfer**: Free within same datacenter

### Recommendations for Selling
1. **Create one master snapshot** with clean configuration
2. **Use smaller droplets** for customers with low traffic ($6-12/month)
3. **Scale up** as customer grows
4. **Use managed databases** for high-traffic customers

### Pricing Tiers
```
Basic: $6/month  - 1GB RAM, 1 vCPU  - Up to 100 messages/day
Pro:   $12/month - 2GB RAM, 1 vCPU  - Up to 1000 messages/day
Business: $24/month - 4GB RAM, 2 vCPU - Unlimited messages
```

---

## Monitoring Multiple Servers

### Simple Monitoring Script
```bash
#!/bin/bash
# Check all customer servers

SERVERS=(
    "178.128.62.119:3011:customer1"
    "178.128.62.120:3011:customer2"
    "178.128.62.121:3011:customer3"
)

for server in "${SERVERS[@]}"; do
    IFS=':' read -r ip port name <<< "$server"
    
    echo "Checking $name ($ip:$port)..."
    
    if curl -s --max-time 5 "http://$ip:$port/health" > /dev/null; then
        echo "✅ $name is UP"
    else
        echo "❌ $name is DOWN - Alert!"
        # Send notification here
    fi
done
```

---

## Backup Strategy for Multiple Servers

### Automated Backup Script
```bash
#!/bin/bash
# Backup all customer databases

BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d)

mkdir -p $BACKUP_DIR

# Backup each customer
for customer in /opt/wa-bots/*/; do
    CUSTOMER_NAME=$(basename $customer)
    
    # Backup database
    cp "$customer/data/wa-bot.db" \
       "$BACKUP_DIR/${CUSTOMER_NAME}-${DATE}.db"
    
    echo "✅ Backed up $CUSTOMER_NAME"
done

# Upload to DigitalOcean Spaces (S3-compatible)
# s3cmd put $BACKUP_DIR/*.db s3://your-bucket/backups/

# Clean old backups (keep 30 days)
find $BACKUP_DIR -name "*.db" -mtime +30 -delete
```

---

## Troubleshooting

### Snapshot Too Large
```bash
# Clean before snapshot
apt clean
apt autoremove
rm -rf /var/log/*.log
rm -rf /tmp/*
journalctl --vacuum-time=1d
```

### Droplet Won't Start from Snapshot
- Check DigitalOcean status page
- Try different datacenter region
- Verify snapshot completed successfully
- Contact DigitalOcean support

### Port Already in Use on New Server
```bash
# Check what's using the port
lsof -i :3011

# Kill the process
kill -9 PID

# Or use different port in .env
```

---

## Security Checklist for Each Deployment

- [ ] Change admin password
- [ ] Update SESSION_SECRET
- [ ] Configure firewall (ufw)
- [ ] Set up SSL certificate
- [ ] Disable root SSH login
- [ ] Enable automatic security updates
- [ ] Configure fail2ban
- [ ] Regular backup schedule

---

## Support & Resources

- **DigitalOcean Docs**: https://docs.digitalocean.com/products/droplets/how-to/create-snapshots/
- **API Reference**: https://docs.digitalocean.com/reference/api/
- **Community**: https://www.digitalocean.com/community/

---

**Last Updated:** November 23, 2025  
**Version:** 1.0
