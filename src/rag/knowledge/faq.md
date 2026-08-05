# FAQ — ecoSystem help

**Q: What is ecoSystem?**  
A: An IoT platform to monitor venue sensors and control devices (including AC), with alerts, schedules, and triggers.

**Q: Why is my device grey / controls disabled?**  
A: The device is offline. Wait until status is online, or check power/Wi-Fi/MQTT connectivity of the ESP.

**Q: What does AC lock do?**  
A: Lock keeps the AC on the app's desired settings. Physical remote changes are reverted. Unlock allows the remote to update the dashboard.

**Q: Can I use Fan High?**  
A: Yes — High is a supported fan speed (Low, Medium, High, Ultra, Turbo). The brand IR pack must include a High command for the unit to change.

**Q: Temperature vs set temperature on AC?**  
A: Set temperature is the AC setpoint the user chooses (16–30°C). Live room/vent sensors are separate metrics when present.

**Q: Why is gas spelled "gass"?**  
A: In this app the gas-leakage alert key is stored and sent as `gass`.

**Q: Water leak has no threshold — is that normal?**  
A: Yes. WLD reports detected / not detected from the sensor; there are no `>` / `<` conditions.

**Q: Who can create devices?**  
A: Managers, and sub-users with **manage** permission. View-only users cannot create/edit. Admin does not create devices in admin UI.

**Q: Can I change a device name?**  
A: **Manager** and **user (manage)**: yes — Device Management → edit (pencil) → change Device Name → save. **User (view)**: no. **Admin**: no device-rename UI (Devices tab is view-only). Never say only admin can rename devices.

**Q: How do I change my email?**  
A: Sidebar account/logout → Account Settings → Change Email. Available to manager and sub-users. Hidden for admin.

**Q: How do I change my password?**  
A: There is no Change Password inside the logged-in Account Settings. Use: Login page → **Forgot password** → enter email → **Send Reset Link** → open email link (15 min) → enter new password (min 8) + confirm → **Reset Password** → login again. Works for admin, manager, and users.

**Q: Alert vs alert access?**
A: An **alert** is a warning flag on the dashboard. **Alert access** on a trigger device decides whether that alert is allowed to auto-turn the device ON.

**Q: Where do I see all alerts?**  
A: Open the Alerts panel on the Dashboard — by venue (all device alerts) or by alert type across the organization.

**Q: How do I create / add a device?**  
A: Open sidebar **Device Management**. The **Add Device** form is there. On that form select Organization, Venue, Device Type, configure conditions, select Category; if Category is trigger, choose alert-access parameters; then Save. Do not go Org Management → Venue Management first — those fields are on the Add Device form.

**Q: Can a manager terminate / Inactive a user?**  
A: No. A manager can only **delete** their team member from **Users Management**. Only **admin** can set a manager Active/Inactive (suspend) from Management → **Managers** → click status → enter **suspension reason** when deactivating.

**Q: Can I change my own Active/Inactive status?**  
A: **No.** Nobody can change their own account status in this app. Only an **admin** can change a manager's status. Managers and sub-users cannot flip Active/Inactive for themselves or for others (managers only delete team members).

**Q: How does admin Inactive a manager?**  
A: Management → **Managers** → All Managers table → click **Active/Inactive** status → modal → **suspension reason** → confirm.

**Q: How many organizations does admin have in the application?**  
A: Admin sees **all organizations** platform-wide (every manager's orgs). Eco assistant: getPlatformOverview or listMyOrganizations. UI: Admin → Management → Organizations tab. This is NOT personal subscription usage.

**Q: How does admin perform OTA (Over The Air) firmware update?**  
A: Admin sidebar → **OTA Management** (`/admin/management/ota`). **Upload firmware:** Device Type, Version ID, file (.bin / .ota / .hex), Upload firmware. **Start OTA:** Device Type, Version ID, select online devices, **Start OTA**. Admin-only — NOT manager Device Management.
