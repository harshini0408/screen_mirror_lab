// ============================================
// PAGE NAVIGATION FUNCTIONS
// ============================================

// Debug logging helper
function addDebugLog(message) {
    const debugLog = document.getElementById('debugLog');
    if (debugLog) {
        const timestamp = new Date().toLocaleTimeString();
        debugLog.innerHTML += `<div>[${timestamp}] ${message}</div>`;
        debugLog.scrollTop = debugLog.scrollHeight;
    }
    console.log(`[DEBUG] ${message}`);
}

// Show login page (hide all others)
function showLoginPage() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('firstTimeSignInPage').style.display = 'none';
    document.getElementById('forgotPasswordPage').style.display = 'none';
    
    // Reset forms
    const firstTimeForm = document.getElementById('firstTimeForm');
    if (firstTimeForm) firstTimeForm.reset();
    
    // Reset forgot password to step 1
    resetForgotPasswordSteps();
    
    addDebugLog('🏠 Returned to login page');
    
    // RE-ENABLE all inputs on login page to fix typing issue
    setTimeout(() => {
        const loginScreen = document.getElementById('loginScreen');
        if (loginScreen) {
            const inputs = loginScreen.querySelectorAll('input, textarea, select');
            inputs.forEach(input => {
                input.removeAttribute('readonly');
                input.removeAttribute('disabled');
            });
        }
        
        // Focus on student ID field
        const studentIdInput = document.getElementById('studentId');
        if (studentIdInput) {
            studentIdInput.focus();
            console.log('✅ Login page inputs re-enabled and focused');
        }
    }, 100);
}

// Show first-time sign-in page
function showFirstTimeSignIn() {
    console.log('🔧 showFirstTimeSignIn() called');
    try {
        const loginScreen = document.getElementById('loginScreen');
        const firstTimePage = document.getElementById('firstTimeSignInPage');
        const forgotPage = document.getElementById('forgotPasswordPage');
        
        if (!loginScreen || !firstTimePage || !forgotPage) {
            console.error('❌ Missing page elements:', { loginScreen: !!loginScreen, firstTimePage: !!firstTimePage, forgotPage: !!forgotPage });
            alert('Error: Page elements not found. Check console for details.');
            return;
        }
        
        loginScreen.style.display = 'none';
        firstTimePage.style.display = 'flex';
        forgotPage.style.display = 'none';
        
        console.log('✅ First-time sign-in page shown');
        addDebugLog('👋 First-time sign-in page opened');
        addFirstTimeDebugLog('First-time sign-in page opened');
    } catch (error) {
        console.error('❌ Error in showFirstTimeSignIn():', error);
        alert('Error opening first-time sign-in page: ' + error.message);
    }
    
    // Re-enable inputs and focus
    setTimeout(() => {
        const firstTimePage = document.getElementById('firstTimeSignInPage');
        if (firstTimePage) {
            const inputs = firstTimePage.querySelectorAll('input, textarea, select');
            inputs.forEach(input => {
                input.removeAttribute('readonly');
                input.removeAttribute('disabled');
            });
        }
        
        const input = document.getElementById('firstTimeStudentId');
        if (input) {
            input.focus();
            console.log('✅ First-time sign-in page focused on Student ID field');
        }
    }, 100);
}

// Show forgot password page
function showForgotPassword() {
    console.log('🔧 showForgotPassword() called');
    try {
        const loginScreen = document.getElementById('loginScreen');
        const firstTimePage = document.getElementById('firstTimeSignInPage');
        const forgotPage = document.getElementById('forgotPasswordPage');
        
        if (!loginScreen || !firstTimePage || !forgotPage) {
            console.error('❌ Missing page elements:', { loginScreen: !!loginScreen, firstTimePage: !!firstTimePage, forgotPage: !!forgotPage });
            alert('Error: Page elements not found. Check console for details.');
            return;
        }
        
        loginScreen.style.display = 'none';
        firstTimePage.style.display = 'none';
        forgotPage.style.display = 'flex';
        
        // Reset to step 1
        resetForgotPasswordSteps();
        
        console.log('✅ Forgot password page shown');
        addDebugLog('🔑 Forgot password page opened');
        addForgotDebugLog('Password reset page opened - Step 1');
    } catch (error) {
        console.error('❌ Error in showForgotPassword():', error);
        alert('Error opening forgot password page: ' + error.message);
    }
    
    // Re-enable inputs and focus
    setTimeout(() => {
        const forgotPage = document.getElementById('forgotPasswordPage');
        if (forgotPage) {
            const inputs = forgotPage.querySelectorAll('input, textarea, select');
            inputs.forEach(input => {
                input.removeAttribute('readonly');
                input.removeAttribute('disabled');
            });
        }
        
        const input = document.getElementById('forgotStudentId');
        if (input) input.focus();
    }, 100);
}

// ============================================
// FIRST-TIME SIGN-IN FUNCTIONS
// ============================================

function addFirstTimeDebugLog(message) {
    const debugLog = document.getElementById('firstTimeDebugLog');
    if (debugLog) {
        const timestamp = new Date().toLocaleTimeString();
        debugLog.innerHTML += `<br>[${timestamp}] ${message}`;
        debugLog.scrollTop = debugLog.scrollHeight;
    }
    console.log(`[FIRST-TIME] ${message}`);
}

function showFirstTimeError(message) {
    const errorAlert = document.getElementById('firstTimeErrorAlert');
    const errorMessage = document.getElementById('firstTimeErrorMessage');
    if (errorAlert && errorMessage) {
        errorMessage.textContent = message;
        errorAlert.classList.remove('d-none');
    }
}

function hideFirstTimeError() {
    const errorAlert = document.getElementById('firstTimeErrorAlert');
    if (errorAlert) {
        errorAlert.classList.add('d-none');
    }
}

// Handle first-time sign-in form submission
document.addEventListener('DOMContentLoaded', function() {
    const firstTimeForm = document.getElementById('firstTimeForm');
    if (firstTimeForm) {
        firstTimeForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            hideFirstTimeError();
            
            const studentId = document.getElementById('firstTimeStudentId').value.trim().toUpperCase();
            const email = document.getElementById('firstTimeEmail').value.trim().toLowerCase();
            const dateOfBirth = document.getElementById('firstTimeDateOfBirth').value;
            const newPassword = document.getElementById('firstTimeNewPassword').value;
            const confirmPassword = document.getElementById('firstTimeConfirmPassword').value;
            
            addFirstTimeDebugLog(`🔍 Starting first-time sign-in for: ${studentId}`);
            
            // Validation
            if (!studentId || !email || !dateOfBirth || !newPassword || !confirmPassword) {
                showFirstTimeError('Please fill in all fields');
                addFirstTimeDebugLog('❌ Validation failed: Missing fields');
                return;
            }
            
            if (newPassword !== confirmPassword) {
                showFirstTimeError('Passwords do not match!\n\nPlease ensure both password fields are identical.');
                addFirstTimeDebugLog('❌ Password confirmation failed');
                return;
            }
            
            if (newPassword.length < 6) {
                showFirstTimeError('Password too short!\n\nPassword must be at least 6 characters long.');
                addFirstTimeDebugLog('❌ Password too short');
                return;
            }
            
            // Email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                showFirstTimeError('Invalid email format!\n\nPlease enter a valid email address.');
                addFirstTimeDebugLog('❌ Invalid email format');
                return;
            }
            
            addFirstTimeDebugLog(`📡 Submitting first-time sign-in for: ${studentId}`);
            
            try {
                const apiUrl = serverUrl ? `${serverUrl}/api/first-time-signin` : '/api/first-time-signin';
                addFirstTimeDebugLog(`Calling API: ${apiUrl}`);
                
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ studentId, email, dateOfBirth, newPassword })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    addFirstTimeDebugLog(`✅ Password setup successful!`);
                    
                    alert(`✅ Account Setup Successful!

Welcome ${data.student.name}!

Your account has been set up successfully.
You can now login with:
- Student ID: ${data.student.studentId}
- Password: [The password you just created]

🔄 Auto-Login Ready:
- Student ID: ✅ (Auto-filled)
- New Password: ✅ (Auto-filled)

Click OK to return to login page with both fields pre-filled!`);
                    
                    // Go to login page first
                    showLoginPage();
                    
                    // Auto-fill BOTH student ID and password AFTER inputs are re-enabled
                    setTimeout(() => {
                        // Pre-fill student ID - use server response data for accuracy
                        const studentIdField = document.getElementById('studentId');
                        const studentIdToFill = data.student.studentId || studentId;
                        if (studentIdField && studentIdToFill) {
                            studentIdField.value = studentIdToFill;
                            // Force trigger input event to ensure field is properly filled
                            studentIdField.dispatchEvent(new Event('input', { bubbles: true }));
                            console.log(`📝 Auto-filled Student ID: ${studentIdToFill}`);
                        } else {
                            console.error('❌ Failed to auto-fill Student ID - field or data missing');
                            console.error('Field exists:', !!studentIdField);
                            console.error('Student ID data:', studentIdToFill);
                        }
                        
                        // Auto-fill the new password
                        const passwordField = document.getElementById('password');
                        if (passwordField && newPassword) {
                            passwordField.value = newPassword;
                            passwordField.focus();
                            console.log(`🔑 Auto-filled password for: ${studentIdToFill}`);
                        }
                        
                        // Show success message
                        addDebugLog(`🔑 Auto-filled login: ${studentIdToFill} with new password`);
                    }, 300);
                    
                } else {
                    addFirstTimeDebugLog(`❌ First-time sign-in failed: ${data.error}`);
                    
                    showFirstTimeError(`Account Setup Failed:

${data.error}

Please check:
- Student ID is correct and exists in system
- Email matches your registered email
- Date of birth is correct
- Contact admin if you need help`);
                }
                
            } catch (error) {
                addFirstTimeDebugLog(`❌ Network error: ${error.message}`);
                showFirstTimeError(`Network error occurred:

${error.message}

Please ensure the server is running and try again.`);
            }
        });
    }
});

// ============================================
// FORGOT PASSWORD FUNCTIONS
// ============================================

let forgotPasswordData = {
    studentId: '',
    studentName: '',
    maskedEmail: '',
    email: ''
};

function addForgotDebugLog(message) {
    const debugLog = document.getElementById('forgotDebugLog');
    if (debugLog) {
        const timestamp = new Date().toLocaleTimeString();
        debugLog.innerHTML += `<br>[${timestamp}] ${message}`;
        debugLog.scrollTop = debugLog.scrollHeight;
    }
    console.log(`[FORGOT-PASSWORD] ${message}`);
}

function showForgotError(stepNum, message) {
    const errorAlert = document.getElementById(`forgotErrorAlert${stepNum}`);
    const errorMessage = document.getElementById(`forgotErrorMessage${stepNum}`);
    if (errorAlert && errorMessage) {
        errorMessage.textContent = message;
        errorAlert.classList.remove('d-none');
    }
}

function hideForgotError(stepNum) {
    const errorAlert = document.getElementById(`forgotErrorAlert${stepNum}`);
    if (errorAlert) {
        errorAlert.classList.add('d-none');
    }
}

function resetForgotPasswordSteps() {
    // Show step 1, hide others
    document.getElementById('forgotStep1').style.display = 'block';
    document.getElementById('forgotStep2').style.display = 'none';
    document.getElementById('forgotStep3').style.display = 'none';
    
    // Clear all error messages
    hideForgotError(1);
    hideForgotError(2);
    hideForgotError(3);
    
    // Clear all inputs
    document.getElementById('forgotStudentId').value = '';
    document.getElementById('forgotEmail').value = '';
    document.getElementById('forgotOTP').value = '';
    document.getElementById('forgotNewPassword').value = '';
    
    // Reset data
    forgotPasswordData = {
        studentId: '',
        studentName: '',
        maskedEmail: '',
        email: ''
    };
}

function forgotBackToStep1() {
    document.getElementById('forgotStep2').style.display = 'none';
    document.getElementById('forgotStep1').style.display = 'block';
    hideForgotError(2);
    addForgotDebugLog('⬅️ Back to Step 1');
    
    setTimeout(() => {
        // Re-enable inputs
        const forgotPage = document.getElementById('forgotPasswordPage');
        if (forgotPage) {
            const inputs = forgotPage.querySelectorAll('input, textarea, select');
            inputs.forEach(input => {
                input.removeAttribute('readonly');
                input.removeAttribute('disabled');
            });
        }
        
        const input = document.getElementById('forgotStudentId');
        if (input) input.focus();
    }, 100);
}

// Step 1: Verify Student ID
async function forgotPasswordStep1() {
    hideForgotError(1);
    
    const studentId = document.getElementById('forgotStudentId').value.trim().toUpperCase();
    
    if (!studentId) {
        showForgotError(1, 'Please enter your Student ID');
        return;
    }
    
    addForgotDebugLog(`🔍 Verifying student ID: ${studentId}`);
    
    try {
        const apiUrl = serverUrl ? `${serverUrl}/api/forgot-password-initiate` : '/api/forgot-password-initiate';
        addForgotDebugLog(`📡 Calling API: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            addForgotDebugLog(`✅ Student verified: ${data.studentName}`);
            
            // Store data
            forgotPasswordData.studentId = studentId;
            forgotPasswordData.studentName = data.studentName;
            forgotPasswordData.maskedEmail = data.maskedEmail;
            
            // Update Step 2 display
            document.getElementById('forgotStudentName').textContent = data.studentName;
            document.getElementById('forgotMaskedEmail').textContent = data.maskedEmail;
            
            // Move to Step 2
            document.getElementById('forgotStep1').style.display = 'none';
            document.getElementById('forgotStep2').style.display = 'block';
            addForgotDebugLog('➡️ Moved to Step 2 - Email Verification');
            
            setTimeout(() => {
                // Re-enable inputs
                const forgotPage = document.getElementById('forgotPasswordPage');
                if (forgotPage) {
                    const inputs = forgotPage.querySelectorAll('input, textarea, select');
                    inputs.forEach(input => {
                        input.removeAttribute('readonly');
                        input.removeAttribute('disabled');
                    });
                }
                
                const input = document.getElementById('forgotEmail');
                if (input) input.focus();
            }, 100);
            
        } else {
            showForgotError(1, data.error || 'Student not found');
            addForgotDebugLog(`❌ Verification failed: ${data.error}`);
        }
        
    } catch (error) {
        showForgotError(1, 'Network error: ' + error.message);
        addForgotDebugLog(`❌ Network error: ${error.message}`);
    }
}

// Step 2: Send OTP to Email
async function forgotPasswordStep2() {
    hideForgotError(2);
    
    const email = document.getElementById('forgotEmail').value.trim();
    
    if (!email) {
        showForgotError(2, 'Please enter your email address');
        return;
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showForgotError(2, 'Invalid email format');
        return;
    }
    
    addForgotDebugLog(`📧 Sending OTP to: ${email}`);
    
    try {
        const apiUrl = serverUrl ? `${serverUrl}/api/forgot-password-send-otp` : '/api/forgot-password-send-otp';
        addForgotDebugLog(`📡 Calling API: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                studentId: forgotPasswordData.studentId, 
                email 
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            addForgotDebugLog(`✅ OTP sent successfully`);
            
            // Store email
            forgotPasswordData.email = email;
            
            // Move to Step 3
            document.getElementById('forgotStep2').style.display = 'none';
            document.getElementById('forgotStep3').style.display = 'block';
            addForgotDebugLog('➡️ Moved to Step 3 - OTP & Password');
            
            setTimeout(() => {
                // Re-enable inputs
                const forgotPage = document.getElementById('forgotPasswordPage');
                if (forgotPage) {
                    const inputs = forgotPage.querySelectorAll('input, textarea, select');
                    inputs.forEach(input => {
                        input.removeAttribute('readonly');
                        input.removeAttribute('disabled');
                    });
                }
                
                const input = document.getElementById('forgotOTP');
                if (input) input.focus();
            }, 100);
            
        } else {
            showForgotError(2, data.error || 'Failed to send OTP');
            addForgotDebugLog(`❌ OTP send failed: ${data.error}`);
        }
        
    } catch (error) {
        showForgotError(2, 'Network error: ' + error.message);
        addForgotDebugLog(`❌ Network error: ${error.message}`);
    }
}

// Step 3: Verify OTP and Reset Password
async function forgotPasswordStep3() {
    hideForgotError(3);
    
    const otp = document.getElementById('forgotOTP').value.trim();
    const newPassword = document.getElementById('forgotNewPassword').value;
    
    if (!otp) {
        showForgotError(3, 'Please enter the OTP');
        return;
    }
    
    if (!/^\d{6}$/.test(otp)) {
        showForgotError(3, 'OTP must be exactly 6 digits');
        return;
    }
    
    if (!newPassword) {
        showForgotError(3, 'Please enter a new password');
        return;
    }
    
    if (newPassword.length < 6) {
        showForgotError(3, 'Password must be at least 6 characters');
        return;
    }
    
    addForgotDebugLog(`🔄 Verifying OTP and resetting password...`);
    
    try {
        const apiUrl = serverUrl ? `${serverUrl}/api/forgot-password-verify-otp` : '/api/forgot-password-verify-otp';
        addForgotDebugLog(`📡 Calling API: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                studentId: forgotPasswordData.studentId,
                email: forgotPasswordData.email,
                otp,
                newPassword
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            addForgotDebugLog(`✅ Password reset successful!`);
            addForgotDebugLog(`📊 Server response data: ${JSON.stringify(data.student)}`);
            
            alert(`✅ Password Reset Successful!

Dear ${data.student.name},

Your password has been successfully reset!

🔄 Auto-Login Ready:
- Student ID: ${data.student.studentId} ✅ (Auto-filled)
- New Password: ✅ (Auto-filled)

Click OK to return to login with both fields pre-filled!`);
            
            // Go to login page first
            showLoginPage();
            
            // Auto-fill BOTH student ID and password AFTER inputs are re-enabled
            setTimeout(() => {
                // Pre-fill student ID - use server response data for accuracy
                const studentIdField = document.getElementById('studentId');
                const studentIdToFill = data.student.studentId || forgotPasswordData.studentId;
                if (studentIdField && studentIdToFill) {
                    studentIdField.value = studentIdToFill;
                    // Force trigger input event to ensure field is properly filled
                    studentIdField.dispatchEvent(new Event('input', { bubbles: true }));
                    console.log(`📝 Auto-filled Student ID: ${studentIdToFill}`);
                } else {
                    console.error('❌ Failed to auto-fill Student ID - field or data missing');
                    console.error('Field exists:', !!studentIdField);
                    console.error('Student ID data:', studentIdToFill);
                }
                
                // Auto-fill the new password
                const passwordField = document.getElementById('password');
                if (passwordField && newPassword) {
                    passwordField.value = newPassword;
                    passwordField.focus();
                    console.log(`🔑 Auto-filled password for: ${studentIdToFill}`);
                }
                
                // Show success message
                addDebugLog(`🔑 Auto-filled login: ${studentIdToFill} with new password`);
            }, 300);
            
        } else {
            showForgotError(3, data.error || 'Password reset failed');
            addForgotDebugLog(`❌ Reset failed: ${data.error}`);
        }
        
    } catch (error) {
        showForgotError(3, 'Network error: ' + error.message);
        addForgotDebugLog(`❌ Network error: ${error.message}`);
    }
}
