# Verification Steps for First-Run Setup & Student Portal

## 1. Fresh Installation Test
1. Backup/move existing database: `mv data/record_management.db data/record_management.db.backup`
2. Optional: Also move `data/db.json` to prevent automatic migration seeding old data
3. Start server: `npm start`
4. Visit `http://localhost:3000` - should redirect to `/setup.html` (not login)
5. Complete department registration form:
   - Department Name: "Test Department"
   - Department Code: "TEST"
   - Institution: "Test University"
   - Admin Full Name: "Test Admin"
   - Username: "testadmin"
   - Password: "test123"
6. Click Continue - should proceed to onboarding step
7. Onboarding step should show success message with created collection info
8. Click "Go to Dashboard" - should redirect to `/dashboard.html` showing login form
9. Login with credentials from step 5
10. Verify dashboard shows no collections yet (onboarding creates collection in background)

## 2. Collection Verification
1. After login, dashboard should show one collection: "dept-students-field"
2. Click Manage on that collection
3. Verify schema includes: Student ID, Full Name, Level, CGPA, Student PIN
4. Add a test student record:
   - Student ID: "STU001"
   - Full Name: "John Doe"
   - Level: "ND 1"
   - PIN: "1234" (or leave empty initially)
5. Save record

## 3. Details & Courses/CGPA Test
1. On the records table for the student, click "Details" button
2. Details modal should show:
   - Student Overview: ID, Name, Level, CGPA (should be 0.00 initially)
   - Courses section: "No courses recorded yet."
   - "+ Add Course" button
3. Click "+ Add Course" and add:
   - Session: "2024/2025"
   - Level: "ND 1"
   - Semester: "1"
   - Course Code: "CSC 101"
   - Course Title: "Introduction to Computing"
   - Credit Units: "3"
   - Score: "85"
4. Save course
5. Details modal should update to show:
   - CGPA: 4.00 (since 85 = grade point 4.0, 3 units → 12.0/3 = 4.0)
   - Courses table showing the added course with correct calculations
6. Add another course:
   - Session: "2024/2025"
   - Level: "ND 1"
   - Semester: "2"
   - Course Code: "MTH 101"
   - Course Title: "Algebra"
   - Credit Units: "4"
   - Score: "65"
7. Save course
8. CGPA should now be: ((4.0×3) + (3.0×4)) / (3+4) = (12+12)/7 = 24/7 ≈ 3.43

## 4. Student Portal Test
1. Open new browser/tab to `http://localhost:3000/student/`
2. Enter Student ID: "STU001" and PIN: "1234" (set during record creation or edit)
3. Should redirect to `/student/portal.html`
4. Portal should show:
   - Welcome message with student name
   - Department: "Test Department"
   - Student Record: all fields except PIN
   - Your Courses: both courses grouped by session/level with correct CGPA
   - Name Correction form
5. Test name correction:
   - Change "Requested Name" to "Johnny Doe"
   - Add note: "Preferred name"
   - Submit Correction
   - Should show success message
6. Logout from student portal

## 5. Corrections Review Test
1. As admin, navigate to `/corrections.html`
2. Should see pending correction from student
3. Click "Approve" on the correction
4. Should show confirmation
5. Return to student records list - student name should now be "Johnny Doe"
6. Return to student portal (login again) - should see updated name

## 6. Idempotency Test
1. Stop server (`Ctrl+C`)
2. Start server again: `npm start`
3. Visit `http://localhost:3000` - should go directly to login page (not setup)
4. Login with admin credentials
5. Dashboard should still show the same collection and data
6. Attempt to visit `/setup.html` directly - should still work but onboarding step should detect existing collection and not duplicate

## API Endpoint Verification (using curl or similar)
```
# Setup status
curl http://localhost:3000/api/setup/setup

# Register dept
curl -X POST http://localhost:3000/api/setup/register \
  -H "Content-Type: application/json" \
  -d '{"deptName":"Test","username":"test","password":"test123"}'

# Onboard
curl -X POST http://localhost:3000/api/setup/onboard \
  -H "Authorization: Bearer <token-from-register>"

# Student login
curl -X POST http://localhost:3000/api/student/login \
  -H "Content-Type: application/json" \
  -d '{"studentId":"STU001","pin":"1234"}'

# Get corrections
curl -H "Authorization: Bearer <admin-token>" http://localhost:3000/api/corrections
```