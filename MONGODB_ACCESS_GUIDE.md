# MongoDB Access & Database Guide

## 📊 Database Information

### MongoDB Connection
This project uses **MongoDB Atlas** (cloud database). The connection string is configured in:
- **File**: `final_sdc/central-admin/server/app.js`
- **Line**: 73

### Connection String
```javascript
MONGODB_URI = 'mongodb+srv://srijaaanandhan12_db_user:122007@cluster0.2kzkkpe.mongodb.net/college-lab-registration?retryWrites=true&w=majority'
```

### Database Name
- **Database**: `college-lab-registration`

### Collections
The database contains the following collections:

1. **students** - Stores all student information
   - Schema fields: `studentId`, `name`, `email`, `passwordHash`, `dateOfBirth`, `department`, `section`, `year`, `labId`, `isPasswordSet`, `registeredAt`, `updatedAt`

2. **sessions** - Stores student login/logout sessions
   - Schema fields: `studentName`, `studentId`, `computerName`, `labId`, `systemNumber`, `loginTime`, `logoutTime`, `duration`, `status`, `screenshot`

3. **labsessions** - Stores lab session metadata
   - Schema fields: `labId`, `subject`, `faculty`, `year`, `department`, `section`, `periods`, `expectedDuration`, `startTime`, `endTime`, `status`, `studentRecords`

4. **timetables** - Stores timetable entries
   - Schema fields: `sessionDate`, `startTime`, `endTime`, `faculty`, `subject`, `labId`, `year`, `department`, `section`, etc.

---

## 🔧 Issue Fixed: Missing Section Field

### Problem
The `student-management-system.html` file was collecting and displaying a `section` field for students, but:
- The database schema didn't have a `section` field
- API endpoints weren't saving or returning `section` data
- Students couldn't be properly updated with section information

### Solution
✅ **Added `section` field to Student Schema**
- Added `section: { type: String, default: 'A' }` to the Student model

✅ **Updated API Endpoints**
- `/api/debug-students` - Now returns `section` field
- `/api/add-student` - Now accepts and saves `section` field
- `/api/update-student` - Now accepts and updates `section` field
- `/api/import-students` - Now extracts and saves `section` from CSV/Excel files

✅ **Updated HTML Form**
- Add student form now sends `section` field to the API

---

## 🌐 How to Access the Database

### Option 1: Through MongoDB Atlas Web Interface
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Login with credentials
3. Select your cluster: `cluster0`
4. Click "Browse Collections" to view data
5. Use the Data Explorer to query and edit documents

### Option 2: Through MongoDB Compass (Desktop App)
1. Download [MongoDB Compass](https://www.mongodb.com/products/compass)
2. Connect using the connection string:
   ```
   mongodb+srv://srijaaanandhan12_db_user:122007@cluster0.2kzkkpe.mongodb.net/college-lab-registration?retryWrites=true&w=majority
   ```
3. Browse and edit collections directly

### Option 3: Through Node.js Scripts
You can use the existing scripts in the project:
- `final_sdc/central-admin/server/quick-restore.js` - Example of connecting to MongoDB
- `final_sdc/central-admin/server/add-test-student.js` - Example of adding data

### Option 4: Through API Endpoints
The server provides REST API endpoints to interact with the database:

#### View All Students
```
GET http://localhost:7401/api/debug-students
```

#### Add Student
```
POST http://localhost:7401/api/add-student
Content-Type: application/json

{
  "studentId": "CS2025001",
  "name": "John Doe",
  "email": "john@college.edu",
  "dateOfBirth": "2000-01-15",
  "department": "Computer Science and Engineering",
  "section": "A",
  "year": 3
}
```

#### Update Student
```
PUT http://localhost:7401/api/update-student/CS2025001
Content-Type: application/json

{
  "name": "John Updated",
  "section": "B",
  "department": "Information Technology"
}
```

#### Delete Student
```
DELETE http://localhost:7401/api/delete-student/CS2025001
```

---

## 📝 Student Management System HTML File

### Location
- **File**: `final_sdc/student-management-system.html`

### Features
- **Bulk Import**: Upload CSV/Excel files to import multiple students
- **Add Individual**: Add single students through a form
- **Manage Students**: View, edit, and delete students
- **Export Data**: Export student data to CSV/Excel
- **Timetable Management**: Upload and manage lab timetables

### Server Connection
The HTML file connects to the backend server at:
- Default: `http://localhost:7401`
- Auto-detects server IP from `server-config.json`

---

## 🔄 How Student Updates Work

1. **Frontend** (`student-management-system.html`):
   - User fills form or clicks edit
   - JavaScript sends API request to server

2. **Backend** (`central-admin/server/app.js`):
   - API endpoint receives request
   - Validates data
   - Updates MongoDB using Mongoose

3. **Database** (MongoDB Atlas):
   - Changes are saved to the `students` collection
   - Data persists in cloud database

4. **Refresh**:
   - Frontend calls `/api/debug-students` to get updated data
   - Table displays latest student information

---

## 🚀 Server Setup

### Start the Server
```bash
cd final_sdc/central-admin/server
npm install
node app.js
```

Or use the batch file:
```bash
DEPLOY-SERVER.bat
```

### Environment Variables (Optional)
Create a `.env` file in `final_sdc/central-admin/server/`:
```env
MONGODB_URI=mongodb+srv://srijaaanandhan12_db_user:122007@cluster0.2kzkkpe.mongodb.net/college-lab-registration?retryWrites=true&w=majority
PORT=7401
BCRYPT_SALT_ROUNDS=10
```

---

## ✅ Verification Checklist

After the fixes, verify that:
- [x] Section field is saved when adding new students
- [x] Section field is updated when editing students
- [x] Section field appears in the student list table
- [x] Section field is included in CSV exports
- [x] Section field is imported from CSV/Excel files

---

## 📞 Troubleshooting

### Students not updating?
1. Check if server is running: `http://localhost:7401/api/debug-students`
2. Check browser console for errors
3. Verify MongoDB connection in server logs
4. Check network tab to see if API requests are successful

### Database connection issues?
1. Check MongoDB Atlas network access (IP whitelist)
2. Verify connection string is correct
3. Check if MongoDB Atlas cluster is running
4. Verify credentials are correct

### Section field not showing?
1. Clear browser cache and refresh
2. Verify server was restarted after code changes
3. Check database directly to confirm section field exists
4. Try adding a new student to test

---

## 📚 Related Files

- **Server**: `final_sdc/central-admin/server/app.js`
- **Student Management UI**: `final_sdc/student-management-system.html`
- **MongoDB Schema**: Defined in `app.js` (lines 94-106)
- **API Endpoints**: Defined in `app.js` (starting from line 1080)

