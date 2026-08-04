# AC device controls

AC devices (`deviceType: AC`) let users control a physical air conditioner through the ecoSystem dashboard (IR commands via the linked brand pack on the Ackit/ESP device).

## Controls
- **Power**: ON / OFF. May be locked while a **current schedule event** is active.
- **Set temperature**: 16–30 °C (default often 26).
- **Mode**: Cool, Heat, Dry, FanOnly, Auto.
- **Fan speed**: Low, Medium, High, Ultra, Turbo. (Brand IR packs may leave Ultra/Turbo empty — only speeds with IR data will apply on the unit.)
- **Lock (`acLocked`)**: When locked, physical remote changes that disagree with the app desired state are reverted by the device. When unlocked, remote changes can update the dashboard (state, setpoint, mode, fan).

## Where to control
- Dashboard **AC device card** (quick selects).
- Venue details **AC Climate** dial (temperature stepper, mode, fan, lock).

Controls are disabled when the device is **offline**.

## Live metrics (optional energy)
If energy monitoring is included, the card can show current (A), power (W, or kW when ≥ 1000 W), and energy (kWh).

## Physical remote vs app
- Unlocked: remote → MQTT → backend → live UI update for supported fields.
- Locked: remote attempts are ignored/reverted to the app desired IR state.

## Brand
Creating an AC requires selecting a **brand** so the correct IR command keys (power, temp, mode, fan) are available on the device.
