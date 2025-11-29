// Backup & Restore Functions

const BACKUP_API_BASE = window.API_BASE || '';
let selectedBackupFile = null;

// Load backup tab data
async function loadBackupTab() {
  try {
    // Get counts for all data types
    const [products, categories, orders] = await Promise.all([
      fetch(`${BACKUP_API_BASE}/api/ecommerce/products`).then(r => r.json()),
      fetch(`${BACKUP_API_BASE}/api/ecommerce/categories`).then(r => r.json()),
      fetch(`${BACKUP_API_BASE}/api/ecommerce/orders`).then(r => r.json())
    ]);
    
    document.getElementById('productsCount').textContent = 
      products.success ? `${products.products.length} items` : 'Error loading';
    document.getElementById('categoriesCount').textContent = 
      categories.success ? `${categories.categories.length} items` : 'Error loading';
    document.getElementById('ordersCount').textContent = 
      orders.success ? `${orders.orders.length} items` : 'Error loading';
      
    loadBackupHistory();
    
  } catch (error) {
    console.error('Error loading backup tab:', error);
  }
}

// Download backup
async function downloadBackup(type) {
  try {
    showToast('Creating backup...', 'info');
    
    const response = await fetch(`${BACKUP_API_BASE}/api/backup/download?type=${type}`);
    const data = await response.json();
    
    if (!data.success) {
      showToast('Failed to create backup: ' + data.message, 'error');
      return;
    }
    
    // Create download
    const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gigies-backup-${type}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('✅ Backup downloaded successfully!', 'success');
    
    // Save to history
    saveBackupToHistory({
      type: type,
      date: new Date().toISOString(),
      size: blob.size,
      items: data.backup.metadata
    });
    
  } catch (error) {
    console.error('Error downloading backup:', error);
    showToast('Failed to download backup', 'error');
  }
}

// Handle file selection
function handleBackupFileSelect(input) {
  const file = input.files[0];
  
  if (!file) {
    return;
  }
  
  if (!file.name.endsWith('.json')) {
    showToast('Please select a valid JSON backup file', 'error');
    input.value = '';
    return;
  }
  
  if (file.size > 50 * 1024 * 1024) { // 50MB max
    showToast('File is too large (max 50MB)', 'error');
    input.value = '';
    return;
  }
  
  selectedBackupFile = file;
  
  // Show file info
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = formatFileSize(file.size);
  document.getElementById('selectedFileInfo').style.display = 'block';
  document.getElementById('restoreBtn').disabled = false;
  
  // Change upload area style
  document.getElementById('uploadArea').style.borderColor = 'var(--success)';
  document.getElementById('uploadArea').style.background = 'var(--light)';
}

// Clear selected file
function clearSelectedFile() {
  selectedBackupFile = null;
  document.getElementById('backupFile').value = '';
  document.getElementById('selectedFileInfo').style.display = 'none';
  document.getElementById('restoreBtn').disabled = true;
  document.getElementById('uploadArea').style.borderColor = 'var(--border)';
  document.getElementById('uploadArea').style.background = 'transparent';
}

// Restore backup
async function restoreBackup() {
  if (!selectedBackupFile) {
    showToast('Please select a backup file first', 'error');
    return;
  }
  
  if (!confirm('⚠️ WARNING: This will replace ALL existing data!\n\nAre you sure you want to continue? This action cannot be undone.')) {
    return;
  }
  
  if (!confirm('Final confirmation: This will DELETE your current data and restore from backup. Continue?')) {
    return;
  }
  
  try {
    showToast('Reading backup file...', 'info');
    
    // Read file
    const fileContent = await selectedBackupFile.text();
    let backupData;
    
    try {
      backupData = JSON.parse(fileContent);
    } catch (e) {
      showToast('Invalid backup file format', 'error');
      return;
    }
    
    // Validate backup structure
    if (!backupData.metadata || !backupData.timestamp) {
      showToast('Invalid backup file: missing metadata', 'error');
      return;
    }
    
    showToast('Restoring data...', 'info');
    
    // Send to server
    const response = await fetch(`${BACKUP_API_BASE}/api/backup/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backupData)
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast('✅ Backup restored successfully! Reloading page...', 'success');
      
      // Clear selected file
      clearSelectedFile();
      
      // Reload page after 2 seconds
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } else {
      showToast('Failed to restore backup: ' + result.message, 'error');
    }
    
  } catch (error) {
    console.error('Error restoring backup:', error);
    showToast('Failed to restore backup', 'error');
  }
}

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Save backup to history (localStorage)
function saveBackupToHistory(backup) {
  try {
    let history = JSON.parse(localStorage.getItem('backupHistory') || '[]');
    history.unshift(backup);
    history = history.slice(0, 10); // Keep only last 10
    localStorage.setItem('backupHistory', JSON.stringify(history));
    loadBackupHistory();
  } catch (error) {
    console.error('Error saving backup history:', error);
  }
}

// Load backup history
function loadBackupHistory() {
  try {
    const history = JSON.parse(localStorage.getItem('backupHistory') || '[]');
    const container = document.getElementById('backupHistory');
    
    if (history.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--gray);">No backup history available yet</div>';
      return;
    }
    
    let html = '<table class="data-table" style="width: 100%;"><thead><tr><th>Type</th><th>Date</th><th>Size</th><th>Items</th></tr></thead><tbody>';
    
    history.forEach(backup => {
      const date = new Date(backup.date);
      const itemsText = backup.items ? 
        `${backup.items.products || 0} products, ${backup.items.categories || 0} categories, ${backup.items.orders || 0} orders` :
        'N/A';
      
      html += `
        <tr>
          <td><span class="badge badge-info">${backup.type}</span></td>
          <td>${date.toLocaleString()}</td>
          <td>${formatFileSize(backup.size)}</td>
          <td style="font-size: 12px;">${itemsText}</td>
        </tr>
      `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
    
  } catch (error) {
    console.error('Error loading backup history:', error);
  }
}

// Drag and drop support
document.addEventListener('DOMContentLoaded', () => {
  const uploadArea = document.getElementById('uploadArea');
  
  if (uploadArea) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      uploadArea.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    ['dragenter', 'dragover'].forEach(eventName => {
      uploadArea.addEventListener(eventName, () => {
        uploadArea.style.borderColor = 'var(--primary)';
        uploadArea.style.background = 'var(--light)';
      });
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
      uploadArea.addEventListener(eventName, () => {
        if (!selectedBackupFile) {
          uploadArea.style.borderColor = 'var(--border)';
          uploadArea.style.background = 'transparent';
        }
      });
    });
    
    uploadArea.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      
      if (files.length > 0) {
        document.getElementById('backupFile').files = files;
        handleBackupFileSelect(document.getElementById('backupFile'));
      }
    });
  }
});

// Export functions
window.loadBackupTab = loadBackupTab;
window.downloadBackup = downloadBackup;
window.handleBackupFileSelect = handleBackupFileSelect;
window.clearSelectedFile = clearSelectedFile;
window.restoreBackup = restoreBackup;
