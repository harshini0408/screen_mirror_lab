const nodemailer = require('nodemailer');

console.log('🧪 Testing Email Configuration...\n');
console.log('📧 Email: screen.mirrorsdc@gmail.com');
console.log('🔑 Password: jeetkuyfdaaenoav (first 4 chars: jeet)\n');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'screen.mirrorsdc@gmail.com',
    pass: 'jeetkuyfdaaenoav'
  }
});

console.log('⏳ Attempting to connect to Gmail SMTP...\n');

transporter.verify(function(error, success) {
  if (error) {
    console.log('❌ CONNECTION FAILED!\n');
    console.log('Error Details:');
    console.log(error);
    console.log('\n📋 TROUBLESHOOTING STEPS:');
    console.log('1. Go to: https://myaccount.google.com/security');
    console.log('2. Sign in to screen.mirrorsdc@gmail.com');
    console.log('3. Check for "Recent security activity"');
    console.log('4. Look for blocked sign-in attempts');
    console.log('5. Click "That was me" if you see any');
    console.log('\nOR');
    console.log('6. Try generating a NEW App Password');
    console.log('7. Delete the old one and create a fresh one');
  } else {
    console.log('✅ SUCCESS! Email server is ready!');
    console.log('✅ Gmail accepted the credentials');
    console.log('✅ Server can send emails now\n');
    console.log('Your configuration is working correctly!');
  }
  
  process.exit(0);
});
