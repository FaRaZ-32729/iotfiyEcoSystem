# Alerts in ecoSystem

Alerts are live flags on a device when a reading crosses a configured threshold (or when ESP reports a leak/smoke situation). They appear in the Alerts panel by venue (“all devices”) or by organization (“alert types”).

## Alert types users see

| Alert key | Meaning | Typical value shown |
|-----------|---------|---------------------|
| temperature | Temperature alert | °C |
| humidity | Humidity alert | % |
| odour | Odour / smell level alert | % |
| AQI | Air Quality Index alert | AQI number (key is capital **AQI**) |
| smoke | Smoke alert | % or “Detected” |
| waterLeak | Water leakage detected | “Detected” |
| gass | Gas leakage alert | % (**spelling is `gass` in the app**) |
| voltage | Voltage alert (energy devices) | V |
| current | Current alert (energy devices) | A |

Note: the main Alerts panel chips focus on odour, temperature, humidity, AQI, smoke, waterLeak, and gass. Voltage/current still exist for Energy devices via the API.

## How alerts are configured
Most devices use **conditions**: a metric type, an operator (`>`, `<`, `=`), and a value. When the live reading matches, the related alert flag becomes true.

Special cases:
- **Water Leak (WLD)**: no threshold conditions; ESP sends leak true/false.
- **Smoke (SMD)**: ESP sends smoke %; alert follows the smoke condition.
- **AC**: no threshold alert conditions like sensors; may show **AC health** (`acHealthAlert`) from the device (vent/temperature health), separate from the Alerts panel chip list.

## Trigger “alert access”
On **trigger** category devices, each alert type can have an **alert access** switch (e.g. temp alert access).  
If that alert fires **and** access is enabled, the backend can publish **ON** for the device’s interval, then auto-OFF.  
This is different from monitoring-only alert flags (which only warn on the dashboard).

## Tips for users
- “Why is my alert on?” → check the device’s live reading vs its condition thresholds.
- “Why didn’t my trigger turn on?” → confirm category is trigger, the matching alert access is enabled, manualButton is not blocking, and the device is online.

## What counts as “devices with alerts”
Only devices with at least one alert flag **true** (same as Dashboard **Alerts** panel). Devices that only show false flags are **not** “having alerts.” Metric values may show as `--` while the alert is still active. The assistant must use the active-alerts list for this question — not a full device dump.
