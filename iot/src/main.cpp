// DHT Logger Source Code
// Version: 1.0.0

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <time.h>
#include <HTTPClient.h>

#include "secret.h"

// Initialize DHT sensor using defines from secret.h
DHT dht(DHT_PIN, DHT_TYPE);
WiFiClientSecure espClient;
PubSubClient client(espClient);
String mac_address;

// Flag to prevent spamming alerts in Telegram
bool alertSent = false;
unsigned long lastAlertTime = 0;
const signed long ALERT_COOLDOWN = 300000; // 5 minutes cooldown

float TEMP_MAX_THRESHOLD = 30.0;
float HUMI_MAX_THRESHOLD = 75.0;

void reconnect() {
  while (!client.connected()) {
    Serial.print("🔌 Connecting to MQTT broker...");
    String clientId = "ESP32_DHT_" + mac_address;
    clientId.replace(":", "");
    
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

void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("=== 📨 ACK Message Received from Topic: ");
  Serial.print(topic);
  Serial.print(" ===");
  Serial.println();
  
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, message);
  
  if (error) {
    Serial.println("❌ JSON Parse Error!");
    Serial.print("Error: ");
    Serial.println(error.c_str());
    return;
  }
  
  bool success = doc["success"] | false;
  const char* device_id = doc["device_id"] | "N/A";
  const char* mac_addr = doc["mac_address"] | "N/A";
  const char* timestamp = doc["timestamp"] | "N/A";
  
  Serial.print("🆔 Device ID: ");
  Serial.println(device_id);
  Serial.print("💻 MAC Address: ");
  Serial.println(mac_addr);
  Serial.print("🕒 Timestamp: ");
  Serial.println(timestamp);
  
  if (success) {
    int log_id = doc["log_id"] | 0;
    const char* message_text = doc["message"] | "Data logged successfully";
    Serial.println("✅ Status: SUCCESS");
    Serial.print("📊 Log ID: ");
    Serial.println(log_id);
    Serial.print("🧾 Message: ");
    Serial.println(message_text);
    Serial.println("🎉 Data successfully saved to database!");
  } else {
    const char* error_msg = doc["error"] | "Unknown error";
    Serial.println("❌ Status: FAILED");
    Serial.print("👉 Error: ");
    Serial.println(error_msg);
    Serial.println("⚠️ Data was NOT saved to database!");
  }
}

String getISOTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("⚠️ Failed to get time");
    return "";
  }
  
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%S", &timeinfo);
  return String(buffer);
}

// ===========================================
// v0.1.1: Send Alert Notification to Telegram
// ===========================================
bool sendTelegramAlert(float temperature, float humidity) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ WiFi not connected!");
    return false;
  }

  // Build alert message
  String message = "⚠️ *ALERT: Threshold Exceeded!*\n\n";  // ← Fixed: single \n
  message += "🌡️ *Temperature:* " + String(temperature, 1) + "°C\n";
  message += "💧 *Humidity:* " + String(humidity, 1) + "%\n";
  message += "🕒 *Time:* " + getISOTimestamp() + "\n";
  message += "💻 *Device ID:* " + String(DEVICE_ID) + "\n\n";
  
  // Check which threshold exceeded
  if (temperature >= TEMP_MAX_THRESHOLD) {
    message += "🔥INFO: Temperature Threshold >= " + String(TEMP_MAX_THRESHOLD, 1) + "°C\n";
  }
  if (humidity >= HUMI_MAX_THRESHOLD) {
    message += "💦INFO: Humidity Threshold >= " + String(HUMI_MAX_THRESHOLD, 1) + "%\n";
  }

  // Prepare HTTP client
  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();
  
  String url = "https://api.telegram.org/bot";
  url += TELEGRAM_BOT_TOKEN;
  url += "/sendMessage";

  bool overallSuccess = true;
  int successCount = 0;
  int totalTargets = 0;

  // Send alert notification to Telegram
  #ifdef TELEGRAM_CHAT_ID
    totalTargets++;
    Serial.println("💬 Sending Alert Notification to Telegram...");
    
    JsonDocument doc;
    doc["chat_id"] = String(TELEGRAM_CHAT_ID);
    doc["text"] = message;
    doc["parse_mode"] = "Markdown";
    
    String payload;
    serializeJson(doc, payload);
    
    http.begin(client, url);
    http.addHeader("Content-Type", "application/json");
    int httpCode = http.POST(payload);
    
    if (httpCode > 0) {
      Serial.println("✅ Sent alarm notification (Code: " + String(httpCode) + ")");
      successCount++;
    } else {
      Serial.println("❌ Failed to send alarm notification");
      overallSuccess = false;
    }
    http.end();
  #endif

  // Summary of alert notifications
  Serial.printf("📊 Telegram Alert Summary: %d/%d sent successfully\n", successCount, totalTargets);
  
  return overallSuccess;
}

void setup() {
  Serial.begin(115200);
  
  // Connect to WiFi using credentials from secret.h
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 0, NULL, true);
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
  espClient.setInsecure();
  client.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  client.setKeepAlive(60);
  client.setCallback(callback);
  
  // Initialize DHT sensor
  dht.begin();
  Serial.println("🌡️ DHT sensor initialized");
  
  reconnect();
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
  
  // ======================================================
  // v0.1.1: Check threshold and send Telegram alert
  // ======================================================
  bool thresholdExceeded = (temperature >= TEMP_MAX_THRESHOLD) || 
                            (humidity >= HUMI_MAX_THRESHOLD);
  
  unsigned long currentTime = millis();
  bool cooldownPassed = (currentTime - lastAlertTime) >= ALERT_COOLDOWN;
  
  if (thresholdExceeded && (!alertSent || cooldownPassed)) {
    Serial.println("\n🚨 THRESHOLD EXCEEDED! Sending alert...");
    if (sendTelegramAlert(temperature, humidity)) {
      alertSent = true;
      lastAlertTime = currentTime;
    }
  } else if (!thresholdExceeded && alertSent) {
    // Reset flag when values return to normal
    alertSent = false;
    Serial.println("✅ Values returned to normal range");
  }
  // ============================================================
  
  // Get ISO timestamp string
  String timestamp = getISOTimestamp();
  if (timestamp == "") {
    Serial.println("⚠️ No valid timestamp, skipping send");
    delay(5000);
    return;
  }
  
  // Create JSON payload
  JsonDocument doc;
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
  while (millis() - startWait < 1800000) { // v0.1.2: Send data every 30 minutes (1800000 ms)
    if (!client.connected()) {
      reconnect();
    }
    client.loop();
    delay(100);
  }
}