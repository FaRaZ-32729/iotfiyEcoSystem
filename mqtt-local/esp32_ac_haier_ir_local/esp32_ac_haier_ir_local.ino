/*
 * IoTify AC (Haier YRW02) — ESP wale bande ki bs120 firmware + LOCAL MQTT
 * =======================================================================
 * ESP guy ka asal IR/lock/health/Preferences logic HU-BA-HU rakha gaya hai.
 * Sirf uska local WebServer hata ke MQTT add kiya gaya hai taake aapka
 * frontend/backend is AC ko control kar sake.
 *
 * ---- Translation SIRF naye MQTT glue me (uski functions untouched) ----
 *   Backend "mode"  ->  Haier webMode        Backend "fanSpeed" -> Haier webFan
 *     Cool    -> cool                           Low     -> low
 *     Heat    -> heat                           Medium  -> med
 *     Dry     -> dry                            Ultra   -> turbo  (Haier me Ultra nahi)
 *     FanOnly -> fan                            Turbo   -> turbo
 *     Auto    -> auto
 *   command: ON/OFF | setTemperature 16..30 | lock bool
 *
 * ESP -> backend data (iotify/devices/{id}/data):
 *   { state, setTemperature, mode(Cool..), fanSpeed(Low..), lock, acHealth, current }
 *   acHealth = !maintenanceAlert   (true = healthy)
 *   current  = SIMULATED (bs120 me real current sensor nahi — energy UI ke liye)
 *
 * WIRING (bs120 same): IR LED GPIO16 | IR RECV GPIO15 | DS18B20 GPIO4
 */

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <IRremoteESP8266.h>
#include <IRsend.h>
#include <IRrecv.h>
#include <IRutils.h>
#include <Preferences.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ==================== NETWORK (LOCAL) ====================
const char* ssid = "IOTFIY8";
const char* password = "12345678";

// ==================== LOCAL MQTT ====================
const char* mqtt_server = "192.168.137.1";
const int   mqtt_port   = 1883;
const char* deviceId    = "FCJG5O";   // <-- LOCAL Mongo AC device id
const char* mqtt_user   = "";
const char* mqtt_pass   = "";

WiFiClient espClient;
PubSubClient client(espClient);

const uint16_t kIrLedPin = 16;
IRsend irsend(kIrLedPin);
Preferences preferences;

// --- DS18B20 SENSOR SETUP ---
#define ONE_WIRE_BUS 4
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);
float currentRoomTemp = 0.0;
unsigned long lastSensorReadTime = 0;

// --- MAINTENANCE TRACKING VARIABLES (VENT-BASED) ---
bool maintenanceAlert = false;
bool isTracking = false;
unsigned long coolingStartTime = 0;
int lastTrackedTargetTemp = 0;
const unsigned long GRACE_PERIOD = 2UL * 60UL * 1000UL;
const float MAX_HEALTHY_VENT_TEMP = 15.0;
float smoothedVentTemp = NAN;

// --- IR RECEIVER SETUP ---
const uint16_t kIrRecvPin = 15;
const uint16_t kCaptureBufferSize = 1024;
const uint8_t  kTimeout = 50;
IRrecv irrecv(kIrRecvPin, kCaptureBufferSize, kTimeout, true);
decode_results results;

String lastCommandName = "None yet";
String lastRawCode = "--";
unsigned long lastCommandTime = 0;

// --- LOCK & STATE VARIABLES (bs120 originals — used by IR functions) ---
bool systemLocked = false;
int webTargetTemp = 24;
String webMode = "cool";
String webFan = "low";
bool webPower = true;

// --- APP-FACING mirror (backend keywords — sirf MQTT echo ke liye) ---
String appMode = "Cool";
String appFan = "Low";

// --- MQTT timers ---
unsigned long lastDataSend = 0;
unsigned long lastStatusSend = 0;
unsigned long lastReconnectAttempt = 0;

// --- POWER ARRAYS ---
uint8_t ac_OFF[14] = {0xA6, 0x2C, 0x00, 0x00, 0x00, 0x60, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x05, 0x57};
uint8_t ac_ON[14]  = {0xA6, 0x2C, 0x00, 0x00, 0x40, 0x60, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x05, 0x97};

// --- TEMPERATURE ARRAYS ---
uint8_t ac_16C[14] = {0xA6, 0x0C, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x32};
uint8_t ac_17C[14] = {0xA6, 0x1C, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0x43};
uint8_t ac_18C[14] = {0xA6, 0x2C, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0x53};
uint8_t ac_19C[14] = {0xA6, 0x3C, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0x63};
uint8_t ac_20C[14] = {0xA6, 0x4C, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0x73};
uint8_t ac_21C[14] = {0xA6, 0x5C, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0x83};
uint8_t ac_22C[14] = {0xA6, 0x6C, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0x93};
uint8_t ac_23C[14] = {0xA6, 0x7C, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0xA3};
uint8_t ac_24C[14] = {0xA6, 0x8C, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0xB3};
uint8_t ac_25C[14] = {0xA6, 0x9C, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0xC3};
uint8_t ac_26C[14] = {0xA6, 0xAC, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0xD3};
uint8_t ac_27C[14] = {0xA6, 0xBC, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0xE3};
uint8_t ac_28C[14] = {0xA6, 0xCC, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0xF3};
uint8_t ac_29C[14] = {0xA6, 0xDC, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0x03};
uint8_t ac_30C[14] = {0xA6, 0xEC, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0x13};

// --- FAN SPEED ARRAYS ---
uint8_t ac_FAN_TURBO[14] = {0xA6, 0x4C, 0x00, 0x00, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x04, 0x76};
uint8_t ac_FAN_MED[14]   = {0xA6, 0x4C, 0x00, 0x00, 0x40, 0x40, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x04, 0x96};
uint8_t ac_FAN_LOW[14]   = {0xA6, 0x4C, 0x00, 0x00, 0x40, 0x60, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x04, 0xB6};
uint8_t ac_FAN_AUTO[14]  = {0xA6, 0x4C, 0x00, 0x00, 0x40, 0xA0, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x04, 0xF6};

// --- MODE ARRAYS ---
uint8_t ac_MODE_AUTO[14] = {0xA6, 0x4C, 0x00, 0x00, 0x40, 0x60, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x06, 0x98};
uint8_t ac_MODE_COOL[14] = {0xA6, 0x4C, 0x00, 0x00, 0x40, 0x60, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x06, 0xB8};
uint8_t ac_MODE_DRY[14]  = {0xA6, 0x4C, 0x00, 0x00, 0x40, 0x60, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x06, 0xD8};
uint8_t ac_MODE_FAN[14]  = {0xA6, 0x4C, 0x00, 0x00, 0x40, 0x60, 0x00, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x06, 0x58};
uint8_t ac_MODE_HEAT[14] = {0xA6, 0x4C, 0x00, 0x00, 0x40, 0x60, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x06, 0x18};

struct IRCommand {
  const char* name;
  uint8_t* data;
};

IRCommand knownCommands[] = {
  {"Power ON",        ac_ON},
  {"Power OFF",       ac_OFF},
  {"Temp 16C",        ac_16C},
  {"Temp 17C",        ac_17C},
  {"Temp 18C",        ac_18C},
  {"Temp 19C",        ac_19C},
  {"Temp 20C",        ac_20C},
  {"Temp 21C",        ac_21C},
  {"Temp 22C",        ac_22C},
  {"Temp 23C",        ac_23C},
  {"Temp 24C",        ac_24C},
  {"Temp 25C",        ac_25C},
  {"Temp 26C",        ac_26C},
  {"Temp 27C",        ac_27C},
  {"Temp 28C",        ac_28C},
  {"Temp 29C",        ac_29C},
  {"Temp 30C",        ac_30C},
  {"Fan Turbo",       ac_FAN_TURBO},
  {"Fan Medium",      ac_FAN_MED},
  {"Fan Low",         ac_FAN_LOW},
  {"Fan Auto",        ac_FAN_AUTO},
  {"Mode Auto",       ac_MODE_AUTO},
  {"Mode Cool",       ac_MODE_COOL},
  {"Mode Dry",        ac_MODE_DRY},
  {"Mode Fan",        ac_MODE_FAN},
  {"Mode Heat",       ac_MODE_HEAT},
};
const uint8_t numKnownCommands = sizeof(knownCommands) / sizeof(knownCommands[0]);

// ==================== IR FUNCTIONS (bs120 — UNCHANGED) ====================
void sendIRCode(uint8_t* code) {
  irrecv.disableIRIn();
  irsend.send(decode_type_t::HAIER_AC_YRW02, code, 14);
  delay(50);
  irrecv.enableIRIn();
}

uint8_t tempToCode(int temp) {
  switch(temp) {
    case 16: return 0x0C; case 17: return 0x1C; case 18: return 0x2C;
    case 19: return 0x3C; case 20: return 0x4C; case 21: return 0x5C;
    case 22: return 0x6C; case 23: return 0x7C; case 24: return 0x8C;
    case 25: return 0x9C; case 26: return 0xAC; case 27: return 0xBC;
    case 28: return 0xCC; case 29: return 0xDC; case 30: return 0xEC;
    default: return 0x8C;
  }
}

uint8_t modeToCode(String mode) {
  if (mode == "auto") return 0x00;
  if (mode == "cool") return 0x20;
  if (mode == "dry")  return 0x40;
  if (mode == "fan")  return 0xC0;
  if (mode == "heat") return 0x80;
  return 0x20;
}

uint8_t fanToCode(String fan) {
  if (fan == "turbo") return 0x20;
  if (fan == "med")   return 0x40;
  if (fan == "low")   return 0x60;
  if (fan == "auto")  return 0xA0;
  return 0x60;
}

void composeStateArray(uint8_t out[14], int temp, String mode, String fan, bool powerOn) {
  out[0] = 0xA6;
  out[1] = tempToCode(temp);
  out[2] = 0x00;
  out[3] = 0x00;
  out[4] = powerOn ? 0x40 : 0x00;
  out[5] = fanToCode(fan);
  out[6] = 0x00;
  out[7] = modeToCode(mode);
  out[8] = 0x00;
  out[9] = 0x00;
  out[10] = 0x00;
  out[11] = 0x00;
  out[12] = 0x01;

  uint8_t sum = 0;
  for (uint8_t i = 0; i < 13; i++) sum += out[i];
  out[13] = sum;
}

/** Same as his "BLAST TEMP" — full composed IR (temp + mode + fan + power bit). */
void blastCurrentState() {
  uint8_t composed[14];
  composeStateArray(composed, webTargetTemp, webMode, webFan, true);
  sendIRCode(composed);
  Serial.printf("IR BLAST: temp=%d mode=%s fan=%s | frame=",
                webTargetTemp, webMode.c_str(), webFan.c_str());
  for (uint8_t i = 0; i < 14; i++) Serial.printf("0x%02X ", composed[i]);
  Serial.println();
}

/**
 * OFF  → dedicated ac_OFF (proven working on your AC)
 * ON   → dedicated ac_ON first (category 0x05), then BLAST full state
 *        (composed-only after OFF often fails on Haier — that's why ON wasn't working)
 * Settings while already ON → BLAST only (auto — no separate Blast button in app)
 */
void sendCorrectedState() {
  if (!webPower) {
    sendIRCode(ac_OFF);
    Serial.println("IR: POWER OFF (ac_OFF)");
  } else {
    blastCurrentState();
  }
}

void sendPowerOnThenBlast() {
  sendIRCode(ac_ON);
  Serial.println("IR: POWER ON (ac_ON)");
  delay(800);   // AC ko pehla frame process karne ka time (100ms me 2nd frame miss hota tha)
  blastCurrentState();
}

bool verifyChecksum(uint8_t* state, uint16_t stateLength) {
  if (stateLength < 14) return false;
  uint8_t sum = 0;
  for (uint8_t i = 0; i < 13; i++) sum += state[i];
  return sum == state[13];
}

int getTempFromState(uint8_t code) {
  switch(code) {
    case 0x0C: return 16; case 0x1C: return 17; case 0x2C: return 18;
    case 0x3C: return 19; case 0x4C: return 20; case 0x5C: return 21;
    case 0x6C: return 22; case 0x7C: return 23; case 0x8C: return 24;
    case 0x9C: return 25; case 0xAC: return 26; case 0xBC: return 27;
    case 0xCC: return 28; case 0xDC: return 29; case 0xEC: return 30;
    default: return -1;
  }
}

String getModeFromState(uint8_t byte7) {
  switch (byte7 & 0xE0) {
    case 0x00: return "auto";
    case 0x20: return "cool";
    case 0x40: return "dry";
    case 0x80: return "heat";
    case 0xC0: return "fan";
    default:   return "?";
  }
}

String getFanFromState(uint8_t byte5) {
  switch (byte5 & 0xE0) {
    case 0x20: return "turbo";
    case 0x40: return "med";
    case 0x60: return "low";
    case 0xA0: return "auto";
    default:   return "?";
  }
}

String decodeFriendlyState(uint8_t* state) {
  uint8_t category = state[12];
  bool powerOn = (state[4] & 0x40) != 0;
  int t = getTempFromState(state[1]);
  String tempStr = (t != -1) ? String(t) + "C" : "?";
  String fanStr = getFanFromState(state[5]);
  String modeStr = getModeFromState(state[7]);

  String result = powerOn ? "Power ON" : "Power OFF";
  result += "  |  Mode: " + modeStr + "  |  Fan: " + fanStr + "  |  Temp: " + tempStr;

  if (category == 0x05) result += "  (Power button)";
  else if (category == 0x04) result += "  (Fan button)";
  else if (category == 0x06) result += "  (Mode button)";
  else if (category == 0x01 || category == 0x00) result += "  (Temp button)";

  return result;
}

String identifyCommand(uint8_t* receivedState, uint16_t stateLength) {
  if (stateLength != 14) return "";
  for (uint8_t i = 0; i < numKnownCommands; i++) {
    if (memcmp(receivedState, knownCommands[i].data, 14) == 0) {
      return String(knownCommands[i].name);
    }
  }
  return "";
}

String stateToHexString(uint8_t* state, uint16_t stateLength) {
  String hex = "{";
  for (uint16_t i = 0; i < stateLength; i++) {
    char buf[6];
    snprintf(buf, sizeof(buf), "0x%02X", state[i]);
    hex += buf;
    if (i != stateLength - 1) hex += ", ";
  }
  hex += "}";
  return hex;
}

void handleReceivedIR() {
  if (results.decode_type == decode_type_t::HAIER_AC_YRW02 && results.bits >= 100) {
    uint8_t* state = results.state;
    uint16_t stateLen = results.bits / 8;

    lastRawCode = stateToHexString(state, stateLen);

    if (!verifyChecksum(state, stateLen)) {
      lastCommandName = "Weak/partial signal (ignored)";
    } else {
      String decoded = decodeFriendlyState(state);
      String exactMatch = identifyCommand(state, stateLen);
      lastCommandName = (exactMatch != "") ? (exactMatch + "  [" + decoded + "]") : decoded;

      int remoteTemp = getTempFromState(state[1]);
      String remoteMode = getModeFromState(state[7]);
      String remoteFan = getFanFromState(state[5]);
      bool remotePower = (state[4] & 0x40) != 0;

      bool mismatch = false;
      String mismatchDetails = "";

      if (remotePower != webPower) {
        mismatch = true;
        mismatchDetails += " power(" + String(remotePower ? "ON" : "OFF") + " vs " + String(webPower ? "ON" : "OFF") + ")";
      }
      if (remoteTemp != -1 && remoteTemp != webTargetTemp) {
        mismatch = true;
        mismatchDetails += " temp(" + String(remoteTemp) + "C vs " + String(webTargetTemp) + "C)";
      }
      if (remoteMode != "?" && remoteMode != webMode) {
        mismatch = true;
        mismatchDetails += " mode(" + remoteMode + " vs " + webMode + ")";
      }
      if (remoteFan != "?" && remoteFan != webFan) {
        mismatch = true;
        mismatchDetails += " fan(" + remoteFan + " vs " + webFan + ")";
      }

      if (systemLocked && mismatch) {
          Serial.println("===========================================");
          Serial.print("SYSTEM LOCKED! Remote tried to change:");
          Serial.println(mismatchDetails);
          Serial.println("Reverting AC to the webpage-set state.");
          Serial.println("===========================================");

          delay(500);
          sendCorrectedState();

          lastCommandName += " (LOCKED: reverted" + mismatchDetails + ")";
      }
    }
    lastCommandTime = millis();
  } else {
    lastCommandName = "Non-Haier / malformed signal";
    lastRawCode = "protocol: " + String(typeToString(results.decode_type)) + ", bits: " + String(results.bits);
    lastCommandTime = millis();
  }

  Serial.print("Button: ");
  Serial.print(lastCommandName);
  Serial.print("  |  Raw: ");
  Serial.println(lastRawCode);
}

// ==================== MQTT GLUE (naya — uski functions untouched) ====================
String modeAppToHaier(const String& m) {
  if (m == "Cool")    return "cool";
  if (m == "Heat")    return "heat";
  if (m == "Dry")     return "dry";
  if (m == "FanOnly") return "fan";
  if (m == "Auto")    return "auto";
  return "cool";
}
String fanAppToHaier(const String& f) {
  if (f == "Low")    return "low";
  if (f == "Medium") return "med";
  if (f == "Ultra")  return "turbo";
  if (f == "Turbo")  return "turbo";
  return "low";
}
String modeHaierToApp(const String& m) {
  if (m == "cool") return "Cool";
  if (m == "heat") return "Heat";
  if (m == "dry")  return "Dry";
  if (m == "fan")  return "FanOnly";
  if (m == "auto") return "Auto";
  return "Cool";
}
String fanHaierToApp(const String& f) {
  if (f == "low")   return "Low";
  if (f == "med")   return "Medium";
  if (f == "turbo") return "Turbo";
  return "Low";
}

String dataTopic()    { return "iotify/devices/"  + String(deviceId) + "/data"; }
String statusTopic()  { return "iotify/devices/"  + String(deviceId) + "/status"; }
String controlTopic() { return "iotify/commands/" + String(deviceId) + "/control"; }

void publishAcData() {
  if (!client.connected()) return;

  StaticJsonDocument<384> doc;
  doc["state"] = webPower ? "ON" : "OFF";
  doc["setTemperature"] = webTargetTemp;
  doc["mode"] = appMode;         // backend keywords (Cool..)
  doc["fanSpeed"] = appFan;      // backend keywords (Low..)
  doc["lock"] = systemLocked;
  doc["acHealth"] = !maintenanceAlert;   // true = healthy

  // NOTE: bs120 me real current sensor nahi — energy UI ke liye simulate.
  float currentA = webPower ? (0.5f + (random(0, 50) / 10.0f)) : 0.0f;
  doc["current"] = currentA;

  char buffer[384];
  serializeJson(doc, buffer);
  client.publish(dataTopic().c_str(), buffer);
  Serial.print("[DATA] ");
  Serial.println(buffer);
}

void sendOnlineStatus() {
  if (!client.connected()) return;
  client.publish(statusTopic().c_str(), "online", true);
  Serial.println("status -> online");
}

void applyCommand(JsonObject doc) {
  const char* command = doc["command"] | "";
  bool isReassert = doc["isLockReassert"] | false;
  bool wasOff = !webPower;

  if (isReassert) Serial.println("LOCK REASSERT from backend");
  else { Serial.print("Command: "); Serial.println(command); }

  if (strcmp(command, "ON") == 0)  { webPower = true;  preferences.putBool("power", true); }
  else if (strcmp(command, "OFF") == 0) { webPower = false; preferences.putBool("power", false); }

  if (!doc["setTemperature"].isNull()) {
    int t = doc["setTemperature"].as<int>();
    if (t >= 16 && t <= 30) { webTargetTemp = t; preferences.putInt("targetTemp", t); }
  }
  if (!doc["mode"].isNull()) {
    appMode = doc["mode"].as<String>();
    webMode = modeAppToHaier(appMode);
    preferences.putString("mode", webMode);
  }
  if (!doc["fanSpeed"].isNull()) {
    appFan = doc["fanSpeed"].as<String>();
    webFan = fanAppToHaier(appFan);
    preferences.putString("fan", webFan);
  }
  if (!doc["lock"].isNull()) {
    systemLocked = doc["lock"].as<bool>();
    preferences.putBool("locked", systemLocked);
  }

  Serial.printf("   -> state=%s temp=%d mode=%s(%s) fan=%s(%s) lock=%d\n",
                webPower ? "ON" : "OFF", webTargetTemp,
                appMode.c_str(), webMode.c_str(),
                appFan.c_str(), webFan.c_str(), systemLocked ? 1 : 0);

  // OFF → ac_OFF
  // OFF→ON transition ONLY → ac_ON phir BLAST
  // Already ON (temp/mode/fan change) → sirf BLAST (single IR, single beep)
  // NOTE: backend har settings-update me bhi command:"ON" bhejta hai (device.state),
  //       isliye "ON" string pe nahi — sirf wasOff transition pe power frame bhejo.
  if (!webPower) {
    sendIRCode(ac_OFF);
    Serial.println(">>> IR SENT: POWER OFF (ac_OFF frame)");
  } else if (wasOff) {
    Serial.println(">>> IR SENT: POWER ON (ac_ON) + full state BLAST (2 frames — expect 2 beeps)");
    sendPowerOnThenBlast();
  } else {
    Serial.println(">>> IR SENT: full state BLAST only (1 frame — expect 1 beep)");
    blastCurrentState();  // temp/mode/fan = auto Blast (no UI button)
  }
  publishAcData();
}

void callback(char* topic, byte* payload, unsigned int length) {
  // Console: backend se aaya raw payload as-is print karo
  Serial.print("<<< [BACKEND MQTT] ");
  Serial.print(topic);
  Serial.print(" : ");
  for (unsigned int i = 0; i < length; i++) Serial.print((char)payload[i]);
  Serial.println();

  StaticJsonDocument<384> doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) { Serial.println("JSON parse failed"); return; }
  if (strstr(topic, "/control") != NULL) applyCommand(doc.as<JsonObject>());
}

void handleSerialCommands() {
  if (!Serial.available()) return;
  char c = Serial.read();
  if (c == '\n' || c == '\r') return;

  if (c == '+') {
    if (webTargetTemp < 30) webTargetTemp++;
    preferences.putInt("targetTemp", webTargetTemp);
    sendCorrectedState(); publishAcData();
  } else if (c == '-') {
    if (webTargetTemp > 16) webTargetTemp--;
    preferences.putInt("targetTemp", webTargetTemp);
    sendCorrectedState(); publishAcData();
  } else if (c == 'o' || c == 'O') {
    webPower = !webPower;
    preferences.putBool("power", webPower);
    if (!webPower) {
      sendIRCode(ac_OFF);
      Serial.println("IR: POWER OFF (ac_OFF)");
    } else {
      sendPowerOnThenBlast();
    }
    publishAcData();
  } else if (c == 'u' || c == 'U') {
    systemLocked = false;
    preferences.putBool("locked", false);
    publishAcData();
  } else if (c == 'h' || c == 'H') {
    Serial.println("Keys: +/- temp | o=on/off | u=local unlock");
  }
}

void reconnect() {
  unsigned long now = millis();
  if (now - lastReconnectAttempt < 5000) return;
  lastReconnectAttempt = now;

  Serial.printf("MQTT -> %s:%d ...\n", mqtt_server, mqtt_port);
  String clientId = "ESP32-AC-" + String(deviceId);  // stable id (no flicker)

  bool ok = strlen(mqtt_user) > 0
    ? client.connect(clientId.c_str(), mqtt_user, mqtt_pass, statusTopic().c_str(), 1, true, "offline")
    : client.connect(clientId.c_str(), statusTopic().c_str(), 1, true, "offline");

  if (ok) {
    Serial.println("MQTT Connected (LOCAL)");
    sendOnlineStatus();
    client.subscribe(controlTopic().c_str());
    Serial.println(String("Subscribed: ") + controlTopic());
    publishAcData();
  } else {
    Serial.print("MQTT failed, rc=");
    Serial.println(client.state());
  }
}

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== IoTify AC (Haier IR bs120) — LOCAL MQTT ===");

  // bs120: load saved state from flash
  preferences.begin("ac_remote", false);
  systemLocked  = preferences.getBool("locked", false);
  webTargetTemp = preferences.getInt("targetTemp", 24);
  webMode       = preferences.getString("mode", "cool");
  webFan        = preferences.getString("fan", "low");
  webPower      = preferences.getBool("power", true);

  // Mirror to app-facing keywords for MQTT echo
  appMode = modeHaierToApp(webMode);
  appFan  = fanHaierToApp(webFan);

  sensors.begin();
  irsend.begin();
  irrecv.enableIRIn();

  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  WiFi.begin(ssid, password);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.print("\nWiFi OK. IP: ");
  Serial.println(WiFi.localIP());

  client.setServer(mqtt_server, mqtt_port);
  client.setBufferSize(512);
  client.setCallback(callback);
}

// ==================== LOOP ====================
void loop() {
  if (!client.connected()) { reconnect(); delay(50); return; }
  client.loop();
  handleSerialCommands();

  // --- bs120 DS18B20 vent-health (UNCHANGED logic) ---
  if (millis() - lastSensorReadTime >= 2000) {
    lastSensorReadTime = millis();

    sensors.requestTemperatures();
    float t = sensors.getTempCByIndex(0);

    if (t != DEVICE_DISCONNECTED_C) {
      if (isnan(smoothedVentTemp)) {
        smoothedVentTemp = t;
      } else {
        smoothedVentTemp = (smoothedVentTemp * 0.8) + (t * 0.2);
      }
      currentRoomTemp = smoothedVentTemp;

      if (webPower == true && webMode == "cool") {
        if (!isTracking) {
          isTracking = true;
          coolingStartTime = millis();
          lastTrackedTargetTemp = webTargetTemp;
        }
        if (webTargetTemp != lastTrackedTargetTemp) {
          coolingStartTime = millis();
          lastTrackedTargetTemp = webTargetTemp;
          maintenanceAlert = false;
        }
        if (millis() - coolingStartTime >= GRACE_PERIOD) {
          if (currentRoomTemp > MAX_HEALTHY_VENT_TEMP) {
            maintenanceAlert = true;
            Serial.printf("WARNING: Vent air is %.1fC. Compressor is failing to cool!\n", currentRoomTemp);
          } else {
            maintenanceAlert = false;
          }
        }
      } else {
        isTracking = false;
        maintenanceAlert = false;
      }
    } else {
      Serial.println(F("Failed to read from DS18B20 sensor!"));
      currentRoomTemp = NAN;
    }
  }

  // --- bs120 IR receive (lock enforce) ---
  if (irrecv.decode(&results)) {
    handleReceivedIR();
    irrecv.resume();
  }

  // --- MQTT periodic publish ---
  unsigned long now = millis();
  if (now - lastDataSend > 15000)   { lastDataSend = now; publishAcData(); }
  if (now - lastStatusSend > 30000) { lastStatusSend = now; sendOnlineStatus(); }
}
