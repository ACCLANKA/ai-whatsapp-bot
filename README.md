# AI WhatsApp Bot

A powerful WhatsApp bot with AI-powered responses, e-commerce functionality, and admin management via chat.

## Features

### 🤖 AI-Powered Chat
- Natural language processing using Ollama AI (DeepSeek, Llama, etc.)
- Context-aware conversations with history
- Customizable system prompts

### 🛒 E-Commerce Integration
- Product catalog browsing via chat
- Shopping cart management
- Order placement and tracking
- Product search by name/category
- Automatic product image sending

### 👨‍💼 Admin Features (via WhatsApp)
- Create categories
- Add/update products
- Upload product images by sending photos
- Manage inventory
- All admin functions accessible from registered phone number

### 📊 Web Dashboard
- Real-time message monitoring
- WhatsApp connection status with QR code
- Product and category management
- Order management
- Settings configuration

## Tech Stack

- **Backend**: Node.js, Express.js
- **WhatsApp**: whatsapp-web.js
- **AI**: Ollama (local LLM)
- **Database**: SQLite
- **Real-time**: Socket.IO
- **Frontend**: HTML, CSS, JavaScript

## Installation

### Prerequisites
- Node.js 18+ 
- Ollama installed with a model (e.g., `deepseek-v3.1:671b`)
- A WhatsApp account for the bot

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/ai-whatsapp-bot.git
   cd ai-whatsapp-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create environment file**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your settings:
   ```env
   PORT=3011
   OLLAMA_HOST=http://localhost:11434
   OLLAMA_MODEL=deepseek-v3.1:671b
   ```

4. **Start the server**
   ```bash
   npm start
   ```

5. **Scan QR Code**
   - Open `http://YOUR_SERVER_IP:3011` in browser
   - Scan the QR code with WhatsApp (Settings → Linked Devices)

## Configuration

### Admin Phone Number
Set your admin phone number in the dashboard settings to enable admin features via WhatsApp chat.

### AI Model
Configure your preferred Ollama model in the dashboard or `.env` file.

## Usage

### Customer Commands (via WhatsApp)
- "Show me products" - Browse catalog
- "Search for watches" - Search products
- "Add to cart" - Add items
- "View cart" - See cart contents
- "Checkout" - Place order
- "Track order ORD-XXXX" - Track order status

### Admin Commands (via WhatsApp from admin number)
- "Create category Electronics" - Create new category
- "Add product iPhone in category 1, price 150000, stock 10" - Add product
- Send image with caption "Product ID 3" - Update product image

## Deployment

### Systemd Service (Linux)
```bash
sudo cp wa-bot.service /etc/systemd/system/
sudo systemctl enable wa-bot
sudo systemctl start wa-bot
```

### Docker (Coming Soon)
Docker support is planned for future releases.

## Project Structure

```
├── server.js           # Main server file
├── package.json        # Dependencies
├── public/             # Frontend files
│   ├── dashboard.html  # Main dashboard
│   ├── css/           # Stylesheets
│   └── js/            # Frontend JavaScript
├── utils/              # Utility modules
│   ├── ai-functions.js    # AI function calling
│   ├── shopping-functions.js  # E-commerce logic
│   └── ollama.js      # Ollama AI integration
├── data/               # SQLite database (gitignored)
├── uploads/            # User uploads (gitignored)
└── wa-session/         # WhatsApp session (gitignored)
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | WhatsApp connection status |
| `/api/qr` | GET | Get QR code for login |
| `/api/messages` | GET | Get message history |
| `/api/settings` | GET/POST | Manage settings |
| `/api/ecommerce/products` | GET/POST | Product management |
| `/api/ecommerce/categories` | GET/POST | Category management |
| `/api/ecommerce/orders` | GET | Order management |

## Security Notes

⚠️ **Important**: Never commit these files:
- `.env` - Contains secrets
- `wa-session/` - Contains WhatsApp auth tokens
- `data/*.db` - Contains user data

## License

MIT License - See [LICENSE](LICENSE) file

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

For issues and feature requests, please use the GitHub Issues page.
