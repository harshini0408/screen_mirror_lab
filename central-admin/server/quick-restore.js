const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGODB_URI = 'mongodb+srv://srijaaanandhan12_db_user:122007@cluster0.2kzkkpe.mongodb.net/college-lab-registration?retryWrites=true&w=majority';

const studentSchema = new mongoose.Schema({
  name: String,
  studentId: { type: String, unique: true },
  email: { type: String, unique: true },
  passwordHash: String,
  dateOfBirth: Date,
  department: String,
  year: Number,
  labId: String,
  isPasswordSet: { type: Boolean, default: true }
});

const Student = mongoose.model('Student', studentSchema);

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected');
  
  const password = await bcrypt.hash('password123', 10);
  
  await Student.deleteMany({ studentId: { $in: ['CS2021001', '715524104158'] } });
  
  await Student.insertMany([
    {
      name: 'Test Student',
      studentId: 'CS2021001',
      email: 'test@college.edu',
      passwordHash: password,
      dateOfBirth: new Date('2000-01-01'),
      department: 'CS',
      year: 3,
      labId: 'CC1',
      isPasswordSet: true
    },
    {
      name: 'Srijaa',
      studentId: '715524104158',
      email: 'srijaa@college.edu',
      passwordHash: password,
      dateOfBirth: new Date('2000-05-15'),
      department: 'CS',
      year: 3,
      labId: 'CC1',
      isPasswordSet: true
    }
  ]);
  
  console.log('✅ 2 students restored: CS2021001 and 715524104158');
  console.log('🔑 Password for both: password123');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
