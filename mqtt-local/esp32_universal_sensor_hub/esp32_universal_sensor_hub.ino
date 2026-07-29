/*
 * IoTify THD SCHEDULING only — Hostinger live
 * Device: E6SYLQ  (TDCategoryScheduling)
 * Payload: temperature, humidity, state
 * Listens: iotify/commands/E6SYLQ/control  { "command": "ON"|"OFF" }
 * Serial: s = send now
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const char* ssid = "FaRaZ";
const char* password = "faraz32729";

const char* mqtt_server = "72.62.146.208"; // ecosystem.iotfiysolutions.com
const int mqtt_port = 1883;
const char* mqtt_user = "mqttuser";
const char* mqtt_pass = "Growmore12345@";

const char* deviceId = "E6SYLQ"; // TDCategoryScheduling — scheduling

WiFiClient espClient;
PubSubClient client(espClient);

bool deviceEnabled = false;
unsigned long lastData = 0;
unsigned long lastReconnect = 0;

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

void publishData() {
  float temperature = 24.0 + random(0, 60) / 10.0;
  float humidity = 45.0 + random(0, 200) / 10.0;

  StaticJsonDocument<160> doc;
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["state"] = deviceEnabled ? "ON" : "OFF";

  char buf[160];
  serializeJson(doc, buf);

  bool ok = client.publish(dataTopic().c_str(), buf);
  Serial.print(ok ? "OK  " : "FAIL ");
  Serial.print(deviceId);
  Serial.print("  ");
  Serial.println(buf);
}

void callback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  Serial.print("CMD ");
  Serial.print(topic);
  Serial.print(" → ");
  Serial.println(msg);

  StaticJsonDocument<192> doc;
  if (deserializeJson(doc, msg)) {
    Serial.println("bad JSON");
    return;
  }

  String command = doc["command"] | "";
  command.toUpperCase();

  if (command == "ON") {
    deviceEnabled = true;
    Serial.println("STATE → ON");
  } else if (command == "OFF") {
    deviceEnabled = false;
    Serial.println("STATE → OFF");
  } else {
    Serial.println("unknown command");
    return;
  }

  publishData();
}

void reconnect() {
  if (millis() - lastReconnect < 5000) return;
  lastReconnect = millis();

  String clientId = "ESP32-THD-SCH-" + String(random(0xffff), HEX);
  String will = statusTopic();

  Serial.println("MQTT connecting...");
  if (!client.connect(clientId.c_str(), mqtt_user, mqtt_pass, will.c_str(), 1, true, "offline")) {
    Serial.print("MQTT fail rc=");
    Serial.println(client.state());
    return;
  }

  client.publish(will.c_str(), "online", true);
  client.subscribe(controlTopic().c_str(), 1);
  Serial.println("MQTT connected + online + subscribed control");
}

void setup() {
  Serial.begin(115200);
  delay(500);
  randomSeed(millis());

  Serial.println("\nTHD SCHEDULING only → E6SYLQ");
  setupWiFi();

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setKeepAlive(60);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) setupWiFi();
  if (!client.connected()) reconnect();
  client.loop();

  if (Serial.available()) {
    char c = (char)Serial.read();
    if (c == 's' || c == 'S') publishData();
  }

  if (client.connected() && millis() - lastData > 15000) {
    lastData = millis();
    publishData();
  }

  delay(20);
}
