require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://srijaaanandhan12_db_user:122007@cluster0.2kzkkpe.mongodb.net/college-lab-registration?retryWrites=true&w=majority';
const BCRYPT_SALT_ROUNDS = 10;

// Student Schema
const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  studentId: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true },
  passwordHash: { type: String },
  dateOfBirth: { type: Date, required: true },
  department: { type: String, required: true },
  year: { type: Number, required: true },
  labId: { type: String, required: true },
  isPasswordSet: { type: Boolean, default: false },
  registeredAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Student = mongoose.model('Student', studentSchema);

async function restoreSampleStudents() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB');

    console.log('🗑️ Clearing existing sample students...');
    await Student.deleteMany({
      studentId: { $in: ['CS2021001', 'CS2021002', 'IT2021003', 'CS2021004', 'IT2021005'] }
    });

    console.log('📊 Creating sample student data...');
    
    // Sample student data with passwords
    const sampleStudents = [
      {
        name: 'Rajesh Kumar',
        studentId: 'CS2021001',
        email: 'rajesh.kumar@college.edu',
        passwordHash: await bcrypt.hash('password123', BCRYPT_SALT_ROUNDS),
        dateOfBirth: new Date('2000-05-15'),
        department: 'Computer Science',
        year: 3,
        labId: 'CC1',
        isPasswordSet: true
      },
      {
        name: 'Priya Sharma',
        studentId: 'CS2021002',
        email: 'priya.sharma@college.edu',
        passwordHash: await bcrypt.hash('password123', BCRYPT_SALT_ROUNDS),
        dateOfBirth: new Date('2001-08-22'),
        department: 'Computer Science',
        year: 3,
        labId: 'CC1',
        isPasswordSet: true
      },
      {
        name: 'Arjun Patel',
        studentId: 'IT2021003',
        email: 'arjun.patel@college.edu',
        passwordHash: await bcrypt.hash('password123', BCRYPT_SALT_ROUNDS),
        dateOfBirth: new Date('2000-12-10'),
        department: 'Information Technology',
        year: 3,
        labId: 'CC1',
        isPasswordSet: true
      },
      {
        name: 'Sneha Reddy',
        studentId: 'CS2021004',
        email: 'sneha.reddy@college.edu',
        passwordHash: await bcrypt.hash('password123', BCRYPT_SALT_ROUNDS),
        dateOfBirth: new Date('2001-03-18'),
        department: 'Computer Science',
        year: 3,
        labId: 'CC1',
        isPasswordSet: true
      },
      {
        name: 'Vikram Singh',
        studentId: 'IT2021005',
        email: 'vikram.singh@college.edu',
        passwordHash: await bcrypt.hash('password123', BCRYPT_SALT_ROUNDS),
        dateOfBirth: new Date('2000-09-25'),
        department: 'Information Technology',
        year: 3,
        labId: 'CC1',
        isPasswordSet: true
      }
    ];

    // Insert sample students
    const insertedStudents = await Student.insertMany(sampleStudents);
    
    console.log(`✅ Sample students restored successfully!`);
    console.log(`📊 ${insertedStudents.length} students added:`);
    
    insertedStudents.forEach(student => {
      console.log(`   • ${student.name} (${student.studentId}) - ${student.department}`);
    });

    console.log('\n🔑 Login Credentials:');
    console.log('   Student ID: CS2021001, CS2021002, IT2021003, CS2021004, IT2021005');
    console.log('   Password: password123 (for all students)');
    console.log('   Lab ID: CC1');
    console.log('   System Numbers: CC1-01, CC1-02, CC1-03, etc.');

    console.log('\n✅ Sample data restoration complete!');
    
  } catch (error) {
    console.error('❌ Error restoring sample students:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the restoration
restoreSampleStudents();
