const axios = require('axios');

class OllamaAI {
  constructor(customSystemPrompt = null) {
    this.host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    this.apiKey = process.env.OLLAMA_API_KEY;
    this.model = process.env.OLLAMA_MODEL || 'qwen2.5-coder:32b';
    this.useCloud = process.env.OLLAMA_CLOUD === 'true';
    
    // Default system prompt
    this.defaultSystemPrompt = `You are a helpful customer service assistant for KCC Lanka. 
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
    
    // Use custom prompt if provided, otherwise use default
    this.systemPrompt = customSystemPrompt || this.defaultSystemPrompt;
  }
  
  // Method to update system prompt dynamically
  setSystemPrompt(newPrompt) {
    this.systemPrompt = newPrompt || this.defaultSystemPrompt;
  }
  
  // Method to get current system prompt
  getSystemPrompt() {
    return this.systemPrompt;
  }
  
  // Method to get default system prompt
  getDefaultSystemPrompt() {
    return this.defaultSystemPrompt;
  }

  async generateResponse(userMessage, conversationHistory = []) {
    try {
      // Build prompt with context
      let prompt = this.systemPrompt + '\n\n';
      
      // Add conversation history (last 10 messages for better context)
      if (conversationHistory.length > 0) {
        const recentHistory = conversationHistory.slice(-10);
        recentHistory.forEach(msg => {
          const speaker = msg.is_from_me ? 'Assistant' : 'User';
          prompt += `${speaker}: ${msg.message}\n`;
        });
      }
      
      // Add current message
      prompt += `User: ${userMessage}\nAssistant:`;

      // Call Ollama API
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
      };
      
      // Add API key for cloud models
      if (this.useCloud && this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await axios.post(
        `${this.host}/api/generate`,
        {
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 1000,
            top_p: 0.9
          }
        },
        {
          headers: headers,
          timeout: 60000
        }
      );

      // Log the response for debugging
      console.log('[OLLAMA] API Response:', JSON.stringify(response.data).substring(0, 200));

      if (response.data && response.data.response && response.data.response.trim()) {
        return {
          success: true,
          message: response.data.response.trim()
        };
      } else {
        // Empty response - likely model issue, return friendly error
        console.error('[OLLAMA] Empty response from model. Thinking field exists:', !!response.data?.thinking);
        throw new Error('Model returned empty response');
      }
    } catch (error) {
      console.error('Ollama API Error:', error.message);
      if (error.response) {
        console.error('[OLLAMA] Response status:', error.response.status);
        console.error('[OLLAMA] Response data:', JSON.stringify(error.response.data).substring(0, 200));
      }
      
      // Return fallback message
      return {
        success: false,
        message: 'I apologize, but I\'m having trouble processing your request right now. Please try again or contact our support team.',
        error: error.message
      };
    }
  }

  async listAvailableModels() {
    try {
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
      };
      
      if (this.useCloud && this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      
      const response = await axios.get(`${this.host}/api/tags`, { headers });
      return {
        success: true,
        models: response.data.models || []
      };
    } catch (error) {
      console.error('Failed to list models:', error.message);
      return {
        success: false,
        models: [],
        error: error.message
      };
    }
  }

  async testConnection() {
    try {
      // Test if Ollama server is responding
      const response = await axios.get(`${this.host}/api/version`, { timeout: 5000 });
      
      if (response.data) {
        return {
          success: true,
          message: 'Ollama connected successfully',
          version: response.data.version,
          model: this.model,
          cloud: this.useCloud
        };
      }
      
      throw new Error('No response from Ollama');
    } catch (error) {
      return {
        success: false,
        message: 'Failed to connect to Ollama',
        error: error.message
      };
    }
  }
}

module.exports = OllamaAI;
