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

# Organization APIs Documentation

---

# 1. Create Organization

## Endpoint
POST /api/organization/create

## Authentication
Required ✅

## Allowed Roles
- Admin
- Manager

## Dependencies
- User must be logged in
- Valid JWT token required
- Managers must have available organization limit in subscription
- Organization name must be unique for that owner

## Request Payload

```json
{
  "name": "Tech Organization"
}
```

## Required Fields

| Field | Type | Required |
|------|------|------|
| name | String | ✅ Yes |

## Success Response

```json
{
  "success": true,
  "message": "Organization created successfully",
  "organization": {
    "_id": "689abc123",
    "name": "Tech Organization",
    "owner": "688xyz123"
  }
}
```

## Error Responses

```json
{
  "success": false,
  "message": "You already have an organization with this name"
}
```

```json
{
  "success": false,
  "message": "Organization limit reached"
}
```

---

# 2. Get All Organizations

## Endpoint
GET /api/organization/all

## Authentication
Not Required ❌

## Dependencies
None

## Success Response

```json
{
  "success": true,
  "count": 2,
  "organizations": [
    {
      "_id": "123",
      "name": "Tech Organization",
      "owner": {
        "_id": "456",
        "name": "Faraz",
        "email": "faraz@gmail.com",
        "role": "manager"
      }
    }
  ]
}
```

## Error Response

```json
{
  "success": false,
  "message": "No Oragnizaiton Found"
}
```

---

# 3. Get Organizations By Owner

## Endpoint
GET /api/organization/owner/:ownerId

## Authentication
Not Required ❌

## URL Params

| Param | Description |
|------|------|
| ownerId | Organization owner's user ID |

## Dependencies
- Owner ID must exist

## Success Response

```json
{
  "success": true,
  "count": 2,
  "organizations": [
    {
      "_id": "123",
      "name": "Tech Organization"
    }
  ]
}
```

## Error Response

```json
{
  "success": false,
  "message": "No organizations found for this owner"
}
```

---

# 4. Get Single Organization

## Endpoint
GET /api/organization/single/:id

## Authentication
Not Required ❌

## URL Params

| Param | Description |
|------|------|
| id | Organization ID |

## Dependencies
- Organization must exist

## Success Response

```json
{
  "success": true,
  "organization": {
    "_id": "123",
    "name": "Tech Organization",
    "owner": {
      "_id": "456",
      "name": "Faraz",
      "email": "faraz@gmail.com"
    }
  }
}
```

## Error Response

```json
{
  "success": false,
  "message": "Organization not found"
}
```

---

# 5. Get My Organizations

## Endpoint
GET /api/organization/my-organizations

## Authentication
Required ✅

## Dependencies
- User must be logged in

## Success Response

```json
{
  "success": true,
  "count": 2,
  "organizations": [
    {
      "_id": "123",
      "name": "Tech Organization",
      "createdAt": "2026-05-21T10:00:00.000Z"
    }
  ]
}
```

## Error Response

```json
{
  "success": false,
  "message": "User not found"
}
```

---

# 6. Delete Organization

## Endpoint
DELETE /api/organization/delete-org/:id

## Authentication
Required ✅

## Allowed Roles
- Admin
- Organization Owner

## URL Params

| Param | Description |
|------|------|
| id | Organization ID |

## Dependencies
- User must be logged in
- Organization must exist
- Only admin or organization owner can delete

## Important Note
This API also deletes:
- All venues inside the organization
- All devices inside those venues
- Removes organization from assigned users

## Success Response

```json
{
  "success": true,
  "message": "Organization and all related venues & devices deleted successfully"
}
```

## Error Responses

```json
{
  "success": false,
  "message": "Organization not found"
}
```

```json
{
  "success": false,
  "message": "You don't have permission to delete this organization"
}
```

# 🏟️ Venue APIs Documentation

---

# 1. Create Venue

## Endpoint
POST /api/venue/create

## Authentication
Required ✅

## Allowed Roles
- Admin
- Manager

## Dependencies
- User must be logged in
- Valid JWT token required
- Organization must exist
- Manager must belong to organization
- Subscription limit check (for non-admin users)
- Venue name must be unique within organization

---

## Request Payload

```json
{
  "name": "Main Hall",
  "organization": "64f1c2a9b9a7c8d9e1234567"
}

| Field        | Type              | Required |
| ------------ | ----------------- | -------- |
| name         | String            | ✅ Yes    |
| organization | String (ObjectId) | ✅ Yes    |


Success Response
{
  "success": true,
  "message": "Venue created successfully",
  "venue": {
    "_id": "123",
    "name": "Main Hall",
    "organization": "456",
    "createdAt": "2026-05-21T10:00:00.000Z",
    "updatedAt": "2026-05-21T10:00:00.000Z"
  }
}

Error Responses

{
  "success": false,
  "message": "Organization not found"
}
{
  "success": false,
  "message": "You can only create venues in your own organizations"
}
{
  "success": false,
  "message": "Venue with this name already exists in this organization"
}
{
  "success": false,
  "message": "Organization limit reached"
}

2. Get All Venues
Endpoint

GET /api/venue/all

Authentication

Not Required ❌

Dependencies

None

Success Response
{
  "success": true,
  "count": 2,
  "venues": [
    {
      "_id": "123",
      "name": "Main Hall",
      "organization": {
        "_id": "456",
        "name": "Tech Organization"
      }
    }
  ]
}
Error Response
{
  "success": false,
  "message": "Venues not found"
}

# 3. Get Venue By Organization

Endpoint

GET /api/venue/get-by-org/:organizationId

Authentication

Not Required ❌

URL Params
Param	Description
organizationId	Organization ID
Success Response
{
  "success": true,
  "count": 2,
  "venues": [
    {
      "_id": "123",
      "name": "Main Hall",
      "organization": {
        "_id": "456",
        "name": "Tech Organization"
      }
    }
  ]
}
Error Response
{
  "success": false,
  "message": "No venue found under this organization"
}

4. Get Single Venue

Endpoint
GET /api/venue/single/:id

Authentication
Not Required ❌


Success Response
{
  "success": true,
  "venue": {
    "_id": "123",
    "name": "Main Hall",
    "organization": {
      "_id": "456",
      "name": "Tech Organization"
    }
  }
}
Error Response
{
  "success": false,
  "message": "Venue not found"
}
5. Update Venue

Endpoint
PUT /api/venue/update/:id

Authentication
Required 

Dependencies
User must be logged in
Venue must exist
User must have permission (admin or organization owner)
Name must be unique in organization

Request Payload
{
  "name": "Updated Hall",
  "description": "Large event hall",
  "organization": "64f1c2a9b9a7c8d9e1234567"
}

Optional Fields
Field	Type
name	String
description	String
organization	String (ObjectId)

Success Response
{
  "success": true,
  "message": "Venue updated successfully",
  "venue": {
    "_id": "123",
    "name": "Updated Hall"
  }
}
Error Responses
{
  "success": false,
  "message": "Venue not found"
}
{
  "success": false,
  "message": "A venue with this name already exists in this organization"
}
{
  "success": false,
  "message": "You don't have access to the new organization"
}

6. Delete Venue

Endpoint
DELETE /api/venue/delete-venue/:id

Authentication
Required 

Allowed Roles
Admin
Organization Owner
Dependencies
Venue must exist
Organization must exist
User must be admin or owner
⚠️ Cascade Delete Behavior

When a venue is deleted:

All devices inside venue are deleted
Venue is removed from all users
Venue is permanently deleted
Success Response
{
  "success": true,
  "message": "Venue and all its devices deleted successfully. References removed from all users."
}
Error Responses
{
  "success": false,
  "message": "Venue not found"
}
{
  "success": false,
  "message": "You don't have permission to delete this venue"
}

---


# 📟 Device APIs Documentation

---

# 1. Create Device

## Endpoint
POST /api/device/create

## Authentication
Required ✅

## Allowed Roles
- Admin
- Manager

## Dependencies
- User must be logged in
- Valid JWT token required
- Venue must exist
- Manager must belong to organization of the venue
- Subscription limit check (for non-admin users)
- Device name must be unique within a venue
- Valid deviceType and category required
- Conditions must match deviceType rules

---

## Request Payload

```json
{
  "deviceName": "Temperature Sensor 1",
  "venueId": "64f1c2a9b9a7c8d9e1234567",
  "deviceType": "THD",
  "category": "monitoring",
  "conditions": [
    {
      "type": "temperature",
      "operator": ">",
      "value": 30
    },
    {
      "type": "humidity",
      "operator": "<",
      "value": 70
    }
  ],
}

Required Fields
Field	Type	Required
deviceName	String	✅ Yes
venueId	String (ObjectId)	✅ Yes
deviceType	Enum (OD, THD, AQID, GLD, ED)	✅ Yes
category	Enum (monitoring, scheduling, trigger)	✅ Yes
conditions	Array	✅ Yes
Device Type Rules (Conditions)
Device Type	Required Conditions
OD	temperature, humidity, odour
THD	temperature, humidity
AQID	temperature, humidity, AQI
GLD	temperature, humidity, gass
ED	temperature, humidity, voltage, current

Success Response
{
  "success": true,
  "message": "Device created successfully",
  "device": {
    "id": "123",
    "deviceId": "A1B2C3",
    "deviceName": "Temperature Sensor 1",
    "deviceType": "THD",
    "category": "monitoring",
    "apiKey": "QUJDMTIz"
  }
}

Error Responses
{
  "success": false,
  "message": "Venue not found"
}
{
  "success": false,
  "message": "Device name already exists in this venue"
}
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "conditions",
      "message": "temperature condition is required for THD"
    }
  ]
}

2. Get All Devices

Endpoint
GET /api/device/all

Authentication
Not Required 

Dependencies
None

Success Response
{
  "success": true,
  "count": 2,
  "devices": [
    {
      "_id": "123",
      "deviceId": "A1B2C3",
      "deviceName": "Sensor 1",
      "deviceType": "THD",
      "category": "monitoring",
      "venue": {
        "_id": "456",
        "name": "Main Hall"
      }
    }
  ]
}

Error Response
{
  "message": "No devices found"
}

3. Get Devices By Venue

Endpoint
GET /api/device/get-by-venue/:venueId

Authentication
Not Required 


Success Response
{
  "success": true,
  "count": 2,
  "devices": [
    {
      "_id": "123",
      "deviceId": "A1B2C3",
      "deviceName": "Sensor 1",
      "venue": {
        "_id": "456",
        "name": "Main Hall"
      }
    }
  ]
}

Error Response
{
  "message": "No devices under this venue"
}

4. Get Single Device

Endpoint
GET /api/device/single/:id

Authentication
Not Required 

URL Params
Param	Description
id	Device ID

Success Response
{
  "success": true,
  "device": {
    "_id": "123",
    "deviceId": "A1B2C3",
    "deviceName": "Sensor 1",
    "deviceType": "THD",
    "category": "monitoring",
    "venue": {
      "_id": "456",
      "name": "Main Hall"
    }
  }
}

Error Response
{
  "success": false,
  "message": "Device not found"
}

5. Update Device

Endpoint
PUT /api/device/update/:id

Authentication

Required ⚠️ (permission logic partially implemented)

Dependencies
Device must exist
If venue is changed → new venue must exist
Conditions must match device rules
Only admin or organization owner (intended logic)

Request Payload
{
  "deviceName": "Updated Sensor",
  "venueId": "64f1c2a9b9a7c8d9e1234567",
  "deviceType": "THD",
  "category": "monitoring",
  "conditions": [
    {
      "type": "temperature",
      "operator": ">",
      "value": 35
    },
    {
      "type": "humidity",
      "operator": "<",
      "value": 60
    }
  ]
}

Optional Fields
Field	Type
deviceName	String
venueId	String (ObjectId)
deviceType	Enum
category	Enum
conditions	Array

Success Response
{
  "success": true,
  "message": "Device updated successfully",
  "device": {
    "_id": "123",
    "deviceName": "Updated Sensor"
  }
}

Error Responses
{
  "success": false,
  "message": "Device not found"
}
{
  "success": false,
  "message": "New venue not found"
}
{
  "success": false,
  "errors": [
    {
      "field": "conditions",
      "message": "AQI condition is required for AQID"
    }
  ]
}

6. Delete Device

Endpoint
DELETE /api/device/delete/:id

Authentication
Required 

Dependencies
Device must exist
Admin or owner permission intended

Success Response
{
  "success": true,
  "message": "Device deleted successfully"
}
Error Response
{
  "success": false,
  "message": "Device not found"
}

📌 Notes
deviceId is auto-generated (6-character unique ID)
apiKey is base64 encoded from deviceId
Device names are unique per venue (case-insensitive)
Conditions validation depends on deviceType
Pre-save middleware removes irrelevant fields based on device type