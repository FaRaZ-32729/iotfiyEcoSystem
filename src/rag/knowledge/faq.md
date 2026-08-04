# FAQ — ecoSystem help

**Q: What is ecoSystem?**  
A: An IoT platform to monitor venue sensors and control devices (including AC), with alerts, schedules, and triggers.

**Q: Why is my device grey / controls disabled?**  
A: The device is offline. Wait until status is online, or check power/Wi‑Fi/MQTT connectivity of the ESP.

**Q: What does AC lock do?**  
A: Lock keeps the AC on the app’s desired settings. Physical remote changes are reverted. Unlock allows the remote to update the dashboard.

**Q: Can I use Fan High?**  
A: Yes — High is a supported fan speed (Low, Medium, High, Ultra, Turbo). The brand IR pack must include a High command for the unit to change.

**Q: Temperature vs set temperature on AC?**  
A: Set temperature is the AC setpoint the user chooses (16–30°C). Live room/vent sensors are separate metrics when present.

**Q: Why is gas spelled “gass”?**  
A: In this app the gas-leakage alert key is stored and sent as `gass`.

**Q: Water leak has no threshold — is that normal?**  
A: Yes. WLD reports detected / not detected from the sensor; there are no `>` / `<` conditions.

**Q: Who can create devices?**  
A: Managers, and sub-users with **manage** permission on the venue. View-only users cannot create/edit.

**Q: Alert vs alert access?**  
A: An **alert** is a warning flag on the dashboard. **Alert access** on a trigger device decides whether that alert is allowed to auto-turn the device ON.

**Q: Where do I see all alerts?**  
A: Open the Alerts panel on the Dashboard — by venue (all device alerts) or by alert type across the organization.
