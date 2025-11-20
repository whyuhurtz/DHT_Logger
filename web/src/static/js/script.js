// Global variables
let currentPage = 1;
let recordsPerPage = 10; // Dynamic records per page
let selectedDeviceFilter = ''; // Device filter
let eventSource = null;
let sensorChart = null; // Chart.js instance
let selectedChartDevice = ''; // Selected device for chart

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

// ✨ NEW: Filter elements
const deviceFilterSelect = document.getElementById('device-filter');
const recordsPerPageSelect = document.getElementById('records-per-page');
const chartDeviceSelect = document.getElementById('chart-device-select');
const chartLimitSelect = document.getElementById('chart-limit-select');

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    fetchOverviewStats();
    fetchDevicesList(); // Fetch devices for filters
    fetchLogs(currentPage);
    setupRealtimeUpdates();
    setupFilterListeners(); // Setup filter event listeners
    
    // Auto-refresh every 30 seconds (backup if SSE fails)
    setInterval(() => {
        fetchOverviewStats();
    }, 30000);
});

// Setup filter event listeners
function setupFilterListeners() {
    // Device filter change
    deviceFilterSelect.addEventListener('change', function() {
        selectedDeviceFilter = this.value;
        currentPage = 1;
        fetchLogs(currentPage);
    });
    
    // Records per page change
    recordsPerPageSelect.addEventListener('change', function() {
        recordsPerPage = parseInt(this.value);
        currentPage = 1;
        fetchLogs(currentPage);
    });
    
    // Chart device selection
    chartDeviceSelect.addEventListener('change', function() {
        const deviceId = this.value;
        selectedChartDevice = deviceId; // ✅ SAVE globally
        
        if (deviceId) {
            const limit = parseInt(chartLimitSelect.value);
            fetchChartData(deviceId, limit);
        } else {
            clearChart();
        }
    });
    
    // Chart limit change
    chartLimitSelect.addEventListener('change', function() {
        const deviceId = chartDeviceSelect.value;
        if (deviceId) {
            const limit = parseInt(this.value);
            fetchChartData(deviceId, limit);
        }
    });
}

// Fetch devices list for filters
async function fetchDevicesList(retryCount = 0) {
    try {
        console.log(`📡 Fetching devices list... (attempt ${retryCount + 1})`);
        
        const response = await fetch('/api/devices');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        console.log('📦 Devices API response:', data);
        
        if (data.success && data.devices && data.devices.length > 0) {
            // ✅ SAVE current selections BEFORE clearing
            const currentTableFilter = deviceFilterSelect.value;
            const currentChartDevice = chartDeviceSelect.value;
            
            // Clear existing options
            deviceFilterSelect.innerHTML = '';
            chartDeviceSelect.innerHTML = '';
            
            // Add default option
            const defaultOption1 = document.createElement('option');
            defaultOption1.value = '';
            defaultOption1.textContent = 'All Devices';
            deviceFilterSelect.appendChild(defaultOption1);
            
            const defaultOption2 = document.createElement('option');
            defaultOption2.value = '';
            defaultOption2.textContent = '-- Select a device --';
            chartDeviceSelect.appendChild(defaultOption2);
            
            // Populate device options
            data.devices.forEach(deviceId => {
                // Table filter dropdown
                const option1 = document.createElement('option');
                option1.value = deviceId;
                option1.textContent = deviceId;
                deviceFilterSelect.appendChild(option1);
                
                // Chart device dropdown
                const option2 = document.createElement('option');
                option2.value = deviceId;
                option2.textContent = deviceId;
                chartDeviceSelect.appendChild(option2);
                
                console.log(`✅ Added device: ${deviceId}`);
            });
            
            // ✅ RESTORE selections after populating
            if (currentTableFilter && data.devices.includes(currentTableFilter)) {
                deviceFilterSelect.value = currentTableFilter;
            }
            
            if (currentChartDevice && data.devices.includes(currentChartDevice)) {
                chartDeviceSelect.value = currentChartDevice;
            }
            
            console.log(`✅ Successfully loaded ${data.devices.length} device(s)`);
            console.log('📋 Restored table filter:', deviceFilterSelect.value);
            console.log('📋 Restored chart device:', chartDeviceSelect.value);
            
        } else if (data.success && (!data.devices || data.devices.length === 0)) {
            console.warn('⚠️ No devices found in database yet');
            deviceFilterSelect.innerHTML = '<option value="">No devices found</option>';
            chartDeviceSelect.innerHTML = '<option value="">No devices found</option>';
        } else {
            console.error('❌ API returned error:', data);
        }
        
    } catch (error) {
        console.error('❌ Error fetching devices:', error);
        
        if (retryCount < 3) {
            console.log(`🔄 Retrying in 2 seconds... (${retryCount + 1}/3)`);
            setTimeout(() => {
                fetchDevicesList(retryCount + 1);
            }, 2000);
        } else {
            console.error('❌ Failed to fetch devices after 3 attempts');
            deviceFilterSelect.innerHTML = '<option value="">Error loading devices</option>';
            chartDeviceSelect.innerHTML = '<option value="">Error loading devices</option>';
        }
    }
}

// Fetch chart data
async function fetchChartData(deviceId, limit = 50) {
    try {
        // Show loading
        document.getElementById('chart-loading').classList.remove('d-none');
        document.getElementById('chart-empty').classList.add('d-none');
        document.getElementById('chart-container').classList.add('d-none');
        
        const response = await fetch(`/api/chart/device/${deviceId}?limit=${limit}`);
        const data = await response.json();
        
        if (data.success && data.data.length > 0) {
            renderChart(data.data, deviceId);
        } else {
            clearChart();
            showChartEmpty('No data available for this device');
        }
    } catch (error) {
        console.error('Error fetching chart data:', error);
        clearChart();
        showChartEmpty('Error loading chart data');
    }
}

// Check if device is mobile
function isMobileDevice() {
    return window.innerWidth <= 768;
}

// Render chart using Chart.js
function renderChart(chartData, deviceId) {
    document.getElementById('chart-loading').classList.add('d-none');
    document.getElementById('chart-empty').classList.add('d-none');
    document.getElementById('chart-container').classList.remove('d-none');
    
    const isMobile = isMobileDevice();
    
    // Prepare data
    const labels = chartData.map(item => {
        const date = new Date(item.datetime);
        
        // ✅ Shorter labels on mobile
        if (isMobile) {
            return date.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }).replace(',', '\n'); // ✅ Line break for mobile
        }
        
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    });
    
    const temperatures = chartData.map(item => item.temperature);
    const humidities = chartData.map(item => item.humidity);
    
    // Destroy existing chart
    if (sensorChart) {
        sensorChart.destroy();
    }
    
    // Create new chart
    const ctx = document.getElementById('sensorChart').getContext('2d');
    sensorChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Temperature (°C)',
                    data: temperatures,
                    borderColor: 'rgb(255, 99, 132)',
                    backgroundColor: 'rgba(255, 99, 132, 0.1)',
                    borderWidth: isMobile ? 1.5 : 2, // ✅ Thinner on mobile
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y',
                    pointRadius: isMobile ? 2 : 3, // ✅ Smaller points on mobile
                    pointHoverRadius: 5
                },
                {
                    label: 'Humidity (%)',
                    data: humidities,
                    borderColor: 'rgb(54, 162, 235)',
                    backgroundColor: 'rgba(54, 162, 235, 0.1)',
                    borderWidth: isMobile ? 1.5 : 2,
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y1',
                    pointRadius: isMobile ? 2 : 3,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false, // ✅ CRITICAL for responsive height
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                title: {
                    display: true,
                    text: `Device: ${deviceId}`,
                    font: {
                        size: isMobile ? 14 : 16,
                        weight: 'bold'
                    },
                    padding: {
                        top: 10,
                        bottom: isMobile ? 15 : 20
                    }
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        boxWidth: isMobile ? 10 : 12,
                        padding: isMobile ? 10 : 15,
                        font: {
                            size: isMobile ? 10 : 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toFixed(2);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    title: {
                        display: !isMobile, // ✅ Hide on mobile to save space
                        text: 'Time',
                        font: {
                            size: 12,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        maxRotation: isMobile ? 45 : 45,
                        minRotation: isMobile ? 45 : 30,
                        font: {
                            size: isMobile ? 8 : 10
                        },
                        autoSkip: true,
                        maxTicksLimit: isMobile ? 6 : 10 // ✅ Fewer ticks on mobile
                    },
                    grid: {
                        display: true,
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: !isMobile, // ✅ Hide on mobile
                        text: 'Temp (°C)',
                        color: 'rgb(255, 99, 132)',
                        font: {
                            size: 11,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        color: 'rgb(255, 99, 132)',
                        font: {
                            size: isMobile ? 9 : 10
                        }
                    },
                    grid: {
                        color: 'rgba(255, 99, 132, 0.1)'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: !isMobile, // ✅ Hide on mobile
                        text: 'Humidity (%)',
                        color: 'rgb(54, 162, 235)',
                        font: {
                            size: 11,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        color: 'rgb(54, 162, 235)',
                        font: {
                            size: isMobile ? 9 : 10
                        }
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });
}

// Re-render chart on window resize
let resizeTimeout;
window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        const currentDevice = chartDeviceSelect.value;
        if (currentDevice && sensorChart) {
            const limit = parseInt(chartLimitSelect.value);
            fetchChartData(currentDevice, limit);
        }
    }, 300); // Debounce 300ms
});

// ✨ NEW: Clear chart
function clearChart() {
    if (sensorChart) {
        sensorChart.destroy();
        sensorChart = null;
    }
    document.getElementById('chart-loading').classList.add('d-none');
    document.getElementById('chart-container').classList.add('d-none');
    document.getElementById('chart-empty').classList.remove('d-none');
}

// Show chart empty state
function showChartEmpty(message = 'Select a device to view the chart') {
    document.getElementById('chart-loading').classList.add('d-none');
    document.getElementById('chart-container').classList.add('d-none');
    const emptyDiv = document.getElementById('chart-empty');
    emptyDiv.innerHTML = `
        <i class="bi bi-graph-up fs-1"></i>
        <p class="mt-2">${message}</p>
    `;
    emptyDiv.classList.remove('d-none');
}

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
            
            // Add new row to the top of the table (only on page 1 and matching filter)
            if (currentPage === 1) {
                // Check if device matches filter
                if (!selectedDeviceFilter || newLog.device_id === selectedDeviceFilter) {
                    addLogToTable(newLog);
                    updatePaginationAfterRealtimeData();
                }
            }
            
            // Show notification
            showNotification(newLog);
            
            // Update stats
            fetchOverviewStats();
            
            // Update chart if device matches
            if (chartDeviceSelect.value === newLog.device_id) {
                const limit = parseInt(chartLimitSelect.value);
                fetchChartData(newLog.device_id, limit);
            }
            
            // Refresh devices list (in case new device appears)
            fetchDevicesList();
            
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

// Fetch logs with pagination and filters
async function fetchLogs(page) {
    try {
        // Show loading
        showLoading();
        
        // Build query params
        let url = `/api/logs?page=${page}&limit=${recordsPerPage}`;
        
        // Add device filter if selected
        if (selectedDeviceFilter) {
            // Use existing endpoint for device-specific logs
            url = `/api/logs/device/${selectedDeviceFilter}?limit=${recordsPerPage * page}`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.success) {
                hideLoading();
                
                // Calculate pagination manually for device filter
                const allLogs = data.data;
                const total = allLogs.length;
                const totalPages = Math.ceil(total / recordsPerPage);
                const startIdx = (page - 1) * recordsPerPage;
                const endIdx = startIdx + recordsPerPage;
                const paginatedLogs = allLogs.slice(startIdx, endIdx);
                
                displayLogs(paginatedLogs);
                renderPagination(page, totalPages, total);
            } else {
                showError(data.error || 'Failed to fetch data');
            }
        } else {
            // Use default paginated endpoint
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.success) {
                hideLoading();
                displayLogs(data.data);
                renderPagination(data.page, data.total_pages, data.total);
            } else {
                showError(data.error || 'Failed to fetch data');
            }
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
        let url = `/api/logs?page=${currentPage}&limit=${recordsPerPage}`;
        
        if (selectedDeviceFilter) {
            url = `/api/logs/device/${selectedDeviceFilter}?limit=${recordsPerPage * currentPage}`;
        }
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            // Only update pagination, don't touch the table
            if (selectedDeviceFilter) {
                const total = data.data.length;
                const totalPages = Math.ceil(total / recordsPerPage);
                renderPagination(currentPage, totalPages, total);
            } else {
                renderPagination(data.page, data.total_pages, data.total);
            }
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

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (eventSource) {
        eventSource.close();
    }
    if (sensorChart) {
        sensorChart.destroy();
    }
});

// Export for debugging (optional)
window.debugLogs = {
    currentPage,
    recordsPerPage,
    selectedDeviceFilter,
    fetchLogs,
    fetchOverviewStats,
    fetchChartData,
    eventSource,
    sensorChart
};