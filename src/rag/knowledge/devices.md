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

## Adding a device
Managers (or users with manage permission) add devices under Device Management, pick type, category, venue, and for AC a **brand** (IR command pack). Threshold conditions depend on device type.
