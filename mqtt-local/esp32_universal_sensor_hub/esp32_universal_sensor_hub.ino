/*
 * IoTify SMD SCHEDULING — Hostinger live
 * Device: 0OBNGI  (SMDSch)
 * Payload: smoke (%), state
 * Status heartbeat every 30s (needed for live CURRENT event on dashboard)
 * Listens: iotify/commands/0OBNGI/control  { "command": "ON"|"OFF" }
 * Serial: s = send now
 *         m = force high smoke next packets
 *         n = normal smoke again
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const char* ssid = "IOTFIY8";
const char* password = "12345678";

const char* mqtt_server = "ecosystem.iotfiysolutions.com";
// const char* mqtt_server = "72.62.146.208"; // use if DNS fails (rc=-2)
const int mqtt_port = 1883;
const char* mqtt_user = "mqttuser";
const char* mqtt_pass = "Growmore12345@";

const char* deviceId = "0OBNGI"; // SMDSch

WiFiClient espClient;
PubSubClient client(espClient);

unsigned long lastDataSend = 0;
unsigned long lastStatusSend = 0;
unsigned long lastReconnectAttempt = 0;
bool deviceEnabled = false;
bool forceHighSmoke = false;

const unsigned long DATA_INTERVAL_MS = 15000;
const unsigned long STATUS_INTERVAL_MS = 30000;

String dataTopic()    { return String("iotify/devices/") + deviceId + "/data"; }
String statusTopic()  { return String("iotify/devices/") + deviceId + "/status"; }
String controlTopic() { return String("iotify/commands/") + deviceId + "/control"; }

void setupWiFi() {
  Serial.print("WiFi: ");
  Serial.println(ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

void sendOnlineStatus() {
  bool ok = client.publish(statusTopic().c_str(), "online", true);
  Serial.println(ok ? "status → online" : "status FAILED");
}

void sendCurrentState() {
  StaticJsonDocument<96> doc;
  doc["state"] = deviceEnabled ? "ON" : "OFF";
  char buf[96];
  serializeJson(doc, buf);
  client.publish(dataTopic().c_str(), buf);
  Serial.print("state → ");
  Serial.println(deviceEnabled ? "ON" : "OFF");
}

void publishSensorData() {
  int smoke = forceHighSmoke ? (70 + random(0, 25)) : random(5, 40);

  StaticJsonDocument<128> doc;
  doc["smoke"] = smoke;
  doc["state"] = deviceEnabled ? "ON" : "OFF";

  char buf[128];
  serializeJson(doc, buf);
  bool ok = client.publish(dataTopic().c_str(), buf);
  Serial.print(ok ? "OK  " : "FAIL ");
  Serial.print(deviceId);
  Serial.print("  ");
  Serial.println(buf);
}

void callback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];

  Serial.print("CMD ");
  Serial.print(topic);
  Serial.print(" → ");
  Serial.println(message);

  if (strstr(topic, "/control") == NULL) return;

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, message)) return;

  String command = doc["command"] | "";
  command.toUpperCase();

  if (command == "ON") {
    deviceEnabled = true;
    Serial.println("STATE → ON");
  } else if (command == "OFF") {
    deviceEnabled = false;
    Serial.println("STATE → OFF");
  } else {
    return;
  }

  sendCurrentState();
  delay(30);
  publishSensorData();
}

void reconnect() {
  unsigned long now = millis();
  if (now - lastReconnectAttempt < 5000) return;
  lastReconnectAttempt = now;

  String clientId = "ESP32-SMD-SCH-" + String(random(0xffff), HEX);
  String will = statusTopic();

  Serial.println("MQTT connecting...");
  if (!client.connect(clientId.c_str(), mqtt_user, mqtt_pass, will.c_str(), 1, true, "offline")) {
    Serial.print("MQTT fail rc=");
    Serial.println(client.state());
    return;
  }

  Serial.println("MQTT connected");
  sendOnlineStatus();
  client.subscribe(controlTopic().c_str(), 1);
  Serial.println("sub control");
}

void setup() {
  Serial.begin(115200);
  delay(500);
  randomSeed(millis());

  Serial.println("\nSMD SCHEDULING → 0OBNGI");
  Serial.println("fields: smoke, state");
  Serial.println("status heartbeat: 30s");
  Serial.println("serial: s=send  m=high smoke  n=normal\n");

  setupWiFi();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setKeepAlive(60);

  WiFi.onEvent([](WiFiEvent_t event) {
    if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
      Serial.println("WiFi lost → offline");
      if (client.connected()) {
        client.publish(statusTopic().c_str(), "offline", true);
      }
    }
  }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) setupWiFi();
  if (!client.connected()) reconnect();
  client.loop();

  if (Serial.available()) {
    char c = (char)Serial.read();
    if (c == 's' || c == 'S') {
      publishSensorData();
    } else if (c == 'm' || c == 'M') {
      forceHighSmoke = true;
      Serial.println("next smoke → HIGH");
    } else if (c == 'n' || c == 'N') {
      forceHighSmoke = false;
      Serial.println("next smoke → normal");
    }
  }

  unsigned long now = millis();

  if (client.connected() && now - lastDataSend >= DATA_INTERVAL_MS) {
    lastDataSend = now;
    publishSensorData();
  }

  if (client.connected() && now - lastStatusSend >= STATUS_INTERVAL_MS) {
    lastStatusSend = now;
    sendOnlineStatus();
  }

  delay(20);
}
