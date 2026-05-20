# Authentication APIs Documentation

---

# 1. Register Admin

## Method
```http
POST
```

## URL
```http
/api/auth/register-admin
```

## Payload
```json
{
  "name": "Admin",
  "email": "admin@example.com",
  "password": "12345678"
}
```

## Success Response
```json
{
  "success": true,
  "message": "Admin registered successfully"
}
```

## Dependencies / Requirements
- Public API
- No authentication required
- Email must be unique
- Password minimum 8 characters

---

# 2. Register User (Manager Registration)

## Method
```http
POST
```

## URL
```http
/api/auth/register
```

## Payload
```json
{
  "name": "Faraz",
  "email": "faraz@example.com",
  "password": "12345678"
}
```

## Success Response
```json
{
  "success": true,
  "message": "Registration successful. Please verify OTP sent to your email."
}
```

## Dependencies / Requirements
- Public API
- No authentication required
- Email service required
- `checkPendingSubscription` middleware runs
- Email must be unique

---

# 3. Admin Create User

## Method
```http
POST
```

## URL
```http
/api/auth/admin/register
```

## Headers
```http
Authorization: Bearer <token>
```

## Payload
```json
{
  "name": "Manager",
  "email": "manager@example.com"
}
```

## Success Response
```json
{
  "success": true,
  "message": "User created successfully. Setup link sent to email."
}
```

## Dependencies / Requirements
- Authentication required
- Only Admin can access
- `authenticate` middleware required
- `roleGuard(["admin"])` required
- Email service required
- Email must be unique

---

# 4. Create Sub User

## Method
```http
POST
```

## URL
```http
/api/auth/register-user
```

## Headers
```http
Authorization: Bearer <token>
```

## Payload
```json
{
  "name": "Sub User",
  "email": "subuser@example.com",
  "role": "user",
  "organizations": ["organizationId"],
  "venues": ["venueId"],
  "permission": "view",
  "timer": "30"
}
```

## Success Response
```json
{
  "success": true,
  "message": "Sub-user created successfully. Setup link sent."
}
```

## Dependencies / Requirements
- Authentication required
- Only Manager can access
- `authenticate` middleware required
- `roleGuard(["manager"])` required
- Subscription limit check required
- Organizations must belong to manager
- Email service required

---

# 5. Set Password

## Method
```http
POST
```

## URL
```http
/api/auth/set-password/:token
```

## Payload
```json
{
  "password": "12345678"
}
```

## Success Response
```json
{
  "success": true,
  "message": "Password set successfully. Please verify OTP sent to your email."
}
```

## Dependencies / Requirements
- Valid setup token required
- Token expires in 24 hours
- Password minimum 8 characters
- Email service required

---

# 6. Verify OTP

## Method
```http
POST
```

## URL
```http
/api/auth/verify-otp
```

## Payload
```json
{
  "otp": "123456"
}
```

## Success Response
```json
{
  "success": true,
  "message": "Account verified successfully. You can now login."
}
```

## Dependencies / Requirements
- Valid OTP required
- OTP must not be expired

---

# 7. Login User

## Method
```http
POST
```

## URL
```http
/api/auth/login
```

## Payload
```json
{
  "email": "faraz@example.com",
  "password": "12345678"
}
```

## Success Response
```json
{
  "success": true,
  "message": "Login successful",
  "token": "jwt_token"
}
```

## Dependencies / Requirements
- User must be verified
- User account must be active
- Correct email & password required

---

# 8. Logout User

## Method
```http
DELETE
```

## URL
```http
/api/auth/logout
```

## Success Response
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

## Dependencies / Requirements
- Logged in user
- JWT cookie/token required

---

# 9. Forgot Password

## Method
```http
POST
```

## URL
```http
/api/auth/forgot-password
```

## Payload
```json
{
  "email": "faraz@example.com"
}
```

## Success Response
```json
{
  "success": true,
  "message": "Password reset link sent to your email"
}
```

## Dependencies / Requirements
- Registered email required
- Email service required

---

# 10. Reset Password

## Method
```http
POST
```

## URL
```http
/api/auth/reset-password/:token
```

## Payload
```json
{
  "password": "newpassword123"
}
```

## Success Response
```json
{
  "success": true,
  "message": "Password reset successfully. You can now login with new password."
}
```

## Dependencies / Requirements
- Valid reset token required
- Reset token expires in 15 minutes
- Password minimum 8 characters

---

# 11. Get Logged In User (Me)

## Method
```http
GET
```

## URL
```http
/api/auth/me
```

## Headers
```http
Authorization: Bearer <token>
```

## Success Response
```json
{
  "success": true,
  "user": {}
}
```

## Dependencies / Requirements
- Authentication required
- `authenticate` middleware required

---

# User Management APIs Documentation

---

# 1. Get All Users (Except Admin)

## Method
```http
GET
```

## URL
```http
/api/users/all
```

## Headers
```http
Authorization: Bearer <token>
```

## Success Response
```json
{
  "success": true,
  "count": 10,
  "users": []
}
```

## Dependencies / Requirements
- Authentication required
- Any logged-in user (depends on roleGuard if added later)
- Excludes admin users
- MongoDB connection required

---

# 2. Get All Managers

## Method
```http
GET
```

## URL
```http
/api/users/managers
```

## Headers
```http
Authorization: Bearer <token>
```

## Success Response
```json
{
  "success": true,
  "count": 5,
  "managers": []
}
```

## Dependencies / Requirements
- Authentication required
- MongoDB connection required

---

# 3. Get Users By Manager

## Method
```http
GET
```

## URL
```http
/api/users/manager/:managerId
```

## Headers
```http
Authorization: Bearer <token>
```

## Success Response
```json
{
  "success": true,
  "manager": {
    "id": "managerId",
    "name": "Manager Name",
    "email": "manager@email.com"
  },
  "count": 3,
  "subUsers": []
}
```

## Dependencies / Requirements
- Authentication required
- Valid managerId required
- Manager must exist

---

# 4. Get Single User

## Method
```http
GET
```

## URL
```http
/api/users/single/:userId
```

## Headers
```http
Authorization: Bearer <token>
```

## Success Response
```json
{
  "success": true,
  "user": {}
}
```

## Dependencies / Requirements
- Authentication required
- Valid userId required
- User must exist

---

# 5. Update Manager Created User

## Method
```http
PUT
```

## URL
```http
/api/users/update-user/:userId
```

## Headers
```http
Authorization: Bearer <token>
```

## Payload
```json
{
  "organizations": ["orgId1", "orgId2"],
  "venues": ["venueId1"],
  "permission": "view"
}
```

## Success Response
```json
{
  "success": true,
  "message": "User access updated successfully",
  "user": {}
}
```

## Dependencies / Requirements
- Only Manager can update users
- User must be created by same manager
- Only role = "user" allowed
- Organizations must belong to manager
- Venues must belong to organizations
- Permission must be "view" or "manage"

---

# 6. Suspend / Activate Manager

## Method
```http
PUT
```

## URL
```http
/api/users/suspend/:managerId
```

## Headers
```http
Authorization: Bearer <token>
```

## Payload
```json
{
  "isActive": false,
  "suspensionReason": "Violation of policy"
}
```

## Success Response
```json
{
  "success": true,
  "message": "Manager and all its sub-users have been suspended successfully"
}
```

## Dependencies / Requirements
- Only Admin can access
- Authentication required
- Valid managerId required
- If isActive = false → suspensionReason required
- Affects all sub-users

---

# 7. Delete User

## Method
```http
DELETE
```

## URL
```http
/api/users/delete-user/:id
```

## Headers
```http
Authorization: Bearer <token>
```

## Success Response
```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

## Dependencies / Requirements
- Authentication required
- Valid userId required

---

# 8. Delete Manager (Cascade Delete)

## Method
```http
DELETE
```

## URL
```http
/api/users/delete-manager/:id
```

## Headers
```http
Authorization: Bearer <token>
```

## Success Response
```json
{
  "success": true,
  "message": "Manager and all related data deleted successfully"
}
```

## Dependencies / Requirements
- Only Admin can access
- Authentication required
- Deletes:
  - Organizations
  - Venues
  - Devices
  - Sub-users
  - Subscriptions
  - Subscription Plans

---

# 9. Request Email Change

## Method
```http
POST
```

## URL
```http
/api/users/request-email-change
```

## Headers
```http
Authorization: Bearer <token>
```

## Payload
```json
{
  "newEmail": "newemail@example.com"
}
```

## Success Response
```json
{
  "success": true,
  "message": "OTP sent to your new email. Please verify."
}
```

## Dependencies / Requirements
- Authentication required
- New email must be unique
- Must not match current email
- Email service required

---

# 10. Verify Email Change

## Method
```http
POST
```

## URL
```http
/api/users/verify-email-change
```

## Headers
```http
Authorization: Bearer <token>
```

## Payload
```json
{
  "otp": "123456"
}
```

## Success Response
```json
{
  "success": true,
  "message": "Email updated successfully",
  "email": "newemail@example.com"
}
```

## Dependencies / Requirements
- Authentication required
- OTP must be valid
- OTP must not be expired
- Pending email change must exist

---

