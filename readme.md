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
# Subscription APIs Documentation

---

# 1. Create Subscription Plan

## Method
```http
POST
```

## URL
```http
/api/subscription/create-plan
```

## Headers
```http
Authorization: Bearer <token>
```

---

# Payload Structure

## Normal Plan Payload

```json
{
  "name": "Premium Plan",                  // Required
  "type": "premium",                      // Required
  "description": "Premium subscription",  // Optional
  "price": 99,                            // Required
  "durationDays": 30,                     // Required
  "maxOrganizations": 10,                 // Required
  "maxVenues": 50,                        // Required
  "maxDevices": 200,                      // Required
  "maxUsers": 20                          // Required
}
```

---

## Admin Custom Plan Payload

```json
{
  "name": "Custom Enterprise Plan",       // Required
  "type": "custom",                       // Required
  "description": "Enterprise Plan",       // Optional
  "price": 500,                           // Required
  "durationDays": 365,                    // Required
  "maxOrganizations": 100,                // Required
  "maxVenues": 500,                       // Required
  "maxDevices": 5000,                     // Required
  "maxUsers": 100,                        // Required
  "assignedToEmail": "user@example.com"   // Required for Admin Custom Plan
}
```

---

## Manager Custom Plan Payload

```json
{
  "name": "My Custom Plan",               // Required
  "type": "custom",                       // Required
  "description": "Manager Custom Plan",   // Optional
  "price": 200,                           // Required
  "durationDays": 90,                     // Required
  "maxOrganizations": 20,                 // Required
  "maxVenues": 100,                       // Required
  "maxDevices": 1000,                     // Required
  "maxUsers": 25                          // Required
}
```

---


# Success Response

```json
{
  "success": true,
  "message": "Subscription Plan created successfully",
  "plan": {},
  "subscription": {}
}
```

---

# Dependencies / Requirements

- Authentication required
- Admin and Manager both can create plans
- Plan name must be unique
- Free plan must contain exactly 15 duration days
- Valid plan types:
  - free
  - basic
  - premium
  - custom

---

# Important Custom Plan Logic

## Admin Custom Plan

- Admin can create custom plan for another user
- `assignedToEmail` is compulsory
- If user already exists:
  - Subscription automatically attaches to user
  - User instantly receives active subscription
- If user does not exist:
  - Subscription stores email
  - When user registers later using same email:
    - Subscription automatically links

---

## Manager Custom Plan

- Manager can create only own custom plan
- `assignedToEmail` automatically uses manager email
- Plan becomes manager-specific custom plan

---

# Auto Subscription Creation

For Admin-created custom plans:

- Subscription automatically created
- Status becomes `active`
- Payment method:
```json
{
  "paymentMethod": "admin-assigned"
}
```

---

# 2. Purchase Subscription

## Method
```http
POST
```

## URL
```http
/api/subscription/purchase
```

## Headers
```http
Authorization: Bearer <token>
```

---

# Payload

```json
{
  "planId": "subscriptionPlanId"   // Required
}
```

---

# Payload Fields

| Field | Type | Required | Description |
|---|---|---|---|
| planId | String | Yes | Subscription plan ID |

---

# Success Response

```json
{
  "success": true,
  "message": "Subscription activated successfully",
  "subscription": {
    "id": "subscriptionId",
    "plan": "Premium Plan",
    "startDate": "2026-05-20T10:00:00.000Z",
    "endDate": "2026-06-20T10:00:00.000Z"
  }
}
```

---

# Dependencies / Requirements

- Authentication required
- User must exist
- User must be verified
- Plan must exist
- Plan must be active
- User cannot already have active subscription

---

# Purchase Flow

```text
User selects plan
        ↓
Plan validation
        ↓
Check active subscription
        ↓
Create subscription
        ↓
Attach subscription to user
        ↓
Send activation email
        ↓
Subscription activated
```

---

# Subscription Status Types

```text
active
expired
cancelled
trial
```

---

# Subscription Plan Types

```text
free
basic
premium
custom
```

---
