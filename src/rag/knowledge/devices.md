# Device types in ecoSystem

Each device has a short code (`deviceType`) and a human label.

| Code | Label | What it measures / does |
|------|--------|-------------------------|
| OD | Odour Device | Temperature, humidity, odour (%) |
| THD | Temperature Humidity Device | Temperature, humidity |
| AQID | Air Quality Index Device | Temperature, humidity, AQI |
| SMD | Smoke Device | Smoke level (0–100%). Alert from threshold condition (UI default often smoke > 60). |
| WLD | Water Leakage Device | Leak detected yes/no from ESP. No user threshold conditions. Monitoring category only. |
| GLD | Gas Leakage Device | Temperature, humidity, gas leakage level (`gass` %) |
| ED | Energy Device | Current (A) required; optional temperature, humidity, voltage (default around 225 V) |
| AC | AC Device | Air-conditioner control via IR brand pack: power, setpoint, mode, fan, lock; optional energy metrics |

## Online / offline and state
- **status**: `online` or `offline` (connectivity).
- **state**: `ON` or `OFF` (actuator / scheduling / trigger devices).

## Trigger device extras
- **manualButton**: when true, sensor-driven auto-trigger can be skipped; user can use manual control.
- **interval**: seconds the device stays ON after an auto-trigger (default 5), then auto-OFF.

## Adding a device (real UI path)

Do **not** tell users to open Organization Management then Venue Management then Device Management as separate steps to create a device.

Correct path:
1. Sidebar → **Device Management** (`/management/device`).
2. The **Add Device** form is shown on that page.
3. On the same form, select **Organization**, then **Venue**, then **Device Type**.
4. Configure **conditions** (thresholds) according to the device type (WLD has no threshold conditions).
5. Select **Category** (`monitoring` / `scheduling` / `trigger`). WLD is forced to monitoring.
6. If category is **trigger**, choose which **alert access** parameters should be allowed to auto-trigger the device.
7. For **AC**, also select the **brand** (IR pack).
8. **Save** / create.

Organization and Venue on this form are dropdown fields inside Add Device — you do not need to visit Org/Venue Management pages first (those pages are only for creating/editing org and venue records themselves).
