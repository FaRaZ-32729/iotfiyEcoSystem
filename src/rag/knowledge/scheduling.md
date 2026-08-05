# Scheduling and triggers

## Scheduling events
Used mainly for **scheduling** category devices and **AC** devices.

- Pick **start time** and **end time** (stored as UTC HH:mm), **days** of week, and command **ON** or **OFF**.
- For AC ON schedules, you can also set a **setTemperature**.
- Events can be active/inactive, recurring, overnight, and support manual override for a date.
- Overlapping schedules for the same device are blocked.
- While a schedule window is **current**, AC power toggle from the card can be blocked.

Dashboard cards show the next/current schedule summary when present.

## How to add a schedule on an AC (real UI path)

There is **no** menu named "My Devices".
Do **not** send the user to **Organization Management** or **Venue Management** just to pick a venue for scheduling.

On the **Dashboard**, organization and venue are chosen with the **top dropdowns** (org select + venue select), not via the management pages.

Correct steps:
1. Open the **Dashboard** (sidebar **Home** → `/management`). Log in first if needed.
2. Use the Dashboard **Organization dropdown** and **Venue dropdown** to select the venue where the AC lives.
3. On the dashboard device grid, **click the AC device card** (e.g. AC1).
4. The **right-hand details panel** opens for that device.
5. Find the **Schedules / Events** section on that panel.
6. **Add schedule**, set days / start / end / ON or OFF (and setpoint if ON), then save.

**Organization Management** / **Venue Management** / **Device Management** are for creating and editing org/venue/device **records** — not the normal path to open an AC schedule.

**Device Management** (`/management/device`) does not replace the Dashboard card → right-panel schedule flow.

## Trigger schedules
Separate from sensor-driven triggers. A **trigger event** can turn a device **ON** at a start time on selected days for `intervalSeconds`, then off. UI is on the same right panel when a **trigger** category device is selected (`TriggerEventsSection`).

## Sensor-driven triggers (alert access)
On **trigger** devices:
1. A monitored alert becomes true (e.g. temperature alert).
2. Matching **alert access** is enabled.
3. Device goes ON for `interval` seconds (unless manual mode blocks auto behaviour).

## Monitoring vs scheduling vs trigger (short)
- **Monitoring**: watch + alerts only — **cannot** have ON/OFF schedules.
- **Scheduling**: calendar ON/OFF windows (open via Dashboard → click device card → schedules on right panel).
- **Trigger**: react to alerts (and/or timed trigger ON) with a short ON pulse.
