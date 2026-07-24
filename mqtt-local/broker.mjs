/**
 * Local MQTT broker for Windows Mobile Hotspot testing.
 * aedes v1 API: Aedes.createBroker()
 *
 * Usage:
 *   docker stop ecosystem-mosquitto
 *   node mqtt-local/broker.mjs
 *   Then restart backend: npm start
 */
import { createServer } from "node:net";
import { Aedes } from "aedes";

const PORT = Number(process.env.MQTT_PORT) || 1883;
const HOST = "0.0.0.0";

const aedes = await Aedes.createBroker();
const server = createServer(aedes.handle);

server.listen(PORT, HOST, () => {
  console.log(`✅ Local MQTT broker listening on ${HOST}:${PORT}`);
  console.log(`   ESP mqtt_server = "192.168.137.1" (PC hotspot IP)`);
});

aedes.on("client", (client) => {
  console.log(`🔌 Client connected: ${client.id}`);
});

aedes.on("clientDisconnect", (client) => {
  console.log(`🔌 Client disconnected: ${client.id}`);
});

aedes.on("publish", (packet, client) => {
  if (!client) return;
  const topic = packet.topic || "";
  if (
    topic.includes("/data") ||
    topic.includes("/status") ||
    topic.includes("/control")
  ) {
    console.log(
      `📨 ${client.id} → ${topic}: ${packet.payload.toString().slice(0, 120)}`
    );
  }
});

server.on("error", (err) => {
  console.error("❌ Broker error:", err.message);
  if (err.code === "EADDRINUSE") {
    console.error("   Port 1883 busy — run: docker stop ecosystem-mosquitto");
  }
  process.exit(1);
});
