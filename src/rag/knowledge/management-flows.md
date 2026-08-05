# Management how-to flows (accurate UI)

General pattern for manager pages: **same page** = left list + right Add form. Edit uses a **modal** on the list — not a separate edit route.

## Create Organization
1. Sidebar → **Organization Management** (`/management/organization`).
2. Right panel **Add Organization**.
3. Enter **Organization Name** → **Save**.

Do not mix this with Dashboard org dropdown (that only filters the dashboard view).

## Create Venue
1. Sidebar → **Venue Management** (`/management/venue`).
2. Right panel **Add Venues**.
3. Enter venue name + dropdown **Select Organization** → **Save**.

## Create Device
1. Sidebar → **Device Management** (`/management/device`).
2. Right panel **Add Device** form (all on this page).
3. On the form: Device Name → Organization → Venue → Device Type → Category.
4. Configure conditions (type-dependent; WLD has none). AC: pick **AC Brand**.
5. If Category = **trigger**, choose **alert access** parameters.
6. **Save** (API key shown after create).

Do **not** send users through Org Management → Venue Management → Device Management as three separate navigation steps before Add Device. Org/Venue are dropdowns on the Add Device form.

Who can create/edit devices: **manager** and sub-user with permission **manage**. Sub-user **view** cannot. **Admin** does not use this page (admin devices tab is view-only).

## Change device name (rename)
1. Sidebar → **Device Management**.
2. On the device row, click **edit (pencil)**.
3. Modal opens → change **Device Name** (and other editable fields) → Save/Update.

Allowed: manager + user(manage). **Not** allowed: user(view). Admin does not rename via admin Devices tab.

## Add team member / sub-user
1. Sidebar (**manager only**) → **Users Management** (`/management/users`).
2. Right form **Add User**.
3. Full Name, Email, Organizations (multi), Venues (optional multi), Permission (**View Only** or **Manage**).
4. **Create User** (setup email is sent; role is `user`).

Users Management is for **team sub-users only**. It is **not** an All Managers page. There is **no** Active/Inactive status control here — not for yourself, not for team members. Sub-users (even manage) do **not** see Users Management in the current sidebar.

## Delete team member / sub-user (manager)
Managers **cannot terminate / suspend / Inactive** users. They can only **delete** their own team members.

1. Sidebar (manager only) → **Users Management**.
2. Trash/delete on that user → confirm.

## Edit records
- Organization / Venue / Device: edit (pencil) on the list → modal → Update/Save (requires manage permission).
- User edit (manager): name/email often read-only; orgs, venues, permission editable.

## Change email (manager & sub-users)
1. Sidebar bottom **account / logout** control → **Account Settings** modal.
2. Open **Change Email** tab → request + verify.
3. **Admin** does not get this tab.

## Change / reset password (all roles)
There is **no** Change Password inside Account Settings. Use Forgot Password:

1. Open **Login** page (logout first if needed).
2. Click **Forgot password**.
3. Enter email → **Send Reset Link**.
4. Open email → click link (expires in **15 minutes**).
5. Enter new password (min **8** chars) + confirm → **Reset Password**.
6. Login again with the new password.

## Subscription usage (manager)
1. Sidebar → **Subscription Analytics** (`/management/subscription`).
2. See plan name, dates, and used/total/remaining for Organizations, Venues, Devices, Users.

To answer “kitne aur devices/orgs/venues/users bana sakta hun?” use the subscription usage tool (remaining counts) — do not invent numbers.
