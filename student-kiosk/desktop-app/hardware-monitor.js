// Hardware Monitor Module - Monitors Network and Input Device Activity
// Uses native web APIs - no external dependencies required

class HardwareMonitor {
    constructor(socket, studentInfo) {
        this.socket = socket;
        this.studentInfo = studentInfo;
        this.isNetworkOnline = navigator.onLine;
        this.lastKeyboardActivity = Date.now();
        this.lastMouseActivity = Date.now();
        this.inactivityThreshold = 300000; // 5 minutes in milliseconds
        this.keyboardInactive = false;
        this.mouseInactive = false;
        this.monitoringActive = false;
        this.socketWasConnected = socket && socket.connected;
        this.networkDisconnectDetected = false;
        
        console.log('🔍 Hardware Monitor initialized for:', studentInfo.studentName);
        
        // Load pending alerts from localStorage
        this.loadPendingAlertsFromStorage();
        
        this.startMonitoring();
    }

    startMonitoring() {
        if (this.monitoringActive) {
            console.log('⚠️ Hardware monitoring already active');
            return;
        }
        
        this.monitoringActive = true;
        console.log('🔍 Hardware monitoring started...');
        
        // Monitor network/ethernet
        this.monitorNetwork();
        
        // Monitor socket connection status
        this.monitorSocketConnection();
        
        // Monitor keyboard and mouse activity
        this.monitorInputDevices();
        
        // Periodic activity check (every 30 seconds)
        this.activityCheckInterval = setInterval(() => {
            this.checkInputActivity();
        }, 30000);
        
        // Initial status report
        setTimeout(() => {
            this.sendStatusReport();
        }, 2000);
    }

    // MONITOR SOCKET CONNECTION (Primary Network Detection)
    monitorSocketConnection() {
        console.log('🔌 Socket connection monitoring started');
        
        // Monitor socket connection status every 2 seconds
        this.socketCheckInterval = setInterval(() => {
            const isConnected = this.socket && this.socket.connected;
            
            // Socket disconnected - likely network issue
            if (this.socketWasConnected && !isConnected) {
                console.log('🔴 ========================================');
                console.log('🔴 SOCKET DISCONNECTED - NETWORK ISSUE!');
                console.log('🔴 ========================================');
                
                this.socketWasConnected = false;
                this.networkDisconnectDetected = true;
                
                const alert = {
                    type: 'hardware_disconnect',
                    deviceType: 'Network',
                    studentId: this.studentInfo.studentId,
                    studentName: this.studentInfo.studentName,
                    systemNumber: this.studentInfo.systemNumber,
                    timestamp: new Date().toISOString(),
                    message: `Network/Ethernet disconnected on ${this.studentInfo.systemNumber}`,
                    severity: 'critical'
                };
                
                console.log('🚨 Network disconnect detected via socket:', alert);
                
                // Store in localStorage immediately
                this.storeAlertInLocalStorage(alert);
            }
            
            // Socket reconnected - network restored
            if (!this.socketWasConnected && isConnected) {
                console.log('🟢 ========================================');
                console.log('🟢 SOCKET RECONNECTED - NETWORK RESTORED!');
                console.log('🟢 ========================================');
                
                this.socketWasConnected = true;
                
                // Send disconnect alert if it was detected
                if (this.networkDisconnectDetected) {
                    this.networkDisconnectDetected = false;
                    
                    // Send all pending alerts from storage
                    this.sendPendingAlertsFromStorage();
                    
                    // Send reconnect alert
                    const alert = {
                        type: 'hardware_reconnect',
                        deviceType: 'Network',
                        studentId: this.studentInfo.studentId,
                        studentName: this.studentInfo.studentName,
                        systemNumber: this.studentInfo.systemNumber,
                        timestamp: new Date().toISOString(),
                        message: `Network/Ethernet reconnected on ${this.studentInfo.systemNumber}`,
                        severity: 'info'
                    };
                    
                    console.log('✅ Network reconnect alert:', alert);
                    this.sendAlert(alert);
                }
            }
        }, 2000);
    }

    // MONITOR ETHERNET/NETWORK CONNECTION
    monitorNetwork() {
        console.log('🌐 Network monitoring started. Current status:', navigator.onLine ? 'Online' : 'Offline');
        
        // Listen for network online/offline events
        window.addEventListener('offline', () => {
            console.log('🔴 ========================================');
            console.log('🔴 NETWORK OFFLINE EVENT DETECTED!');
            console.log('🔴 ========================================');
            console.log('📊 Student Info:', this.studentInfo);
            console.log('📊 Socket Connected:', this.socket && this.socket.connected);
            this.isNetworkOnline = false;
            
            const alert = {
                type: 'hardware_disconnect',
                deviceType: 'Network',
                studentId: this.studentInfo.studentId,
                studentName: this.studentInfo.studentName,
                systemNumber: this.studentInfo.systemNumber,
                timestamp: new Date().toISOString(),
                message: `Network disconnected on ${this.studentInfo.systemNumber}`,
                severity: 'critical'
            };
            
            console.log('🚨 Preparing to send alert:', alert);
            this.sendAlert(alert);
        });

        window.addEventListener('online', () => {
            console.log('🟢 ========================================');
            console.log('🟢 NETWORK ONLINE EVENT DETECTED!');
            console.log('🟢 ========================================');
            console.log('📊 Student Info:', this.studentInfo);
            console.log('📊 Socket Connected:', this.socket && this.socket.connected);
            this.isNetworkOnline = true;
            
            const alert = {
                type: 'hardware_reconnect',
                deviceType: 'Network',
                studentId: this.studentInfo.studentId,
                studentName: this.studentInfo.studentName,
                systemNumber: this.studentInfo.systemNumber,
                timestamp: new Date().toISOString(),
                message: `Network reconnected on ${this.studentInfo.systemNumber}`,
                severity: 'info'
            };
            
            console.log('✅ Preparing to send alert:', alert);
            this.sendAlert(alert);
        });

        // Periodic network check (backup method) - every 5 seconds
        this.networkCheckInterval = setInterval(() => {
            const currentStatus = navigator.onLine;
            if (currentStatus !== this.isNetworkOnline) {
                console.log('🔄 Network status changed:', currentStatus ? 'Online' : 'Offline');
                this.isNetworkOnline = currentStatus;
                
                if (!currentStatus) {
                    this.sendAlert({
                        type: 'hardware_disconnect',
                        deviceType: 'Network',
                        studentId: this.studentInfo.studentId,
                        studentName: this.studentInfo.studentName,
                        systemNumber: this.studentInfo.systemNumber,
                        timestamp: new Date().toISOString(),
                        message: `Network disconnected on ${this.studentInfo.systemNumber}`,
                        severity: 'critical'
                    });
                } else {
                    this.sendAlert({
                        type: 'hardware_reconnect',
                        deviceType: 'Network',
                        studentId: this.studentInfo.studentId,
                        studentName: this.studentInfo.studentName,
                        systemNumber: this.studentInfo.systemNumber,
                        timestamp: new Date().toISOString(),
                        message: `Network reconnected on ${this.studentInfo.systemNumber}`,
                        severity: 'info'
                    });
                }
            }
        }, 5000);
    }

    // MONITOR KEYBOARD AND MOUSE ACTIVITY
    monitorInputDevices() {
        console.log('⌨️🖱️ Input device monitoring started');
        
        // Monitor keyboard activity
        document.addEventListener('keydown', () => {
            const wasInactive = this.keyboardInactive;
            this.lastKeyboardActivity = Date.now();
            this.keyboardInactive = false;
            
            if (wasInactive) {
                console.log('✅ Keyboard activity detected - device reconnected');
                this.sendAlert({
                    type: 'hardware_reconnect',
                    deviceType: 'Keyboard',
                    studentId: this.studentInfo.studentId,
                    studentName: this.studentInfo.studentName,
                    systemNumber: this.studentInfo.systemNumber,
                    timestamp: new Date().toISOString(),
                    message: `Keyboard activity resumed on ${this.studentInfo.systemNumber}`,
                    severity: 'info'
                });
            }
        }, { passive: true });

        // Monitor mouse activity
        const mouseActivityHandler = () => {
            const wasInactive = this.mouseInactive;
            this.lastMouseActivity = Date.now();
            this.mouseInactive = false;
            
            if (wasInactive) {
                console.log('✅ Mouse activity detected - device reconnected');
                this.sendAlert({
                    type: 'hardware_reconnect',
                    deviceType: 'Mouse',
                    studentId: this.studentInfo.studentId,
                    studentName: this.studentInfo.studentName,
                    systemNumber: this.studentInfo.systemNumber,
                    timestamp: new Date().toISOString(),
                    message: `Mouse activity resumed on ${this.studentInfo.systemNumber}`,
                    severity: 'info'
                });
            }
        };

        document.addEventListener('mousemove', mouseActivityHandler, { passive: true });
        document.addEventListener('mousedown', mouseActivityHandler, { passive: true });
        document.addEventListener('click', mouseActivityHandler, { passive: true });
    }

    // CHECK FOR INPUT DEVICE INACTIVITY
    checkInputActivity() {
        const now = Date.now();
        const keyboardInactiveTime = now - this.lastKeyboardActivity;
        const mouseInactiveTime = now - this.lastMouseActivity;

        // Check keyboard inactivity
        if (!this.keyboardInactive && keyboardInactiveTime > this.inactivityThreshold) {
            console.log('⚠️ Keyboard inactivity detected - possible disconnection');
            this.keyboardInactive = true;
            this.sendAlert({
                type: 'hardware_disconnect',
                deviceType: 'Keyboard',
                studentId: this.studentInfo.studentId,
                studentName: this.studentInfo.studentName,
                systemNumber: this.studentInfo.systemNumber,
                timestamp: new Date().toISOString(),
                message: `Keyboard inactive for ${Math.floor(keyboardInactiveTime / 60000)} minutes on ${this.studentInfo.systemNumber}`,
                severity: 'warning'
            });
        }

        // Check mouse inactivity
        if (!this.mouseInactive && mouseInactiveTime > this.inactivityThreshold) {
            console.log('⚠️ Mouse inactivity detected - possible disconnection');
            this.mouseInactive = true;
            this.sendAlert({
                type: 'hardware_disconnect',
                deviceType: 'Mouse',
                studentId: this.studentInfo.studentId,
                studentName: this.studentInfo.studentName,
                systemNumber: this.studentInfo.systemNumber,
                timestamp: new Date().toISOString(),
                message: `Mouse inactive for ${Math.floor(mouseInactiveTime / 60000)} minutes on ${this.studentInfo.systemNumber}`,
                severity: 'warning'
            });
        }
    }

    // SEND STATUS REPORT
    sendStatusReport() {
        console.log('📊 Sending hardware status report');
        
        const status = {
            type: 'hardware_status',
            studentId: this.studentInfo.studentId,
            studentName: this.studentInfo.studentName,
            systemNumber: this.studentInfo.systemNumber,
            timestamp: new Date().toISOString(),
            network: this.isNetworkOnline ? 'Connected' : 'Disconnected',
            keyboard: this.keyboardInactive ? 'Inactive' : 'Active',
            mouse: this.mouseInactive ? 'Inactive' : 'Active'
        };
        
        if (this.socket && this.socket.connected) {
            this.socket.emit('hardware-status', status);
            console.log('✅ Status report sent:', status);
        }
    }

    // SEND ALERT TO SERVER
    sendAlert(alertData) {
        console.log('🚨 Attempting to send hardware alert:', alertData.deviceType, alertData.type);
        
        if (this.socket && this.socket.connected) {
            this.socket.emit('hardware-alert', alertData);
            console.log('✅ Alert sent successfully via socket');
            return true;
        } else {
            console.error('❌ Socket not connected, storing alert for later');
            // Store in localStorage for persistence
            this.storeAlertInLocalStorage(alertData);
            return false;
        }
    }

    // STORE ALERT IN LOCALSTORAGE
    storeAlertInLocalStorage(alertData) {
        try {
            const storageKey = 'pendingHardwareAlerts';
            let alerts = [];
            
            const stored = localStorage.getItem(storageKey);
            if (stored) {
                alerts = JSON.parse(stored);
            }
            
            alerts.push(alertData);
            localStorage.setItem(storageKey, JSON.stringify(alerts));
            
            console.log('💾 Alert stored in localStorage. Total pending:', alerts.length);
        } catch (error) {
            console.error('❌ Error storing alert in localStorage:', error);
            // Fallback to memory storage
            this.storeAlertForRetry(alertData);
        }
    }

    // LOAD PENDING ALERTS FROM LOCALSTORAGE
    loadPendingAlertsFromStorage() {
        try {
            const storageKey = 'pendingHardwareAlerts';
            const stored = localStorage.getItem(storageKey);
            
            if (stored) {
                const alerts = JSON.parse(stored);
                console.log('📥 Loaded', alerts.length, 'pending alerts from localStorage');
                return alerts;
            }
        } catch (error) {
            console.error('❌ Error loading alerts from localStorage:', error);
        }
        return [];
    }

    // SEND PENDING ALERTS FROM LOCALSTORAGE
    sendPendingAlertsFromStorage() {
        try {
            const storageKey = 'pendingHardwareAlerts';
            const alerts = this.loadPendingAlertsFromStorage();
            
            if (alerts.length === 0) {
                console.log('✅ No pending alerts to send');
                return;
            }
            
            console.log('📤 Sending', alerts.length, 'pending alerts from storage');
            
            alerts.forEach((alert, index) => {
                // Add a small delay between sending multiple alerts
                setTimeout(() => {
                    console.log(`📤 Sending stored alert ${index + 1}/${alerts.length}:`, alert.deviceType, alert.type);
                    this.sendAlert(alert);
                }, index * 500);
            });
            
            // Clear storage after sending
            localStorage.removeItem(storageKey);
            console.log('✅ Pending alerts sent and storage cleared');
        } catch (error) {
            console.error('❌ Error sending pending alerts:', error);
        }
    }

    // STORE ALERT FOR RETRY (Memory fallback)
    storeAlertForRetry(alertData) {
        if (!this.pendingAlerts) {
            this.pendingAlerts = [];
        }
        this.pendingAlerts.push(alertData);
        console.log('📦 Alert stored in memory. Pending alerts:', this.pendingAlerts.length);
    }

    // RETRY PENDING ALERTS (Memory)
    retryPendingAlerts() {
        // First send alerts from localStorage
        this.sendPendingAlertsFromStorage();
        
        // Then send alerts from memory
        if (!this.pendingAlerts || this.pendingAlerts.length === 0) {
            return;
        }

        console.log('🔄 Retrying', this.pendingAlerts.length, 'pending alerts from memory');
        
        while (this.pendingAlerts.length > 0) {
            const alert = this.pendingAlerts.shift();
            this.sendAlert(alert);
        }
    }

    // STOP MONITORING
    stopMonitoring() {
        if (!this.monitoringActive) {
            return;
        }
        
        this.monitoringActive = false;
        
        // Clear intervals
        if (this.networkCheckInterval) {
            clearInterval(this.networkCheckInterval);
            this.networkCheckInterval = null;
        }
        
        if (this.socketCheckInterval) {
            clearInterval(this.socketCheckInterval);
            this.socketCheckInterval = null;
        }
        
        if (this.activityCheckInterval) {
            clearInterval(this.activityCheckInterval);
            this.activityCheckInterval = null;
        }
        
        console.log('⏹️ Hardware monitoring stopped');
    }

    // UPDATE SOCKET (in case socket reconnects)
    updateSocket(newSocket) {
        this.socket = newSocket;
        console.log('🔌 Socket updated in hardware monitor');
        
        // Retry any pending alerts
        this.retryPendingAlerts();
    }

    // GET CURRENT STATUS
    getStatus() {
        return {
            network: this.isNetworkOnline ? 'Connected' : 'Disconnected',
            keyboard: this.keyboardInactive ? 'Inactive' : 'Active',
            mouse: this.mouseInactive ? 'Inactive' : 'Active',
            lastKeyboardActivity: new Date(this.lastKeyboardActivity).toLocaleString(),
            lastMouseActivity: new Date(this.lastMouseActivity).toLocaleString()
        };
    }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HardwareMonitor;
}
