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
- **admin** — platform admin (plans, OTA, managers).
- **manager** — owns organizations; full manage access to their orgs/venues/devices/users.
- **user** — sub-user assigned to specific venues with permission **view** or **manage**.

View = read-only. Manage = create/edit devices, events, etc.

## Device categories
- **monitoring** — sense metrics and raise alert flags; no ON/OFF schedule UI.
- **scheduling** — timed ON/OFF windows (and AC climate controls).
- **trigger** — can turn ON automatically when configured alert accesses fire, or via trigger schedules / manual button.

Water Leakage devices (WLD) are monitoring-only.
AC devices appear with scheduling-style controls on the dashboard.

## Getting help
Ask about device types, what each alert means, how AC lock/fan/mode works, how schedules differ from triggers, or how org/venue/roles work.
