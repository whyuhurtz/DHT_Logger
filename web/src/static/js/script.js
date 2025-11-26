// Global variables
let currentPage = 1;
let recordsPerPage = 10;
let selectedDeviceFilter = '';
let eventSource = null;
let deviceCharts = {}; // Store multiple charts
let selectedMetric = 'temperature';

// Color palette for each devices
const DEVICE_COLORS = [
    { border: 'rgb(255, 99, 132)', bg: 'rgba(255, 99, 132, 0.1)', name: 'Red' },           // 1
    { border: 'rgb(54, 162, 235)', bg: 'rgba(54, 162, 235, 0.1)', name: 'Blue' },          // 2
    { border: 'rgb(75, 192, 192)', bg: 'rgba(75, 192, 192, 0.1)', name: 'Teal' },          // 3
    { border: 'rgb(255, 206, 86)', bg: 'rgba(255, 206, 86, 0.1)', name: 'Yellow' },        // 4
    { border: 'rgb(153, 102, 255)', bg: 'rgba(153, 102, 255, 0.1)', name: 'Purple' },      // 5
    { border: 'rgb(255, 159, 64)', bg: 'rgba(255, 159, 64, 0.1)', name: 'Orange' },        // 6
    { border: 'rgb(231, 76, 60)', bg: 'rgba(231, 76, 60, 0.1)', name: 'Crimson' },         // 7
    { border: 'rgb(46, 204, 113)', bg: 'rgba(46, 204, 113, 0.1)', name: 'Emerald' },       // 8
    { border: 'rgb(52, 152, 219)', bg: 'rgba(52, 152, 219, 0.1)', name: 'Sky Blue' },      // 9
    { border: 'rgb(241, 196, 15)', bg: 'rgba(241, 196, 15, 0.1)', name: 'Gold' },          // 10
    { border: 'rgb(155, 89, 182)', bg: 'rgba(155, 89, 182, 0.1)', name: 'Amethyst' },      // 11
    { border: 'rgb(26, 188, 156)', bg: 'rgba(26, 188, 156, 0.1)', name: 'Turquoise' },     // 12
];

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

// Filter elements
const deviceFilterSelect = document.getElementById('device-filter');
const recordsPerPageSelect = document.getElementById('records-per-page');
const chartMetricSelect = document.getElementById('chart-metric-select');
const chartLimitSelect = document.getElementById('chart-limit-select');

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    fetchOverviewStats();
    fetchDevicesList();
    fetchLogs(currentPage);
    setupRealtimeUpdates();
    setupFilterListeners();
    
    // Auto-refresh every 5 minutes
    setInterval(() => {
        fetchOverviewStats();
    }, 300000);
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
    
    // Chart metric selection
    chartMetricSelect.addEventListener('change', function() {
        const metric = this.value;
        selectedMetric = metric;
        
        const limit = parseInt(chartLimitSelect.value);
        fetchMultiDeviceChartData(metric, limit);
    });
    
    // Chart limit change
    chartLimitSelect.addEventListener('change', function() {
        const metric = chartMetricSelect.value;
        const limit = parseInt(this.value);
        fetchMultiDeviceChartData(metric, limit);
    });
    
    let retryCount = 0;
    const maxRetries = 5;
    
    const tryLoadChart = async () => {
        try {
            const response = await fetch('/api/chart/all-devices?metric=temperature&limit=50');
            const result = await response.json();
            
            if (result.success && result.devices && result.devices.length > 0) {
                fetchMultiDeviceChartData('temperature', 50);
            } else if (retryCount < maxRetries - 1) {
                retryCount++;
                setTimeout(tryLoadChart, 2000);
            }
        } catch (error) {
            console.error('Error loading initial chart:', error);
            if (retryCount < maxRetries - 1) {
                retryCount++;
                setTimeout(tryLoadChart, 2000);
            }
        }
    };
    
    setTimeout(tryLoadChart, 2000);
}

// Fetch devices list for table filter only
async function fetchDevicesList(retryCount = 0) {
    try {
        const response = await fetch('/api/devices');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.devices && data.devices.length > 0) {
            const currentTableFilter = deviceFilterSelect.value;
            
            deviceFilterSelect.innerHTML = '';
            
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'All Devices';
            deviceFilterSelect.appendChild(defaultOption);
            
            data.devices.forEach(deviceId => {
                const option = document.createElement('option');
                option.value = deviceId;
                option.textContent = deviceId;
                deviceFilterSelect.appendChild(option);
            });
            
            if (currentTableFilter && data.devices.includes(currentTableFilter)) {
                deviceFilterSelect.value = currentTableFilter;
            }
            
        } else if (data.success && (!data.devices || data.devices.length === 0)) {
            deviceFilterSelect.innerHTML = '<option value="">No devices found</option>';
        }
        
    } catch (error) {
        console.error('Error fetching devices:', error);
        
        if (retryCount < 3) {
            setTimeout(() => {
                fetchDevicesList(retryCount + 1);
            }, 2000);
        } else {
            deviceFilterSelect.innerHTML = '<option value="">Error loading devices</option>';
        }
    }
}

// Check if device is mobile
function isMobileDevice() {
    return window.innerWidth <= 768;
}

// Re-render chart on window resize
let resizeTimeout;
window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (Object.keys(deviceCharts).length > 0) {
            const metric = chartMetricSelect.value;
            const limit = parseInt(chartLimitSelect.value);
            fetchMultiDeviceChartData(metric, limit);
        }
    }, 300);
});

// Fetch multi-device chart data
async function fetchMultiDeviceChartData(metric, limit = 50) {
    try {
        document.getElementById('chart-loading').classList.remove('d-none');
        document.getElementById('chart-empty').classList.add('d-none');
        document.getElementById('charts-container').classList.add('d-none');
        
        const response = await fetch(`/api/chart/all-devices?metric=${metric}&limit=${limit}`);
        const result = await response.json();
        
        if (result.success && result.devices.length > 0) {
            renderMultiDeviceCharts(result.data, metric);
        } else {
            clearCharts();
            showChartEmpty('No data available');
        }
    } catch (error) {
        console.error('Error fetching chart data:', error);
        clearCharts();
        showChartEmpty('Error loading chart data');
    }
}

// Render individual charts for each device
function renderMultiDeviceCharts(devicesData, metric) {
    if (typeof Chart === 'undefined') {
        console.error('Chart.js library not loaded!');
        clearCharts();
        showChartEmpty('Chart library failed to load. Please refresh the page.');
        return;
    }
    
    document.getElementById('chart-loading').classList.add('d-none');
    document.getElementById('chart-empty').classList.add('d-none');
    document.getElementById('charts-container').classList.remove('d-none');
    
    const isMobile = isMobileDevice();
    const container = document.getElementById('charts-container');
    
    Object.keys(deviceCharts).forEach(deviceId => {
        if (deviceCharts[deviceId]) {
            deviceCharts[deviceId].destroy();
        }
    });
    deviceCharts = {};
    container.innerHTML = '';
    
    const deviceIds = Object.keys(devicesData);
    const metricTitle = metric === 'temperature' ? 'Temperature' : 'Humidity';
    const metricUnit = metric === 'temperature' ? '°C' : '%';
    
    const metricIcon = metric === 'temperature' 
        ? 'bi bi-thermometer-half' 
        : 'bi bi-droplet-half';
    
    deviceIds.forEach((deviceId, index) => {
        const readings = devicesData[deviceId];
        
        if (readings.length === 0) {
            return;
        }
        
        const color = DEVICE_COLORS[index % DEVICE_COLORS.length];
        
        const chartCard = document.createElement('div');
        chartCard.className = 'device-chart-card mb-3';
        chartCard.innerHTML = `
            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center" style="background: linear-gradient(135deg, ${color.border}, ${color.border}dd); color: #212529;">
                    <div>
                        <i class="${metricIcon}"></i>
                        <strong>${metricTitle}: ${deviceId}</strong>
                    </div>
                    <span class="badge bg-light text-dark">${readings.length} readings</span>
                </div>
                <div class="card-body p-2">
                    <div class="chart-wrapper-individual">
                        <canvas id="chart-${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}"></canvas>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(chartCard);
        
        const labels = readings.map(item => {
            const date = new Date(item.datetime);
            
            if (isMobile) {
                return date.toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }).replace(',', '\n');
            }
            
            return date.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        });
        
        const values = readings.map(item => item.value);
        
        const canvasId = `chart-${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const canvasElement = document.getElementById(canvasId);
        
        if (!canvasElement) {
            console.error(`Canvas element not found: ${canvasId}`);
            return;
        }
        
        const ctx = canvasElement.getContext('2d');
        
        try {
            deviceCharts[deviceId] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: `${metricTitle} (${metricUnit})`,
                        data: values,
                        borderColor: color.border,
                        backgroundColor: color.bg,
                        borderWidth: isMobile ? 2 : 2.5,
                        tension: 0.4,
                        fill: true,
                        pointRadius: isMobile ? 2 : 3,
                        pointHoverRadius: 6,
                        pointBackgroundColor: color.border,
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            padding: 12,
                            titleFont: {
                                size: isMobile ? 11 : 13
                            },
                            bodyFont: {
                                size: isMobile ? 10 : 12
                            },
                            callbacks: {
                                label: function(context) {
                                    const value = context.parsed.y.toFixed(2);
                                    return `${metricTitle}: ${value}${metricUnit}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            display: true,
                            grid: {
                                display: true,
                                color: 'rgba(0, 0, 0, 0.05)'
                            },
                            ticks: {
                                maxRotation: isMobile ? 45 : 30,
                                minRotation: isMobile ? 45 : 30,
                                font: {
                                    size: isMobile ? 8 : 10
                                },
                                autoSkip: true,
                                maxTicksLimit: isMobile ? 6 : 10
                            }
                        },
                        y: {
                            type: 'linear',
                            display: true,
                            grid: {
                                color: 'rgba(0, 0, 0, 0.1)'
                            },
                            ticks: {
                                font: {
                                    size: isMobile ? 9 : 11
                                },
                                callback: function(value) {
                                    return value.toFixed(1) + metricUnit;
                                }
                            }
                        }
                    }
                }
            });
            
        } catch (error) {
            console.error(`Failed to create chart for ${deviceId}:`, error);
        }
    });
}

// Clear all charts
function clearCharts() {
    Object.keys(deviceCharts).forEach(deviceId => {
        if (deviceCharts[deviceId]) {
            deviceCharts[deviceId].destroy();
        }
    });
    deviceCharts = {};
    
    document.getElementById('chart-loading').classList.add('d-none');
    document.getElementById('charts-container').classList.add('d-none');
    document.getElementById('chart-empty').classList.remove('d-none');
}

// Show chart empty state
function showChartEmpty(message = 'Select a metric to view device charts') {
    document.getElementById('chart-loading').classList.add('d-none');
    document.getElementById('charts-container').classList.add('d-none');
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
        showConnectionStatus(true);
    };
    
    eventSource.onmessage = (event) => {
        try {
            const newLog = JSON.parse(event.data);
            
            if (currentPage === 1) {
                if (!selectedDeviceFilter || newLog.device_id === selectedDeviceFilter) {
                    addLogToTable(newLog);
                    updatePaginationAfterRealtimeData();
                }
            }
            
            showNotification(newLog);
            fetchOverviewStats();
            
            const metric = chartMetricSelect.value;
            const limit = parseInt(chartLimitSelect.value);
            fetchMultiDeviceChartData(metric, limit);
            
            fetchDevicesList();
            
        } catch (error) {
            console.error('Failed to parse SSE data:', error);
        }
    };
    
    eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        showConnectionStatus(false);
        
        setTimeout(() => {
            setupRealtimeUpdates();
        }, 5000);
    };
}

// Add new log to table (realtime)
function addLogToTable(log) {
    const tbody = tableBody;
    if (!tbody) return;
    
    const emptyRow = tbody.querySelector('td[colspan="6"]');
    if (emptyRow) {
        tbody.innerHTML = '';
    }
    
    const row = document.createElement('tr');
    row.className = 'new-log';
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
    
    tbody.insertBefore(row, tbody.firstChild);
    
    setTimeout(() => {
        row.classList.remove('new-log');
    }, 2000);
    
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
        showLoading();
        
        let url = `/api/logs?page=${page}&limit=${recordsPerPage}`;
        
        if (selectedDeviceFilter) {
            url = `/api/logs/device/${selectedDeviceFilter}?limit=${recordsPerPage * page}`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.success) {
                hideLoading();
                
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
    
    const prevLi = document.createElement('li');
    prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
    prevLi.innerHTML = `
        <a class="page-link" href="#" onclick="changePage(${currentPage - 1}); return false;">
            <i class="bi bi-chevron-left"></i> Previous
        </a>
    `;
    paginationContainer.appendChild(prevLi);
    
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage < maxVisiblePages - 1) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
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
    
    for (let i = startPage; i <= endPage; i++) {
        const li = document.createElement('li');
        li.className = `page-item ${i === currentPage ? 'active' : ''}`;
        li.innerHTML = `<a class="page-link" href="#" onclick="changePage(${i}); return false;">${i}</a>`;
        paginationContainer.appendChild(li);
    }
    
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
    
    const nextLi = document.createElement('li');
    nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
    nextLi.innerHTML = `
        <a class="page-link" href="#" onclick="changePage(${currentPage + 1}); return false;">
            Next <i class="bi bi-chevron-right"></i>
        </a>
    `;
    paginationContainer.appendChild(nextLi);
    
    const startRecord = (currentPage - 1) * recordsPerPage + 1;
    const endRecord = Math.min(currentPage * recordsPerPage, totalRecords);
    paginationInfo.textContent = `Showing ${startRecord}-${endRecord} of ${totalRecords} records`;
}

// Update pagination after realtime data
async function updatePaginationAfterRealtimeData() {
    try {
        let url = `/api/logs?page=${currentPage}&limit=${recordsPerPage}`;
        
        if (selectedDeviceFilter) {
            url = `/api/logs/device/${selectedDeviceFilter}?limit=${recordsPerPage * currentPage}`;
        }
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
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
        
        if (isNaN(date.getTime())) {
            return dateTimeStr;
        }
        
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
    clearCharts();
});

/* Export for debugging
window.debugLogs = {
    currentPage,
    recordsPerPage,
    selectedDeviceFilter,
    deviceCharts,
    fetchLogs,
    fetchOverviewStats,
    fetchMultiDeviceChartData,
    eventSource
};
*/