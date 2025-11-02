#ifndef SECRET_H
#define SECRET_H

// WiFi Credentials
#define WIFI_SSID "Your-SSID-Name"
#define WIFI_PASSWORD "Your-SSID-Password"

// MQTT Broker Settings
#define MQTT_BROKER_HOST "broker.emqx.io"
#define MQTT_BROKER_PORT 1883
#define MQTT_USERNAME ""
#define MQTT_PASSWORD ""

// MQTT Topics
#define MQTT_TOPIC_DATA "dht/sensors/data"
#define MQTT_TOPIC_ACK "dht/app/ack"

// NTP Server Settings
#define NTP_SERVER "pool.ntp.org"
#define GMT_OFFSET_SEC 25200  // GMT+7 (WIB) = 7 * 3600
#define DAYLIGHT_OFFSET_SEC 0

// DHT Sensor Pin
#define DHT_PIN 4      // Change this according to your DHT11/DHT22 analog pin
#define DHT_TYPE DHT22 // Change this according to your DHT sensor types

// Device Configuration
// Remember! Only 11 characters that will be stored in db
#define DEVICE_ID "ESP32_01"  // Change this for each device

#endif // SECRET_H