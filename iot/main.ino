// DHT Logger Source Code
// Version: 0.0.1

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <time.h>

#include "secret.h"

// Initialize DHT sensor using defines from secret.h
DHT dht(DHT_PIN, DHT_TYPE);

WiFiClientSecure espClient;
PubSubClient client(espClient);

String mac_address;

void setup() {
  Serial.begin(115200);
  
  // Connect to WiFi using credentials from secret.h
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("📡 Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi connected");
  Serial.print("📍 IP Address: ");
  Serial.println(WiFi.localIP());

  // Get MAC address
  mac_address = WiFi.macAddress();
  Serial.print("🔌 MAC Address: ");
  Serial.println(mac_address);
  
  // Initialize NTP
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
  Serial.println("⏰ Waiting for NTP time sync...");
  
  struct tm timeinfo;
  int retry = 0;
  while (!getLocalTime(&timeinfo) && retry < 10) {
    delay(1000);
    Serial.print(".");
    retry++;
  }
  
  if (retry < 10) {
    Serial.println("\n✅ Time synchronized");
    Serial.println(&timeinfo, "📅 Current time: %Y-%m-%d %H:%M:%S");
  } else {
    Serial.println("\n❌ Failed to sync time");
  }
  
  // Setup MQTT
  espClient.setInsecure(); // Skip certificate validation (for testing)
  client.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  client.setKeepAlive(60); // ← SET KEEP-ALIVE TO 60 SECONDS
  client.setCallback(callback);
  
  // Initialize DHT sensor
  dht.begin();
  Serial.println("🌡️ DHT sensor initialized");
  
  reconnect();
}

void callback(char* topic, byte* payload, unsigned int length) {
  // Print separator for better readability
 
  Serial.print("=== 📨 ACK Message Received from Topic: ");
  Serial.print(topic);
  Serial.print(" ===");
  Serial.println();

  // Convert payload to String
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  // Parse JSON data
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, message);
  
  if (error) {
    Serial.println("❌ JSON Parse Error!");
    Serial.print("Error: ");
    Serial.println(error.c_str());
    return;
  }
  
  // Extract fields from JSON
  bool success = doc["success"] | false;
  const char* device_id = doc["device_id"] | "N/A";
  const char* mac_addr = doc["mac_address"] | "N/A";
  const char* timestamp = doc["timestamp"] | "N/A";
  
  // Print parsed data
  Serial.print("🆔 Device ID: ");
  Serial.println(device_id);
  Serial.print("💻 MAC Address: ");
  Serial.println(mac_addr);
  Serial.print("🕒 Timestamp: ");
  Serial.println(timestamp);
  
  // Check success status
  if (success) {
    // Success case
    int log_id = doc["log_id"] | 0;
    const char* message_text = doc["message"] | "Data logged successfully";
    
    Serial.println("✅ Status: SUCCESS");
    Serial.print("📊 Log ID: ");
    Serial.println(log_id);
    Serial.print("🧾 Message: ");
    Serial.println(message_text);
    Serial.println("🎉 Data successfully saved to database!");
    
  } else {
    // Failure case
    const char* error_msg = doc["error"] | "Unknown error";
    
    Serial.println("❌ Status: FAILED");
    Serial.print("👉 Error: ");
    Serial.println(error_msg);
    Serial.println("⚠️ Data was NOT saved to database!");
  }
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("🔌 Connecting to MQTT broker...");
    
    String clientId = "ESP32_DHT_" + mac_address;
    clientId.replace(":", ""); // Remove colons from MAC address
    
    if (client.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
      Serial.println("connected ✅");
      client.subscribe(MQTT_TOPIC_ACK);
      Serial.printf("📡 Subscribed to: %s\n", MQTT_TOPIC_ACK);
    } else {
      Serial.print("failed ❌, rc=");
      Serial.print(client.state());
      Serial.println(" retrying in 5 seconds...");
      delay(5000);
    }
  }
}

String getISOTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("⚠️ Failed to get time");
    return "";
  }
  
  char buffer[25];
  // Format: "2025-01-11T12:30:45"
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%S", &timeinfo);
  
  return String(buffer);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
  
  // Read sensor data
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();
  
  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("❌ Failed to read from DHT sensor!");
    delay(2000);
    return;
  }
  
  // Get ISO timestamp string
  String timestamp = getISOTimestamp();
  
  if (timestamp == "") {
    Serial.println("⚠️ No valid timestamp, skipping send");
    delay(5000);
    return;
  }
  
  // Create JSON payload
  StaticJsonDocument<256> doc;
  doc["device_id"] = DEVICE_ID;
  doc["mac_address"] = mac_address;
  doc["temperature"] = round(temperature * 10) / 10.0;
  doc["humidity"] = round(humidity * 10) / 10.0;
  doc["timestamp"] = timestamp;
  
  String payload;
  serializeJson(doc, payload);
  
  // Publish to MQTT
  Serial.println("\n📤 Publishing data:");
  Serial.println(payload);
  
  if (client.publish(MQTT_TOPIC_DATA, payload.c_str(), false)) {
    Serial.println("✅ Published successfully");
  } else {
    Serial.println("❌ Publish failed");
  }
  
  // NON-BLOCKING DELAY: Keep calling client.loop() during wait
  unsigned long startWait = millis();
  while (millis() - startWait < 30000) {  // Wait 30 seconds
    if (!client.connected()) {
      reconnect();
    }
    client.loop();  // Keep processing MQTT messages
    delay(100);     // Small delay to prevent watchdog timeout
  }
}