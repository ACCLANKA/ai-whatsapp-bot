// Analytics Functions for Sales Dashboard

const ANALYTICS_API_BASE = window.API_BASE || '';
let currentTimeRange = 30; // Default 30 days

// Load Analytics Data
async function loadAnalytics() {
  try {
    const response = await fetch(`${ANALYTICS_API_BASE}/api/analytics?days=${currentTimeRange}`);
    const data = await response.json();
    
    if (data.success) {
      updateAnalyticsSummary(data.summary);
      renderDailySalesChart(data.dailySales);
      renderOrderStatusChart(data.orderStatus);
      renderTopProducts(data.topProducts);
      renderRecentSales(data.recentSales);
    } else {
      console.error('Failed to load analytics:', data.message);
      showToast('Failed to load analytics', 'error');
    }
    
  } catch (error) {
    console.error('Error loading analytics:', error);
    showToast('Error loading analytics', 'error');
  }
}

// Update Summary Cards
function updateAnalyticsSummary(summary) {
  // Today's Sales
  document.getElementById('todaySales').textContent = `Rs. ${summary.today.revenue.toLocaleString()}`;
  document.getElementById('todaySalesChange').textContent = `${summary.today.orders} order${summary.today.orders !== 1 ? 's' : ''}`;
  
  // Weekly Sales
  document.getElementById('weeklySales').textContent = `Rs. ${summary.weekly.revenue.toLocaleString()}`;
  document.getElementById('weeklySalesChange').textContent = `${summary.weekly.orders} order${summary.weekly.orders !== 1 ? 's' : ''}`;
  
  // Monthly Sales
  document.getElementById('monthlySales').textContent = `Rs. ${summary.monthly.revenue.toLocaleString()}`;
  document.getElementById('monthlySalesChange').textContent = `${summary.monthly.orders} order${summary.monthly.orders !== 1 ? 's' : ''}`;
  
  // Total Revenue
  document.getElementById('totalRevenue').textContent = `Rs. ${summary.total.revenue.toLocaleString()}`;
  document.getElementById('totalOrders').textContent = `${summary.total.orders} order${summary.total.orders !== 1 ? 's' : ''} total`;
}

// Render Daily Sales Chart
function renderDailySalesChart(dailySales) {
  const chartContainer = document.getElementById('dailySalesChart');
  
  if (!dailySales || dailySales.length === 0) {
    chartContainer.innerHTML = '<div style="text-align: center; padding: 60px; color: var(--gray);">No sales data available</div>';
    return;
  }
  
  const maxRevenue = Math.max(...dailySales.map(d => d.revenue));
  const chartHeight = 250;
  
  let html = `
    <div style="display: flex; align-items: flex-end; gap: 8px; height: ${chartHeight}px; padding: 10px 0;">
  `;
  
  dailySales.forEach(day => {
    const barHeight = maxRevenue > 0 ? (day.revenue / maxRevenue) * (chartHeight - 60) : 0;
    const date = new Date(day.date);
    const dayLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    html += `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%;">
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
          <div style="font-size: 11px; color: var(--primary); font-weight: 600; margin-bottom: 4px;">
            ${day.revenue.toLocaleString()}
          </div>
          <div 
            style="
              width: 100%; 
              background: linear-gradient(180deg, var(--primary) 0%, var(--secondary) 100%);
              border-radius: 6px 6px 0 0;
              height: ${barHeight}px;
              transition: all 0.3s ease;
              cursor: pointer;
              box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
            "
            onmouseover="this.style.transform='scaleY(1.05)'"
            onmouseout="this.style.transform='scaleY(1)'"
            title="Rs. ${day.revenue.toLocaleString()} - ${day.orders} order${day.orders !== 1 ? 's' : ''}"
          ></div>
        </div>
        <div style="font-size: 10px; color: var(--gray); margin-top: 8px; font-weight: 500;">
          ${dayLabel}
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  chartContainer.innerHTML = html;
}

// Render Order Status Chart (Pie Chart)
function renderOrderStatusChart(orderStatus) {
  const chartContainer = document.getElementById('orderStatusChart');
  
  if (!orderStatus || orderStatus.length === 0) {
    chartContainer.innerHTML = '<div style="text-align: center; padding: 60px; color: var(--gray);">No order data available</div>';
    return;
  }
  
  const total = orderStatus.reduce((sum, item) => sum + item.count, 0);
  
  const statusColors = {
    'pending': '#f59e0b',
    'confirmed': '#3b82f6',
    'processing': '#8b5cf6',
    'shipped': '#06b6d4',
    'delivered': '#10b981',
    'cancelled': '#ef4444',
    'refunded': '#f97316'
  };
  
  let html = `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <div style="display: flex; justify-content: center; align-items: center; height: 180px;">
        <div style="position: relative; width: 180px; height: 180px; border-radius: 50%; background: conic-gradient(
  `;
  
  let currentAngle = 0;
  orderStatus.forEach((item, index) => {
    const percentage = (item.count / total) * 100;
    const angle = (percentage / 100) * 360;
    const color = statusColors[item.status] || '#94a3b8';
    
    if (index > 0) html += ', ';
    html += `${color} ${currentAngle}deg ${currentAngle + angle}deg`;
    currentAngle += angle;
  });
  
  html += `); box-shadow: 0 8px 24px rgba(0,0,0,0.15);">
          <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 100px; height: 100px; background: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-direction: column; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
            <div style="font-size: 28px; font-weight: 700; color: var(--dark);">${total}</div>
            <div style="font-size: 11px; color: var(--gray);">Orders</div>
          </div>
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
  `;
  
  orderStatus.forEach(item => {
    const percentage = ((item.count / total) * 100).toFixed(1);
    const color = statusColors[item.status] || '#94a3b8';
    const statusLabel = item.status.charAt(0).toUpperCase() + item.status.slice(1);
    
    html += `
      <div style="display: flex; align-items: center; gap: 8px;">
        <div style="width: 12px; height: 12px; border-radius: 3px; background: ${color};"></div>
        <div style="font-size: 12px; color: var(--dark); flex: 1;">
          <strong>${statusLabel}</strong>
          <div style="color: var(--gray); font-size: 11px;">${item.count} (${percentage}%)</div>
        </div>
      </div>
    `;
  });
  
  html += `
      </div>
    </div>
  `;
  
  chartContainer.innerHTML = html;
}

// Render Top Products
function renderTopProducts(topProducts) {
  const container = document.getElementById('topProductsList');
  
  if (!topProducts || topProducts.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--gray);">No products sold yet</div>';
    return;
  }
  
  let html = `
    <table class="data-table" style="width: 100%;">
      <thead>
        <tr>
          <th style="text-align: left;">Rank</th>
          <th style="text-align: left;">Product</th>
          <th style="text-align: center;">Units Sold</th>
          <th style="text-align: right;">Revenue</th>
          <th style="text-align: center;">Share</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  const totalRevenue = topProducts.reduce((sum, p) => sum + p.revenue, 0);
  
  topProducts.forEach((product, index) => {
    const share = ((product.revenue / totalRevenue) * 100).toFixed(1);
    const medalEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
    
    html += `
      <tr>
        <td style="font-size: 20px; text-align: center; width: 60px;">${medalEmoji}</td>
        <td>
          <strong>${product.name}</strong>
          <div style="font-size: 12px; color: var(--gray);">${product.category || 'No category'}</div>
        </td>
        <td style="text-align: center;">
          <span style="background: var(--light); padding: 4px 12px; border-radius: 12px; font-weight: 600;">
            ${product.quantity}
          </span>
        </td>
        <td style="text-align: right; font-weight: 700; color: var(--primary);">
          Rs. ${product.revenue.toLocaleString()}
        </td>
        <td style="text-align: center;">
          <div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
            <div style="flex: 0 0 60px; height: 8px; background: var(--light); border-radius: 4px; overflow: hidden;">
              <div style="height: 100%; background: linear-gradient(90deg, var(--primary), var(--secondary)); width: ${share}%; transition: width 0.5s ease;"></div>
            </div>
            <span style="font-size: 12px; font-weight: 600; color: var(--gray);">${share}%</span>
          </div>
        </td>
      </tr>
    `;
  });
  
  html += `
      </tbody>
    </table>
  `;
  
  container.innerHTML = html;
}

// Render Recent Sales
function renderRecentSales(recentSales) {
  const container = document.getElementById('recentSalesList');
  
  if (!recentSales || recentSales.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--gray);">No recent sales</div>';
    return;
  }
  
  let html = '<div style="display: flex; flex-direction: column; gap: 16px;">';
  
  recentSales.forEach(sale => {
    const date = new Date(sale.created_at);
    const timeAgo = getTimeAgo(date);
    
    const statusColors = {
      'pending': 'warning',
      'confirmed': 'info',
      'processing': 'secondary',
      'shipped': 'info',
      'delivered': 'success',
      'cancelled': 'danger'
    };
    
    html += `
      <div style="display: flex; align-items: center; gap: 16px; padding: 16px; background: var(--light); border-radius: 12px; transition: all 0.2s ease;">
        <div style="flex: 0 0 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, var(--primary), var(--secondary)); display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 18px;">
          ${sale.customer_name ? sale.customer_name.charAt(0).toUpperCase() : 'C'}
        </div>
        <div style="flex: 1;">
          <div style="font-weight: 700; color: var(--dark); margin-bottom: 4px;">
            ${sale.customer_name || 'Customer'}
            <span style="font-weight: 400; color: var(--gray); font-size: 14px; margin-left: 8px;">
              ${sale.order_number}
            </span>
          </div>
          <div style="font-size: 13px; color: var(--gray);">
            ${sale.phone_number} • ${timeAgo}
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 18px; font-weight: 700; color: var(--primary); margin-bottom: 4px;">
            Rs. ${parseFloat(sale.total_amount).toLocaleString()}
          </div>
          <span class="badge badge-${statusColors[sale.status] || 'secondary'}" style="font-size: 11px; text-transform: capitalize;">
            ${sale.status}
          </span>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
}

// Helper: Get Time Ago
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Change Time Range
function changeTimeRange(days) {
  currentTimeRange = parseInt(days);
  loadAnalytics();
}

// Refresh Analytics
function refreshAnalytics() {
  loadAnalytics();
  showToast('📊 Analytics refreshed!', 'success');
}

// Export functions
window.loadAnalytics = loadAnalytics;
window.changeTimeRange = changeTimeRange;
window.refreshAnalytics = refreshAnalytics;
