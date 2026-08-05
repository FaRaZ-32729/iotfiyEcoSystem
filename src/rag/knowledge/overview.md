# ecoSystem overview

ecoSystem (IOTFIY ecoSystem) is an IoT monitoring and control platform for venues such as kitchens, cold rooms, and facilities.

## What users can do
- Monitor sensors live on the Dashboard (temperature, humidity, odour, AQI, smoke, water leak, gas, energy, AC).
- See active alerts for a venue or across an organization.
- Control AC devices (power, setpoint, mode, fan, lock) when online.
- Create schedules (timed ON/OFF) and trigger behaviours (ON when selected alerts fire).
- Manage organizations, venues, devices, and users (role-dependent).

## Hierarchy
1. **Organization** — owned by a manager.
2. **Venue** — belongs to one organization (e.g. a store or kitchen).
3. **Device** — belongs to one venue and has a type + category.

## Roles
- **admin** — Plans, OTA, Managers (Active/Inactive). View-only Orgs/Venues/Devices tabs. Does **not** create/rename devices.
- **manager** — CRUD orgs, venues, devices (including device name), team users. Cannot Active/Inactive managers.
- **user + manage** — CRUD orgs, venues, devices (including device name). No Users Management / Subscription menus in current app.
- **user + view** — read-only; cannot change device name or any records.

See `roles-and-permissions.md` for the full matrix.

View = read-only. Manage (on user) = create/edit/delete on management pages they can access.

## Device categories
- **monitoring** — sense metrics and raise alert flags; no ON/OFF schedule UI.
- **scheduling** — timed ON/OFF windows (and AC climate controls).
- **trigger** — can turn ON automatically when configured alert accesses fire, or via trigger schedules / manual button.

Water Leakage devices (WLD) are monitoring-only.
AC devices appear with scheduling-style controls on the dashboard.

## Getting help
Ask about device types, alerts, AC lock/fan/mode, schedules vs triggers, how to add a device, or org/venue/roles.

## How to create a device (short)
Sidebar **Device Management** → **Add Device** form → select Organization, Venue, Device Type → configure conditions → select Category → if trigger, pick alert-access parameters → Save.  
Do not route the user through Org Management → Venue Management first; those dropdowns are on the Add Device form.
