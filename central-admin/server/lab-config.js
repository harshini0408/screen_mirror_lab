/**
 * Multi-Lab Configuration
 * Maps IP address prefixes to lab IDs
 * 
 * Each lab has:
 * - labId: Unique identifier (e.g., CC1, CC2)
 * - labName: Full name for display
 * - ipPrefix: Network prefix (e.g., "10.10.46")
 * - systemCount: Number of systems in this lab
 * - systemRange: Array of system numbers
 */

const LAB_CONFIG = {
  // Computer Center Lab 1
  'CC1': {
    labId: 'CC1',
    labName: 'Computer Center Lab 1',
    ipPrefix: '192.168.29',  // For testing on laptop
    systemCount: 60,
    systemRange: generateSystemRange('CC1', 60)
  },
  
  // Computer Center Lab 2
  'CC2': {
    labId: 'CC2',
    labName: 'Computer Center Lab 2',
    ipPrefix: '10.10.46',
    systemCount: 60,
    systemRange: generateSystemRange('CC2', 60)
  },
  
  // Computer Center Lab 3
  'CC3': {
    labId: 'CC3',
    labName: 'Computer Center Lab 3',
    ipPrefix: '10.10.47',
    systemCount: 60,
    systemRange: generateSystemRange('CC3', 60)
  },
  
  // Computer Center Lab 4
  'CC4': {
    labId: 'CC4',
    labName: 'Computer Center Lab 4',
    ipPrefix: '10.10.48',
    systemCount: 60,
    systemRange: generateSystemRange('CC4', 60)
  },
  
  // Computer Center Lab 5
  'CC5': {
    labId: 'CC5',
    labName: 'Computer Center Lab 5',
    ipPrefix: '10.10.49',
    systemCount: 60,
    systemRange: generateSystemRange('CC5', 60)
  },
  
  // Add more labs as needed...
};

/**
 * Generate system numbers for a lab
 * @param {string} labId - Lab identifier (e.g., 'CC1')
 * @param {number} count - Number of systems (e.g., 60)
 * @returns {Array<string>} Array of system numbers (e.g., ['CC1-01', 'CC1-02', ...])
 */
function generateSystemRange(labId, count) {
  const systems = [];
  for (let i = 1; i <= count; i++) {
    const systemNum = i.toString().padStart(2, '0');
    systems.push(`${labId}-${systemNum}`);
  }
  return systems;
}

/**
 * Detect lab ID from IP address
 * @param {string} ipAddress - IP address (e.g., '10.10.46.101')
 * @returns {string|null} Lab ID (e.g., 'CC2') or null if not found
 */
function detectLabFromIP(ipAddress) {
  if (!ipAddress || ipAddress === 'localhost' || ipAddress === '127.0.0.1') {
    return 'CC1'; // Default for localhost testing
  }
  
  // Extract first 3 octets (e.g., '10.10.46' from '10.10.46.101')
  const parts = ipAddress.split('.');
  if (parts.length < 3) return null;
  
  const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
  
  // Find matching lab
  for (const [labId, config] of Object.entries(LAB_CONFIG)) {
    if (config.ipPrefix === prefix) {
      console.log(`✅ Detected lab ${labId} from IP prefix ${prefix}`);
      return labId;
    }
  }
  
  console.warn(`⚠️ No lab found for IP prefix ${prefix}, defaulting to CC1`);
  return 'CC1'; // Default fallback
}

/**
 * Get lab configuration
 * @param {string} labId - Lab ID (e.g., 'CC1')
 * @returns {Object|null} Lab configuration or null
 */
function getLabConfig(labId) {
  return LAB_CONFIG[labId] || null;
}

/**
 * Get all lab IDs
 * @returns {Array<string>} Array of lab IDs
 */
function getAllLabIds() {
  return Object.keys(LAB_CONFIG);
}

/**
 * Get all lab configurations
 * @returns {Object} All lab configurations
 */
function getAllLabConfigs() {
  return LAB_CONFIG;
}

/**
 * Validate if a lab ID exists
 * @param {string} labId - Lab ID to validate
 * @returns {boolean} True if lab exists
 */
function isValidLabId(labId) {
  return labId && LAB_CONFIG.hasOwnProperty(labId);
}

module.exports = {
  LAB_CONFIG,
  detectLabFromIP,
  getLabConfig,
  getAllLabIds,
  getAllLabConfigs,
  isValidLabId,
  generateSystemRange
};
