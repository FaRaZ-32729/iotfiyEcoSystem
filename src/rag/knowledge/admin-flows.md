# Admin how-to flows (accurate UI)

Admin home: `/admin/management` with AdminSidebar.

## Management tabs (in-page)

1. **Managers** — table of managers (plan, usage, status). Click **Active/Inactive** status → modal. Deactivate requires **suspension reason**. Cascades inactive to that manager’s sub-users. No self-status change.
2. **Organizations** — view-only list across managers.
3. **Venues** — view-only list (not a “revenue” tab).
4. **Devices** — view-only list. Admin does **not** create, rename, or delete devices here.

## Plan Management
1. Sidebar / nav → **Plan Management** (`/admin/management/plans`).
2. Plan cards + filters (All / Free / Basic / Premium / Custom).
3. **Create plan** opens a side drawer on the **same page**.
4. Fill: Plan Type, Plan Name, Description (optional), Price (PKR), Duration (days). Free: price 0, duration 15.
5. Limits: Max organizations, venues, devices, users.
6. Custom plans can include **Assign to email**.
7. Submit **Create plan**.

## OTA Management
1. **OTA Management** (`/admin/management/ota`).
2. Same page, two areas:

### Upload firmware
1. Device Type dropdown.
2. Version ID (admin chooses any version string).
3. Firmware file (.bin / .ota / .hex).
4. **Upload firmware**.

### Start OTA
1. Device Type → Version ID.
2. Select devices (or select all online).
3. **Start OTA**.

OTA is admin-only UI — not manager Device Management.

## What admin cannot do in UI
- Create/edit/delete organizations, venues, or devices (those are manager / manage-user flows).
- Change email via Account Settings (Change Email tab is hidden for admin).
- Change their own Active/Inactive status.
