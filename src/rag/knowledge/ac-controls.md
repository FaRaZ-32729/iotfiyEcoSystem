# AC device controls

AC devices (`deviceType: AC`) let users control a physical air conditioner through the ecoSystem dashboard (IR commands via the linked brand pack on the Ackit/ESP device).

## Controls
- **Power**: ON / OFF. May be locked while a **current schedule event** is active.
- **Set temperature**: 16–30 °C (default often 26).
- **Mode**: Cool, Heat, Dry, FanOnly, Auto.
- **Fan speed**: Low, Medium, High, Ultra, Turbo. (Brand IR packs may leave Ultra/Turbo empty — only speeds with IR data will apply on the unit.)
- **Lock (`acLocked`)**: When locked, physical remote changes that disagree with the app desired state are reverted by the device. When unlocked, remote changes can update the dashboard (state, setpoint, mode, fan).

## Where to control
- **Dashboard** (sidebar Home): first pick **Organization** and **Venue** from the **dashboard dropdowns** (not Organization/Venue Management pages).
- Then use the AC **device card** for quick power, mode, fan, lock, temp.
- Click the AC card → **right details panel** → **AC Climate** dial and **Schedules / Events**.
- There is **no** "My Devices" page. Management pages are for CRUD records, not day-to-day AC control/schedules.

## Physical remote vs app

## Live metrics (optional energy)
If energy monitoring is included, the card can show current (A), power (W, or kW when ≥ 1000 W), and energy (kWh).

## Physical remote vs app
- Unlocked: remote → MQTT → backend → live UI update for supported fields.
- Locked: remote attempts are ignored/reverted to the app desired IR state.

## Brand
Creating an AC requires selecting a **brand** so the correct IR command keys (power, temp, mode, fan) are available on the device.
