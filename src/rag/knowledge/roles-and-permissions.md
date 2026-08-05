# Roles & permissions (product truth for the assistant)

Answer “can I …?” using the **logged-in user’s role + permission**, never a generic invented rule.

## Roles

| Role | Notes |
|------|--------|
| **admin** | Platform admin. Does **not** create/edit/delete orgs, venues, or devices. |
| **manager** | Owns organizations; full CRUD on their management pages. |
| **user** + permission **manage** | Sub-user who can create/edit/delete on Org / Venue / Device pages (same action buttons as manager on those pages). |
| **user** + permission **view** | Read-only. Can open lists/dashboard but **cannot** create, edit, or delete. |

`canManage` in the app = admin OR manager OR (user + manage). View-only = user + view.

---

## Admin (`/admin/management`)

Admin sidebar / Management area:

1. **Managers** — view all managers (plan, orgs, venues, devices, users, status). Eco assistant (admin): use listAllManagers for counts, premium plan users, and limit-full status (e.g. organization limit reached). Can **Active/Inactive** a manager (click status → modal → **suspension reason** required when deactivating). Nobody changes their **own** status.
2. **Organizations** — **view only** (no create/edit/delete UI).
3. **Venues** — **view only** (there is no “Revenue” tab; venues is the places tab).
4. **Devices** — **view only** (admin does **not** rename or create devices here).
5. **Plan Management** — create/manage subscription plans.
6. **OTA Management** — upload firmware (device type, version ID, file) then start OTA on devices.

Admin does **not** use manager Device Management to change device names.

---

## Manager (`/management`)

Sidebar: Home (Dashboard), Organization Management, Venue Management, Device Management, **Users Management**, Subscription Analytics.

Can **create / update / delete**:
- Organizations
- Venues
- Devices (including **device name** via Device Management → edit pencil → modal)
- Team sub-users (Users Management) — **delete** or edit permission/orgs/venues; **cannot** Active/Inactive anyone

Cannot: Active/Inactive managers; admin Plan/OTA screens.

---

## Sub-user permission = manage

Same Org / Venue / Device management actions as manager on those pages (including **change device name**).

**Users Management** and **Subscription Analytics** menus are **manager-only** in the current app (sub-users do not get those sidebar items).

Cannot: Active/Inactive managers; admin Plan/OTA.

---

## Sub-user permission = view

Can **only view** dashboard and lists. **Cannot** change device name, create/edit/delete orgs/venues/devices, or manage team users.

---

## Device name change (CRITICAL)

| Who | Can change device name? |
|-----|-------------------------|
| user + **view** | **NO** |
| user + **manage** | **YES** — Device Management → edit (pencil) → change Device Name → save |
| **manager** | **YES** — same path |
| **admin** | **NO** in admin UI (devices tab is view-only; no device edit form) |

Never say “only admin can manage device names.” That is false.

---

## Email change

- Open **Account Settings** from the sidebar bottom account/logout control (modal).
- Tab **Change Email** (request + verify flow).
- Shown for **manager** and **user** (view and manage).
- **Hidden for admin** — admin cannot change email from this UI.

## Password change / reset (all roles)

There is **no** “Change Password” tab inside Account Settings / logged-in dashboard.

To set a new password:
1. Go to the **Login** page (`/login`) — logout first if already logged in.
2. Click **Forgot password** (link on the login form).
3. On **Forgot Password** (`/forgot-password`), enter the account **email** → **Send Reset Link**.
4. Open the email → click the reset link (valid **15 minutes**).
5. On **Reset Your Password** (`/reset-password/:token`): enter **New Password** (min **8** characters) and **Confirm Password** → **Reset Password**.
6. Success → redirected to Login; sign in with the new password.

Works for admin, manager, and sub-users (any account that has that email). Never say password change is impossible.

---

## Role-scoped answering (CRITICAL)

- If the logged-in user is **manager** or **user**: do **not** teach admin-only Plan/OTA/Managers-status flows unless they ask what an admin can do in general.
- If **admin**: do **not** tell them to use Device Management to rename devices; explain admin view-only devices + that managers/manage-users rename devices.
- If **view** user asks to change something: say they are view-only; a manage user or manager must do it.
- If unsure whether a path exists for **this** role: say what **this** role can do; do not invent menus.
