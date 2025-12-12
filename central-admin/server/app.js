require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cron = require('node-cron');

// IP Auto-Detection
const { detectLocalIP, saveServerConfig } = require('./ip-detector');

// Multi-Lab Configuration
const { detectLabFromIP, getLabConfig, getAllLabConfigs, isValidLabId } = require('./lab-config');

// NEW: CSV Import Dependencies (using secure ExcelJS instead of xlsx)
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const ExcelJS = require('exceljs');

// CSV Session Storage Directories
const SESSION_CSV_DIR = path.join(__dirname, 'session-csvs');
const MANUAL_REPORT_DIR = path.join(__dirname, 'reports', 'manual');
const AUTO_REPORT_DIR = path.join(__dirname, 'reports', 'automatic');

// Create directories if they don't exist
if (!fs.existsSync(SESSION_CSV_DIR)) fs.mkdirSync(SESSION_CSV_DIR, { recursive: true });
if (!fs.existsSync(MANUAL_REPORT_DIR)) fs.mkdirSync(MANUAL_REPORT_DIR, { recursive: true });
if (!fs.existsSync(AUTO_REPORT_DIR)) fs.mkdirSync(AUTO_REPORT_DIR, { recursive: true });

// NEW: Email and OTP Dependencies
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve server-config.json for clients to discover server IP (BEFORE static files)
app.get('/server-config.json', (req, res) => {
  const configPath = path.join(__dirname, '..', '..', 'server-config.json');
  if (fs.existsSync(configPath)) {
    res.sendFile(configPath);
  } else {
    // Return default config if file doesn't exist
    const defaultConfig = {
      serverIp: detectLocalIP(),
      serverPort: process.env.PORT || 7401,
      lastUpdated: new Date().toISOString(),
      autoDetect: true
    };
    res.json(defaultConfig);
  }
});

// IMPORTANT: API routes must be defined BEFORE static file middleware
// Static files will be served last as a catch-all

// Serve student sign-in system
app.use('/student-signin', express.static(path.join(__dirname, '../../student-signin')));

// Serve student management system
app.use('/student-management', express.static(path.join(__dirname, '../../')));

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://srijaaanandhan12_db_user:122007@cluster0.2kzkkpe.mongodb.net/college-lab-registration?retryWrites=true&w=majority';
const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;

// Enhanced MongoDB Connection with Connection Pooling
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4
})
  .then(async () => {
    console.log("✅ MongoDB connected successfully");
    
    // Clean up any lingering active sessions from previous server runs
    await cleanupStaleSessions();
    
    // Seed default departments after connection is established
    await seedDefaultDepartments();
  })
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Student Schema
const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  studentId: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true },
  passwordHash: { type: String },
  dateOfBirth: { type: Date, required: true },
  department: { type: String, required: true },
  section: { type: String, default: 'A' }, // Added section field
  year: { type: Number, required: true },
  labId: { type: String, required: true },
  isPasswordSet: { type: Boolean, default: false },
  registeredAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

studentSchema.methods.verifyPassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

const Student = mongoose.model('Student', studentSchema);

// Session Schema
const sessionSchema = new mongoose.Schema({
  studentName: String,
  studentId: String,
  computerName: String,
  labId: String,
  systemNumber: String,
  loginTime: { type: Date, default: Date.now },
  logoutTime: Date,
  duration: Number,
  status: { type: String, enum: ['active', 'completed'], default: 'active' },
  screenshot: String
});

const Session = mongoose.model('Session', sessionSchema);

// Lab Session Schema (for managing entire lab sessions with metadata)
const labSessionSchema = new mongoose.Schema({
  labId: { type: String, required: true, default: 'CC1' }, // 🔧 MULTI-LAB: Lab identifier (CC1, CC2, etc.)
  subject: { type: String, required: true },
  faculty: { type: String, required: true },
  year: { type: Number, required: false, default: 1 }, // Made optional for backward compatibility
  department: { type: String, required: false, default: 'Computer Science' }, // Made optional for backward compatibility
  section: { type: String, required: false, default: 'None' }, // Made optional for backward compatibility
  periods: { type: Number, required: true },
  expectedDuration: { type: Number, required: true }, // in minutes
  startTime: { type: Date, default: Date.now },
  endTime: Date,
  status: { type: String, enum: ['active', 'completed'], default: 'active' },
  createdBy: { type: String, default: 'admin' },
  studentRecords: [{
    studentName: String,
    studentId: String,
    systemNumber: String,
    loginTime: Date,
    logoutTime: Date,
    duration: Number, // in seconds
    status: { type: String, enum: ['active', 'completed'], default: 'active' }
  }]
});

// Add index for efficient lab-based queries
labSessionSchema.index({ labId: 1, status: 1 });

const LabSession = mongoose.model('LabSession', labSessionSchema);

// Cleanup function to mark all active sessions as completed when server starts
async function cleanupStaleSessions() {
  try {
    const staleSessions = await Session.find({ status: 'active' });
    
    if (staleSessions.length > 0) {
      console.log(`🧹 Cleaning up ${staleSessions.length} stale active session(s) from previous server run...`);
      
      const now = new Date();
      await Session.updateMany(
        { status: 'active' },
        { 
          status: 'completed',
          logoutTime: now,
          duration: 0, // Can't calculate accurate duration for interrupted sessions
          notes: 'Auto-closed: Server restart'
        }
      );
      
      console.log(`✅ Cleaned up ${staleSessions.length} stale session(s)`);
    } else {
      console.log(`✅ No stale sessions found - database is clean`);
    }
    
    // Also cleanup any active lab sessions
    const staleLabSessions = await LabSession.find({ status: 'active' });
    if (staleLabSessions.length > 0) {
      console.log(`🧹 Cleaning up ${staleLabSessions.length} stale active lab session(s)...`);
      
      const now = new Date();
      await LabSession.updateMany(
        { status: 'active' },
        { 
          status: 'completed',
          endTime: now
        }
      );
      
      console.log(`✅ Cleaned up ${staleLabSessions.length} stale lab session(s)`);
    }
  } catch (error) {
    console.error('❌ Error cleaning up stale sessions:', error);
  }
}

// One-Time Password Schema
const oneTimePasswordSchema = new mongoose.Schema({
  studentId: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isUsed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) }, // 24 hours
  createdBy: { type: String, default: 'admin' }
});

const OneTimePassword = mongoose.model('OneTimePassword', oneTimePasswordSchema);

// OTP Schema for password reset
const otpSchema = new mongoose.Schema({
  studentId: { type: String, required: true },
  email: { type: String, required: true },
  otp: { type: String, required: true },
  isUsed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 10 * 60 * 1000) } // 10 minutes
});

const OTP = mongoose.model('OTP', otpSchema);

// Timetable Entry Schema
const timetableEntrySchema = new mongoose.Schema({
  sessionDate: { type: Date, required: true },
  startTime: { type: String, required: true }, // Format: "09:00"
  endTime: { type: String, required: true }, // Format: "10:40"
  faculty: { type: String, required: true },
  subject: { type: String, required: true },
  labId: { type: String, required: true },
  year: { type: Number, required: true },
  department: { type: String, required: true },
  section: { type: String, default: 'A' },
  periods: { type: Number, required: true },
  duration: { type: Number, required: true }, // in minutes
  maxStudents: { type: Number, default: 60 },
  remarks: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  isProcessed: { type: Boolean, default: false }, // Whether session has been auto-started
  labSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabSession' }, // Link to created lab session
  uploadedAt: { type: Date, default: Date.now },
  uploadedBy: { type: String, default: 'admin' }
});

// Add index for efficient querying
timetableEntrySchema.index({ sessionDate: 1, startTime: 1, labId: 1 });

const TimetableEntry = mongoose.model('TimetableEntry', timetableEntrySchema);

// Report Schedule Schema - Updated to support 2 schedules per day
const reportScheduleSchema = new mongoose.Schema({
  labId: { type: String, required: true, unique: true },
  // Schedule 1 (Morning/Afternoon)
  scheduleTime1: { type: String, default: '13:00' }, // 24-hour format HH:MM
  enabled1: { type: Boolean, default: true },
  // Schedule 2 (Evening)
  scheduleTime2: { type: String, default: '18:00' }, // 24-hour format HH:MM
  enabled2: { type: Boolean, default: true },
  // Legacy support
  scheduleTime: { type: String }, // Kept for backward compatibility
  enabled: { type: Boolean }, // Kept for backward compatibility
  lastGenerated: { type: Date },
  outputPath: { type: String, default: './reports' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const ReportSchedule = mongoose.model('ReportSchedule', reportScheduleSchema);

// Department master data
// ================== DEPARTMENT MASTER DATA ==================
const departmentSchema = new mongoose.Schema({
  code:      { type: String, required: true, unique: true }, // e.g., CSE
  name:      { type: String, required: true },               // Full name
  shortName: { type: String },                               // Optional display label
  isActive:  { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

departmentSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

const Department = mongoose.model('Department', departmentSchema);

// Seed default departments if none exist
async function seedDefaultDepartments() {
  try {
    const count = await Department.countDocuments({});
    if (count > 0) {
      return; // Already have data, do not seed again
    }

    const defaultDepts = [
      { code: 'CSE',  name: 'Computer Science and Engineering',      shortName: 'CSE'  },
      { code: 'ECE',  name: 'Electronics and Communication Engineering', shortName: 'ECE'  },
      { code: 'AIDS', name: 'Artificial Intelligence and Data Science',  shortName: 'AIDS' },
      { code: 'EEE',  name: 'Electrical and Electronics Engineering',    shortName: 'EEE'  },
      { code: 'ICE',  name: 'Instrumentation and Control Engineering',   shortName: 'ICE'  },
      { code: 'VLSI', name: 'VLSI Design',                               shortName: 'VLSI' },
      { code: 'MECH', name: 'Mechanical Engineering',                    shortName: 'Mech' },
      { code: 'CIVIL',name: 'Civil Engineering',                         shortName: 'Civil'}
    ];

    await Department.insertMany(defaultDepts);
    console.log('✅ Default departments seeded successfully');
  } catch (err) {
    console.error('❌ Error seeding default departments:', err.message);
  }
}


// Hardware Alert Schema - For tracking hardware disconnections
const hardwareAlertSchema = new mongoose.Schema({
  studentId: { type: String, required: true },
  studentName: { type: String, required: true },
  systemNumber: { type: String, required: true },
  deviceType: { type: String, required: true }, // 'Network', 'Keyboard', 'Mouse'
  type: { type: String, required: true }, // 'hardware_disconnect' or 'hardware_reconnect'
  severity: { type: String, default: 'warning' }, // 'critical', 'warning', 'info'
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  acknowledged: { type: Boolean, default: false },
  acknowledgedAt: { type: Date },
  acknowledgedBy: { type: String }
});

const HardwareAlert = mongoose.model('HardwareAlert', hardwareAlertSchema);

// System Registry Schema (tracks all powered-on systems, even before student login)
const systemRegistrySchema = new mongoose.Schema({
  systemNumber: { type: String, required: true, unique: true }, // e.g., 'CC1-05'
  labId: { type: String, required: true }, // e.g., 'CC1'
  ipAddress: { type: String, required: true }, // e.g., '192.168.29.101'
  status: { type: String, enum: ['available', 'logged-in', 'guest', 'offline'], default: 'available' },
  lastSeen: { type: Date, default: Date.now },
  currentSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  currentStudentId: { type: String },
  currentStudentName: { type: String },
  isGuest: { type: Boolean, default: false },
  socketId: { type: String }
});

// Update lastSeen on every registry update
systemRegistrySchema.pre('save', function(next) {
  this.lastSeen = new Date();
  next();
});

const SystemRegistry = mongoose.model('SystemRegistry', systemRegistrySchema);

// Email Configuration - Now enabled for real email sending
let emailTransporter = null;

// Create email transporter - Using Gmail SMTP
// You can use any Gmail account or create a dedicated one for the system
const EMAIL_USER = process.env.EMAIL_USER || 'screen.mirrorsdc@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS || 'jeetkuyfdaaenoav';

// Always try to create email transporter
try {
  emailTransporter = nodemailer.createTransport({
    service: 'gmail', // Use Gmail service
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    },
    tls: {
      rejectUnauthorized: false // Allow self-signed certificates
    }
  });
  
  // Test the connection
  emailTransporter.verify((error, success) => {
    if (error) {
      console.log('❌ Email configuration error:', error.message);
      console.log('📧 Falling back to console logging for OTP');
      emailTransporter = null;
    } else {
      console.log('✅ Email server is ready to send emails');
      console.log(`📧 Email configured: ${EMAIL_USER}`);
    }
  });
  
} catch (error) {
  console.log('❌ Failed to create email transporter:', error.message);
  console.log('📧 OTP emails will be logged to console only');
  emailTransporter = null;
}

// Helper Functions
function generateOneTimePassword() {
  return crypto.randomBytes(4).toString('hex').toUpperCase(); // 8-character password
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
}

async function sendOTPEmail(email, otp, studentName) {
  // Always log to console for backup/debugging
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📧 SENDING OTP EMAIL:`);
  console.log(`👤 Student: ${studentName}`);
  console.log(`📧 Email: ${email}`);
  console.log(`🔢 OTP CODE: ${otp}`);
  console.log(`⏰ Valid for: 10 minutes`);
  console.log(`${'='.repeat(60)}\n`);
  
  // If email is not configured, just log the OTP to console
  if (!emailTransporter) {
    console.log(`⚠️ EMAIL NOT CONFIGURED - OTP logged above for manual testing`);
    console.log(`🚨 BACKUP MODE: Copy this OTP → ${otp}`);
    return true; // Return true so the process continues
  }

  // Try to send actual email
  try {
    console.log(`📤 Attempting to send email to: ${email}`);
    
    const mailOptions = {
      from: `"College Lab System" <${EMAIL_USER}>`,
      to: email,
      subject: '🔐 Password Reset OTP - College Lab System',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 20px;">
          <div style="background: white; border-radius: 15px; padding: 30px; box-shadow: 0 5px 15px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #28a745; margin: 0;">🔐 Password Reset Request</h1>
              <p style="color: #6c757d; margin: 10px 0 0 0;">College Lab Management System</p>
            </div>
            
            <div style="background: #e8f5e9; border-radius: 10px; padding: 20px; margin: 20px 0;">
              <p style="margin: 0; color: #2c3e50;">Dear <strong>${studentName}</strong>,</p>
              <p style="margin: 10px 0 0 0; color: #2c3e50;">You have requested to reset your password for the College Lab System.</p>
            </div>
            
            <div style="background: linear-gradient(135deg, #28a745, #20c997); color: white; padding: 25px; text-align: center; margin: 25px 0; border-radius: 12px;">
              <p style="margin: 0; font-size: 16px; opacity: 0.9;">Your OTP Code:</p>
              <h1 style="margin: 10px 0 0 0; font-size: 3rem; letter-spacing: 8px; font-weight: bold;">${otp}</h1>
            </div>
            
            <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 5px;">
              <p style="margin: 0; color: #856404;"><strong>⏰ Important:</strong></p>
              <ul style="margin: 10px 0 0 0; color: #856404;">
                <li>This OTP will expire in <strong>10 minutes</strong></li>
                <li>Use this code in the kiosk interface to reset your password</li>
                <li>Do not share this OTP with anyone</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #6c757d; font-size: 14px;">
                If you did not request this password reset, please ignore this email.<br>
                This is an automated email from College Lab Management System.
              </p>
            </div>
          </div>
        </div>
      `
    };

    const info = await emailTransporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully!`);
    console.log(`📧 Message ID: ${info.messageId}`);
    console.log(`📬 Email delivered to: ${email}`);
    
    return true;
    
  } catch (error) {
    console.log(`❌ Failed to send email: ${error.message}`);
    console.log(`📧 Falling back to console logging`);
    console.log(`🚨 BACKUP MODE: Copy this OTP → ${otp}`);
    
    // Don't fail the process, just continue with console logging
    return true;
  }
}

// CSV/Excel Import Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files (.csv, .xlsx, .xls) are allowed!'));
    }
  }
});

// Process CSV File
function processCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

// Process Excel File using ExcelJS (secure alternative to xlsx)
async function processExcelFile(filePath) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    
    const worksheet = workbook.getWorksheet(1); // First worksheet
    const jsonData = [];
    
    // Get headers from first row
    const headerRow = worksheet.getRow(1);
    const headers = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber] = cell.value ? cell.value.toString().trim() : '';
    });
    
    // Process data rows (skip header row)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header row
      
      const rowData = {};
      let hasData = false;
      
      row.eachCell((cell, colNumber) => {
        if (headers[colNumber]) {
          let cellValue = '';
          if (cell.value !== null && cell.value !== undefined) {
            // Handle different cell value types
            if (cell.value instanceof Date) {
              cellValue = cell.value.toISOString().split('T')[0]; // Convert date to YYYY-MM-DD format
            } else if (typeof cell.value === 'object' && cell.value.text) {
              cellValue = cell.value.text; // Rich text
            } else {
              cellValue = cell.value.toString().trim();
            }
            hasData = true;
          }
          rowData[headers[colNumber]] = cellValue;
        }
      });
      
      // Only add row if it has data
      if (hasData && Object.values(rowData).some(val => val && val.length > 0)) {
        jsonData.push(rowData);
      }
    });
    
    return jsonData;
  } catch (error) {
    throw new Error('Error processing Excel file: ' + error.message);
  }
}

// Validate Student Data
function validateStudentData(rawData) {
  const validatedStudents = [];
  const seenIds = new Set();
  const seenEmails = new Set();
  
  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    
    try {
      const student = {
        name: cleanString(row.name || row.Name || row.student_name || row['Student Name'] || row['Full Name']),
        studentId: cleanString(row.student_id || row.StudentID || row.id || row.ID || row['Student ID'] || row['Roll No']),
        email: cleanString(row.email || row.Email || row.email_address || row['Email Address']),
        dateOfBirth: parseDate(row.dob || row.date_of_birth || row.dateOfBirth || row['Date of Birth'] || row.DOB),
        department: cleanString(row.department || row.Department || row.dept || row.Dept || row['Department Name']),
        section: cleanString(row.section || row.Section || row['Section'] || 'A'), // Added section extraction
        year: parseInt(row.year || row.Year || row.class_year || row['Year'] || row['Academic Year'] || 1),
        labId: cleanString(row.lab_id || row.labId || row.lab || row.Lab || row['Lab ID'] || 'LAB-01'),
        isPasswordSet: false,
        registeredAt: new Date(),
        updatedAt: new Date()
      };
      
      // Validate required fields
      if (!student.name || student.name.length < 2) {
        console.warn(`⚠️ Row ${i + 1}: Invalid or missing name`);
        continue;
      }
      
      if (!student.studentId || student.studentId.length < 3) {
        console.warn(`⚠️ Row ${i + 1}: Invalid or missing student ID`);
        continue;
      }
      
      if (!student.dateOfBirth || student.dateOfBirth.getFullYear() < 1980) {
        console.warn(`⚠️ Row ${i + 1}: Invalid date of birth`);
        continue;
      }
      
      if (!student.department || student.department.length < 2) {
        console.warn(`⚠️ Row ${i + 1}: Invalid or missing department`);
        continue;
      }
      
      // Check for duplicates in current batch
      if (seenIds.has(student.studentId.toUpperCase())) {
        console.warn(`⚠️ Row ${i + 1}: Duplicate student ID ${student.studentId}`);
        continue;
      }
      
      // Generate email if missing or invalid
      if (!student.email || !student.email.includes('@') || !student.email.includes('.')) {
        student.email = `${student.studentId.toLowerCase().replace(/[^a-z0-9]/g, '')}@college.edu`;
      }
      
      // Check for duplicate emails in current batch
      if (seenEmails.has(student.email.toLowerCase())) {
        // Generate unique email
        student.email = `${student.studentId.toLowerCase().replace(/[^a-z0-9]/g, '')}.${Date.now()}@college.edu`;
      }
      
      // Validate and normalize year
      if (isNaN(student.year) || student.year < 1 || student.year > 4) {
        student.year = 1;
      }
      
      // Normalize department names
      student.department = normalizeDepartment(student.department);
      
      // Normalize student ID (uppercase)
      student.studentId = student.studentId.toUpperCase();
      
      // Add to tracking sets
      seenIds.add(student.studentId);
      seenEmails.add(student.email.toLowerCase());
      
      validatedStudents.push(student);
      
    } catch (error) {
      console.warn(`⚠️ Row ${i + 1}: Validation error:`, error.message);
    }
  }
  
  return validatedStudents;
}

// Helper Functions
function cleanString(str) {
  if (!str) return '';
  return str.toString().trim().replace(/\s+/g, ' '); // Normalize whitespace
}

function parseDate(dateString) {
  if (!dateString) return new Date('2000-01-01');
  
  // Handle Excel date serial numbers
  if (typeof dateString === 'number' && dateString > 25000 && dateString < 50000) {
    // Excel serial date to JS date
    const date = new Date((dateString - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) return date;
  }
  
  const formats = [
    dateString.toString(),
    dateString.toString().replace(/[-/]/g, '-'),
    dateString.toString().replace(/[-/]/g, '/'),
  ];
  
  for (let format of formats) {
    const parsed = new Date(format);
    if (!isNaN(parsed.getTime()) && 
        parsed.getFullYear() > 1980 && 
        parsed.getFullYear() < 2015) {
      return parsed;
    }
  }
  
  return new Date('2000-01-01');
}

function normalizeDepartment(dept) {
  if (!dept) return 'General';
  
  const deptMap = {
    'cs': 'Computer Science',
    'cse': 'Computer Science',
    'computer': 'Computer Science',
    'it': 'Information Technology',
    'information': 'Information Technology',
    'ec': 'Electronics & Communication',
    'ece': 'Electronics & Communication',
    'electronics': 'Electronics & Communication',
    'me': 'Mechanical Engineering',
    'mechanical': 'Mechanical Engineering',
    'ce': 'Civil Engineering',
    'civil': 'Civil Engineering',
    'ee': 'Electrical Engineering',
    'electrical': 'Electrical Engineering',
    'ch': 'Chemical Engineering',
    'chemical': 'Chemical Engineering',
    'bt': 'Biotechnology',
    'bio': 'Biotechnology',
    'ai': 'Artificial Intelligence',
    'ml': 'Machine Learning',
    'ds': 'Data Science',
    'data': 'Data Science'
  };
  
  const normalized = dept.toLowerCase().trim();
  return deptMap[normalized] || dept;
}

// Import Students to Database
async function importStudentsToDatabase(students) {
  let successful = 0;
  let failed = 0;
  const errors = [];
  
  for (let student of students) {
    try {
      const existing = await Student.findOne({ 
        $or: [
          { studentId: student.studentId },
          { email: student.email }
        ]
      });
      
      if (existing) {
        // Update existing student (except password fields)
        await Student.findByIdAndUpdate(existing._id, {
          name: student.name,
          email: student.email,
          dateOfBirth: student.dateOfBirth,
          department: student.department,
          section: student.section || 'A', // Added section to update
          year: student.year,
          labId: student.labId,
          updatedAt: new Date()
          // Keep existing passwordHash and isPasswordSet
        });
        successful++;
        console.log(`✅ Updated existing student: ${student.studentId}`);
      } else {
        const newStudent = new Student(student);
        await newStudent.save();
        successful++;
        console.log(`✅ Added new student: ${student.studentId}`);
      }
      
    } catch (error) {
      failed++;
      errors.push(`${student.studentId || 'Unknown'}: ${error.message}`);
      console.error(`❌ Failed to import ${student.studentId}:`, error.message);
    }
  }
  
  return { successful, failed, errors };
}

// NEW: Restore sample data (alias for setup-sample-data)
// Note: Admin dashboard route moved to end of file (after static middleware)
app.post('/api/restore-sample-data', async (req, res) => {
  try {
    console.log('🗑️ Clearing all existing data...');
    
    // Clear all collections
    await Student.deleteMany({});
    await Session.deleteMany({});
    await OneTimePassword.deleteMany({});
    await OTP.deleteMany({});
    
    console.log('📊 Setting up sample student data...');
    
    // Sample student data including TEST2025001
    const sampleStudents = [
      {
        name: 'Rajesh Kumar',
        studentId: 'CS2021001',
        email: 'rajesh.kumar@college.edu',
        dateOfBirth: new Date('2000-05-15'),
        department: 'Computer Science',
        year: 3,
        labId: 'CC1',
        isPasswordSet: false
      },
      {
        name: 'Priya Sharma',
        studentId: 'CS2021002',
        email: 'priya.sharma@college.edu',
        dateOfBirth: new Date('2001-08-22'),
        department: 'Computer Science',
        year: 3,
        labId: 'CC1',
        isPasswordSet: false
      },
      {
        name: 'Arjun Patel',
        studentId: 'IT2021003',
        email: 'arjun.patel@college.edu',
        dateOfBirth: new Date('2000-12-10'),
        department: 'Information Technology',
        year: 3,
        labId: 'CC1',
        isPasswordSet: false
      },
      {
        name: 'Sneha Reddy',
        studentId: 'CS2021004',
        email: 'sneha.reddy@college.edu',
        dateOfBirth: new Date('2001-03-18'),
        department: 'Computer Science',
        year: 3,
        labId: 'CC1',
        isPasswordSet: false
      },
      {
        name: 'Vikram Singh',
        studentId: 'IT2021005',
        email: 'vikram.singh@college.edu',
        dateOfBirth: new Date('2000-09-25'),
        department: 'Information Technology',
        year: 3,
        labId: 'CC1',
        isPasswordSet: false
      },
      {
        name: 'Test User',
        studentId: 'TEST2025001',
        email: '24z258@psgitech.ac.in',
        dateOfBirth: new Date('2000-01-01'),
        department: 'Computer Science',
        year: 3,
        labId: 'CC1',
        isPasswordSet: false
      }
    ];
    
    // Insert sample students
    const insertedStudents = await Student.insertMany(sampleStudents);
    
    console.log(`✅ Sample data restored: ${insertedStudents.length} students added`);
    
    res.json({
      success: true,
      message: 'Sample data restored successfully',
      studentsAdded: insertedStudents.length,
      students: insertedStudents.map(s => ({
        name: s.name,
        studentId: s.studentId,
        email: s.email,
        department: s.department
      }))
    });
    
  } catch (error) {
    console.error('❌ Sample data restore error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NEW: Clear all data and setup sample students
app.post('/api/setup-sample-data', async (req, res) => {
  try {
    console.log('🗑️ Clearing all existing data...');
    
    // Clear all collections
    await Student.deleteMany({});
    await Session.deleteMany({});
    await OneTimePassword.deleteMany({});
    await OTP.deleteMany({});
    
    console.log('📊 Setting up sample student data...');
    
    // Sample student data
    const sampleStudents = [
      {
        name: 'Rajesh Kumar',
        studentId: 'CS2021001',
        email: 'rajesh.kumar@college.edu',
        dateOfBirth: new Date('2000-05-15'),
        department: 'Computer Science',
        year: 3,
        labId: 'CC1',
        isPasswordSet: false
      },
      {
        name: 'Priya Sharma',
        studentId: 'CS2021002',
        email: 'priya.sharma@college.edu',
        dateOfBirth: new Date('2001-08-22'),
        department: 'Computer Science',
        year: 3,
        labId: 'CC1',
        isPasswordSet: false
      },
      {
        name: 'Arjun Patel',
        studentId: 'IT2021003',
        email: 'arjun.patel@college.edu',
        dateOfBirth: new Date('2000-12-10'),
        department: 'Information Technology',
        year: 3,
        labId: 'CC1',
        isPasswordSet: false
      },
      {
        name: 'Sneha Reddy',
        studentId: 'CS2021004',
        email: 'sneha.reddy@college.edu',
        dateOfBirth: new Date('2001-03-18'),
        department: 'Computer Science',
        year: 3,
        labId: 'CC1',
        isPasswordSet: false
      },
      {
        name: 'Vikram Singh',
        studentId: 'IT2021005',
        email: 'vikram.singh@college.edu',
        dateOfBirth: new Date('2000-09-25'),
        department: 'Information Technology',
        year: 3,
        labId: 'CC1',
        isPasswordSet: false
      },
      {
        name: 'Test User',
        studentId: 'TEST2025001',
        email: '24z258@psgitech.ac.in',
        dateOfBirth: new Date('2000-01-01'),
        department: 'Computer Science',
        year: 3,
        labId: 'CC1',
        isPasswordSet: false
      }
    ];
    
    // Insert sample students
    const insertedStudents = await Student.insertMany(sampleStudents);
    
    console.log(`✅ Sample data setup complete: ${insertedStudents.length} students added`);
    
    res.json({
      success: true,
      message: 'Sample data setup complete',
      studentsAdded: insertedStudents.length,
      students: insertedStudents.map(s => ({
        name: s.name,
        studentId: s.studentId,
        email: s.email,
        department: s.department
      }))
    });
    
  } catch (error) {
    console.error('❌ Sample data setup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NEW: Generate one-time password for a student
app.post('/api/generate-one-time-password', async (req, res) => {
  try {
    const { studentId } = req.body;
    
    if (!studentId) {
      return res.status(400).json({ success: false, error: 'Student ID is required' });
    }
    
    // Check if student exists
    const student = await Student.findOne({ studentId: studentId.toUpperCase() });
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    
    // Check if student already has a password set
    if (student.isPasswordSet) {
      return res.status(400).json({ 
        success: false, 
        error: 'Student already has a password set. Use password reset instead.' 
      });
    }
    
    // Generate one-time password
    const oneTimePass = generateOneTimePassword();
    
    // Remove any existing one-time password for this student
    await OneTimePassword.deleteMany({ studentId: studentId.toUpperCase() });
    
    // Create new one-time password
    const otpRecord = new OneTimePassword({
      studentId: studentId.toUpperCase(),
      password: oneTimePass,
      isUsed: false
    });
    
    await otpRecord.save();
    
    console.log(`✅ One-time password generated for ${studentId}: ${oneTimePass}`);
    
    res.json({
      success: true,
      message: 'One-time password generated successfully',
      studentId: studentId.toUpperCase(),
      studentName: student.name,
      oneTimePassword: oneTimePass,
      expiresAt: otpRecord.expiresAt
    });
    
  } catch (error) {
    console.error('❌ One-time password generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NEW: Use one-time password to set permanent password
app.post('/api/use-one-time-password', async (req, res) => {
  try {
    const { studentId, oneTimePassword, newPassword } = req.body;
    
    if (!studentId || !oneTimePassword || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        error: 'Student ID, one-time password, and new password are required' 
      });
    }
    
    // Find the one-time password record
    const otpRecord = await OneTimePassword.findOne({ 
      studentId: studentId.toUpperCase(),
      password: oneTimePassword.toUpperCase(),
      isUsed: false
    });
    
    if (!otpRecord) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid or expired one-time password' 
      });
    }
    
    // Check if expired
    if (otpRecord.expiresAt < new Date()) {
      await OneTimePassword.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ 
        success: false, 
        error: 'One-time password has expired' 
      });
    }
    
    // Find the student
    const student = await Student.findOne({ studentId: studentId.toUpperCase() });
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    
    // Validate new password
    if (newPassword.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'New password must be at least 6 characters long' 
      });
    }
    
    // Hash the new password and update student
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await Student.findByIdAndUpdate(student._id, {
      passwordHash,
      isPasswordSet: true,
      updatedAt: new Date()
    });
    
    // Mark one-time password as used
    otpRecord.isUsed = true;
    await otpRecord.save();
    
    console.log(`✅ One-time password used successfully for ${studentId}`);
    
    res.json({
      success: true,
      message: 'Password set successfully using one-time password',
      student: {
        name: student.name,
        studentId: student.studentId,
        email: student.email,
        department: student.department
      }
    });
    
  } catch (error) {
    console.error('❌ One-time password usage error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================== DEPARTMENT MASTER APIs ==================

// Get all active departments
app.get('/api/departments', async (req, res) => {
  try {
    const departments = await Department.find({ isActive: true }).sort({ code: 1 });
    res.json({ success: true, departments });
  } catch (err) {
    console.error('Error fetching departments:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new department
app.post('/api/departments', async (req, res) => {
  try {
    const { code, name, shortName } = req.body;
    if (!code || !name) {
      return res.status(400).json({ success: false, error: 'Code and name are required' });
    }
    const existing = await Department.findOne({ code });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Department code already exists' });
    }
    const dept = new Department({ code, name, shortName });
    await dept.save();
    res.json({ success: true, department: dept });
  } catch (err) {
    console.error('Error creating department:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update existing department
app.put('/api/departments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const dept = await Department.findByIdAndUpdate(id, updates, { new: true });
    if (!dept) {
      return res.status(404).json({ success: false, error: 'Department not found' });
    }
    res.json({ success: true, department: dept });
  } catch (err) {
    console.error('Error updating department:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Soft delete / deactivate department
app.delete('/api/departments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const dept = await Department.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!dept) {
      return res.status(404).json({ success: false, error: 'Department not found' });
    }
    res.json({ success: true, department: dept });
  } catch (err) {
    console.error('Error deleting department:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// DEBUG: List all students in database
app.get('/api/debug-students', async (req, res) => {
  try {
    // Get all students with all necessary fields, no limit (including section)
    const students = await Student.find({}, 'studentId name email isPasswordSet department section year dateOfBirth labId createdAt').sort({ createdAt: -1 });
    
    console.log(`📊 Fetching all students: ${students.length} students found`);
    
    res.json({
      success: true,
      count: students.length,
      students: students
    });
  } catch (error) {
    console.error('❌ Error fetching students:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NEW: Check student eligibility for first-time sign-in
app.post('/api/check-student-eligibility', async (req, res) => {
  try {
    const { studentId } = req.body;
    
    if (!studentId) {
      return res.status(400).json({ 
        eligible: false, 
        reason: 'Student ID is required' 
      });
    }
    
    // Find student by ID
    const student = await Student.findOne({ 
      studentId: studentId.toUpperCase()
    });
    
    if (!student) {
      return res.status(400).json({ 
        eligible: false, 
        reason: 'Student ID not found in our records. Please contact admin.' 
      });
    }
    
    // Check if password is already set
    if (student.passwordHash && student.isPasswordSet) {
      return res.status(400).json({ 
        eligible: false, 
        reason: 'Password already set for this account. Use regular login or "Forgot Password".' 
      });
    }
    
    res.json({
      eligible: true,
      studentName: student.name,
      department: student.department,
      year: student.year,
      labId: student.labId
    });
    
  } catch (error) {
    console.error('❌ Student eligibility check error:', error);
    res.status(500).json({ eligible: false, reason: 'Server error. Please try again.' });
  }
});

// NEW: Add individual student
app.post('/api/add-student', async (req, res) => {
  try {
    const { studentId, name, email, dateOfBirth, department, section, year, labId } = req.body;
    
    // Validate required fields (labId is now optional)
    if (!studentId || !name || !email || !dateOfBirth || !department || !year) {
      return res.status(400).json({ 
        success: false, 
        error: 'All fields are required: studentId, name, email, dateOfBirth, department, year' 
      });
    }
    
    // Check if student ID already exists
    const existingStudent = await Student.findOne({ 
      $or: [
        { studentId: studentId.toUpperCase() },
        { email: email.toLowerCase() }
      ]
    });
    
    if (existingStudent) {
      return res.status(400).json({ 
        success: false, 
        error: 'Student ID or email already exists' 
      });
    }
    
    // Create new student
    const newStudent = new Student({
      studentId: studentId.toUpperCase(),
      name: name.trim(),
      email: email.toLowerCase(),
      dateOfBirth: new Date(dateOfBirth),
      department: department.trim(),
      section: section ? section.trim().toUpperCase() : 'A', // Added section handling
      year: parseInt(year),
      labId: labId ? labId.toUpperCase() : 'ALL', // Default to 'ALL' if not provided
      isPasswordSet: false
    });
    
    await newStudent.save();
    
    console.log(`✅ New student added: ${newStudent.name} (${newStudent.studentId})`);
    
    res.json({
      success: true,
      message: 'Student added successfully',
      student: {
        studentId: newStudent.studentId,
        name: newStudent.name,
        email: newStudent.email,
        department: newStudent.department,
        section: newStudent.section,
        year: newStudent.year,
        labId: newStudent.labId
      }
    });
    
  } catch (error) {
    console.error('❌ Add student error:', error);
    if (error.code === 11000) {
      res.status(400).json({ success: false, error: 'Student ID or email already exists' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// UPDATE: Update student information
app.put('/api/update-student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { name, email, department, section, year } = req.body;
    
    // Find and update student
    const student = await Student.findOne({ studentId: studentId.toUpperCase() });
    
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        error: 'Student not found' 
      });
    }
    
    // Update fields if provided
    if (name) student.name = name.trim();
    if (email) student.email = email.toLowerCase();
    if (department) student.department = department.trim();
    if (section !== undefined) student.section = section.trim().toUpperCase(); // Added section handling
    if (year) student.year = parseInt(year);
    student.updatedAt = new Date(); // Update timestamp
    
    await student.save();
    
    console.log(`✅ Student updated: ${student.name} (${student.studentId})`);
    
    res.json({
      success: true,
      message: 'Student updated successfully',
      student: {
        studentId: student.studentId,
        name: student.name,
        email: student.email,
        department: student.department,
        section: student.section,
        year: student.year
      }
    });
    
  } catch (error) {
    console.error('❌ Update student error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE: Delete student
app.delete('/api/delete-student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    // Find and delete student
    const student = await Student.findOneAndDelete({ studentId: studentId.toUpperCase() });
    
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        error: 'Student not found' 
      });
    }
    
    console.log(`🗑️ Student deleted: ${student.name} (${student.studentId})`);
    
    res.json({
      success: true,
      message: 'Student deleted successfully',
      studentId: student.studentId
    });
    
  } catch (error) {
    console.error('❌ Delete student error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE: Clear all students
app.delete('/api/clear-all-students', async (req, res) => {
  try {
    const result = await Student.deleteMany({});
    
    console.log(`🗑️ Cleared all students: ${result.deletedCount} deleted`);
    
    res.json({
      success: true,
      message: 'All students deleted successfully',
      deletedCount: result.deletedCount
    });
    
  } catch (error) {
    console.error('❌ Clear all students error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NEW: Student authentication for kiosk login
app.post('/api/authenticate', async (req, res) => {
  try {
    const { studentId, password } = req.body;
    
    if (!studentId || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Student ID and password are required' 
      });
    }
    
    // Find student by ID
    const student = await Student.findOne({ 
      studentId: studentId.toUpperCase()
    });
    
    if (!student) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid student ID or password' 
      });
    }
    
    // Check if password is set
    if (!student.passwordHash || !student.isPasswordSet) {
      return res.status(401).json({ 
        success: false, 
        error: 'Password not set. Please complete first-time sign-in online first.' 
      });
    }
    
    // Verify password
    const passwordMatch = await bcrypt.compare(password, student.passwordHash);
    
    if (!passwordMatch) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid student ID or password' 
      });
    }
    
    console.log(`✅ Student authenticated: ${student.name} (${student.studentId})`);
    
    res.json({
      success: true,
      message: 'Authentication successful',
      student: {
        name: student.name,
        studentId: student.studentId,
        email: student.email,
        department: student.department,
        year: student.year,
        labId: student.labId
      }
    });
    
  } catch (error) {
    console.error('❌ Authentication error:', error);
    res.status(500).json({ success: false, error: 'Server error during authentication' });
  }
});

// NEW: Student first-time sign-in (separate web system)
app.post('/api/student-first-signin', async (req, res) => {
  try {
    const { name, studentId, dateOfBirth, password } = req.body;
    
    if (!name || !studentId || !dateOfBirth || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'All fields are required: name, student ID, date of birth, and password' 
      });
    }
    
    // Find student by ID
    const student = await Student.findOne({ 
      studentId: studentId.toUpperCase()
    });
    
    if (!student) {
      return res.status(400).json({ 
        success: false, 
        error: 'Student not found in our records' 
      });
    }
    
    // Verify date of birth
    const providedDate = new Date(dateOfBirth);
    const storedDate = new Date(student.dateOfBirth);
    
    if (providedDate.toDateString() !== storedDate.toDateString()) {
      return res.status(400).json({ 
        success: false, 
        error: 'Date of birth does not match our records' 
      });
    }
    
    // Check if password is already set
    if (student.passwordHash && student.isPasswordSet) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password already set for this account. Use "Forgot Password" if you need to reset it.' 
      });
    }
    
    // Hash the new password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // Update student with new password and name
    student.name = name; // Allow name update during first signin
    student.passwordHash = passwordHash;
    student.isPasswordSet = true;
    await student.save();
    
    console.log(`✅ First-time sign-in completed via web for: ${student.name} (${student.studentId})`);
    
    res.json({
      success: true,
      message: 'Password set successfully. You can now login at lab computers.',
      student: {
        name: student.name,
        studentId: student.studentId,
        department: student.department,
        labId: student.labId
      }
    });
    
  } catch (error) {
    console.error('❌ Student first-time sign-in error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NEW: First-time sign-in endpoint (legacy - for kiosk)
app.post('/api/first-time-signin', async (req, res) => {
  try {
    const { studentId, email, dateOfBirth, newPassword } = req.body;
    
    if (!studentId || !email || !dateOfBirth || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        error: 'All fields are required: Student ID, email, date of birth, and password' 
      });
    }
    
    // Find student by ID, email, and date of birth
    const student = await Student.findOne({ 
      studentId: studentId.toUpperCase(),
      email: email.toLowerCase()
    });
    
    if (!student) {
      return res.status(400).json({ 
        success: false, 
        error: 'Student not found or email does not match our records' 
      });
    }
    
    // Verify date of birth
    const providedDate = new Date(dateOfBirth);
    const storedDate = new Date(student.dateOfBirth);
    
    if (providedDate.toDateString() !== storedDate.toDateString()) {
      return res.status(400).json({ 
        success: false, 
        error: 'Date of birth does not match our records' 
      });
    }
    
    // Check if password is already set
    if (student.passwordHash && student.isPasswordSet) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password already set for this account. Use "Forgot Password" if you need to reset it.' 
      });
    }
    
    // Hash the new password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);
    
    // Update student with new password
    student.passwordHash = passwordHash;
    student.isPasswordSet = true;
    await student.save();
    
    console.log(`✅ First-time sign-in completed for: ${student.name} (${student.studentId})`);
    
    res.json({
      success: true,
      message: 'Password set successfully. You can now login.',
      student: {
        name: student.name,
        studentId: student.studentId,
        email: student.email,
        department: student.department
      }
    });
    
  } catch (error) {
    console.error('❌ First-time sign-in error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NEW: Initiate forgot password with roll number and email
app.post('/api/forgot-password-initiate', async (req, res) => {
  try {
    const { studentId } = req.body;
    
    if (!studentId) {
      return res.status(400).json({ success: false, error: 'Student ID (Roll Number) is required' });
    }
    
    // Find student
    const student = await Student.findOne({ studentId: studentId.toUpperCase() });
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found with this roll number' });
    }
    
    if (!student.isPasswordSet) {
      return res.status(400).json({ 
        success: false, 
        error: 'No password set for this student. Please use first-time sign-in instead.' 
      });
    }
    
    res.json({
      success: true,
      message: 'Student verified. Please provide email for OTP.',
      studentName: student.name,
      maskedEmail: student.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') // Mask email for security
    });
    
  } catch (error) {
    console.error('❌ Forgot password initiate error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NEW: Send OTP to email for password reset
app.post('/api/forgot-password-send-otp', async (req, res) => {
  try {
    const { studentId, email } = req.body;
    
    if (!studentId || !email) {
      return res.status(400).json({ success: false, error: 'Student ID and email are required' });
    }
    
    // Find student first
    const student = await Student.findOne({ 
      studentId: studentId.toUpperCase()
    });
    
    if (!student) {
      return res.status(400).json({ 
        success: false, 
        error: 'Student ID not found in our records' 
      });
    }
    
    // For testing purposes, allow any email but warn if it doesn't match
    if (student.email.toLowerCase() !== email.toLowerCase()) {
      console.log(`⚠️ Email mismatch for ${studentId}:`);
      console.log(`   Registered: ${student.email}`);
      console.log(`   Provided: ${email}`);
      console.log(`   Proceeding with OTP send for testing...`);
    }
    
    // Generate OTP
    const otp = generateOTP();
    
    // Remove any existing OTPs for this student
    await OTP.deleteMany({ studentId: studentId.toUpperCase() });
    
    // Create new OTP record
    const otpRecord = new OTP({
      studentId: studentId.toUpperCase(),
      email: email.toLowerCase(),
      otp: otp
    });
    
    await otpRecord.save();
    
    // Send OTP email
    const emailSent = await sendOTPEmail(email, otp, student.name);
    
    if (!emailSent) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to send OTP email. Please try again.' 
      });
    }
    
    console.log(`✅ OTP sent to ${email} for student ${studentId}`);
    
    res.json({
      success: true,
      message: 'OTP sent to your email address',
      studentName: student.name,
      email: email,
      expiresIn: '10 minutes'
    });
    
  } catch (error) {
    console.error('❌ OTP send error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NEW: Verify OTP and reset password
app.post('/api/forgot-password-verify-otp', async (req, res) => {
  try {
    const { studentId, email, otp, newPassword } = req.body;
    
    if (!studentId || !email || !otp || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        error: 'All fields are required: Student ID, email, OTP, and new password' 
      });
    }
    
    // Find and verify OTP
    const otpRecord = await OTP.findOne({
      studentId: studentId.toUpperCase(),
      email: email.toLowerCase(),
      otp: otp,
      isUsed: false
    });
    
    if (!otpRecord) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid OTP or OTP already used' 
      });
    }
    
    // Check if OTP expired
    if (otpRecord.expiresAt < new Date()) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ 
        success: false, 
        error: 'OTP has expired. Please request a new one.' 
      });
    }
    
    // Validate new password
    if (newPassword.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'New password must be at least 6 characters long' 
      });
    }
    
    // Find student and update password
    const student = await Student.findOne({ 
      studentId: studentId.toUpperCase(),
      email: email.toLowerCase()
    });
    
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    
    // Hash new password and update
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await Student.findByIdAndUpdate(student._id, {
      passwordHash,
      updatedAt: new Date()
    });
    
    // Mark OTP as used
    otpRecord.isUsed = true;
    await otpRecord.save();
    
    console.log(`✅ Password reset successful for ${studentId} via OTP`);
    
    res.json({
      success: true,
      message: 'Password reset successful! You can now login with your new password.',
      student: {
        name: student.name,
        studentId: student.studentId,
        email: student.email
      }
    });
    
  } catch (error) {
    console.error('❌ OTP verification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload and Import Students from CSV/Excel
app.post('/api/import-students', upload.single('studentFile'), async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    
    console.log(`📁 Processing file: ${req.file.originalname} (${fileExtension})`);
    
    let studentsData = [];
    
    if (fileExtension === '.csv') {
      studentsData = await processCSVFile(filePath);
    } else if (fileExtension === '.xlsx' || fileExtension === '.xls') {
      studentsData = await processExcelFile(filePath);
    } else {
      return res.status(400).json({ 
        success: false, 
        error: 'Unsupported file format. Please use CSV or Excel files.' 
      });
    }
    
    console.log(`📊 Raw data extracted: ${studentsData.length} rows`);
    
    const validatedStudents = validateStudentData(studentsData);
    
    console.log(`✅ Validated students: ${validatedStudents.length} records`);
    
    if (validatedStudents.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No valid student records found in file. Please check the format and required fields.' 
      });
    }
    
    const clearExisting = req.body.clearExisting === 'true';
    if (clearExisting) {
      const deletedCount = await Student.countDocuments();
      await Student.deleteMany({});
      console.log(`🗑️ Cleared ${deletedCount} existing student records`);
    }
    
    const importResult = await importStudentsToDatabase(validatedStudents);
    
    console.log(`✅ Import completed: ${importResult.successful} successful, ${importResult.failed} failed`);
    
    res.json({
      success: true,
      message: 'Students imported successfully',
      stats: {
        totalProcessed: studentsData.length,
        validatedRecords: validatedStudents.length,
        successful: importResult.successful,
        failed: importResult.failed,
        errors: importResult.errors.slice(0, 10) // Limit error messages
      }
    });
    
  } catch (error) {
    console.error('❌ Import error:', error);
    res.status(500).json({ 
      success: false, 
      error: `Import failed: ${error.message}` 
    });
  } finally {
    // Clean up uploaded file
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupError) {
        console.warn('⚠️ Failed to clean up uploaded file:', cleanupError.message);
      }
    }
  }
});

// Download Sample CSV Template
app.get('/api/download-template', (req, res) => {
  const sampleData = [
    {
      'Student ID': '2024CS001',
      'Name': 'John Doe',
      'Email': 'john.doe@college.edu',
      'Date of Birth': '2002-01-15',
      'Department': 'Computer Science',
      'Year': 3,
      'Lab ID': 'LAB-01'
    },
    {
      'Student ID': '2024IT002',
      'Name': 'Jane Smith',
      'Email': 'jane.smith@college.edu',
      'Date of Birth': '2001-08-22',
      'Department': 'Information Technology',
      'Year': 2,
      'Lab ID': 'LAB-02'
    },
    {
      'Student ID': '2024EC003',
      'Name': 'Mike Wilson',
      'Email': 'mike.wilson@college.edu',
      'Date of Birth': '2000-12-10',
      'Department': 'Electronics & Communication',
      'Year': 4,
      'Lab ID': 'LAB-03'
    },
    {
      'Student ID': '2024ME004',
      'Name': 'Sarah Johnson',
      'Email': 'sarah.johnson@college.edu',
      'Date of Birth': '2001-07-05',
      'Department': 'Mechanical Engineering',
      'Year': 2,
      'Lab ID': 'LAB-04'
    },
    {
      'Student ID': '2024CE005',
      'Name': 'David Brown',
      'Email': 'david.brown@college.edu',
      'Date of Birth': '2000-03-12',
      'Department': 'Civil Engineering',
      'Year': 4,
      'Lab ID': 'LAB-05'
    }
  ];
  
  // Create CSV content
  const headers = Object.keys(sampleData[0]).join(',');
  const rows = sampleData.map(row => Object.values(row).join(',')).join('\n');
  const csvContent = headers + '\n' + rows;
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="student-template.csv"');
  res.send(csvContent);
});

// =================================================================
// TIMETABLE MANAGEMENT API ENDPOINTS
// =================================================================

// Upload and Import Timetable from CSV
app.post('/api/upload-timetable', upload.single('timetableFile'), async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    filePath = req.file.path;
    console.log(`📅 Processing timetable file: ${req.file.originalname}`);

    // Parse the CSV file
    const timetableData = await processCSVFile(filePath);
    console.log(`📅 Parsed ${timetableData.length} timetable entries`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const row of timetableData) {
      try {
        // Parse date (format: YYYY-MM-DD)
        const sessionDate = new Date(row['Session Date'] || row.sessionDate);
        
        // Get and validate lab ID
        const rawLabId = row['Lab ID'] || row.labId || 'CC1';
        const labId = String(rawLabId).toUpperCase();
        
        // Validate lab ID exists in configuration
        if (!isValidLabId(labId)) {
          throw new Error(`Invalid Lab ID: ${labId}. Must be one of: ${Object.keys(getAllLabConfigs()).join(', ')}`);
        }
        
        // Create timetable entry
        const timetableEntry = new TimetableEntry({
          sessionDate: sessionDate,
          startTime: row['Start Time'] || row.startTime,
          endTime: row['End Time'] || row.endTime,
          faculty: row.Faculty || row.faculty,
          subject: row.Subject || row.subject,
          labId: labId,
          year: parseInt(row.Year || row.year),
          department: row.Department || row.department,
          section: row.Section || row.section || 'A',
          periods: parseInt(row.Periods || row.periods),
          duration: parseInt(row.Duration || row.duration),
          maxStudents: parseInt(row['Max Students'] || row.maxStudents || 60),
          remarks: row.Remarks || row.remarks || '',
          isActive: true,
          isProcessed: false,
          uploadedBy: 'admin'
        });

        await timetableEntry.save();
        successCount++;
        console.log(`✅ Saved: ${row.Subject} on ${sessionDate.toDateString()} at ${row['Start Time']}`);
      } catch (error) {
        errorCount++;
        errors.push({
          row: row,
          error: error.message
        });
        console.error(`❌ Error saving timetable entry:`, error.message);
      }
    }

    // Clean up uploaded file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    console.log(`📅 Timetable Import Complete:`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);

    res.json({
      success: true,
      message: `Timetable uploaded successfully`,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('❌ Timetable upload error:', error);
    
    // Clean up file on error
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all timetable entries (with optional filters)
app.get('/api/timetable', async (req, res) => {
  try {
    const { date, labId, upcoming } = req.query;
    
    let filter = { isActive: true };
    
    // Filter by specific date
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      filter.sessionDate = { $gte: startDate, $lte: endDate };
    }
    
    // Filter by lab ID
    if (labId) {
      filter.labId = labId.toUpperCase();
    }
    
    // Only upcoming sessions
    if (upcoming === 'true') {
      filter.sessionDate = { $gte: new Date() };
      filter.isProcessed = false;
    }
    
    const entries = await TimetableEntry.find(filter)
      .sort({ sessionDate: 1, startTime: 1 })
      .limit(100);
    
    res.json({ success: true, count: entries.length, entries });
  } catch (error) {
    console.error('Error fetching timetable:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a timetable entry
app.delete('/api/timetable/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await TimetableEntry.findByIdAndDelete(id);
    console.log(`🗑️ Deleted timetable entry: ${id}`);
    res.json({ success: true, message: 'Timetable entry deleted' });
  } catch (error) {
    console.error('Error deleting timetable entry:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear all timetable entries
app.post('/api/timetable/clear-all', async (req, res) => {
  try {
    const result = await TimetableEntry.deleteMany({});
    console.log(`🗑️ Cleared ${result.deletedCount} timetable entries`);
    res.json({ success: true, message: `Cleared ${result.deletedCount} entries` });
  } catch (error) {
    console.error('Error clearing timetable:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download Timetable Template
app.get('/api/timetable-template', (req, res) => {
  const csvContent = `Session Date,Start Time,End Time,Faculty,Subject,Lab ID,Year,Department,Section,Periods,Duration,Max Students,Remarks
2025-11-10,09:00,10:40,Dr. John Smith,Data Structures,CC1,2,Computer Science,A,2,100,60,Regular class
2025-11-10,11:00,12:40,Prof. Jane Doe,Database Management,CC2,3,Computer Science,B,2,100,60,Lab session
2025-11-10,14:00,15:40,Dr. Bob Johnson,Web Development,CC1,2,Information Technology,A,2,100,60,Practical session`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="timetable-template.csv"');
  res.send(csvContent);
});

// Student Registration API
app.post('/api/student-register', async (req, res) => {
  try {
    const { name, studentId, email, password, dateOfBirth, department, year, labId } = req.body;
    
    if (!name || !studentId || !email || !password || !dateOfBirth || !department || !year || !labId) {
      return res.status(400).json({ success: false, error: "Missing required fields." });
    }

    const existing = await Student.findOne({ $or: [{ studentId }, { email }] });
    if (existing) {
      return res.status(400).json({ success: false, error: "Student ID or email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const student = new Student({ 
      name, 
      studentId, 
      email, 
      passwordHash, 
      dateOfBirth, 
      department, 
      year, 
      labId,
      isPasswordSet: true
    });
    
    await student.save();
    console.log(`✅ Student registered: ${studentId}`);
    
    res.json({ success: true, message: "Student registered successfully." });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Student Authentication API
app.post('/api/student-authenticate', async (req, res) => {
  try {
    const { studentId, password, labId } = req.body;
    
    const student = await Student.findOne({ studentId, labId });
    if (!student) {
      return res.status(400).json({ success: false, error: "Invalid student or lab" });
    }

    if (!student.isPasswordSet || !student.passwordHash) {
      return res.status(400).json({ 
        success: false, 
        error: "Password not set. Please complete first-time signin first." 
      });
    }

    const isValid = await student.verifyPassword(password);
    if (!isValid) {
      return res.status(400).json({ success: false, error: "Incorrect password" });
    }

    console.log(`✅ Authentication successful: ${studentId}`);

    res.json({ 
      success: true, 
      student: { 
        name: student.name,
        studentId: student.studentId,
        email: student.email,
        department: student.department,
        year: student.year,
        labId: student.labId
      }
    });
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// First-time signin API
app.post('/api/student-first-signin', async (req, res) => {
  try {
    const { name, studentId, dateOfBirth, password } = req.body;
    
    if (!name || !studentId || !dateOfBirth || !password) {
      return res.status(400).json({ success: false, error: "All fields are required" });
    }

    const student = await Student.findOne({ 
      studentId: studentId.toUpperCase(),
      name: { $regex: new RegExp(name.trim(), 'i') }
    });

    if (!student) {
      return res.status(400).json({ success: false, error: "Student details not found in database" });
    }

    if (student.isPasswordSet) {
      return res.status(400).json({ success: false, error: "Password already set for this student. Use login instead." });
    }

    const providedDOB = new Date(dateOfBirth);
    const studentDOB = new Date(student.dateOfBirth);
    
    if (providedDOB.toDateString() !== studentDOB.toDateString()) {
      return res.status(400).json({ success: false, error: "Date of birth does not match our records" });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    await Student.findByIdAndUpdate(student._id, { 
      passwordHash,
      isPasswordSet: true,
      updatedAt: new Date()
    });

    console.log(`✅ First-time signin completed for: ${studentId}`);
    res.json({ 
      success: true, 
      message: "Password set successfully! You can now login at kiosk.",
      student: {
        name: student.name,
        studentId: student.studentId,
        department: student.department,
        labId: student.labId
      }
    });

  } catch (error) {
    console.error("First-time signin error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Password Reset API
app.post('/api/reset-password', async (req, res) => {
  try {
    const { studentId, dateOfBirth, newPassword } = req.body;
    
    if (!studentId || !dateOfBirth || !newPassword) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    const student = await Student.findOne({ studentId: studentId.toUpperCase() });
    if (!student) {
      return res.status(400).json({ success: false, error: "Student not found" });
    }

    if (!student.isPasswordSet) {
      return res.status(400).json({ 
        success: false, 
        error: "No password set yet. Please complete first-time signin first." 
      });
    }

    const providedDate = new Date(dateOfBirth);
    const studentDOB = new Date(student.dateOfBirth);
    
    if (providedDate.toDateString() !== studentDOB.toDateString()) {
      return res.status(400).json({ success: false, error: "Date of birth does not match our records" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: "New password must be at least 6 characters" });
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await Student.findByIdAndUpdate(student._id, { 
      passwordHash,
      updatedAt: new Date()
    });

    console.log(`✅ Password reset successful for: ${studentId}`);
    res.json({ 
      success: true, 
      message: "Password reset successful! You can now login with your new password.",
      student: {
        name: student.name,
        studentId: student.studentId
      }
    });

  } catch (error) {
    console.error("Password reset error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Student Login (Create Session)
app.post('/api/student-login', async (req, res) => {
  try {
    const { studentName, studentId, computerName, labId, systemNumber, isGuest } = req.body;

    // End any existing session for this computer
    await Session.updateMany(
      { computerName, status: 'active' }, 
      { status: 'completed', logoutTime: new Date() }
    );

    const newSession = new Session({ 
      studentName: isGuest ? 'Guest User' : studentName, 
      studentId: isGuest ? 'GUEST' : studentId, 
      computerName, 
      labId, 
      systemNumber, 
      loginTime: new Date(), 
      status: 'active',
      isGuest: isGuest || false
    });
    
    await newSession.save();
    
    // Save session to CSV file
    await saveSessionToCSV(newSession);
    
    // Update active lab session with this student record
    try {
      const activeLabSession = await LabSession.findOne({ status: 'active' });
      if (activeLabSession) {
        console.log(`📚 Found active lab session: ${activeLabSession.subject} (ID: ${activeLabSession._id})`);
        
        // Remove any existing record for this system
        activeLabSession.studentRecords = activeLabSession.studentRecords.filter(
          record => record.systemNumber !== systemNumber
        );
        
        // Add new student record
        activeLabSession.studentRecords.push({
          studentName,
          studentId,
          systemNumber,
          loginTime: newSession.loginTime,
          status: 'active'
        });
        
        await activeLabSession.save();
        console.log(`📚 Added ${studentName} to lab session: ${activeLabSession.subject}`);
      } else {
        console.log(`⚠️ No active lab session found. Student ${studentName} logged in but not tracked in lab session.`);
      }
    } catch (labSessionError) {
      console.error(`❌ Error updating lab session:`, labSessionError);
      // Continue with student login even if lab session update fails
    }
    
    console.log(`✅ Session created: ${newSession._id} for ${studentName}`);

    // Notify admins of new session
    io.to('admins').emit('session-created', { 
      sessionId: newSession._id, 
      studentName, 
      studentId, 
      computerName, 
      labId, 
      systemNumber, 
      loginTime: newSession.loginTime 
    });

    io.emit('start-live-stream', { sessionId: newSession._id });

    res.json({ success: true, sessionId: newSession._id });
  } catch (error) {
    console.error("Session login error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Student Logout (End Session)
app.post('/api/student-logout', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    const session = await Session.findById(sessionId);
    if (session) {
      session.status = 'completed';
      session.logoutTime = new Date();
      session.duration = Math.floor((session.logoutTime - session.loginTime) / 1000);
      await session.save();

      // Update session in CSV file
      await updateSessionInCSV(session);

      // Update active lab session with logout info
      const activeLabSession = await LabSession.findOne({ status: 'active' });
      if (activeLabSession) {
        const studentRecord = activeLabSession.studentRecords.find(
          record => record.systemNumber === session.systemNumber && record.status === 'active'
        );
        
        if (studentRecord) {
          studentRecord.logoutTime = session.logoutTime;
          studentRecord.duration = session.duration;
          studentRecord.status = 'completed';
          
          await activeLabSession.save();
          console.log(`📚 Updated logout for ${session.studentName} in lab session: ${activeLabSession.subject}`);
        }
      }

      console.log(`✅ Session ended: ${sessionId} - Duration: ${session.duration}s`);

      // Notify admins of session end
      io.to('admins').emit('session-ended', { 
        sessionId, 
        studentName: session.studentName, 
        computerName: session.computerName, 
        logoutTime: session.logoutTime, 
        duration: session.duration 
      });

      io.emit('stop-live-stream', { sessionId });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("Session logout error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update session screenshot
app.post('/api/update-screenshot', async (req, res) => {
  try {
    const { sessionId, screenshot } = req.body;
    await Session.findByIdAndUpdate(sessionId, { screenshot });
    io.emit('screenshot-update', { sessionId, screenshot, timestamp: new Date() });
    res.json({ success: true });
  } catch (error) {
    console.error("Screenshot update error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug endpoint to check lab session data
app.get('/api/debug-lab-session', async (req, res) => {
  try {
    const activeLabSession = await LabSession.findOne({ status: 'active' });
    
    if (activeLabSession) {
      console.log('🔍 DEBUG - Active Lab Session Found:');
      console.log('   ID:', activeLabSession._id);
      console.log('   Subject:', activeLabSession.subject);
      console.log('   Faculty:', activeLabSession.faculty);
      console.log('   Year:', activeLabSession.year);
      console.log('   Department:', activeLabSession.department);
      console.log('   Section:', activeLabSession.section);
      console.log('   Periods:', activeLabSession.periods);
      console.log('   Students:', activeLabSession.studentRecords.length);
      
      res.json({
        success: true,
        session: activeLabSession
      });
    } else {
      console.log('⚠️ No active lab session found');
      res.json({
        success: false,
        message: 'No active lab session'
      });
    }
  } catch (error) {
    console.error('Error checking lab session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get active sessions
app.get('/api/active-sessions/:labId', async (req, res) => {
  try {
    const labIdParam = req.params.labId.toLowerCase();
    let filter = { status: 'active' };
    
    if (labIdParam !== 'all') {
      filter.labId = labIdParam.toUpperCase();
    }
    
    const sessions = await Session.find(filter).sort({ loginTime: -1 });
    res.json({ success: true, sessions });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all students
app.get('/api/students', async (req, res) => {
  try {
    const students = await Student.find({}, '-passwordHash')
      .sort({ studentId: 1 });
    res.json({ success: true, students });
  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================================================
// MULTI-LAB SUPPORT APIs
// ========================================================================

// Get all lab configurations
app.get('/api/labs', (req, res) => {
  try {
    const labs = getAllLabConfigs();
    res.json({ success: true, labs });
  } catch (error) {
    console.error("Error fetching labs:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get available systems for a specific lab
app.get('/api/systems/:labId', async (req, res) => {
  try {
    const { labId } = req.params;
    
    if (!isValidLabId(labId)) {
      return res.status(400).json({ success: false, error: 'Invalid lab ID' });
    }
    
    // Get all systems for this lab from registry
    const systems = await SystemRegistry.find({ labId })
      .sort({ systemNumber: 1 })
      .lean();
    
    // Get lab configuration
    const labConfig = getLabConfig(labId);
    
    // Create complete list with status
    const systemList = labConfig.systemRange.map(systemNumber => {
      const registered = systems.find(s => s.systemNumber === systemNumber);
      return {
        systemNumber,
        labId,
        status: registered?.status || 'offline',
        ipAddress: registered?.ipAddress || null,
        lastSeen: registered?.lastSeen || null,
        currentStudentId: registered?.currentStudentId || null,
        currentStudentName: registered?.currentStudentName || null,
        isGuest: registered?.isGuest || false
      };
    });
    
    res.json({ 
      success: true, 
      labId,
      labName: labConfig.labName,
      systems: systemList,
      totalSystems: systemList.length,
      availableSystems: systemList.filter(s => s.status === 'available').length,
      loggedInSystems: systemList.filter(s => s.status === 'logged-in').length,
      guestSystems: systemList.filter(s => s.status === 'guest').length,
      offlineSystems: systemList.filter(s => s.status === 'offline').length
    });
  } catch (error) {
    console.error("Error fetching systems:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get students by department
app.get('/api/students/department/:dept', async (req, res) => {
  try {
    const department = req.params.dept;
    const students = await Student.find({ department }, '-passwordHash')
      .sort({ studentId: 1 });
    res.json({ success: true, students, count: students.length });
  } catch (error) {
    console.error("Error fetching students by department:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Database statistics
app.get('/api/stats', async (req, res) => {
  try {
    const totalStudents = await Student.countDocuments();
    const passwordsSet = await Student.countDocuments({ isPasswordSet: true });
    const pendingPasswords = await Student.countDocuments({ isPasswordSet: false });
    
    const departmentStats = await Student.aggregate([
      { $group: { _id: "$department", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    const yearStats = await Student.aggregate([
      { $group: { _id: "$year", count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    
    res.json({
      success: true,
      stats: {
        totalStudents,
        passwordsSet,
        pendingPasswords,
        departments: departmentStats,
        years: yearStats
      }
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search students
app.get('/api/students/search/:query', async (req, res) => {
  try {
    const query = req.params.query;
    const students = await Student.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { studentId: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } }
      ]
    }, '-passwordHash').sort({ studentId: 1 }).limit(50);
    
    res.json({ success: true, students, count: students.length });
  } catch (error) {
    console.error("Error searching students:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export all sessions to CSV
app.get('/api/export-sessions', async (req, res) => {
  try {
    const { startDate, endDate, labId, status } = req.query;
    
    // Build filter query
    let filter = {};
    
    if (startDate && endDate) {
      filter.loginTime = {
        $gte: new Date(startDate),
        $lte: new Date(endDate + 'T23:59:59.999Z')
      };
    }
    
    if (labId && labId !== 'all') {
      filter.labId = labId.toUpperCase();
    }
    
    if (status && status !== 'all') {
      filter.status = status;
    }
    
    console.log('📊 Exporting sessions with filter:', filter);
    
    const sessions = await Session.find(filter)
      .sort({ loginTime: -1 })
      .lean();
    
    console.log(`📊 Found ${sessions.length} sessions to export`);
    
    // Prepare CSV data
    const csvData = sessions.map(session => ({
      'Session ID': session._id.toString(),
      'Student Name': session.studentName || 'N/A',
      'Student ID': session.studentId || 'N/A',
      'Computer Name': session.computerName || 'N/A',
      'Lab ID': session.labId || 'N/A',
      'System Number': session.systemNumber || 'N/A',
      'Login Time': session.loginTime ? new Date(session.loginTime).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }) : 'N/A',
      'Logout Time': session.logoutTime ? new Date(session.logoutTime).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }) : 'Still Active',
      'Duration (seconds)': session.duration || (session.status === 'active' ? 'Ongoing' : 'N/A'),
      'Duration (formatted)': session.duration ? formatDuration(session.duration) : (session.status === 'active' ? 'Ongoing' : 'N/A'),
      'Status': session.status || 'unknown',
      'Date': session.loginTime ? new Date(session.loginTime).toLocaleDateString('en-IN') : 'N/A'
    }));
    
    // Convert to CSV
    const csvHeaders = Object.keys(csvData[0] || {}).join(',') + '\n';
    const csvRows = csvData.map(row => 
      Object.values(row).map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    const csvContent = csvHeaders + csvRows;
    
    // Set response headers for file download
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `lab-sessions-${timestamp}.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    
    console.log(`✅ Exporting ${sessions.length} sessions as ${filename}`);
    res.send(csvContent);
    
  } catch (error) {
    console.error('❌ Export sessions error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to format duration
function formatDuration(seconds) {
  if (!seconds || seconds === 0) return '00:00:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Get session history with pagination
app.get('/api/session-history', async (req, res) => {
  try {
    const { page = 1, limit = 50, labId, status, startDate, endDate } = req.query;
    
    let filter = {};
    
    if (labId && labId !== 'all') {
      filter.labId = labId.toUpperCase();
    }
    
    if (status && status !== 'all') {
      filter.status = status;
    }
    
    if (startDate && endDate) {
      filter.loginTime = {
        $gte: new Date(startDate),
        $lte: new Date(endDate + 'T23:59:59.999Z')
      };
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const sessions = await Session.find(filter)
      .sort({ loginTime: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const totalSessions = await Session.countDocuments(filter);
    const totalPages = Math.ceil(totalSessions / parseInt(limit));
    
    res.json({
      success: true,
      sessions,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalSessions,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });
    
  } catch (error) {
    console.error('❌ Session history error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear all sessions from database
app.post('/api/clear-all-sessions', async (req, res) => {
  try {
    console.log('🗑️ Clearing all sessions from database...');
    
    const result = await Session.deleteMany({});
    
    console.log(`✅ Cleared ${result.deletedCount} sessions from database`);
    
    // Emit event to all connected clients
    io.emit('sessions-cleared', { 
      message: 'All sessions have been cleared',
      deletedCount: result.deletedCount,
      timestamp: new Date()
    });
    
    res.json({ 
      success: true, 
      message: `Successfully cleared ${result.deletedCount} sessions`,
      deletedCount: result.deletedCount
    });
    
  } catch (error) {
    console.error('❌ Clear sessions error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// WebSocket: Socket.io WebRTC signaling
// Lab Session Management API Endpoints

// Note: detectLabFromIP is now imported from lab-config.js at the top of this file

// Start Lab Session
app.post('/api/start-lab-session', async (req, res) => {
  try {
    const { subject, faculty, year, department, section, periods, startTime, expectedDuration, labId } = req.body;
    
    // 🔧 MULTI-LAB: Detect lab from admin IP or use provided labId
    const adminIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0];
    const detectedLabId = labId || detectLabFromIP(adminIP);
    
    console.log(`🏢 Starting lab session for Lab: ${detectedLabId} (Admin IP: ${adminIP})`);
    
    // 🗑️ NEW: Clear all old student sessions for THIS LAB before starting new lab session
    console.log(`🧹 Clearing all old student sessions for Lab ${detectedLabId}...`);
    
    // End all active student sessions for this lab only
    const activeSessionsCount = await Session.countDocuments({ status: 'active', labId: detectedLabId });
    if (activeSessionsCount > 0) {
      await Session.updateMany(
        { status: 'active', labId: detectedLabId }, 
        { 
          status: 'completed', 
          logoutTime: new Date(),
          endReason: 'New lab session started - auto logout'
        }
      );
      console.log(`🗑️ Cleared ${activeSessionsCount} old student sessions for Lab ${detectedLabId}`);
    }
    
    // Clean up any incomplete lab sessions for this lab
    await LabSession.deleteMany({ 
      labId: detectedLabId,
      $or: [
        { subject: { $exists: false } },
        { faculty: { $exists: false } },
        { periods: { $exists: false } }
      ]
    });
    
    // End any existing active lab sessions for THIS LAB ONLY
    await LabSession.updateMany(
      { status: 'active', labId: detectedLabId },
      { status: 'completed', endTime: new Date() }
    );
    
    console.log(`✅ Ready to start new lab session for Lab ${detectedLabId}...`);
    
    // Create new lab session with labId
    const newLabSession = new LabSession({
      labId: detectedLabId, // 🔧 MULTI-LAB: Include lab identifier
      subject,
      faculty,
      year,
      department,
      section,
      periods,
      expectedDuration,
      startTime: new Date(startTime),
      status: 'active',
      studentRecords: []
    });
    
    await newLabSession.save();
    
    // Check how many student sessions are still active
    const activeStudentSessions = await Session.countDocuments({ status: 'active' });
    console.log(`🚀 Lab session started: ${subject} by ${faculty} - ${year}${year === 1 ? 'st' : year === 2 ? 'nd' : year === 3 ? 'rd' : 'th'} Year ${department} ${section !== 'None' ? 'Section ' + section : ''}`);    
    console.log(`📊 Active student sessions preserved: ${activeStudentSessions}`);
    
    res.json({ 
      success: true, 
      session: {
        _id: newLabSession._id,
        subject: newLabSession.subject,
        faculty: newLabSession.faculty,
        year: newLabSession.year,
        department: newLabSession.department,
        section: newLabSession.section,
        periods: newLabSession.periods,
        expectedDuration: newLabSession.expectedDuration,
        startTime: newLabSession.startTime,
        status: newLabSession.status
      },
      message: 'Lab session started successfully'
    });
    
  } catch (error) {
    console.error('Error starting lab session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// End Lab Session
app.post('/api/end-lab-session', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    // Handle force clear
    if (sessionId === 'force-clear' || sessionId === 'clear-all') {
      await LabSession.deleteMany({});
      await Session.updateMany({ status: 'active' }, { status: 'completed', logoutTime: new Date() });
      console.log('🧹 Force cleared all lab sessions');
      return res.json({ success: true, message: 'All lab sessions force cleared' });
    }
    
    const labSession = await LabSession.findById(sessionId);
    if (!labSession) {
      return res.status(404).json({ 
        success: false, 
        error: 'Lab session not found' 
      });
    }
    
    // Update lab session status
    labSession.status = 'completed';
    labSession.endTime = new Date();
    await labSession.save();
    
    // 🔧 MULTI-LAB: Clear all individual student sessions for THIS LAB ONLY
    const activeSessions = await Session.find({ status: 'active', labId: labSession.labId });
    const currentTime = new Date();
    
    console.log(`🛑 Ending ${activeSessions.length} active sessions for Lab ${labSession.labId}`);
    
    for (const session of activeSessions) {
      const durationMs = currentTime - session.loginTime;
      const durationSeconds = Math.floor(durationMs / 1000);
      
      await Session.findByIdAndUpdate(session._id, {
        status: 'completed',
        logoutTime: currentTime,
        duration: durationSeconds
      });

      // Notify corresponding kiosk (if connected) that lab session is ending soon
      try {
        const kioskSocketId = kioskSockets.get(session._id.toString());
        if (kioskSocketId) {
          io.to(kioskSocketId).emit('lab-session-ending', {
            sessionId: session._id.toString(),
            timeoutSeconds: 60,
            message: 'Session has ended. Please save your work and log out within 1 minute.'
          });
          console.log(`📢 Sent lab-session-ending notice to kiosk socket ${kioskSocketId} for session ${session._id}`);
        }
      } catch (notifyErr) {
        console.error('⚠️ Error notifying kiosk about session end:', notifyErr.message || notifyErr);
      }
    }
    
    console.log(`🛑 Updated ${activeSessions.length} active sessions to completed`);
    
    console.log(`🛑 Lab session ended: ${labSession.subject}`);
    
    // Generate lab session CSV report
    const csvResult = await generateLabSessionCSV(labSession._id);
    
    if (csvResult.success) {
      // Save to manual reports folder
      const filepath = path.join(MANUAL_REPORT_DIR, csvResult.filename);
      fs.writeFileSync(filepath, csvResult.csvContent, 'utf8');
      console.log(`💾 Lab session CSV saved: ${csvResult.filename}`);
      
      // Notify all admins with CSV download link
      io.to('admins').emit('lab-session-ended', {
        sessionId: labSession._id,
        subject: labSession.subject,
        clearedSessions: activeSessions.length,
        csvFilename: csvResult.filename,
        csvAvailable: true
      });
    } else {
      // Notify without CSV if generation failed
      io.to('admins').emit('lab-session-ended', {
        sessionId: labSession._id,
        subject: labSession.subject,
        clearedSessions: activeSessions.length
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Lab session ended and all data cleared successfully',
      csvGenerated: csvResult.success,
      csvFilename: csvResult.success ? csvResult.filename : null
    });
    
  } catch (error) {
    console.error('Error ending lab session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update session duration - allows adjusting duration after session starts
app.post('/api/update-session-duration', async (req, res) => {
  try {
    const { sessionId, periods, expectedDuration } = req.body;
    
    if (!sessionId || !periods || !expectedDuration) {
      return res.status(400).json({ 
        success: false, 
        error: 'Session ID, periods, and expected duration are required' 
      });
    }
    
    // Validate periods (1-6)
    if (periods < 1 || periods > 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'Periods must be between 1 and 6' 
      });
    }
    
    // Find and update the lab session
    const labSession = await LabSession.findById(sessionId);
    if (!labSession) {
      return res.status(404).json({ 
        success: false, 
        error: 'Lab session not found' 
      });
    }
    
    // Update the duration
    labSession.periods = periods;
    labSession.expectedDuration = expectedDuration;
    labSession.updatedAt = new Date();
    await labSession.save();
    
    console.log(`⏱️ Session duration updated: ${labSession.subject} - ${periods} periods (${expectedDuration} min)`);
    
    res.json({ 
      success: true, 
      message: 'Session duration updated successfully',
      session: labSession
    });
    
  } catch (error) {
    console.error('Error updating session duration:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Force clear everything - emergency endpoint
app.post('/api/force-clear-all', async (req, res) => {
  try {
    console.log('🚨 EMERGENCY: Force clearing ALL data...');
    
    // Delete all lab sessions
    const labResult = await LabSession.deleteMany({});
    
    // Set all individual sessions to completed with proper duration
    const activeSessionsForClear = await Session.find({ status: 'active' });
    const clearTime = new Date();
    
    for (const session of activeSessionsForClear) {
      const durationMs = clearTime - session.loginTime;
      const durationSeconds = Math.floor(durationMs / 1000);
      
      await Session.findByIdAndUpdate(session._id, {
        status: 'completed',
        logoutTime: clearTime,
        duration: durationSeconds
      });
    }
    
    const sessionResult = { modifiedCount: activeSessionsForClear.length };
    
    console.log(`🧹 Deleted ${labResult.deletedCount} lab sessions`);
    console.log(`🧹 Completed ${sessionResult.modifiedCount} individual sessions`);
    
    res.json({
      success: true,
      message: `Emergency clear completed: ${labResult.deletedCount} lab sessions deleted, ${sessionResult.modifiedCount} individual sessions completed`,
      labSessionsDeleted: labResult.deletedCount,
      individualSessionsCompleted: sessionResult.modifiedCount
    });
  } catch (error) {
    console.error('Error in emergency clear:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clean up problematic lab sessions
app.post('/api/cleanup-lab-sessions', async (req, res) => {
  try {
    // Remove any lab sessions that might have validation issues
    const result = await LabSession.deleteMany({
      $or: [
        { subject: { $exists: false } },
        { faculty: { $exists: false } },
        { periods: { $exists: false } },
        { year: { $exists: false } },
        { department: { $exists: false } },
        { section: { $exists: false } }
      ]
    });
    
    console.log(`🧹 Cleaned up ${result.deletedCount} problematic lab sessions`);
    
    res.json({
      success: true,
      message: `Cleaned up ${result.deletedCount} problematic lab sessions`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error cleaning up lab sessions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug current active session
app.get('/api/debug-current-session', async (req, res) => {
  try {
    const activeLabSession = await LabSession.findOne({ status: 'active' });
    const allSessions = await Session.find({}).sort({ loginTime: -1 }).limit(10);
    const activeSessions = await Session.find({ status: 'active' });
    
    res.json({
      success: true,
      debug: {
        activeLabSession: activeLabSession,
        activeLabSessionStudentRecords: activeLabSession ? activeLabSession.studentRecords : null,
        recentIndividualSessions: allSessions,
        activeIndividualSessions: activeSessions,
        counts: {
          labSessionStudents: activeLabSession ? activeLabSession.studentRecords.length : 0,
          activeIndividualSessions: activeSessions.length,
          recentIndividualSessions: allSessions.length
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug endpoint to check session data
app.get('/api/debug-session-data/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const labSession = await LabSession.findById(sessionId);
    const allSessions = await Session.find({}).sort({ loginTime: -1 }).limit(10);
    const activeSessions = await Session.find({ status: 'active' });
    
    res.json({
      success: true,
      debug: {
        labSession: labSession,
        recentSessions: allSessions,
        activeSessions: activeSessions,
        labSessionStudentRecords: labSession ? labSession.studentRecords : null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export Session Data
app.get('/api/export-session-data/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const labSession = await LabSession.findById(sessionId);
    if (!labSession) {
      return res.status(404).json({ 
        success: false, 
        error: 'Lab session not found' 
      });
    }
    
    console.log(`📊 Lab session found: ${labSession.subject} - Start time: ${labSession.startTime}`);
    console.log(`📊 Lab session embedded student records: ${labSession.studentRecords ? labSession.studentRecords.length : 0}`);
    
    // PRIORITY 1: Use embedded student records from lab session (most reliable)
    let finalStudentRecords = [];
    
    if (labSession.studentRecords && labSession.studentRecords.length > 0) {
      console.log(`📊 Using embedded student records from lab session: ${labSession.studentRecords.length}`);
      finalStudentRecords = labSession.studentRecords;
    } else {
      // PRIORITY 2: Get individual session records during this lab session period
      console.log(`📊 No embedded records, checking individual Session records...`);
      const studentRecords = await Session.find({
        loginTime: { $gte: labSession.startTime },
        ...(labSession.endTime && { loginTime: { $lte: labSession.endTime } })
      }).sort({ loginTime: 1 });
      
      console.log(`📊 Found ${studentRecords.length} individual session records`);
      finalStudentRecords = studentRecords;
    }
    
    // PRIORITY 3: If still no records, get ALL active sessions (fallback)
    if (finalStudentRecords.length === 0) {
      console.log(`📊 No records found, using ALL active sessions as fallback...`);
      const allActiveSessions = await Session.find({ status: 'active' }).sort({ loginTime: 1 });
      console.log(`📊 Found ${allActiveSessions.length} active sessions as fallback`);
      finalStudentRecords = allActiveSessions;
    }
    
    console.log(`📊 FINAL: Will export ${finalStudentRecords.length} student records`);
    console.log(`📊 Student names in export:`, finalStudentRecords.map(r => r.studentName));
    
    res.json({
      success: true,
      sessionData: {
        subject: labSession.subject,
        faculty: labSession.faculty,
        year: labSession.year,
        department: labSession.department,
        section: labSession.section,
        periods: labSession.periods,
        expectedDuration: labSession.expectedDuration,
        startTime: labSession.startTime,
        endTime: labSession.endTime
      },
      studentRecords: finalStudentRecords.map(record => ({
        studentName: record.studentName,
        studentId: record.studentId,
        systemNumber: record.systemNumber,
        loginTime: record.loginTime,
        logoutTime: record.logoutTime,
        duration: record.duration,
        status: record.status
      }))
    });
    
  } catch (error) {
    console.error('Error exporting session data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Socket maps for kiosk/admin WebRTC + control
const kioskSockets = new Map(); // sessionId -> socket.id (for logged-in kiosks)
const kioskSystemSockets = new Map(); // systemNumber -> socket.id (for pre-login kiosks)
const adminSockets = new Map();

io.on('connection', (socket) => {
  console.log("✅ Socket connected:", socket.id);
  
  // Get client IP address for lab detection
  const clientIP = socket.handshake.address.replace('::ffff:', ''); // Remove IPv6 prefix if present
  console.log('🌐 Client IP:', clientIP);

  socket.on('computer-online', (data) => { 
    console.log("💻 Computer online:", data); 
  });

  socket.on('screen-share', (data) => { 
    socket.broadcast.emit('live-screen', data); 
  });

  // ========================================================================
  // SYSTEM REGISTRY - Track all powered-on systems (even before login)
  // ========================================================================
  socket.on('register-kiosk', async ({ sessionId, systemNumber, labId, ipAddress }) => {
    try {
      // Detect lab from IP if not provided
      const detectedLabId = labId || detectLabFromIP(ipAddress || clientIP);
      console.log('📡 Kiosk registering:', {
        sessionId: sessionId || 'PRE-LOGIN',
        socketId: socket.id,
        systemNumber,
        labId: detectedLabId,
        ipAddress: ipAddress || clientIP
      });
      
      // Register by session ID if available (after login)
      if (sessionId) {
        kioskSockets.set(sessionId, socket.id);
        socket.join(`session-${sessionId}`);
      }
      
      // Always register by system number (works before and after login)
      if (systemNumber) {
        kioskSystemSockets.set(systemNumber, socket.id);
        console.log(`✅ Registered kiosk by system number: ${systemNumber} -> ${socket.id}`);
        
        // Update system registry in database
        await SystemRegistry.findOneAndUpdate(
          { systemNumber },
          {
            systemNumber,
            labId: detectedLabId,
            ipAddress: ipAddress || clientIP,
            status: sessionId ? 'logged-in' : 'available',
            socketId: socket.id,
            lastSeen: new Date()
          },
          { upsert: true, new: true }
        );
        
        console.log(`✅ System registry updated: ${systemNumber} in lab ${detectedLabId}`);
        
        // Broadcast updated system list to all admins
        const availableSystems = await SystemRegistry.find({ status: { $ne: 'offline' } })
          .sort({ systemNumber: 1 })
          .lean();
        
        io.to('admins').emit('systems-registry-update', {
          systems: availableSystems,
          timestamp: new Date().toISOString()
        });
      }
      
      socket.join(`lab-${detectedLabId}`); // Join lab-specific room
      
    } catch (error) {
      console.error('❌ Error in register-kiosk:', error);
    }
  });
  
  // Handle kiosk screen ready event
  socket.on('kiosk-screen-ready', ({ sessionId, hasVideo, timestamp }) => {
    console.log('🎉 KIOSK SCREEN READY:', sessionId, 'Has Video:', hasVideo);
    // Notify all admins that this kiosk's screen is ready for monitoring
    io.to('admins').emit('kiosk-screen-ready', { 
      sessionId, 
      hasVideo, 
      timestamp,
      kioskSocketId: socket.id
    });
    console.log('📡 Notified admins: Kiosk screen ready for session:', sessionId);
  });

  socket.on('admin-offer', ({ offer, sessionId, adminSocketId, systemNumber }) => {
    // Try to find kiosk by sessionId first (after login)
    let kioskSocketId = sessionId ? kioskSockets.get(sessionId) : null;
    
    // If not found by sessionId, try by systemNumber (before login or guest mode)
    if (!kioskSocketId && systemNumber) {
      kioskSocketId = kioskSystemSockets.get(systemNumber);
      console.log(`📹 Kiosk found by system number: ${systemNumber} -> ${kioskSocketId}`);
    }
    
    const isModal = adminSocketId && adminSocketId.includes('-modal');
    console.log('📹 Admin offer for session:', sessionId || 'PRE-LOGIN', 'System:', systemNumber, '-> Kiosk:', kioskSocketId, 'Modal:', isModal);
    
    // Track admin for this session/system
    const trackingKey = sessionId || systemNumber;
    if (!adminSockets.has(trackingKey)) {
      adminSockets.set(trackingKey, []);
    }
    if (!adminSockets.get(trackingKey).includes(adminSocketId)) {
      adminSockets.get(trackingKey).push(adminSocketId);
    }
    
    if (kioskSocketId) {
      console.log('📤 Forwarding offer to kiosk:', kioskSocketId);
      console.log('📤 Offer params:', {
        hasOffer: !!offer,
        sessionId: sessionId || null,
        adminSocketId: adminSocketId,
        kioskSocketId: kioskSocketId
      });
      io.to(kioskSocketId).emit('admin-offer', { offer, sessionId: sessionId || null, adminSocketId });
      console.log('✅ Offer emitted to kiosk');
    } else {
      console.warn('⚠️ Kiosk not found for session:', sessionId, 'or system:', systemNumber);
      // Send error back to admin (safely handle undefined adminSocketId)
      if (adminSocketId) {
        const targetSocketId = adminSocketId.replace('-modal', '');
        io.to(targetSocketId).emit('webrtc-error', { 
          sessionId, 
          error: 'Student not connected' 
        });
      }
    }
  });

  socket.on('webrtc-answer', ({ answer, adminSocketId, sessionId }) => {
    console.log('📹 ✅✅✅ SERVER RECEIVED WebRTC answer from kiosk!');
    console.log('📹 Answer details:', {
      hasAnswer: !!answer,
      answerType: answer?.type,
      adminSocketId: adminSocketId,
      sessionId: sessionId,
      kioskSocketId: socket.id
    });
    
    // Handle both regular and modal admin socket IDs
    let targetSocketId = adminSocketId;
    if (adminSocketId && adminSocketId.includes('-modal')) {
      // Extract the base socket ID for modal connections
      targetSocketId = adminSocketId.replace('-modal', '');
    }
    
    console.log('📹 Forwarding answer to admin socket:', targetSocketId);
    io.to(targetSocketId).emit('webrtc-answer', { answer, sessionId, adminSocketId });
    console.log('📹 ✅ Answer forwarded to admin');
  });

  socket.on('webrtc-ice-candidate', ({ candidate, sessionId }) => {
    console.log('🧊 SERVER: ICE candidate for session:', sessionId, 'from:', socket.id);
    
    const kioskSocketId = kioskSockets.get(sessionId);
    const admins = adminSockets.get(sessionId) || [];
    
    if (socket.id === kioskSocketId) {
      console.log('🧊 SERVER: ICE from KIOSK -> sending to', admins.length, 'admin(s)');
      admins.forEach(adminId => {
        io.to(adminId).emit('webrtc-ice-candidate', { candidate, sessionId });
      });
    } else {
      console.log('🧊 SERVER: ICE from ADMIN -> sending to kiosk:', kioskSocketId);
      if (kioskSocketId) {
        io.to(kioskSocketId).emit('webrtc-ice-candidate', { candidate, sessionId });
      }
    }
  });

  // Admin registration and session management
  socket.on('register-admin', () => {
    console.log('👨‍💼 Admin registered:', socket.id);
    socket.join('admins');
  });

  // Generic room join handler
  socket.on('join-room', (roomName) => {
    console.log(`👥 Socket ${socket.id} joining room: ${roomName}`);
    socket.join(roomName);
  });

  // Store admin's lab ID when they register
  let adminLabMap = new Map(); // socket.id -> labId
  
  socket.on('register-admin', (data) => {
    // 🔧 MULTI-LAB: Admin can provide labId or it's auto-detected
    const adminIP = socket.handshake.address || socket.request.connection.remoteAddress;
    const providedLabId = data?.labId;
    const detectedLabId = providedLabId || detectLabFromIP(adminIP);
    
    adminLabMap.set(socket.id, detectedLabId);
    console.log(`👨‍💼 Admin registered: ${socket.id} for Lab: ${detectedLabId} (IP: ${adminIP})`);
    socket.join('admins');
    socket.join(`admins-lab-${detectedLabId}`); // Lab-specific admin room
  });

  // 🔓 GUEST ACCESS: Handle guest access request from admin
  socket.on('grant-guest-access', async ({ systemNumber, labId }) => {
    try {
      console.log(`🔓 Admin requesting guest access for system: ${systemNumber} in lab: ${labId}`);
      
      // Find kiosk by system number (works even before login)
      const kioskSocketId = kioskSystemSockets.get(systemNumber);
      
      if (!kioskSocketId) {
        console.error(`❌ Kiosk not found for system: ${systemNumber}`);
        socket.emit('guest-access-error', { 
          systemNumber, 
          error: `System ${systemNumber} is not connected or not registered` 
        });
        return;
      }
      
      console.log(`✅ Found kiosk socket for system ${systemNumber}: ${kioskSocketId}`);
      
      // Send guest access command to kiosk
      io.to(kioskSocketId).emit('guest-access-granted', {
        systemNumber,
        labId: labId || 'CC1',
        timestamp: new Date().toISOString()
      });
      
      console.log(`✅ Guest access command sent to kiosk: ${systemNumber}`);
      
      // Notify admin of success
      socket.emit('guest-access-success', {
        systemNumber,
        labId,
        message: `Guest access granted for ${systemNumber}`
      });
      
    } catch (error) {
      console.error('❌ Error granting guest access:', error);
      socket.emit('guest-access-error', {
        systemNumber,
        error: error.message || 'Unknown error'
      });
    }
  });

  socket.on('get-active-sessions', async (data) => {
    try {
      // 🔧 MULTI-LAB: Get labId from admin's stored value or request data
      const adminLabId = adminLabMap.get(socket.id) || data?.labId || 'CC1';
      
      console.log(`📋 Admin requesting active sessions for Lab: ${adminLabId}`);
      const activeSessions = await Session.find({ status: 'active', labId: adminLabId }).sort({ loginTime: -1 });
      
      // Also get active lab session for THIS LAB ONLY
      const activeLabSession = await LabSession.findOne({ status: 'active', labId: adminLabId });
      
      socket.emit('active-sessions', {
        sessions: activeSessions,
        labSession: activeLabSession,
        labId: adminLabId // Send labId back to admin
      });
      
      console.log(`📊 Sent ${activeSessions.length} sessions for Lab ${adminLabId} and lab session: ${activeLabSession ? activeLabSession.subject : 'none'}`);
    } catch (error) {
      console.error('❌ Error getting active sessions:', error);
      socket.emit('active-sessions', { sessions: [], labSession: null, labId: 'CC1' });
    }
  });

  // Shutdown specific system
  socket.on('shutdown-system', ({ sessionId }) => {
    console.log(`🔌 Shutdown command received for session: ${sessionId}`);
    
    const kioskSocketId = kioskSockets.get(sessionId);
    if (kioskSocketId) {
      io.to(kioskSocketId).emit('execute-shutdown');
      console.log(`✅ Shutdown signal sent to kiosk: ${kioskSocketId}`);
      
      // Log the shutdown action
      Session.findByIdAndUpdate(sessionId, {
        shutdownInitiatedAt: new Date(),
        shutdownBy: 'admin'
      }).catch(err => console.error('❌ Error logging shutdown:', err));
    } else {
      console.warn('⚠️ Kiosk not connected for session:', sessionId);
      socket.emit('shutdown-error', { sessionId, error: 'Student not connected' });
    }
  });

  // Shutdown all systems in a lab
  socket.on('shutdown-all-systems', async ({ labId }) => {
    console.log(`🔌 Shutdown ALL systems command received for lab: ${labId}`);
    
    try {
      // Get all active sessions in this lab
      const activeSessions = await Session.find({ 
        labId: labId, 
        status: 'active' 
      });
      
      console.log(`📋 Found ${activeSessions.length} active sessions in lab ${labId}`);
      
      let shutdownCount = 0;
      for (const session of activeSessions) {
        const kioskSocketId = kioskSockets.get(session._id.toString());
        if (kioskSocketId) {
          io.to(kioskSocketId).emit('execute-shutdown');
          shutdownCount++;
          console.log(`✅ Shutdown signal sent to session: ${session._id}`);
          
          // Log the shutdown action
          Session.findByIdAndUpdate(session._id, {
            shutdownInitiatedAt: new Date(),
            shutdownBy: 'admin-all'
          }).catch(err => console.error('❌ Error logging shutdown:', err));
        }
      }
      
      console.log(`✅ Shutdown signal broadcast to ${shutdownCount} systems in lab ${labId}`);
      socket.emit('shutdown-all-complete', { labId, count: shutdownCount });
    } catch (error) {
      console.error('❌ Error shutting down all systems:', error);
      socket.emit('shutdown-error', { labId, error: error.message });
    }
  });

  // ========================================================================
  // HARDWARE MONITORING - Disconnect Detection
  // ========================================================================
  
  // Handle hardware alerts (disconnections and reconnections)
  socket.on('hardware-alert', async (alertData) => {
    console.log('🚨 Hardware alert received:', alertData);
    
    try {
      // Save alert to database
      const alert = new HardwareAlert({
        studentId: alertData.studentId,
        studentName: alertData.studentName,
        systemNumber: alertData.systemNumber,
        deviceType: alertData.deviceType,
        type: alertData.type,
        severity: alertData.severity || 'warning',
        message: alertData.message,
        timestamp: alertData.timestamp || new Date()
      });
      
      await alert.save();
      console.log('✅ Hardware alert saved to database:', alert._id);
      
      // Broadcast alert to all admin dashboards
      io.to('admins').emit('admin-hardware-alert', {
        ...alertData,
        alertId: alert._id,
        savedAt: new Date()
      });
      
      console.log('📡 Alert broadcast to admins:', alertData.deviceType, alertData.type);
    } catch (error) {
      console.error('❌ Error handling hardware alert:', error);
    }
  });

  // Handle hardware status reports
  socket.on('hardware-status', (statusData) => {
    console.log('📊 Hardware status received:', statusData);
    
    // Broadcast status to admins (optional - for dashboard monitoring)
    io.to('admins').emit('hardware-status-update', statusData);
  });

  // Get hardware alerts (for admin dashboard)
  socket.on('get-hardware-alerts', async ({ limit = 50, acknowledged = false }) => {
    try {
      const query = acknowledged ? {} : { acknowledged: false };
      const alerts = await HardwareAlert.find(query)
        .sort({ timestamp: -1 })
        .limit(limit);
      
      socket.emit('hardware-alerts-list', alerts);
      console.log(`📋 Sent ${alerts.length} hardware alerts to admin`);
    } catch (error) {
      console.error('❌ Error fetching hardware alerts:', error);
      socket.emit('hardware-alerts-list', []);
    }
  });

  // Acknowledge hardware alert
  socket.on('acknowledge-alert', async ({ alertId, adminName }) => {
    try {
      await HardwareAlert.findByIdAndUpdate(alertId, {
        acknowledged: true,
        acknowledgedAt: new Date(),
        acknowledgedBy: adminName || 'admin'
      });
      
      console.log(`✅ Alert ${alertId} acknowledged by ${adminName}`);
      socket.emit('alert-acknowledged', { alertId, success: true });
      
      // Notify other admins
      io.to('admins').emit('alert-status-changed', { alertId, acknowledged: true });
    } catch (error) {
      console.error('❌ Error acknowledging alert:', error);
      socket.emit('alert-acknowledged', { alertId, success: false, error: error.message });
    }
  });

  // ========================================================================
  // GUEST ACCESS / BYPASS LOGIN
  // ========================================================================
  
  socket.on('admin-enable-guest-access', async ({ systemNumber, adminName, labId }) => {
    try {
      console.log('🔓 Admin enabling guest access for system:', systemNumber);
      
      // Update system registry to mark as guest (even if not yet registered)
      await SystemRegistry.findOneAndUpdate(
        { systemNumber },
        {
          status: 'guest',
          isGuest: true,
          lastSeen: new Date()
        },
        { upsert: true, new: true }
      );
      
      // Broadcast to all kiosks - the matching system will respond
      io.emit('enable-guest-access', {
        systemNumber: systemNumber,
        guestPassword: 'admin123',
        enabledBy: adminName || 'admin',
        timestamp: new Date().toISOString()
      });
      
      console.log('✅ Guest access command broadcast for system:', systemNumber);
      
      // Notify admins that guest mode was enabled
      io.to('admins').emit('guest-access-enabled', {
        systemNumber: systemNumber,
        enabledBy: adminName || 'admin',
        timestamp: new Date().toISOString()
      });
      
      // Send updated system list to admins
      const systems = await SystemRegistry.find({ status: { $ne: 'offline' } })
        .sort({ systemNumber: 1 })
        .lean();
      io.to('admins').emit('systems-registry-update', {
        systems,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Error enabling guest access:', error);
    }
  });
  
  // Kiosk confirms guest access enabled
  socket.on('guest-access-confirmed', async ({ systemNumber, studentInfo }) => {
    try {
      console.log('✅ Guest access confirmed for system:', systemNumber);
      
      // Update system registry
      await SystemRegistry.findOneAndUpdate(
        { systemNumber },
        {
          status: 'guest',
          isGuest: true,
          currentStudentId: 'GUEST',
          currentStudentName: 'Guest User',
          lastSeen: new Date()
        },
        { upsert: true, new: true }
      );
      
      // Notify all admins that this system is now in guest mode
      io.to('admins').emit('system-guest-mode-active', {
        systemNumber: systemNumber,
        guestInfo: studentInfo,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Error confirming guest access:', error);
    }
  });

  socket.on('disconnect', () => { 
    console.log("❌ Socket disconnected:", socket.id); 
    
    for (const [sessionId, sId] of kioskSockets.entries()) {
      if (sId === socket.id) {
        kioskSockets.delete(sessionId);
        console.log('🧹 Cleaned up kiosk for session:', sessionId);
      }
    }
    
    for (const [sessionId, admins] of adminSockets.entries()) {
      const index = admins.indexOf(socket.id);
      if (index > -1) {
        admins.splice(index, 1);
        if (admins.length === 0) {
          adminSockets.delete(sessionId);
        }
        console.log('🧹 Cleaned up admin for session:', sessionId);
      }
    }
  });
});

// =============================================================================
// AUTOMATIC REPORT SCHEDULING SYSTEM
// =============================================================================

let scheduledTasks = new Map();

// =============================================================================
// SESSION CSV STORAGE SYSTEM
// =============================================================================

// Function to save individual session to CSV
async function saveSessionToCSV(session) {
  try {
    const date = new Date().toISOString().split('T')[0];
    const labId = session.labId || 'UNKNOWN';
    const filename = `${labId}_${date}.csv`;
    const filepath = path.join(SESSION_CSV_DIR, filename);
    
    // Prepare session data
    const sessionData = {
      'Session ID': session._id.toString(),
      'Student Name': session.studentName || 'N/A',
      'Student ID': session.studentId || 'N/A',
      'Computer Name': session.computerName || 'N/A',
      'Lab ID': session.labId || 'N/A',
      'System Number': session.systemNumber || 'N/A',
      'Login Time': session.loginTime ? new Date(session.loginTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
      'Logout Time': session.logoutTime ? new Date(session.logoutTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Active',
      'Duration (seconds)': session.duration || 'N/A',
      'Status': session.status || 'unknown'
    };
    
    // Check if file exists
    const fileExists = fs.existsSync(filepath);
    
    if (!fileExists) {
      // Create new file with headers
      const headers = Object.keys(sessionData).join(',') + '\n';
      fs.writeFileSync(filepath, headers, 'utf8');
    }
    
    // Append session data
    const row = Object.values(sessionData)
      .map(val => `"${String(val).replace(/"/g, '""')}"`)  
      .join(',') + '\n';
    
    fs.appendFileSync(filepath, row, 'utf8');
    
    console.log(`💾 Session saved to CSV: ${filename}`);
    return { success: true, filename, filepath };
  } catch (error) {
    console.error('❌ Error saving session to CSV:', error);
    return { success: false, error: error.message };
  }
}

// Function to update session in CSV (for logout)
async function updateSessionInCSV(session) {
  try {
    const date = new Date(session.loginTime).toISOString().split('T')[0];
    const labId = session.labId || 'UNKNOWN';
    const filename = `${labId}_${date}.csv`;
    const filepath = path.join(SESSION_CSV_DIR, filename);
    
    if (!fs.existsSync(filepath)) {
      // If file doesn't exist, create it with this session
      return await saveSessionToCSV(session);
    }
    
    // Read existing CSV
    const content = fs.readFileSync(filepath, 'utf8');
    const lines = content.split('\n');
    const sessionId = session._id.toString();
    
    // Find and update the session row
    let updated = false;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].includes(sessionId)) {
        const sessionData = {
          'Session ID': session._id.toString(),
          'Student Name': session.studentName || 'N/A',
          'Student ID': session.studentId || 'N/A',
          'Computer Name': session.computerName || 'N/A',
          'Lab ID': session.labId || 'N/A',
          'System Number': session.systemNumber || 'N/A',
          'Login Time': session.loginTime ? new Date(session.loginTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
          'Logout Time': session.logoutTime ? new Date(session.logoutTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Active',
          'Duration (seconds)': session.duration || 'N/A',
          'Status': session.status || 'unknown'
        };
        
        lines[i] = Object.values(sessionData)
          .map(val => `"${String(val).replace(/"/g, '""')}"`)
          .join(',');
        
        updated = true;
        break;
      }
    }
    
    if (updated) {
      fs.writeFileSync(filepath, lines.join('\n'), 'utf8');
      console.log(`💾 Session updated in CSV: ${filename}`);
    }
    
    return { success: true, filename, filepath };
  } catch (error) {
    console.error('❌ Error updating session in CSV:', error);
    return { success: false, error: error.message };
  }
}

// Function to generate lab session CSV with metadata
async function generateLabSessionCSV(labSessionId) {
  try {
    const labSession = await LabSession.findById(labSessionId);
    
    if (!labSession) {
      console.error('❌ Lab session not found for ID:', labSessionId);
      return { success: false, error: 'Lab session not found' };
    }
    
    console.log('📊 Generating CSV for lab session:');
    console.log('   Subject:', labSession.subject);
    console.log('   Faculty:', labSession.faculty);
    console.log('   Year:', labSession.year);
    console.log('   Department:', labSession.department);
    console.log('   Section:', labSession.section);
    console.log('   Periods:', labSession.periods);
    console.log('   Students:', labSession.studentRecords.length);
    
    // Format dates
    const startTime = new Date(labSession.startTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const endTime = labSession.endTime ? new Date(labSession.endTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Active';
    
    // Calculate total duration
    const totalDuration = labSession.endTime 
      ? Math.floor((labSession.endTime - labSession.startTime) / 1000)
      : 0;
    
    const durationMinutes = Math.floor(totalDuration / 60);
    
    // Create CSV content with metadata header
    let csvContent = '';
    
    // Session Metadata Section
    csvContent += '"LAB SESSION REPORT"\n';
    csvContent += '"="\n';
    csvContent += `"Subject:","${labSession.subject}"\n`;
    csvContent += `"Faculty:","${labSession.faculty}"\n`;
    csvContent += `"Year:","${labSession.year || 'N/A'}"\n`;
    csvContent += `"Department:","${labSession.department || 'N/A'}"\n`;
    csvContent += `"Section:","${labSession.section || 'N/A'}"\n`;
    csvContent += `"Time Periods:","${labSession.periods} periods"\n`;
    csvContent += `"Expected Duration:","${labSession.expectedDuration} minutes"\n`;
    csvContent += `"Actual Duration:","${durationMinutes} minutes"\n`;
    csvContent += `"Start Time:","${startTime}"\n`;
    csvContent += `"End Time:","${endTime}"\n`;
    csvContent += `"Status:","${labSession.status}"\n`;
    csvContent += `"Total Students:","${labSession.studentRecords.length}"\n`;
    csvContent += '"="\n';
    csvContent += '\n';
    
    // Student Records Section
    csvContent += '"STUDENT RECORDS"\n';
    csvContent += '"Student Name","Student ID","System Number","Login Time","Logout Time","Duration (seconds)","Duration (minutes)","Status"\n';
    
    labSession.studentRecords.forEach(record => {
      const loginTime = record.loginTime ? new Date(record.loginTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A';
      const logoutTime = record.logoutTime ? new Date(record.logoutTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Active';
      const durationSec = record.duration || 0;
      const durationMin = Math.floor(durationSec / 60);
      
      csvContent += `"${record.studentName || 'N/A'}",`;
      csvContent += `"${record.studentId || 'N/A'}",`;
      csvContent += `"${record.systemNumber || 'N/A'}",`;
      csvContent += `"${loginTime}",`;
      csvContent += `"${logoutTime}",`;
      csvContent += `"${durationSec}",`;
      csvContent += `"${durationMin}",`;
      csvContent += `"${record.status}"\n`;
    });
    
    // Generate filename
    const dateStr = new Date(labSession.startTime).toISOString().split('T')[0];
    const timeStr = new Date(labSession.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/[: ]/g, '-');
    const subjectStr = labSession.subject.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30);
    const filename = `LabSession_${subjectStr}_${dateStr}_${timeStr}.csv`;
    
    console.log(`✅ Lab session CSV generated: ${filename}`);
    
    return { 
      success: true, 
      csvContent, 
      filename,
      studentCount: labSession.studentRecords.length,
      subject: labSession.subject,
      faculty: labSession.faculty
    };
  } catch (error) {
    console.error('❌ Error generating lab session CSV:', error);
    return { success: false, error: error.message };
  }
}

// Function to clean up old manual reports (older than 1 day)
function cleanupOldManualReports() {
  try {
    const files = fs.readdirSync(MANUAL_REPORT_DIR);
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    let deletedCount = 0;
    
    files.forEach(file => {
      const filepath = path.join(MANUAL_REPORT_DIR, file);
      const stats = fs.statSync(filepath);
      
      if (stats.mtimeMs < oneDayAgo) {
        fs.unlinkSync(filepath);
        deletedCount++;
        console.log(`🗑️ Deleted old manual report: ${file}`);
      }
    });
    
    if (deletedCount > 0) {
      console.log(`✅ Cleaned up ${deletedCount} old manual reports`);
    }
  } catch (error) {
    console.error('❌ Error cleaning up old reports:', error);
  }
}

// Schedule cleanup every hour
setInterval(cleanupOldManualReports, 60 * 60 * 1000);

// =============================================================================
// END SESSION CSV STORAGE SYSTEM
// =============================================================================

// Function to generate and save report (returns CSV content)
async function generateScheduledReport(labId) {
  try {
    console.log(`📊 Generating scheduled report for lab: ${labId} at ${new Date().toLocaleString()}`);
    
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    
    const filter = {
      labId: labId,
      loginTime: { $gte: startDate, $lte: endDate }
    };
    
    const sessions = await Session.find(filter).sort({ loginTime: -1 }).lean();
    
    // Format CSV data
    const csvData = sessions.map(session => ({
      'Session ID': session._id.toString(),
      'Student Name': session.studentName || 'N/A',
      'Student ID': session.studentId || 'N/A',
      'Computer Name': session.computerName || 'N/A',
      'Lab ID': session.labId || 'N/A',
      'System Number': session.systemNumber || 'N/A',
      'Login Time': session.loginTime ? new Date(session.loginTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
      'Logout Time': session.logoutTime ? new Date(session.logoutTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Still Active',
      'Duration (seconds)': session.duration || 'N/A',
      'Status': session.status || 'unknown'
    }));
    
    // Create CSV content
    const csvHeaders = Object.keys(csvData[0] || {}).join(',') + '\n';
    const csvRows = csvData.map(row => 
      Object.values(row).map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const csvContent = csvHeaders + csvRows;
    
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${labId}-sessions-${timestamp}.csv`;
    
    // Update last generated timestamp
    await ReportSchedule.findOneAndUpdate(
      { labId },
      { lastGenerated: new Date() }
    );
    
    console.log(`✅ Report generated: ${filename}`);
    
    return { success: true, csvContent, filename, count: sessions.length };
  } catch (error) {
    console.error('❌ Error generating scheduled report:', error);
    return { success: false, error: error.message };
  }
}

// Setup cron jobs for all labs - Updated to support 2 schedules per day
async function setupReportSchedulers() {
  try {
    const schedules = await ReportSchedule.find({});
    let totalSchedules = 0;
    
    for (const schedule of schedules) {
      // Schedule 1
      if (schedule.scheduleTime1 && schedule.enabled1) {
        const [hours1, minutes1] = schedule.scheduleTime1.split(':');
        const cronExpression1 = `${minutes1} ${hours1} * * *`; // Daily at specified time
        
        console.log(`⏰ Scheduling report 1 for ${schedule.labId} at ${schedule.scheduleTime1} (${cronExpression1})`);
        
        const task1 = cron.schedule(cronExpression1, async () => {
          const result = await generateScheduledReport(schedule.labId);
          
          if (result.success && io) {
            // Save automatic report to AUTO_REPORT_DIR
            const autoReportPath = path.join(AUTO_REPORT_DIR, result.filename);
            fs.writeFileSync(autoReportPath, result.csvContent, 'utf8');
            console.log(`💾 Automatic report 1 saved: ${autoReportPath}`);
            
            console.log(`📢 Broadcasting scheduled report 1 for ${schedule.labId}`);
            io.emit('scheduled-report-ready', {
              labId: schedule.labId,
              scheduleNumber: 1,
              filename: result.filename,
              csvContent: result.csvContent,
              count: result.count,
              timestamp: new Date().toISOString()
            });
          }
        }, {
          timezone: 'Asia/Kolkata'
        });
        
        scheduledTasks.set(`${schedule.labId}-schedule1`, task1);
        totalSchedules++;
      }
      
      // Schedule 2
      if (schedule.scheduleTime2 && schedule.enabled2) {
        const [hours2, minutes2] = schedule.scheduleTime2.split(':');
        const cronExpression2 = `${minutes2} ${hours2} * * *`; // Daily at specified time
        
        console.log(`⏰ Scheduling report 2 for ${schedule.labId} at ${schedule.scheduleTime2} (${cronExpression2})`);
        
        const task2 = cron.schedule(cronExpression2, async () => {
          const result = await generateScheduledReport(schedule.labId);
          
          if (result.success && io) {
            // Save automatic report to AUTO_REPORT_DIR
            const autoReportPath = path.join(AUTO_REPORT_DIR, result.filename);
            fs.writeFileSync(autoReportPath, result.csvContent, 'utf8');
            console.log(`💾 Automatic report 2 saved: ${autoReportPath}`);
            
            console.log(`📢 Broadcasting scheduled report 2 for ${schedule.labId}`);
            io.emit('scheduled-report-ready', {
              labId: schedule.labId,
              scheduleNumber: 2,
              filename: result.filename,
              csvContent: result.csvContent,
              count: result.count,
              timestamp: new Date().toISOString()
            });
          }
        }, {
          timezone: 'Asia/Kolkata'
        });
        
        scheduledTasks.set(`${schedule.labId}-schedule2`, task2);
        totalSchedules++;
      }
      
      // Legacy support - old single schedule
      if (!schedule.scheduleTime1 && !schedule.scheduleTime2 && schedule.scheduleTime && schedule.enabled) {
        const [hours, minutes] = schedule.scheduleTime.split(':');
        const cronExpression = `${minutes} ${hours} * * *`;
        
        console.log(`⏰ Scheduling legacy report for ${schedule.labId} at ${schedule.scheduleTime}`);
        
        const task = cron.schedule(cronExpression, async () => {
          const result = await generateScheduledReport(schedule.labId);
          
          if (result.success && io) {
            io.emit('scheduled-report-ready', {
              labId: schedule.labId,
              filename: result.filename,
              csvContent: result.csvContent,
              count: result.count,
              timestamp: new Date().toISOString()
            });
          }
        }, {
          timezone: 'Asia/Kolkata'
        });
        
        scheduledTasks.set(schedule.labId, task);
        totalSchedules++;
      }
    }
    
    console.log(`✅ ${totalSchedules} report scheduler(s) initialized for ${schedules.length} lab(s)`);
  } catch (error) {
    console.error('❌ Error setting up schedulers:', error);
  }
}

// Restart all schedulers (called when schedule is updated)
async function restartReportScheduler() {
  console.log('🔄 Restarting report schedulers...');
  
  // Stop all existing tasks
  for (const [labId, task] of scheduledTasks.entries()) {
    task.stop();
    scheduledTasks.delete(labId);
  }
  
  // Setup new tasks
  await setupReportSchedulers();
}

// =================================================================
// TIMETABLE-BASED AUTOMATIC SESSION MANAGEMENT
// =================================================================

// Function to auto-start lab session from timetable
async function autoStartLabSession(timetableEntry) {
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 AUTO-STARTING LAB SESSION FROM TIMETABLE`);
    console.log(`   Subject: ${timetableEntry.subject}`);
    console.log(`   Faculty: ${timetableEntry.faculty}`);
    console.log(`   Lab ID: ${timetableEntry.labId}`);
    console.log(`   Time: ${timetableEntry.startTime} - ${timetableEntry.endTime}`);
    console.log(`${'='.repeat(60)}\n`);
    
    // Check if there's already an active lab session
    const existingSession = await LabSession.findOne({ status: 'active' });
    if (existingSession) {
      console.log(`⚠️ Active lab session already exists: ${existingSession.subject}`);
      console.log(`   Ending existing session before starting new one...`);
      
      // End existing session
      existingSession.status = 'completed';
      existingSession.endTime = new Date();
      await existingSession.save();
      
      // Generate CSV for old session
      const csvResult = await generateLabSessionCSV(existingSession._id);
      if (csvResult.success) {
        const filepath = path.join(MANUAL_REPORT_DIR, csvResult.filename);
        fs.writeFileSync(filepath, csvResult.csvContent, 'utf8');
        console.log(`💾 Previous session CSV saved: ${csvResult.filename}`);
      }
    }
    
    // Create new lab session from timetable
    const newLabSession = new LabSession({
      subject: timetableEntry.subject,
      faculty: timetableEntry.faculty,
      year: timetableEntry.year,
      department: timetableEntry.department,
      section: timetableEntry.section,
      periods: timetableEntry.periods,
      expectedDuration: timetableEntry.duration,
      startTime: new Date(),
      status: 'active',
      createdBy: 'timetable-auto',
      studentRecords: []
    });
    
    await newLabSession.save();
    
    // Update timetable entry
    timetableEntry.isProcessed = true;
    timetableEntry.labSessionId = newLabSession._id;
    await timetableEntry.save();
    
    console.log(`✅ Lab session auto-started: ${newLabSession.subject}`);
    console.log(`   Session ID: ${newLabSession._id}`);
    
    // Notify admins via socket
    if (io) {
      io.to('admins').emit('lab-session-auto-started', {
        sessionId: newLabSession._id,
        subject: newLabSession.subject,
        faculty: newLabSession.faculty,
        startTime: newLabSession.startTime,
        expectedDuration: newLabSession.expectedDuration,
        source: 'timetable'
      });
    }
    
    return { success: true, labSession: newLabSession };
  } catch (error) {
    console.error('❌ Error auto-starting lab session:', error);
    return { success: false, error: error.message };
  }
}

// Function to auto-end lab session from timetable
async function autoEndLabSession(timetableEntry) {
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🛑 AUTO-ENDING LAB SESSION FROM TIMETABLE`);
    console.log(`   Subject: ${timetableEntry.subject}`);
    console.log(`   Faculty: ${timetableEntry.faculty}`);
    console.log(`${'='.repeat(60)}\n`);
    
    // Find the lab session linked to this timetable entry
    let labSession = await LabSession.findById(timetableEntry.labSessionId);
    
    // If not found by ID, try to find active session matching the subject
    if (!labSession) {
      labSession = await LabSession.findOne({ 
        status: 'active',
        subject: timetableEntry.subject
      });
    }
    
    if (!labSession) {
      console.log(`⚠️ No active lab session found for: ${timetableEntry.subject}`);
      return { success: false, error: 'No active session found' };
    }
    
    // End the lab session
    labSession.status = 'completed';
    labSession.endTime = new Date();
    await labSession.save();
    
    // End all active student sessions
    const activeSessions = await Session.find({ status: 'active' });
    const currentTime = new Date();
    
    for (const session of activeSessions) {
      const durationMs = currentTime - session.loginTime;
      const durationSeconds = Math.floor(durationMs / 1000);
      
      await Session.findByIdAndUpdate(session._id, {
        status: 'completed',
        logoutTime: currentTime,
        duration: durationSeconds
      });
      
      // Update session in CSV
      await updateSessionInCSV(session);
    }
    
    console.log(`✅ Ended ${activeSessions.length} student sessions`);
    
    // Generate lab session CSV report
    const csvResult = await generateLabSessionCSV(labSession._id);
    
    if (csvResult.success) {
      const filepath = path.join(MANUAL_REPORT_DIR, csvResult.filename);
      fs.writeFileSync(filepath, csvResult.csvContent, 'utf8');
      console.log(`💾 Lab session CSV saved: ${csvResult.filename}`);
      
      // Notify admins
      if (io) {
        io.to('admins').emit('lab-session-auto-ended', {
          sessionId: labSession._id,
          subject: labSession.subject,
          csvFilename: csvResult.filename,
          studentCount: csvResult.studentCount,
          source: 'timetable'
        });
      }
    }
    
    console.log(`✅ Lab session auto-ended: ${labSession.subject}`);
    
    return { success: true, labSession, csvFilename: csvResult.filename };
  } catch (error) {
    console.error('❌ Error auto-ending lab session:', error);
    return { success: false, error: error.message };
  }
}

// Timetable monitor - runs every minute
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    // Find timetable entries for today
    const startOfDay = new Date(currentDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(currentDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const todayEntries = await TimetableEntry.find({
      isActive: true,
      sessionDate: { $gte: startOfDay, $lte: endOfDay }
    });
    
    for (const entry of todayEntries) {
      // Check if it's time to start the session
      if (entry.startTime === currentTime && !entry.isProcessed) {
        console.log(`📅 Timetable trigger: Starting session for ${entry.subject}`);
        await autoStartLabSession(entry);
      }
      
      // Check if it's time to end the session
      if (entry.endTime === currentTime && entry.isProcessed && entry.labSessionId) {
        console.log(`📅 Timetable trigger: Ending session for ${entry.subject}`);
        await autoEndLabSession(entry);
      }
    }
  } catch (error) {
    console.error('❌ Timetable monitor error:', error);
  }
});

console.log('📅 Timetable-based automatic session scheduler started');
console.log('   - Checks every minute for scheduled sessions');
console.log('   - Auto-starts sessions at scheduled time');
console.log('   - Auto-ends sessions at end time');
console.log('   - Generates CSV reports automatically');

// Get current report schedule
app.get('/api/report-schedule/:labId', async (req, res) => {
  try {
    const { labId } = req.params;
    let schedule = await ReportSchedule.findOne({ labId });
    
    if (!schedule) {
      schedule = new ReportSchedule({ 
        labId, 
        scheduleTime1: '13:00',
        enabled1: true,
        scheduleTime2: '18:00',
        enabled2: true
      });
      await schedule.save();
    }
    
    res.json({ success: true, schedule });
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update report schedule - Updated to support 2 schedules
app.post('/api/report-schedule', async (req, res) => {
  try {
    const { labId, scheduleTime1, enabled1, scheduleTime2, enabled2 } = req.body;
    
    if (!labId) {
      return res.status(400).json({ success: false, error: 'Lab ID is required' });
    }
    
    if (!scheduleTime1 && !scheduleTime2) {
      return res.status(400).json({ success: false, error: 'At least one schedule time is required' });
    }
    
    // Validate time formats (HH:MM)
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (scheduleTime1 && !timeRegex.test(scheduleTime1)) {
      return res.status(400).json({ success: false, error: 'Invalid time format for Schedule 1. Use HH:MM (24-hour)' });
    }
    if (scheduleTime2 && !timeRegex.test(scheduleTime2)) {
      return res.status(400).json({ success: false, error: 'Invalid time format for Schedule 2. Use HH:MM (24-hour)' });
    }
    
    let schedule = await ReportSchedule.findOne({ labId });
    
    if (schedule) {
      if (scheduleTime1) schedule.scheduleTime1 = scheduleTime1;
      if (enabled1 !== undefined) schedule.enabled1 = enabled1;
      if (scheduleTime2) schedule.scheduleTime2 = scheduleTime2;
      if (enabled2 !== undefined) schedule.enabled2 = enabled2;
      schedule.updatedAt = new Date();
    } else {
      schedule = new ReportSchedule({ 
        labId, 
        scheduleTime1: scheduleTime1 || '13:00',
        enabled1: enabled1 !== undefined ? enabled1 : true,
        scheduleTime2: scheduleTime2 || '18:00',
        enabled2: enabled2 !== undefined ? enabled2 : true
      });
    }
    
    await schedule.save();
    
    // Restart cron jobs with new schedules
    await restartReportScheduler();
    
    console.log(`✅ Schedules updated for ${labId}:`);
    if (scheduleTime1) console.log(`  - Schedule 1: ${scheduleTime1} (${enabled1 ? 'enabled' : 'disabled'})`);
    if (scheduleTime2) console.log(`  - Schedule 2: ${scheduleTime2} (${enabled2 ? 'enabled' : 'disabled'})`);
    
    res.json({ success: true, schedule, message: 'Schedules updated successfully' });
  } catch (error) {
    console.error('Error updating schedule:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual trigger for testing - downloads CSV to browser
app.post('/api/generate-report-now', async (req, res) => {
  try {
    const { labId } = req.body;
    
    if (!labId) {
      return res.status(400).json({ success: false, error: 'Lab ID is required' });
    }
    
    const result = await generateScheduledReport(labId);
    
    if (result.success) {
      // Save manual report to MANUAL_REPORT_DIR
      const manualReportPath = path.join(MANUAL_REPORT_DIR, result.filename);
      fs.writeFileSync(manualReportPath, result.csvContent, 'utf8');
      console.log(`💾 Manual report saved: ${manualReportPath}`);
      
      // Send CSV as download to browser
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      
      console.log(`📥 Sending report to browser: ${result.filename} (${result.count} sessions)`);
      res.send(result.csvContent);
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error('Error generating manual report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// SESSION CSV FILE MANAGEMENT API
// =============================================================================

// List all session CSV files
app.get('/api/session-csvs', async (req, res) => {
  try {
    const files = fs.readdirSync(SESSION_CSV_DIR);
    const fileList = files
      .filter(file => file.endsWith('.csv'))
      .map(file => {
        const filepath = path.join(SESSION_CSV_DIR, file);
        const stats = fs.statSync(filepath);
        return {
          filename: file,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.modified - a.modified);
    
    res.json({ success: true, files: fileList });
  } catch (error) {
    console.error('Error listing session CSVs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download a specific session CSV file
app.get('/api/session-csvs/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(SESSION_CSV_DIR, filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    
    const content = fs.readFileSync(filepath, 'utf8');
    res.send(content);
    
    console.log(`📥 Downloaded session CSV: ${filename}`);
  } catch (error) {
    console.error('Error downloading session CSV:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// List all manual report files (including lab session CSVs)
app.get('/api/manual-reports', async (req, res) => {
  try {
    const files = fs.readdirSync(MANUAL_REPORT_DIR);
    const fileList = files
      .filter(file => file.endsWith('.csv'))
      .map(file => {
        const filepath = path.join(MANUAL_REPORT_DIR, file);
        const stats = fs.statSync(filepath);
        
        // Determine file type
        const isLabSession = file.startsWith('LabSession_');
        const isDailyReport = !isLabSession;
        
        return {
          filename: file,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          type: isLabSession ? 'lab-session' : 'daily-report'
        };
      })
      .sort((a, b) => b.modified - a.modified);
    
    res.json({ success: true, files: fileList });
  } catch (error) {
    console.error('Error listing manual reports:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download a specific manual report file
app.get('/api/manual-reports/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(MANUAL_REPORT_DIR, filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    
    const content = fs.readFileSync(filepath, 'utf8');
    res.send(content);
    
    console.log(`📥 Downloaded manual report: ${filename}`);
  } catch (error) {
    console.error('Error downloading manual report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// END SESSION CSV FILE MANAGEMENT API
// =============================================================================

// =============================================================================
// END AUTOMATIC REPORT SCHEDULING SYSTEM
// =============================================================================

// =============================================================================
// STATIC FILE SERVING (MUST BE LAST - AFTER ALL API ROUTES)
// =============================================================================
// Move static file serving to the end to avoid intercepting API routes

// Serve static files from dashboard directory (AFTER all API routes)
app.use(express.static(path.join(__dirname, '../dashboard')));

// Serve student sign-in system (after API routes)
app.use('/student-signin', express.static(path.join(__dirname, '../../student-signin')));

// Serve student management system (after API routes)
app.use('/student-management', express.static(path.join(__dirname, '../../')));

// Serve admin dashboard (fallback route - must be last)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/index.html'));
});

// Guest Access / Bypass Login - Admin initiates guest mode for a kiosk
app.post('/api/bypass-login', async (req, res) => {
  try {
    const { systemId, systemNumber, computerName, labId } = req.body;
    
    // Validate required fields
    if (!systemNumber || !computerName || !labId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: systemNumber, computerName, labId'
      });
    }

    console.log(`🔓 Bypass login initiated for ${computerName} (System ${systemNumber}) in lab ${labId}`);
    
    // Broadcast guest mode enabled event to the specific kiosk via Socket.io
    io.emit('guest-mode-enabled', {
      systemId,
      systemNumber,
      computerName,
      labId,
      timestamp: new Date()
    });

    console.log(`📡 Broadcast guest-mode-enabled to system: ${computerName}`);
    
    return res.json({
      success: true,
      message: `Guest access enabled for ${computerName}`,
      system: { systemId, systemNumber, computerName, labId }
    });
  } catch (error) {
    console.error('❌ Bypass login error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 404 handler for API routes (after all routes)
app.use('/api/*', (req, res) => {
  console.error(`❌ API route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    success: false, 
    error: `API endpoint not found: ${req.method} ${req.originalUrl}` 
  });
});

const PORT = process.env.PORT || 7401;
server.listen(PORT, '0.0.0.0', async () => {
  // Auto-detect and save server IP
  const serverIp = detectLocalIP();
  saveServerConfig(serverIp, PORT);
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔐 College Lab Registration System`);
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📡 Local Access: http://localhost:${PORT}`);
  console.log(`🌐 Network Access: http://${serverIp}:${PORT}`);
  console.log(`📊 CSV/Excel Import: http://${serverIp}:${PORT}/import.html`);
  console.log(`📚 Student Database: Import via CSV/Excel files (ExcelJS - Secure)`);
  console.log(`🔑 Password reset: Available via DOB verification`);
  console.log(`📊 API Endpoints: /api/import-students, /api/download-template, /api/stats`);
  console.log(`🛡️ Security: Using ExcelJS (no prototype pollution vulnerability)`);
  console.log(`💾 Config saved to: server-config.json`);
  console.log(`${'='.repeat(60)}\n`);
  
  // Initialize automatic report schedulers
  console.log('⏰ Initializing automatic report schedulers...');
  await setupReportSchedulers();
});
