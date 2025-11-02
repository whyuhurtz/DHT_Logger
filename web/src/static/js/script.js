// Global variables
let currentPage = 1;
const recordsPerPage = 10;
let eventSource = null;

// DOM Elements
const loadingDiv = document.getElementById('loading');
const errorAlert = document.getElementById('error-alert');
const errorMessage = document.getElementById('error-message');
const tableContainer = document.getElementById('table-container');
const tableBody = document.getElementById('data-table-body');
const paginationContainer = document.getElementById('pagination');
const paginationInfo = document.getElementById('pagination-info');

// Stats elements
const totalLogsEl = document.getElementById('total-logs');
const uniqueDevicesEl = document.getElementById('unique-devices');
const latestTimeEl = document.getElementById('latest-time');

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    fetchOverviewStats();
    fetchLogs(currentPage);
    setupRealtimeUpdates();
    
    // Auto-refresh every 30 seconds (backup if SSE fails)
    setInterval(() => {
        fetchOverviewStats();
    }, 30000);
});

// Setup Server-Sent Events for realtime updates
function setupRealtimeUpdates() {
    if (eventSource) {
        eventSource.close();
    }
    
    eventSource = new EventSource('/api/events/stream');
    
    eventSource.onopen = () => {
        console.log('✅ SSE connection established');
        showConnectionStatus(true);
    };
    
    eventSource.onmessage = (event) => {
        try {
            const newLog = JSON.parse(event.data);
            console.log('📨 New sensor data received:', newLog);
            
            // Add new row to the top of the table (only on page 1)
            if (currentPage === 1) {
                addLogToTable(newLog);
                updatePaginationAfterRealtimeData();
            }
            
            // Show notification
            showNotification(newLog);
            
            // Update stats
            fetchOverviewStats();
            
        } catch (error) {
            console.error('Failed to parse SSE data:', error);
        }
    };
    
    eventSource.onerror = (error) => {
        console.error('❌ SSE connection error:', error);
        showConnectionStatus(false);
        
        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
            console.log('🔄 Attempting to reconnect SSE...');
            setupRealtimeUpdates();
        }, 5000);
    };
}

// Add new log to table (realtime)
function addLogToTable(log) {
    const tbody = tableBody;
    if (!tbody) return;
    
    // Check if table is empty (showing "No data" message)
    const emptyRow = tbody.querySelector('td[colspan="6"]');
    if (emptyRow) {
        tbody.innerHTML = '';
    }
    
    // Create new row
    const row = document.createElement('tr');
    row.className = 'new-log'; // Add animation class
    row.innerHTML = `
        <td><span class="badge bg-primary">${log.log_id}</span></td>
        <td><span class="badge device-badge">${log.device_id}</span></td>
        <td><code>${log.mac_address}</code></td>
        <td>
            <i class="bi bi-thermometer-half text-danger"></i>
            <span class="temp-value">${log.temperature.toFixed(1)}°C</span>
        </td>
        <td>
            <i class="bi bi-droplet-half text-primary"></i>
            <span class="humidity-value">${log.humidity.toFixed(1)}%</span>
        </td>
        <td>
            <i class="bi bi-clock text-muted"></i>
            ${formatDateTime(log.datetime)}
        </td>
    `;
    
    // Insert at the top
    tbody.insertBefore(row, tbody.firstChild);
    
    // Remove highlight animation after 2 seconds
    setTimeout(() => {
        row.classList.remove('new-log');
    }, 2000);
    
    // Keep only last N rows (prevent table from growing too large)
    const maxRows = recordsPerPage;
    while (tbody.children.length > maxRows) {
        tbody.removeChild(tbody.lastChild);
    }
}

// Show notification for new data
function showNotification(log) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.innerHTML = `
        <div class="notification-header">
            <i class="bi bi-bell-fill"></i>
            <strong>New Sensor Data</strong>
        </div>
        <div class="notification-body">
            <div><strong>Device:</strong> ${log.device_id}</div>
            <div><strong>Temperature:</strong> ${log.temperature.toFixed(1)}°C</div>
            <div><strong>Humidity:</strong> ${log.humidity.toFixed(1)}%</div>
        </div>
    `;
    document.body.appendChild(notification);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 4000);
}

// Show connection status indicator
function showConnectionStatus(connected) {
    let statusDiv = document.getElementById('connection-status');
    
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.id = 'connection-status';
        statusDiv.className = 'connection-status';
        document.body.appendChild(statusDiv);
    }
    
    if (connected) {
        statusDiv.className = 'connection-status connected';
        statusDiv.innerHTML = '<i class="bi bi-wifi"></i> Live';
    } else {
        statusDiv.className = 'connection-status disconnected';
        statusDiv.innerHTML = '<i class="bi bi-wifi-off"></i> Reconnecting...';
    }
}

// Fetch overview statistics
async function fetchOverviewStats() {
    try {
        const response = await fetch('/api/stats/overview');
        const data = await response.json();
        
        if (data.success) {
            const stats = data.stats;
            totalLogsEl.textContent = stats.total_logs.toLocaleString();
            uniqueDevicesEl.textContent = stats.unique_devices;
            
            if (stats.latest_time) {
                latestTimeEl.textContent = formatDateTime(stats.latest_time);
            } else {
                latestTimeEl.textContent = 'No data yet';
            }
        }
    } catch (error) {
        console.error('Error fetching stats:', error);
    }
}

// Fetch logs with pagination
async function fetchLogs(page) {
    try {
        // Show loading
        showLoading();
        
        const response = await fetch(`/api/logs?page=${page}&limit=${recordsPerPage}`);
        const data = await response.json();
        
        if (data.success) {
            hideLoading();
            displayLogs(data.data);
            renderPagination(data.page, data.total_pages, data.total);
        } else {
            showError(data.error || 'Failed to fetch data');
        }
    } catch (error) {
        showError('Network error: ' + error.message);
    }
}

// Display logs in table
function displayLogs(logs) {
    tableBody.innerHTML = '';
    
    if (logs.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted py-4">
                    <i class="bi bi-inbox fs-1"></i>
                    <p class="mt-2">No data available</p>
                </td>
            </tr>
        `;
        return;
    }
    
    logs.forEach(log => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><span class="badge bg-primary">${log.log_id}</span></td>
            <td><span class="badge device-badge">${log.device_id}</span></td>
            <td><code>${log.mac_address}</code></td>
            <td>
                <i class="bi bi-thermometer-half text-danger"></i>
                ${log.temperature.toFixed(1)}°C
            </td>
            <td>
                <i class="bi bi-droplet-half text-primary"></i>
                ${log.humidity.toFixed(1)}%
            </td>
            <td>
                <i class="bi bi-clock text-muted"></i>
                ${formatDateTime(log.datetime)}
            </td>
        `;
        tableBody.appendChild(row);
    });
}

// Render pagination
function renderPagination(currentPage, totalPages, totalRecords) {
    paginationContainer.innerHTML = '';
    
    if (totalPages <= 1) {
        paginationInfo.textContent = `Showing ${totalRecords} of ${totalRecords} records`;
        return;
    }
    
    // Previous button
    const prevLi = document.createElement('li');
    prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
    prevLi.innerHTML = `
        <a class="page-link" href="#" onclick="changePage(${currentPage - 1}); return false;">
            <i class="bi bi-chevron-left"></i> Previous
        </a>
    `;
    paginationContainer.appendChild(prevLi);
    
    // Page numbers
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage < maxVisiblePages - 1) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    // First page
    if (startPage > 1) {
        const firstLi = document.createElement('li');
        firstLi.className = 'page-item';
        firstLi.innerHTML = `<a class="page-link" href="#" onclick="changePage(1); return false;">1</a>`;
        paginationContainer.appendChild(firstLi);
        
        if (startPage > 2) {
            const dotsLi = document.createElement('li');
            dotsLi.className = 'page-item disabled';
            dotsLi.innerHTML = `<a class="page-link" href="#">...</a>`;
            paginationContainer.appendChild(dotsLi);
        }
    }
    
    // Page numbers
    for (let i = startPage; i <= endPage; i++) {
        const li = document.createElement('li');
        li.className = `page-item ${i === currentPage ? 'active' : ''}`;
        li.innerHTML = `<a class="page-link" href="#" onclick="changePage(${i}); return false;">${i}</a>`;
        paginationContainer.appendChild(li);
    }
    
    // Last page
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const dotsLi = document.createElement('li');
            dotsLi.className = 'page-item disabled';
            dotsLi.innerHTML = `<a class="page-link" href="#">...</a>`;
            paginationContainer.appendChild(dotsLi);
        }
        
        const lastLi = document.createElement('li');
        lastLi.className = 'page-item';
        lastLi.innerHTML = `<a class="page-link" href="#" onclick="changePage(${totalPages}); return false;">${totalPages}</a>`;
        paginationContainer.appendChild(lastLi);
    }
    
    // Next button
    const nextLi = document.createElement('li');
    nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
    nextLi.innerHTML = `
        <a class="page-link" href="#" onclick="changePage(${currentPage + 1}); return false;">
            Next <i class="bi bi-chevron-right"></i>
        </a>
    `;
    paginationContainer.appendChild(nextLi);
    
    // Update info
    const startRecord = (currentPage - 1) * recordsPerPage + 1;
    const endRecord = Math.min(currentPage * recordsPerPage, totalRecords);
    paginationInfo.textContent = `Showing ${startRecord}-${endRecord} of ${totalRecords} records`;
}

// Update pagination after realtime data
async function updatePaginationAfterRealtimeData() {
    try {
        // Fetch updated pagination info WITHOUT reloading table
        const response = await fetch(`/api/logs?page=${currentPage}&limit=${recordsPerPage}`);
        const data = await response.json();
        
        if (data.success) {
            // Only update pagination, don't touch the table
            renderPagination(data.page, data.total_pages, data.total);
        }
    } catch (error) {
        console.error('Error updating pagination:', error);
    }
}

// Change page
function changePage(page) {
    currentPage = page;
    fetchLogs(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Show loading state
function showLoading() {
    loadingDiv.classList.remove('d-none');
    errorAlert.classList.add('d-none');
    tableContainer.classList.add('d-none');
}

// Hide loading state
function hideLoading() {
    loadingDiv.classList.add('d-none');
    tableContainer.classList.remove('d-none');
}

// Show error message
function showError(message) {
    loadingDiv.classList.add('d-none');
    tableContainer.classList.add('d-none');
    errorMessage.textContent = message;
    errorAlert.classList.remove('d-none');
}

// Format datetime string
function formatDateTime(dateTimeStr) {
    if (!dateTimeStr) return '-';
    
    try {
        const date = new Date(dateTimeStr);
        
        // Check if valid date
        if (isNaN(date.getTime())) {
            return dateTimeStr; // Return original if can't parse
        }
        
        // Format: "Nov 1, 2025 14:35:22"
        const options = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };
        
        return date.toLocaleString('en-US', options);
    } catch (error) {
        console.error('Error formatting date:', error);
        return dateTimeStr;
    }
}

// Utility: Format number with commas
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Utility: Time ago helper (optional)
function timeAgo(timestamp) {
    const now = Date.now();
    const diff = now - (timestamp * 1000); // Convert to milliseconds
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (eventSource) {
        eventSource.close();
    }
});

// Export for debugging (optional)
window.debugLogs = {
    currentPage,
    fetchLogs,
    fetchOverviewStats,
    eventSource
};