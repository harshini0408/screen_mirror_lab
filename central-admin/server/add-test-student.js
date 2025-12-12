// Quick script to add TEST2025001 student directly to database
const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/college_lab_system', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

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
  isPasswordSet: { type: Boolean, default: false }
});

const Student = mongoose.model('Student', studentSchema);

async function addTestStudent() {
  try {
    console.log('🔄 Connecting to database...');
    
    // Delete existing TEST2025001 if it exists (to ensure clean state)
    await Student.deleteMany({ 
      $or: [
        { studentId: 'TEST2025001' },
        { email: '24z258@psgitech.ac.in' }
      ]
    });
    
    // Add the test student
    const testStudent = new Student({
      name: 'Test User',
      studentId: 'TEST2025001',
      email: '24z258@psgitech.ac.in',
      dateOfBirth: new Date('2000-01-01'),
      department: 'Computer Science',
      year: 3,
      labId: 'CC1',
      isPasswordSet: false
    });
    
    await testStudent.save();
    console.log('✅ TEST2025001 student added successfully!');
    console.log('Student details:', {
      name: testStudent.name,
      studentId: testStudent.studentId,
      email: testStudent.email,
      dateOfBirth: testStudent.dateOfBirth.toDateString(),
      department: testStudent.department,
      isPasswordSet: testStudent.isPasswordSet
    });
    
    // Also add other sample students
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
        name: 'Vikram Singh',
        studentId: 'IT2021005',
        email: 'vikram.singh@college.edu',
        dateOfBirth: new Date('2000-09-25'),
        department: 'Information Technology',
        year: 3,
        labId: 'CC1',
        isPasswordSet: false
      }
    ];
    
    for (const student of sampleStudents) {
      // Delete existing first
      await Student.deleteMany({ studentId: student.studentId });
      // Add fresh
      await Student.create(student);
      console.log(`✅ Added sample student: ${student.studentId} - ${student.name}`);
    }
    
    // Verify the student was added
    const verification = await Student.findOne({ studentId: 'TEST2025001' });
    if (verification) {
      console.log('\n🎉 VERIFICATION SUCCESSFUL!');
      console.log('TEST2025001 is now in the database and ready for first-time sign-in!');
      console.log('\nUse these details:');
      console.log('- Student ID: TEST2025001');
      console.log('- Email: 24z258@psgitech.ac.in');
      console.log('- Date of Birth: 2000-01-01');
    } else {
      console.log('❌ Verification failed - student not found after adding');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 11000) {
      console.log('Note: Duplicate key error - student might already exist with different details');
    }
  } finally {
    mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

addTestStudent();
