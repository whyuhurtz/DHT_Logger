// Global variables
let selectedDevice = null;
let tempChart = null;
let humiChart = null;
let tempGauge = null;
let humiGauge = null;
let eventSource = null;
let selectedRange = 'live';

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 DHT Logger initialized');
    fetchDevicesList();
    setupRealtimeUpdates();
    setupTimeRangeListeners();
});

// ========================================
// FETCH DEVICES LIST FOR NAVBAR
// ========================================

async function fetchDevicesList() {
    try {
        const response = await fetch('/api/devices');
        const data = await response.json();
        
        const tabsContainer = document.getElementById('device-tabs');
        
        if (data.success && data.devices && data.devices.length > 0) {
            tabsContainer.innerHTML = '';
            
            data.devices.forEach((deviceId, index) => {
                const tab = document.createElement('div');
                tab.className = 'device-tab' + (index === 0 ? ' active' : '');
                tab.textContent = deviceId;
                tab.dataset.device = deviceId;
                
                tab.addEventListener('click', function() {
                    selectDevice(deviceId);
                });
                
                tabsContainer.appendChild(tab);
            });
            
            // Auto-select first device and fetch data immediately
            if (data.devices.length > 0) {
                selectDevice(data.devices[0]);
            }
        } else {
            console.warn('⚠️ No devices found');
            tabsContainer.innerHTML = '<div class="device-tab-loading">No devices found</div>';
        }
    } catch (error) {
        console.error('❌ Error fetching devices:', error);
    }
}

// ========================================
// SELECT DEVICE
// ========================================

function selectDevice(deviceId) {
    selectedDevice = deviceId;
    
    // Update active tab
    document.querySelectorAll('.device-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.device === deviceId);
    });
    
    // Fetch data immediately when device is selected
    fetchDeviceData(deviceId, selectedRange);
}

// ========================================
// FETCH DEVICE DATA (Temperature & Humidity)
// ========================================

async function fetchDeviceData(deviceId, range) {
    try {
        console.log(`📊 Fetching ${deviceId} - Range: ${range}`);
        
        // Add cache-busting timestamp to prevent browser caching
        const timestamp = new Date().getTime();
        const response = await fetch(`/api/chart/range/${deviceId}?range=${range}&_t=${timestamp}`, {
            cache: 'no-cache', // ✅ Disable cache
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
        const data = await response.json();
        
        if (data.success) {
            console.log(`✅ Received ${data.history.length} data points`);
            console.log(`📊 Time window: ${data.window_start} → ${data.window_end}`);
            updateGauges(data.current);
            updateCharts(data.history);
        } else {
            console.error('❌ API error:', data.error);
            // Show "No data" message on charts
            showNoDataMessage();
        }
    } catch (error) {
        console.error('❌ Fetch error:', error);
        showNoDataMessage();
    }
}

// ========================================
// SHOW "NO DATA" MESSAGE
// ========================================

function showNoDataMessage() {
    // Show default values
    const tempCurrent = document.getElementById('temp-current');
    const humiCurrent = document.getElementById('humi-current');
    
    if (tempCurrent) tempCurrent.textContent = '--';
    if (humiCurrent) humiCurrent.textContent = '--';
    
    // Destroy existing charts
    if (tempChart) {
        tempChart.destroy();
        tempChart = null;
    }
    if (humiChart) {
        humiChart.destroy();
        humiChart = null;
    }
    if (tempGauge) {
        tempGauge.destroy();
        tempGauge = null;
    }
    if (humiGauge) {
        humiGauge.destroy();
        humiGauge = null;
    }
    
    console.warn('⚠️ No data available for this device yet');
}

// ========================================
// UPDATE GAUGES (Current Values)
// ========================================

function updateGauges(current) {
    const tempCurrent = document.getElementById('temp-current');
    const humiCurrent = document.getElementById('humi-current');
    
    if (!tempCurrent || !humiCurrent) {
        console.error('❌ Gauge elements not found');
        return;
    }
    
    tempCurrent.textContent = current.temperature.toFixed(1);
    humiCurrent.textContent = current.humidity.toFixed(1);
    
    // Create/Update Gauge Charts
    createGaugeChart('temp-gauge', current.temperature, 0, 50, '#ff6384');
    createGaugeChart('humi-gauge', current.humidity, 0, 100, '#36a2eb');
}

// ========================================
// CREATE GAUGE CHART
// ========================================

function createGaugeChart(canvasId, value, min, max, color) {
    const canvas = document.getElementById(canvasId);
    
    if (!canvas) {
        console.error(`❌ Canvas not found: ${canvasId}`);
        return;
    }
    
    const ctx = canvas.getContext('2d');
    
    // Destroy existing chart
    if (canvasId === 'temp-gauge' && tempGauge) {
        tempGauge.destroy();
    }
    if (canvasId === 'humi-gauge' && humiGauge) {
        humiGauge.destroy();
    }
    
    const chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [value, max - value],
                backgroundColor: [color, 'rgba(200, 200, 200, 0.2)'],
                borderWidth: 0
            }]
        },
        options: {
            circumference: 180,
            rotation: -90,
            cutout: '75%',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            }
        }
    });
    
    if (canvasId === 'temp-gauge') tempGauge = chart;
    if (canvasId === 'humi-gauge') humiGauge = chart;
}

// ========================================
// UPDATE CHARTS (Line Charts)
// ========================================

function updateCharts(history) {
    if (!history || history.length === 0) {
        console.warn('⚠️ No chart data available');
        return;
    }
    
    const labels = history.map(item => {
        if (!item.datetime) return 'N/A';
        return new Date(item.datetime).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    });
    
    const tempData = history.map(item => item.temperature);
    const humiData = history.map(item => item.humidity);
    
    // Temperature Chart
    createLineChart('temp-chart', labels, tempData, '#ff6384', 'Temperature (°C)');
    
    // Humidity Chart
    createLineChart('humi-chart', labels, humiData, '#36a2eb', 'Humidity (%)');
}

// ========================================
// CREATE LINE CHART
// ========================================

function createLineChart(canvasId, labels, data, color, label) {
    const canvas = document.getElementById(canvasId);
    
    if (!canvas) {
        console.error(`❌ Canvas not found: ${canvasId}`);
        return;
    }
    
    const ctx = canvas.getContext('2d');
    
    // Destroy existing chart
    if (canvasId === 'temp-chart' && tempChart) tempChart.destroy();
    if (canvasId === 'humi-chart' && humiChart) humiChart.destroy();
    
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                borderColor: color,
                backgroundColor: color + '20',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHitRadius: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    left: 5,
                    right: 5,
                    top: 5,
                    bottom: 20
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 10,
                    displayColors: false,
                    callbacks: {
                        title: function(context) {
                            return context[0].label;
                        },
                        label: function(context) {
                            return label + ': ' + context.parsed.y.toFixed(1);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { 
                        color: 'rgba(0, 0, 0, 0.1)',
                        display: true
                    },
                    ticks: { 
                        color: '#1f2937',
                        maxRotation: 45, 
                        minRotation: 45,
                        font: { size: 9 },
                        autoSkip: true,
                        maxTicksLimit: 8,
                        padding: 8
                    }
                },
                y: {
                    min: 0,
                    max: canvasId === 'temp-chart' ? 50 : 100,
                    ticks: {
                        stepSize: canvasId === 'temp-chart' ? 10 : 20,
                        color: '#1f2937',
                        font: { size: 10 },
                        padding: 5
                    },
                    grid: { 
                        color: 'rgba(0, 0, 0, 0.1)' 
                    }
                }
            }
        }
    });
    
    if (canvasId === 'temp-chart') tempChart = chart;
    if (canvasId === 'humi-chart') humiChart = chart;
}

// ========================================
// TIME RANGE SELECTOR
// ========================================

function setupTimeRangeListeners() {
    // Add event listener to ALL buttons (both panels)
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const range = this.dataset.range;
            selectedRange = range;
            
            console.log(`🔄 Time range changed: ${range}`);
            
            // Update ALL buttons in BOTH panels
            document.querySelectorAll('.time-btn').forEach(b => {
                if (b.dataset.range === range) {
                    b.classList.add('active');
                } else {
                    b.classList.remove('active');
                }
            });
            
            // Force refetch data with new range
            if (selectedDevice) {
                console.log(`🔃 Forcing data refresh for ${selectedDevice} with range ${range}`);
                fetchDeviceData(selectedDevice, range);
            }
        });
    });
}

// ========================================
// REALTIME UPDATES (SSE)
// ========================================

function setupRealtimeUpdates() {
    if (eventSource) eventSource.close();
    
    eventSource = new EventSource('/api/events/stream');
    
    eventSource.onopen = () => {
        console.log('✅ SSE Connected');
        showConnectionStatus(true);
    };
    
    eventSource.onmessage = (event) => {
        try {
            const newLog = JSON.parse(event.data);
            console.log('📨 New data received:', newLog.device_id);
            
            // Only update if "Live" range is selected
            if (selectedDevice && newLog.device_id === selectedDevice && selectedRange === 'live') {
                console.log('🔄 Updating current device data (Live mode)');
                fetchDeviceData(selectedDevice, selectedRange);
            }
            
            // If no device selected yet, auto-select the first one
            if (!selectedDevice) {
                console.log('🎯 Auto-selecting device:', newLog.device_id);
                selectDevice(newLog.device_id);
                // Also refresh device list to show new device in navbar
                fetchDevicesList();
            }
        } catch (error) {
            console.error('❌ SSE error:', error);
        }
    };
    
    eventSource.onerror = () => {
        console.warn('⚠️ SSE disconnected, reconnecting...');
        showConnectionStatus(false);
        setTimeout(() => setupRealtimeUpdates(), 5000);
    };
}

// ========================================
// CONNECTION STATUS
// ========================================

function showConnectionStatus(connected) {
    const wifiIcon = document.getElementById('wifi-indicator');
    
    if (connected) {
        wifiIcon.className = 'wifi-indicator connected';
        wifiIcon.innerHTML = '<i class="bi bi-wifi"></i>';
    } else {
        wifiIcon.className = 'wifi-indicator disconnected';
        wifiIcon.innerHTML = '<i class="bi bi-wifi-off"></i>';
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (eventSource) eventSource.close();
    if (tempChart) tempChart.destroy();
    if (humiChart) humiChart.destroy();
    if (tempGauge) tempGauge.destroy();
    if (humiGauge) humiGauge.destroy();
});