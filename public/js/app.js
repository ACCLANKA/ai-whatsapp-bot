// WhatsApp Bot Manager - Frontend App

// Get base path dynamically (e.g., /abc-company/)
const pathParts = window.location.pathname.split('/').filter(p => p);
const basePath = pathParts.length > 0 && pathParts[0] !== 'dashboard.html' ? '/' + pathParts[0] + '/' : '/';
const API_BASE = basePath.replace(/\/$/, '') || ''; // e.g., /abc-company or empty for root
const SOCKET_BASE = basePath;
let socket;
let currentEditId = null;
let allReplies = [];
let visibleRepliesCount = 6;

// Expose API_BASE globally for ecommerce.js
window.API_BASE = API_BASE;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializeSocket();
  initializeTabs();
  loadAutoReplies();
  loadMessages();
  loadSettings();
  loadModels(); // Load Ollama models on page load
  
  // Set up QR tab auto-refresh
  setupQRTabRefresh();
});

// Socket.IO Connection
function initializeSocket() {
  console.log('Connecting to Socket.IO at:', SOCKET_BASE);
  console.log('Base path:', basePath);
  console.log('API base:', API_BASE);
  
  // Connect to Socket.IO with explicit path
  const socketPath = basePath === '/' ? '/socket.io/' : basePath + 'socket.io/';
  socket = io({
    path: socketPath
  });

  socket.on('connect', () => {
    console.log('Socket connected');
    updateConnectionStatus('connected', 'Connected');
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
    updateConnectionStatus('disconnected', 'Disconnected');
  });

  socket.on('status', (data) => {
    handleStatus(data);
  });

  socket.on('qr', (qrData) => {
    showQRCode(qrData);
  });

  socket.on('authenticated', () => {
    showToast('Authenticated successfully!', 'success');
  });

  socket.on('ready', (clientInfo) => {
    hideQRCode();
    showConnected(clientInfo);
    updateConnectionStatus('connected', 'Connected');
    showToast('WhatsApp connected successfully!', 'success');
  });

  socket.on('disconnected', (reason) => {
    hideConnected();
    updateConnectionStatus('disconnected', 'Disconnected');
    showToast(`WhatsApp disconnected: ${reason}`, 'error');
  });

  socket.on('auth_failure', (msg) => {
    showToast(`Authentication failed: ${msg}`, 'error');
  });

  socket.on('message', (data) => {
    handleIncomingMessage(data);
  });

  socket.on('message_sent', (data) => {
    if (data.success) {
      showToast('Message sent successfully!', 'success');
      document.getElementById('sendNumber').value = '';
      document.getElementById('sendMessage').value = '';
    }
  });

  socket.on('error', (error) => {
    showToast(`Error: ${error}`, 'error');
  });
}

// Update connection status
function updateConnectionStatus(status, text) {
  const statusBadge = document.getElementById('connectionStatus');
  statusBadge.className = `status-badge ${status}`;
  const statusText = document.getElementById('statusText');
  if (statusText) {
    statusText.textContent = text;
  }
}

// Handle initial status
function handleStatus(data) {
  if (data.qrCode) {
    showQRCode(data.qrCode);
  } else if (data.isReady && data.clientInfo) {
    showConnected(data.clientInfo);
  }
}

// Show QR Code
function showQRCode(qrData) {
  document.getElementById('qrSection').style.display = 'block';
  document.getElementById('connectedSection').style.display = 'none';
  document.getElementById('qrCode').src = qrData;
}

// Hide QR Code
function hideQRCode() {
  document.getElementById('qrSection').style.display = 'none';
}

// Show connected status
function showConnected(clientInfo) {
  const qrSection = document.getElementById('qrSection');
  if (qrSection) qrSection.style.display = 'none';
  
  const infoText = clientInfo.pushname 
    ? `${clientInfo.pushname} (+${clientInfo.user})`
    : `+${clientInfo.user}`;
  
  // Update status text in header
  updateConnectionStatus('connected', `Connected (${infoText})`);
}

// Hide connected status
function hideConnected() {
  // Just update the status badge
  updateConnectionStatus('disconnected', 'Disconnected');
}

// Disconnect bot
function disconnectBot() {
  if (confirm('Are you sure you want to disconnect WhatsApp?')) {
    socket.emit('disconnect_whatsapp');
    showToast('Disconnecting...', 'success');
  }
}

// Reconnect bot
function reconnectBot() {
  socket.emit('reconnect_whatsapp');
  showToast('Reconnecting...', 'success');
}

// Tabs functionality
function initializeTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      
      // Update buttons
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update content
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(`${tabName}-tab`).classList.add('active');
      
      // Load e-commerce data if e-commerce tab is activated
      if (window.loadEcommerceTab) {
        window.loadEcommerceTab(tabName);
      }
      
      // Load analytics data if analytics tab is activated
      if (tabName === 'analytics' && window.loadAnalytics) {
        window.loadAnalytics();
      }
      
      // Load backup data if backup tab is activated
      if (tabName === 'backup' && window.loadBackupTab) {
        window.loadBackupTab();
      }
    });
  });
}

// Switch to specific tab (called from header buttons)
function switchToTab(tabName) {
  // Update buttons
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const targetBtn = document.querySelector(`[data-tab="${tabName}"]`);
  if (targetBtn) {
    targetBtn.classList.add('active');
  }
  
  // Update content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  const targetTab = document.getElementById(`${tabName}-tab`);
  if (targetTab) {
    targetTab.classList.add('active');
  }
  
  // Load e-commerce data if needed
  if (window.loadEcommerceTab) {
    window.loadEcommerceTab(tabName);
  }
  
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Load auto-replies
async function loadAutoReplies() {
  try {
    const response = await fetch(`${API_BASE}/api/auto-replies`);
    const data = await response.json();
    
    if (data.success) {
      displayAutoReplies(data.data);
      updateStats();
    }
  } catch (error) {
    console.error('Load auto-replies error:', error);
    showToast('Failed to load auto-replies', 'error');
  }
}

// Display auto-replies
function displayAutoReplies(replies) {
  allReplies = replies;
  const container = document.getElementById('repliesList');
  const loadMoreBtn = document.getElementById('loadMoreContainer');
  
  if (replies.length === 0) {
    container.innerHTML = '<p class="loading">No auto-replies configured yet.</p>';
    loadMoreBtn.style.display = 'none';
    return;
  }
  
  const visibleReplies = replies.slice(0, visibleRepliesCount);
  
  container.innerHTML = visibleReplies.map(reply => `
    <div class="reply-card">
      <div class="reply-content">
        <span class="reply-keyword">${reply.keyword}</span>
        <p class="reply-text">${reply.response}</p>
        <div class="reply-meta">
          Created: ${new Date(reply.created_at).toLocaleDateString()}
        </div>
      </div>
      <div class="reply-actions">
        <button 
          class="btn-icon btn-toggle ${reply.is_active ? 'active' : ''}" 
          onclick="toggleReply(${reply.id}, ${reply.is_active})"
          title="${reply.is_active ? 'Deactivate' : 'Activate'}"
        >
          ${reply.is_active ? '✓' : '○'}
        </button>
        <button 
          class="btn-icon btn-edit" 
          onclick="editReply(${reply.id}, '${reply.keyword.replace(/'/g, "\\'")}', '${reply.response.replace(/'/g, "\\'")}')"
          title="Edit"
        >
          ✏️
        </button>
        <button 
          class="btn-icon btn-delete" 
          onclick="deleteReply(${reply.id})"
          title="Delete"
        >
          🗑️
        </button>
      </div>
    </div>
  `).join('');
  
  // Show/hide load more button
  if (replies.length > visibleRepliesCount) {
    loadMoreBtn.style.display = 'block';
  } else {
    loadMoreBtn.style.display = 'none';
  }
  
  // Update stats
  const activeCount = replies.filter(r => r.is_active).length;
  document.getElementById('autoRepliesCount').textContent = replies.length;
  document.getElementById('activeReplies').textContent = activeCount;
}

// Load more replies
function loadMoreReplies() {
  visibleRepliesCount += 6;
  displayAutoReplies(allReplies);
}

// Show add reply modal
function showAddReplyModal() {
  currentEditId = null;
  document.getElementById('modalTitle').textContent = 'Add Auto-Reply';
  document.getElementById('keyword').value = '';
  document.getElementById('response').value = '';
  document.getElementById('replyModal').classList.add('active');
}

// Edit reply
function editReply(id, keyword, response) {
  currentEditId = id;
  document.getElementById('modalTitle').textContent = 'Edit Auto-Reply';
  document.getElementById('keyword').value = keyword;
  document.getElementById('response').value = response;
  document.getElementById('replyModal').classList.add('active');
}

// Close reply modal
function closeReplyModal() {
  document.getElementById('replyModal').classList.remove('active');
  currentEditId = null;
}

// Save reply
async function saveReply() {
  const keyword = document.getElementById('keyword').value.trim();
  const response = document.getElementById('response').value.trim();
  
  if (!keyword || !response) {
    showToast('Keyword and response are required', 'error');
    return;
  }
  
  try {
    let url = `${API_BASE}/api/auto-replies`;
    let method = 'POST';
    let body = { keyword, response };
    
    if (currentEditId) {
      url = `${API_BASE}/api/auto-replies/${currentEditId}`;
      method = 'PUT';
    }
    
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    const data = await res.json();
    
    if (data.success) {
      showToast(currentEditId ? 'Reply updated!' : 'Reply added!', 'success');
      closeReplyModal();
      loadAutoReplies();
    } else {
      showToast(data.message || 'Failed to save reply', 'error');
    }
  } catch (error) {
    console.error('Save reply error:', error);
    showToast('Failed to save reply', 'error');
  }
}

// Toggle reply active status
async function toggleReply(id, currentStatus) {
  try {
    const response = await fetch(`${API_BASE}/api/auto-replies/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !currentStatus })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(currentStatus ? 'Reply deactivated' : 'Reply activated', 'success');
      loadAutoReplies();
    }
  } catch (error) {
    console.error('Toggle reply error:', error);
    showToast('Failed to toggle reply', 'error');
  }
}

// Delete reply
async function deleteReply(id) {
  if (!confirm('Are you sure you want to delete this auto-reply?')) {
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/auto-replies/${id}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('Reply deleted successfully', 'success');
      loadAutoReplies();
    }
  } catch (error) {
    console.error('Delete reply error:', error);
    showToast('Failed to delete reply', 'error');
  }
}

// Load messages
async function loadMessages() {
  try {
    const response = await fetch(`${API_BASE}/api/messages?limit=50`);
    const data = await response.json();
    
    if (data.success) {
      displayMessages(data.data);
    }
  } catch (error) {
    console.error('Load messages error:', error);
    showToast('Failed to load messages', 'error');
  }
}

// Display messages
function displayMessages(messages) {
  const container = document.getElementById('messagesList');
  
  if (messages.length === 0) {
    container.innerHTML = '<p class="loading">No messages yet.</p>';
    return;
  }
  
  container.innerHTML = messages.map(msg => {
    const isAI = msg.sender_number === 'ai';
    const isAuto = msg.sender_number === 'auto';
    const extraClass = isAI ? ' message-ai' : (isAuto ? ' message-auto-reply' : '');
    
    return `
      <div class="message-card ${msg.is_from_me ? 'from-me' : 'from-other'}${extraClass}">
        <div class="message-header">
          <span class="message-sender">${msg.sender_name || msg.sender_number}${isAI ? ' 🤖' : ''}</span>
          <span class="message-time">${new Date(msg.timestamp).toLocaleString()}</span>
        </div>
        <div class="message-text">${msg.message}</div>
      </div>
    `;
  }).join('');
  
  // Update stats
  const today = new Date().toDateString();
  const todayCount = messages.filter(m => new Date(m.timestamp).toDateString() === today).length;
  document.getElementById('totalMessages').textContent = messages.length;
  document.getElementById('todayMessages').textContent = todayCount;
}

// Handle incoming message (real-time)
function handleIncomingMessage(data) {
  // Add message to list in real-time
  const container = document.getElementById('messagesList');
  const isAI = data.isAI || data.senderNumber === 'ai';
  const extraClass = isAI ? ' message-ai' : (data.isAutoReply ? ' message-auto-reply' : '');
  
  const messageHtml = `
    <div class="message-card ${data.fromMe ? 'from-me' : 'from-other'}${extraClass}">
      <div class="message-header">
        <span class="message-sender">${data.senderName || data.senderNumber}${isAI ? ' 🤖' : ''}</span>
        <span class="message-time">${new Date(data.timestamp).toLocaleString()}</span>
      </div>
      <div class="message-text">${data.message}</div>
    </div>
  `;
  
  if (container.querySelector('.loading')) {
    container.innerHTML = messageHtml;
  } else {
    container.insertAdjacentHTML('afterbegin', messageHtml);
  }
  
  // Update stats
  updateStats();
}

// Send message
function sendMessage() {
  const number = document.getElementById('sendNumber').value.trim();
  const message = document.getElementById('sendMessage').value.trim();
  
  if (!number || !message) {
    showToast('Number and message are required', 'error');
    return;
  }
  
  // Clean and format number
  let cleanNumber = number.replace(/\D/g, '');
  if (cleanNumber.startsWith('0')) {
    cleanNumber = '94' + cleanNumber.substring(1);
  }
  
  socket.emit('send_message', { number: cleanNumber, message });
  showToast('Sending message...', 'success');
}

// Load settings
async function loadSettings() {
  try {
    const response = await fetch(`${API_BASE}/api/settings`);
    const data = await response.json();
    
    if (data.success) {
      const settings = data.data;
      
      // Update toggle switches (modern design uses div elements)
      const autoReplySwitch = document.getElementById('autoReplySwitch');
      const aiModeSwitch = document.getElementById('aiModeSwitch');
      const aiFallbackSwitch = document.getElementById('aiFallbackSwitch');
      
      if (autoReplySwitch) {
        if (settings.auto_reply_enabled === 'true') {
          autoReplySwitch.classList.add('active');
        } else {
          autoReplySwitch.classList.remove('active');
        }
      }
      
      if (aiModeSwitch) {
        if (settings.ai_mode_enabled === 'true') {
          aiModeSwitch.classList.add('active');
        } else {
          aiModeSwitch.classList.remove('active');
        }
      }
      
      if (aiFallbackSwitch) {
        if (settings.ai_fallback_enabled === 'true') {
          aiFallbackSwitch.classList.add('active');
        } else {
          aiFallbackSwitch.classList.remove('active');
        }
      }
      
      // Load AI system prompt (business information)
      const promptEl = document.getElementById('aiSystemPrompt');
      if (promptEl) {
        promptEl.value = settings.ai_system_prompt || '';
      }
      
      // Load conversation history length
      const historyEl = document.getElementById('aiConversationHistory');
      if (historyEl) {
        historyEl.value = settings.ai_conversation_history || '10';
      }
      
      // Store current AI model globally
      if (settings.ai_model) {
        window.currentAIModel = settings.ai_model;
        console.log('Current AI model from settings:', settings.ai_model);
      } else {
        // Try to get from environment variable
        const aiTestResponse = await fetch(`${API_BASE}/api/ai/test`);
        const aiTestData = await aiTestResponse.json();
        if (aiTestData.success && aiTestData.model) {
          window.currentAIModel = aiTestData.model;
          console.log('Current AI model from AI test:', aiTestData.model);
        }
      }
    }
    
    // Load available AI models (this will select the current model)
    await loadModels();
  } catch (error) {
    console.error('Load settings error:', error);
  }
}

// Toggle auto-reply
async function toggleAutoReply() {
  const switchEl = document.getElementById('autoReplySwitch');
  switchEl.classList.toggle('active');
  const enabled = switchEl.classList.contains('active');
  
  try {
    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'auto_reply_enabled', value: enabled.toString() })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(`Auto-reply ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } else {
      // Revert on failure
      switchEl.classList.toggle('active');
    }
  } catch (error) {
    console.error('Toggle auto-reply error:', error);
    showToast('Failed to update setting', 'error');
    // Revert on error
    switchEl.classList.toggle('active');
  }
}

// Toggle AI mode
async function toggleAIMode() {
  const switchEl = document.getElementById('aiModeSwitch');
  switchEl.classList.toggle('active');
  const enabled = switchEl.classList.contains('active');
  
  try {
    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ai_mode_enabled', value: enabled.toString() })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(`AI Mode ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } else {
      switchEl.classList.toggle('active');
    }
  } catch (error) {
    console.error('Toggle AI mode error:', error);
    showToast('Failed to update AI mode', 'error');
    switchEl.classList.toggle('active');
  }
}

// Toggle AI fallback
async function toggleAIFallback() {
  const switchEl = document.getElementById('aiFallbackSwitch');
  switchEl.classList.toggle('active');
  const enabled = switchEl.classList.contains('active');
  
  try {
    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ai_fallback_enabled', value: enabled.toString() })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(`AI Fallback ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } else {
      switchEl.classList.toggle('active');
    }
  } catch (error) {
    console.error('Toggle AI fallback error:', error);
    showToast('Failed to update AI fallback', 'error');
    switchEl.classList.toggle('active');
  }
}

// Test AI connection
async function testAI() {
  showToast('Testing AI connection...', 'success');
  
  try {
    const response = await fetch(`${API_BASE}/api/ai/test`);
    const data = await response.json();
    
    if (data.success) {
      const cloudStatus = data.cloud ? ' (Cloud)' : '';
      showToast(`✅ Ollama Connected! Version: ${data.version}${cloudStatus} | Model: ${data.model}`, 'success');
    } else {
      showToast(`❌ Connection Failed: ${data.message}`, 'error');
    }
  } catch (error) {
    console.error('Test AI error:', error);
    showToast('❌ Failed to test AI connection', 'error');
  }
}

// Load available models
async function loadModels() {
  try {
    const response = await fetch(`${API_BASE}/api/ai/models`);
    const data = await response.json();
    
    const select = document.getElementById('aiModel');
    select.innerHTML = '';
    
    if (data.success && data.models && data.models.length > 0) {
      // Add a default option
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'Select a model...';
      select.appendChild(defaultOption);
      
      // Add cloud models (qwen, coder models)
      data.models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.name;
        option.textContent = `${model.name} (${(model.size / 1024 / 1024 / 1024).toFixed(1)}GB)`;
        if (model.name === getCurrentModel()) {
          option.selected = true;
        }
        select.appendChild(option);
      });
      
      showToast(`✅ Found ${data.models.length} models`, 'success');
    } else {
      select.innerHTML = '<option value="">No models available</option>';
      showToast('⚠️ No models found. Pull cloud models first!', 'error');
    }
  } catch (error) {
    console.error('Load models error:', error);
    showToast('❌ Failed to load models', 'error');
  }
}

// Get current model from env
function getCurrentModel() {
  // Will be set by loadSettings
  return window.currentAIModel || 'qwen2.5-coder:32b';
}

// Change AI model
async function changeAIModel() {
  const select = document.getElementById('aiModel');
  const model = select.value;
  
  if (!model) {
    showToast('⚠️ Please select a model', 'error');
    return;
  }
  
  showToast(`Switching to ${model}...`, 'success');
  
  try {
    const response = await fetch(`${API_BASE}/api/ai/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model })
    });
    
    const data = await response.json();
    
    if (data.success) {
      window.currentAIModel = model;
      
      // Save the model selection to settings for persistence
      try {
        await fetch(`${API_BASE}/api/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'ai_model', value: model })
        });
      } catch (saveError) {
        console.error('Failed to save model to settings:', saveError);
      }
      
      showToast(`✅ Model changed to ${model}!`, 'success');
    } else {
      showToast(`❌ Failed to change model: ${data.message}`, 'error');
    }
  } catch (error) {
    console.error('Change model error:', error);
    showToast('❌ Failed to change model', 'error');
  }
}

// Save welcome message
async function saveWelcomeMessage() {
  const message = document.getElementById('welcomeMessage').value.trim();
  
  try {
    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'welcome_message', value: message })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('Welcome message saved', 'success');
    }
  } catch (error) {
    console.error('Save welcome message error:', error);
    showToast('Failed to save welcome message', 'error');
  }
}

// Save AI system prompt (business information)
async function saveAISystemPrompt() {
  const prompt = document.getElementById('aiSystemPrompt').value.trim();
  
  if (!prompt) {
    showToast('⚠️ Business information cannot be empty', 'error');
    return;
  }
  
  showToast('💾 Saving business information...', 'success');
  
  try {
    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ai_system_prompt', value: prompt })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('✅ Business information saved! AI will use this for responses.', 'success');
    }
  } catch (error) {
    console.error('Save AI system prompt error:', error);
    showToast('❌ Failed to save business information', 'error');
  }
}

// Reset AI system prompt to default
async function resetAISystemPrompt() {
  if (!confirm('Reset business information to default? Your custom changes will be lost.')) {
    return;
  }
  
  const defaultPrompt = `You are a helpful customer service assistant for KCC Lanka. 
Be friendly, professional, and provide detailed helpful responses.
Respond in the same language the user writes in (Sinhala, English, Tamil, etc.).

Provide information about:
- KCC Lanka services and products
- Business hours: Mon-Fri 8AM-5PM, Sat 9AM-2PM, Sunday Closed
- Location: Colombo, Sri Lanka
- Website: https://kcclanka.com
- TEMCO Development Bank: Education financing up to 10 years at https://kcclanka.com/temco/
- Online Shop: https://kcclanka.com/shop/

For simple greetings, keep it brief. For questions about services or products, provide detailed, helpful information.
Always be helpful and guide users to relevant pages.`;
  
  document.getElementById('aiSystemPrompt').value = defaultPrompt;
  await saveAISystemPrompt();
  showToast('🔄 Reset to default business information', 'success');
}

// Save conversation history length
async function saveConversationHistory() {
  const historyLength = document.getElementById('aiConversationHistory').value;
  
  if (historyLength < 1 || historyLength > 50) {
    showToast('⚠️ History length must be between 1 and 50', 'error');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ai_conversation_history', value: historyLength })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(`✅ Conversation history set to ${historyLength} messages per person`, 'success');
    }
  } catch (error) {
    console.error('Save conversation history error:', error);
    showToast('❌ Failed to save conversation history setting', 'error');
  }
}

// Update stats
async function updateStats() {
  try {
    const [repliesRes, messagesRes] = await Promise.all([
      fetch(`${API_BASE}/api/auto-replies`),
      fetch(`${API_BASE}/api/messages?limit=1000`)
    ]);
    
    const repliesData = await repliesRes.json();
    const messagesData = await messagesRes.json();
    
    if (repliesData.success) {
      const replies = repliesData.data;
      const activeCount = replies.filter(r => r.is_active).length;
      document.getElementById('autoRepliesCount').textContent = replies.length;
      document.getElementById('activeReplies').textContent = activeCount;
    }
    
    if (messagesData.success) {
      const messages = messagesData.data;
      const today = new Date().toDateString();
      const todayCount = messages.filter(m => new Date(m.timestamp).toDateString() === today).length;
      document.getElementById('totalMessages').textContent = messages.length;
      document.getElementById('todayMessages').textContent = todayCount;
    }
  } catch (error) {
    console.error('Update stats error:', error);
  }
}

// Toast notification
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Expose showToast globally for ecommerce.js
window.showToast = showToast;

// Close modal on outside click
document.getElementById('replyModal').addEventListener('click', (e) => {
  if (e.target.id === 'replyModal') {
    closeReplyModal();
  }
});


// Save store settings
async function saveStoreSettings() {
  const storeName = document.getElementById('storeName').value.trim();
  const welcomeMessage = document.getElementById('welcomeMessageStore')?.value.trim() || '';
  const businessHours = document.getElementById('businessHours').value.trim();
  const deliveryFee = document.getElementById('deliveryFee').value;
  const freeDeliveryAbove = document.getElementById('freeDeliveryAbove').value;
  const paymentMethods = document.getElementById('paymentMethods').value.trim();
  const deliveryAreas = document.getElementById('deliveryAreas').value.trim();

  showToast('💾 Saving store settings...', 'success');

  try {
    const settings = [
      { key: 'store_name', value: storeName },
      { key: 'store_welcome_message', value: welcomeMessage },
      { key: 'business_hours', value: businessHours },
      { key: 'delivery_fee', value: deliveryFee },
      { key: 'free_delivery_above', value: freeDeliveryAbove },
      { key: 'payment_methods', value: paymentMethods },
      { key: 'delivery_areas', value: deliveryAreas }
    ];

    for (const setting of settings) {
      await fetch(`${API_BASE}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setting)
      });
    }

    showToast('✅ Store settings saved successfully!', 'success');
  } catch (error) {
    console.error('Save store settings error:', error);
    showToast('❌ Failed to save store settings', 'error');
  }
}

// Load store settings
async function loadStoreSettings() {
  try {
    const response = await fetch(`${API_BASE}/api/settings`);
    const data = await response.json();
    
    if (data.success) {
      const settings = data.data;
      
      // Populate store settings fields
      if (document.getElementById('storeName')) {
        document.getElementById('storeName').value = settings.store_name || '';
      }
      if (document.getElementById('businessHours')) {
        document.getElementById('businessHours').value = settings.business_hours || '';
      }
      if (document.getElementById('deliveryFee')) {
        document.getElementById('deliveryFee').value = settings.delivery_fee || '';
      }
      if (document.getElementById('freeDeliveryAbove')) {
        document.getElementById('freeDeliveryAbove').value = settings.free_delivery_above || '';
      }
      if (document.getElementById('paymentMethods')) {
        document.getElementById('paymentMethods').value = settings.payment_methods || '';
      }
      if (document.getElementById('deliveryAreas')) {
        document.getElementById('deliveryAreas').value = settings.delivery_areas || '';
      }
    }
  } catch (error) {
    console.error('Load store settings error:', error);
  }
}

// Logout function
async function logout() {
  if (confirm("Are you sure you want to logout?")) {
    try {
      const basePath = window.location.pathname.split("/").slice(0, 2).join("/") + "/";
      await fetch(basePath + "api/logout", { method: "POST" });
      window.location.href = basePath;
    } catch (error) {
      console.error("Logout error:", error);
      window.location.href = "/";
    }
  }
}

// Initialize store settings on load
document.addEventListener('DOMContentLoaded', () => {
  // Load store settings when store settings tab is clicked
  const storeSettingsTab = document.querySelector('[data-tab="store-settings"]');
  if (storeSettingsTab) {
    storeSettingsTab.addEventListener('click', loadStoreSettings);
  }
});

// QR Code Tab Functions
let qrRefreshInterval = null;

// Load QR code status
async function loadQRStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/status`);
    const data = await response.json();
    
    if (data.success) {
      const qrTabStatus = document.getElementById('qrTabStatus');
      const qrTabContent = document.getElementById('qrTabContent');
      const qrTabConnected = document.getElementById('qrTabConnected');
      const qrTabImage = document.getElementById('qrTabImage');
      const qrTabConnectedInfo = document.getElementById('qrTabConnectedInfo');
      
      if (data.data.isReady && data.data.clientInfo) {
        // Connected
        qrTabStatus.style.display = 'none';
        qrTabContent.style.display = 'none';
        qrTabConnected.style.display = 'block';
        
        const info = data.data.clientInfo;
        const infoText = info.pushname 
          ? `Connected as ${info.pushname} (+${info.user})`
          : `Connected as +${info.user}`;
        qrTabConnectedInfo.textContent = infoText;
      } else if (data.data.hasQR) {
        // Has QR code - fetch it
        const qrResponse = await fetch(`${API_BASE}/api/qr`);
        
        // Check if response is OK
        if (!qrResponse.ok) {
          const errorText = await qrResponse.text();
          console.error('QR fetch error:', qrResponse.status, errorText);
          qrTabStatus.innerHTML = `<p style="color: var(--danger); font-size: 16px;">❌ Error loading QR: ${qrResponse.status}</p>`;
          qrTabStatus.style.display = 'block';
          qrTabContent.style.display = 'none';
          qrTabConnected.style.display = 'none';
          return;
        }
        
        const qrData = await qrResponse.json();
        
        if (qrData.success && qrData.qr) {
          qrTabStatus.style.display = 'none';
          qrTabContent.style.display = 'block';
          qrTabConnected.style.display = 'none';
          qrTabImage.src = qrData.qr;
        } else {
          // No QR available yet
          qrTabStatus.innerHTML = '<p style="color: var(--warning); font-size: 16px;">⏳ Waiting for QR code...</p>';
          qrTabStatus.style.display = 'block';
          qrTabContent.style.display = 'none';
          qrTabConnected.style.display = 'none';
        }
      } else {
        // Not connected, no QR yet
        qrTabStatus.innerHTML = '<p style="color: var(--warning); font-size: 16px;">⏳ Initializing WhatsApp connection...</p>';
        qrTabStatus.style.display = 'block';
        qrTabContent.style.display = 'none';
        qrTabConnected.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('Load QR status error:', error);
    const qrTabStatus = document.getElementById('qrTabStatus');
    qrTabStatus.innerHTML = '<p style="color: var(--danger); font-size: 16px;">❌ Failed to load QR status</p>';
    qrTabStatus.style.display = 'block';
  }
}

// Refresh QR code manually
function refreshQRCode() {
  showToast('🔄 Refreshing QR code...', 'success');
  loadQRStatus();
}

// Initialize WhatsApp connection
async function initializeWhatsApp() {
  try {
    const confirmed = confirm('This will initialize/reinitialize the WhatsApp connection. Are you sure?');
    if (!confirmed) return;

    showToast('Initializing WhatsApp connection...', 'info');

    const response = await fetch(`${API_BASE}/api/whatsapp/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (data.success) {
      showToast(data.message, 'success');
      // Wait 2 seconds then refresh QR status
      setTimeout(() => {
        loadQRStatus();
      }, 2000);
    } else {
      showToast(data.message || 'Failed to initialize connection', 'error');
    }
  } catch (error) {
    console.error('Initialize WhatsApp error:', error);
    showToast('Error initializing WhatsApp', 'error');
  }
}

// Set up auto-refresh for QR tab
function setupQRTabRefresh() {
  // Load QR status when QR tab is clicked
  const qrTab = document.querySelector('[data-tab="qr-code"]');
  if (qrTab) {
    qrTab.addEventListener('click', () => {
      loadQRStatus();
      
      // Start auto-refresh every 30 seconds when on QR tab
      if (qrRefreshInterval) {
        clearInterval(qrRefreshInterval);
      }
      qrRefreshInterval = setInterval(() => {
        // Only refresh if QR tab is active
        const qrTabContent = document.getElementById('qr-code-tab');
        if (qrTabContent && qrTabContent.classList.contains('active')) {
          loadQRStatus();
        }
      }, 30000); // 30 seconds
    });
  }
  
  // Stop auto-refresh when switching away from QR tab
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab !== 'qr-code' && qrRefreshInterval) {
        clearInterval(qrRefreshInterval);
        qrRefreshInterval = null;
      }
    });
  });
  
  // Also update QR tab when socket events occur
  socket.on('qr', (qrData) => {
    const qrTabImage = document.getElementById('qrTabImage');
    const qrTabContent = document.getElementById('qrTabContent');
    const qrTabStatus = document.getElementById('qrTabStatus');
    const qrTabConnected = document.getElementById('qrTabConnected');
    
    if (qrTabImage && qrData) {
      qrTabImage.src = qrData;
      qrTabStatus.style.display = 'none';
      qrTabContent.style.display = 'block';
      qrTabConnected.style.display = 'none';
    }
  });
  
  socket.on('ready', (clientInfo) => {
    const qrTabStatus = document.getElementById('qrTabStatus');
    const qrTabContent = document.getElementById('qrTabContent');
    const qrTabConnected = document.getElementById('qrTabConnected');
    const qrTabConnectedInfo = document.getElementById('qrTabConnectedInfo');
    
    if (qrTabConnected) {
      qrTabStatus.style.display = 'none';
      qrTabContent.style.display = 'none';
      qrTabConnected.style.display = 'block';
      
      const infoText = clientInfo.pushname 
        ? `Connected as ${clientInfo.pushname} (+${clientInfo.user})`
        : `Connected as +${clientInfo.user}`;
      qrTabConnectedInfo.textContent = infoText;
    }
  });
  
  socket.on('disconnected', () => {
    const qrTabStatus = document.getElementById('qrTabStatus');
    const qrTabContent = document.getElementById('qrTabContent');
    const qrTabConnected = document.getElementById('qrTabConnected');
    
    if (qrTabStatus) {
      qrTabStatus.innerHTML = '<p style="color: var(--danger); font-size: 16px;">❌ WhatsApp disconnected</p>';
      qrTabStatus.style.display = 'block';
      qrTabContent.style.display = 'none';
      qrTabConnected.style.display = 'none';
    }
  });
}

