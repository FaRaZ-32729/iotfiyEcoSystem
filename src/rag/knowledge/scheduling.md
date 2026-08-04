# Scheduling and triggers

## Scheduling events
Used mainly for **scheduling** category devices and AC.

- Pick **start time** and **end time** (stored as UTC HH:mm), **days** of week, and command **ON** or **OFF**.
- For AC ON schedules, you can also set a **setTemperature**.
- Events can be active/inactive, recurring, overnight, and support manual override for a date.
- Overlapping schedules for the same device are blocked.
- While a schedule window is **current**, AC power toggle from the card can be blocked.

Dashboard cards show the next/current schedule summary when present.

## Trigger schedules
Separate from sensor-driven triggers. A **trigger event** can turn a device **ON** at a start time on selected days for `intervalSeconds`, then off.

## Sensor-driven triggers (alert access)
On **trigger** devices:
1. A monitored alert becomes true (e.g. temperature alert).
2. Matching **alert access** is enabled.
3. Device goes ON for `interval` seconds (unless manual mode blocks auto behaviour).

## Monitoring vs scheduling vs trigger (short)
- **Monitoring**: watch + alerts only.
- **Scheduling**: calendar ON/OFF windows.
- **Trigger**: react to alerts (and/or timed trigger ON) with a short ON pulse.
