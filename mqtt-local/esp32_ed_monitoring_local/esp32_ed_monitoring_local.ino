/*
 * IOTFIY ED (Energy Monitoring Device) — LOCAL monitoring
 *
 * Payload fields (monitoringProcessor ED):
 *   temperature, humidity, voltage, current [, state]
 *
 * Same local stack: hotspot + broker.mjs + backend
 * Mongo: deviceType ED + category monitoring
 *
 * Serial 115200:
 *   t  → high temperature
 *   h  → high humidity
 *   v  → high voltage (alert test)
 *   c  → high current (alert test)
 *   n  → normal values
 *   s  → send now
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

// LOCAL Mongo: deviceType ED, category monitoring
const char* deviceId = "YOUR_ED_DEVICE_ID";

const char* mqtt_user = "";
const char* mqtt_pass = "";

WiFiClient espClient;
PubSubClient client(espClient);

unsigned long lastDataSend = 0;
unsigned long lastStatusSend = 0;
unsigned long lastReconnectAttempt = 0;
bool deviceEnabled = false;

enum ForceMode { FORCE_NONE, FORCE_TEMP, FORCE_HUM, FORCE_VOLT, FORCE_CURR };
ForceMode forceMode = FORCE_NONE;

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

void publishSensorData() {
  if (!client.connected()) return;

  float temperature = 25.0 + random(0, 50) / 10.0;
  float humidity = 45.0 + random(0, 100) / 10.0;
  float voltage = 220.0 + random(-20, 21) / 10.0;   // ~218–222 V
  float currentA = deviceEnabled
    ? (0.5f + random(0, 50) / 10.0f)                 // ~0.5–5.5 A when "ON"
    : (0.05f + random(0, 10) / 100.0f);              // idle

  if (forceMode == FORCE_TEMP) {
    temperature = 45.0 + random(0, 50) / 10.0;
  } else if (forceMode == FORCE_HUM) {
    humidity = 90.0 + random(0, 50) / 10.0;
  } else if (forceMode == FORCE_VOLT) {
    voltage = 260.0 + random(0, 100) / 10.0;         // high V
  } else if (forceMode == FORCE_CURR) {
    currentA = 12.0 + random(0, 50) / 10.0;          // high A
  }

  StaticJsonDocument<256> doc;
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["voltage"] = voltage;
  doc["current"] = currentA;
  doc["state"] = deviceEnabled ? "ON" : "OFF";

  char buffer[256];
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

void sendCurrentState() {
  if (!client.connected()) return;
  StaticJsonDocument<64> doc;
  doc["state"] = deviceEnabled ? "ON" : "OFF";
  char buffer[64];
  serializeJson(doc, buffer);
  client.publish(dataTopic().c_str(), buffer);
}

void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("📥 on ");
  Serial.println(topic);

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, payload, length)) return;

  if (strstr(topic, "/control") != NULL) {
    const char* command = doc["command"] | "";
    if (strcmp(command, "ON") == 0) deviceEnabled = true;
    else if (strcmp(command, "OFF") == 0) deviceEnabled = false;
    sendCurrentState();
    publishSensorData();
  }
}

void handleSerial() {
  if (!Serial.available()) return;
  char c = Serial.read();
  if (c == '\n' || c == '\r') return;

  if (c == 't' || c == 'T') {
    forceMode = FORCE_TEMP;
    Serial.println("🚨 FORCE high temperature");
    publishSensorData();
  } else if (c == 'h' || c == 'H') {
    forceMode = FORCE_HUM;
    Serial.println("🚨 FORCE high humidity");
    publishSensorData();
  } else if (c == 'v' || c == 'V') {
    forceMode = FORCE_VOLT;
    Serial.println("🚨 FORCE high voltage");
    publishSensorData();
  } else if (c == 'c' || c == 'C') {
    forceMode = FORCE_CURR;
    Serial.println("🚨 FORCE high current");
    publishSensorData();
  } else if (c == 'n' || c == 'N') {
    forceMode = FORCE_NONE;
    Serial.println("✅ Normal values");
    publishSensorData();
  } else if (c == 's' || c == 'S') {
    publishSensorData();
  } else if (c == '?') {
    Serial.println("Keys: t temp | h hum | v voltage | c current | n normal | s send");
  }
}

void reconnect() {
  unsigned long now = millis();
  if (now - lastReconnectAttempt < 5000) return;
  lastReconnectAttempt = now;

  String clientId = "ESP32-ED-" + String(deviceId);
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
    publishSensorData();
  } else {
    Serial.print("❌ MQTT failed, rc=");
    Serial.println(client.state());
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== IOTFIY ED Energy Monitoring — LOCAL ===");
  Serial.println("Keys: t/h/v/c force | n normal | s send | ? help");

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
  handleSerial();

  unsigned long now = millis();
  if (now - lastDataSend > 15000) {
    lastDataSend = now;
    publishSensorData();
  }
  if (now - lastStatusSend > 30000) {
    lastStatusSend = now;
    sendOnlineStatus();
  }
  delay(20);
}
