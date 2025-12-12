// IP Address Auto-Detection Utility
const os = require('os');
const fs = require('fs');
const path = require('path');

/**
 * Detects the primary local network IP address
 * @returns {string} The detected IP address or 'localhost'
 */
function detectLocalIP() {
  const interfaces = os.networkInterfaces();
  
  // Priority order: WiFi, Ethernet, then any other interface
  const priorityOrder = ['Wi-Fi', 'WiFi', 'Ethernet', 'eth0', 'en0', 'wlan0'];
  
  // First, try priority interfaces
  for (const name of priorityOrder) {
    if (interfaces[name]) {
      const iface = interfaces[name].find(
        details => details.family === 'IPv4' && !details.internal
      );
      if (iface) {
        console.log(`✅ Detected IP from ${name}: ${iface.address}`);
        return iface.address;
      }
    }
  }
  
  // Fallback: Find any non-internal IPv4 address
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name].find(
      details => details.family === 'IPv4' && !details.internal
    );
    if (iface) {
      console.log(`✅ Detected IP from ${name}: ${iface.address}`);
      return iface.address;
    }
  }
  
  console.warn('⚠️ Could not detect network IP, using localhost');
  return 'localhost';
}

/**
 * Saves the detected IP to the shared configuration file
 * @param {string} ip - The IP address to save
 * @param {number} port - The server port
 */
function saveServerConfig(ip, port = 7401) {
  const configPath = path.join(__dirname, '..', '..', 'server-config.json');
  
  const config = {
    serverIp: ip,
    serverPort: port,
    lastUpdated: new Date().toISOString(),
    autoDetect: true
  };
  
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`✅ Server config saved to: ${configPath}`);
    console.log(`📡 Server IP: ${ip}:${port}`);
  } catch (error) {
    console.error('❌ Error saving server config:', error.message);
  }
}

/**
 * Loads the server configuration
 * @returns {Object} The server configuration
 */
function loadServerConfig() {
  const configPath = path.join(__dirname, '..', '..', 'server-config.json');
  
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(data);
      console.log(`✅ Loaded server config from: ${configPath}`);
      console.log(`📡 Server IP: ${config.serverIp}:${config.serverPort}`);
      return config;
    }
  } catch (error) {
    console.error('⚠️ Error loading server config:', error.message);
  }
  
  // Default fallback
  return {
    serverIp: 'localhost',
    serverPort: 7401,
    autoDetect: true
  };
}

/**
 * Gets the server URL (with auto-detection if enabled)
 * @param {number} port - The server port
 * @returns {string} The complete server URL
 */
function getServerUrl(port = 7401) {
  const config = loadServerConfig();
  
  if (config.autoDetect) {
    const ip = detectLocalIP();
    saveServerConfig(ip, port);
    return `http://${ip}:${port}`;
  }
  
  return `http://${config.serverIp}:${config.serverPort}`;
}

module.exports = {
  detectLocalIP,
  saveServerConfig,
  loadServerConfig,
  getServerUrl
};
