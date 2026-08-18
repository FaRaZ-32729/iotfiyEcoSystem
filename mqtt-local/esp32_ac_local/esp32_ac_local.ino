/*
 * IOTFIY AC Device — LOCAL testing + LOCK REASSERT
 *
 * Lock verify (Serial Monitor 115200):
 *   1. Dashboard pe Lock ON (app se)
 *   2. Serial me type:  r   (+ Enter)
 *      → ESP "remote" temp change simulate karke publish karega
 *   3. Backend log: "AC locked — remote setTemp ... re-asserting"
 *   4. Serial: "🔒 LOCK REASSERT" + setTemp wapas app wali
 *
 * Other Serial keys:
 *   u  → unlock locally (test only)
 *   + / - → change setTemp by 1 (like unlocked remote)
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ==================== WIFI (PC Mobile Hotspot) ====================
const char* ssid = "IOTFIY8";
const char* password = "12345678";

// ==================== LOCAL MQTT ====================
const char* mqtt_server = "192.168.137.1";
const int mqtt_port = 1883;
const char* deviceId = "FCJG5O";
const char* mqtt_user = "";
const char* mqtt_pass = "";

// ==================== AC STATE ====================
WiFiClient espClient;
PubSubClient client(espClient);

bool deviceEnabled = false;
int setTemperature = 26;
String acMode = "Cool";
String fanSpeed = "Low";
bool acLocked = false;
bool acHealthy = true;  // true = healthy → no UI alert

unsigned long lastDataSend = 0;
unsigned long lastStatusSend = 0;
unsigned long lastReconnectAttempt = 0;

String dataTopic() {
  return "iotify/devices/" + String(deviceId) + "/data";
}
String statusTopic() {
  return "iotify/devices/" + String(deviceId) + "/status";
}
String controlTopic() {
  return "iotify/commands/" + String(deviceId) + "/control";
}

void setupWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi Connected!");
  Serial.print("📡 ESP IP: ");
  Serial.println(WiFi.localIP());
}

void publishAcData() {
  if (!client.connected()) return;

  StaticJsonDocument<384> doc;
  doc["state"] = deviceEnabled ? "ON" : "OFF";
  doc["setTemperature"] = setTemperature;
  doc["mode"] = acMode;
  doc["fanSpeed"] = fanSpeed;
  doc["lock"] = acLocked;
  doc["acHealth"] = acHealthy;

  float currentA = deviceEnabled ? (0.5f + (random(0, 50) / 10.0f)) : 0.0f;
  doc["current"] = currentA;

  char buffer[384];
  serializeJson(doc, buffer);
  client.publish(dataTopic().c_str(), buffer);
  Serial.print("📤 [DATA] ");
  Serial.println(buffer);
}

void sendOnlineStatus() {
  if (!client.connected()) return;
  client.publish(statusTopic().c_str(), "online", true);
  Serial.println("📤 status → online");
}

/** Simulate physical IR remote changing setpoint while locked */
void simulateRemoteTempChange() {
  int oldTemp = setTemperature;
  int remoteTemp = setTemperature + 2;
  if (remoteTemp > 30) remoteTemp = 16;
  setTemperature = remoteTemp;

  Serial.println("========================================");
  Serial.printf("🎮 REMOTE SIM: setTemp %d → %d (lock=%d)\n",
                oldTemp, setTemperature, acLocked ? 1 : 0);
  Serial.println("   Backend should REASSERT if locked.");
  Serial.println("========================================");

  // Report "wrong" temp to cloud — backend reasserts if acLocked in DB
  publishAcData();
}

void applyCommand(JsonObject doc) {
  const char* command = doc["command"] | "";
  bool isReassert = doc["isLockReassert"] | false;

  if (isReassert) {
    Serial.println("🔒 LOCK REASSERT received from backend");
  } else {
    Serial.print("✅ Command: ");
    Serial.println(command);
  }

  if (strcmp(command, "ON") == 0) {
    deviceEnabled = true;
  } else if (strcmp(command, "OFF") == 0) {
    deviceEnabled = false;
  }

  if (!doc["setTemperature"].isNull()) {
    int t = doc["setTemperature"].as<int>();
    if (t >= 16 && t <= 30) {
      Serial.printf("   setTemp apply: %d → %d%s\n",
                    setTemperature, t,
                    isReassert ? " (reassert)" : "");
      setTemperature = t;
    }
  }
  if (!doc["mode"].isNull()) acMode = doc["mode"].as<String>();
  if (!doc["fanSpeed"].isNull()) fanSpeed = doc["fanSpeed"].as<String>();
  if (!doc["lock"].isNull()) {
    acLocked = doc["lock"].as<bool>();
    Serial.printf("   lock → %s\n", acLocked ? "LOCKED" : "UNLOCKED");
  }

  Serial.printf("   state=%s setTemp=%d mode=%s fan=%s lock=%d\n",
                deviceEnabled ? "ON" : "OFF",
                setTemperature,
                acMode.c_str(),
                fanSpeed.c_str(),
                acLocked ? 1 : 0);

  publishAcData();
}

void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("📥 on ");
  Serial.println(topic);

  StaticJsonDocument<384> doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.println("❌ JSON parse failed");
    return;
  }

  if (strstr(topic, "/control") != NULL) {
    applyCommand(doc.as<JsonObject>());
  }
}

void handleSerialCommands() {
  if (!Serial.available()) return;
  char c = Serial.read();
  if (c == '\n' || c == '\r') return;

  if (c == 'r' || c == 'R') {
    simulateRemoteTempChange();
  } else if (c == '+') {
    if (setTemperature < 30) setTemperature++;
    Serial.printf("Manual + → %d\n", setTemperature);
    publishAcData();
  } else if (c == '-') {
    if (setTemperature > 16) setTemperature--;
    Serial.printf("Manual - → %d\n", setTemperature);
    publishAcData();
  } else if (c == 'u' || c == 'U') {
    acLocked = false;
    Serial.println("Local unlock (ESP only) — prefer Unlock from dashboard");
    publishAcData();
  } else if (c == 'h' || c == 'H') {
    Serial.println("Keys: r=remote sim | +/-=temp | u=local unlock");
  }
}

void reconnect() {
  unsigned long now = millis();
  if (now - lastReconnectAttempt < 5000) return;
  lastReconnectAttempt = now;

  Serial.printf("🔄 MQTT → %s:%d ...\n", mqtt_server, mqtt_port);
  String clientId = "ESP32-AC-" + String(deviceId) + "-" + String(random(0xffff), HEX);

  bool ok = client.connect(
    clientId.c_str(),
    statusTopic().c_str(),
    1,
    true,
    "offline"
  );

  if (ok) {
    Serial.println("✅ MQTT Connected (LOCAL)");
    sendOnlineStatus();
    client.subscribe(controlTopic().c_str());
    Serial.println(String("📡 Subscribed: ") + controlTopic());
    Serial.println("💡 Type 'r' + Enter to simulate remote temp change");
    publishAcData();
  } else {
    Serial.print("❌ MQTT failed, rc=");
    Serial.println(client.state());
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== IOTFIY AC — LOCK REASSERT TEST ===");

  setupWiFi();
  client.setServer(mqtt_server, mqtt_port);
  client.setBufferSize(512);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) {
    reconnect();
    delay(50);
    return;
  }
  client.loop();
  handleSerialCommands();

  unsigned long now = millis();

  if (now - lastDataSend > 15000) {
    lastDataSend = now;
    publishAcData();
  }

  if (now - lastStatusSend > 30000) {
    lastStatusSend = now;
    sendOnlineStatus();
  }

  delay(20);
}
