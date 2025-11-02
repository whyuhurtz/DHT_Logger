import aiomqtt
import asyncio
import json
import logging
import ssl
from typing import Optional
from datetime import datetime

from src.config import get_settings
from src.models import insert_sensor_data_from_mqtt

logger = logging.getLogger(__name__)
env = get_settings()

# Add this import at the top
broadcast_callback = None

async def set_broadcast_callback(callback):
  """Set callback function for broadcasting new data"""
  global broadcast_callback
  broadcast_callback = callback


class MQTTClient:
  def __init__(self):
    self.client: Optional[aiomqtt.Client] = None
    self.task: Optional[asyncio.Task] = None
    self._stop_event = asyncio.Event()

  async def connect(self):
    """Connect to MQTT broker with TLS"""
    try:
      # Setup TLS context
      tls_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
      tls_context.load_verify_locations(cafile=env.MQTT_CA_CERT_FILE)
      tls_context.check_hostname = False
      tls_context.verify_mode = ssl.CERT_REQUIRED

      # Create client with TLS
      tls_params = aiomqtt.TLSParameters(
        ca_certs=env.MQTT_CA_CERT_FILE,
        certfile=None,
        keyfile=None,
        cert_reqs=ssl.CERT_REQUIRED,
        tls_version=ssl.PROTOCOL_TLS,
        ciphers=None
      )

      # Build client parameters
      client_params = {
        "hostname": env.MQTT_BROKER_URL,
        "port": env.MQTT_BROKER_PORT,
        "keepalive": env.MQTT_KEEPALIVE,
        "tls_params": tls_params
      }

      # Add credentials if provided
      if env.MQTT_USERNAME and env.MQTT_PASSWORD:
        client_params["username"] = env.MQTT_USERNAME
        client_params["password"] = env.MQTT_PASSWORD

      self.client = aiomqtt.Client(**client_params)

      logger.info(f"🔌 Connecting to MQTT broker: {env.MQTT_BROKER_URL}:{env.MQTT_BROKER_PORT}")
      await self.client.__aenter__()
      logger.info("✅ Connected to MQTT broker")

      # Start message listener
      self.task = asyncio.create_task(self._message_listener())

    except Exception as e:
      logger.error(f"❌ Failed to connect to MQTT broker: {e}")
      raise

  async def disconnect(self):
    """Disconnect from MQTT broker"""
    try:
      self._stop_event.set()

      if self.task:
        self.task.cancel()
        try:
          await self.task
        except asyncio.CancelledError:
          pass

      if self.client:
        await self.client.__aexit__(None, None, None)
        logger.info("🔒 Disconnected from MQTT broker")

    except Exception as e:
      logger.error(f"❌ Error during MQTT disconnect: {e}")

  async def _message_listener(self):
    """Listen for incoming MQTT messages"""
    try:
      # Check if client exists
      if not self.client:
        logger.error("❌ MQTT client not initialized")
        return

      await self.client.subscribe(env.MQTT_TOPIC_SENSOR_DATA, qos=env.MQTT_QOS)
      logger.info(f"📡 Subscribed to topic: {env.MQTT_TOPIC_SENSOR_DATA}")

      async for message in self.client.messages:
        if self._stop_event.is_set():
          break

        # Process message in background to not block listener
        asyncio.create_task(self._handle_message(message))

    except asyncio.CancelledError:
      logger.info("📴 MQTT listener cancelled")
    except Exception as e:
      logger.error(f"❌ Error in MQTT listener: {e}")

  async def _handle_message(self, message: aiomqtt.Message):
    """Handle incoming MQTT message"""
    try:
      # Decode payload - handle bytes or str
      if isinstance(message.payload, bytes):
        payload = message.payload.decode('utf-8')
      elif isinstance(message.payload, str):
        payload = message.payload
      else:
        payload = str(message.payload)

      logger.info(f"📨 Received message on {message.topic}: {payload}")

      # Parse JSON
      data = json.loads(payload)

      # Validate required fields
      required_fields = ["device_id", "mac_address", "temperature", "humidity", "timestamp"]
      missing_fields = [field for field in required_fields if field not in data]

      if missing_fields:
        logger.error(f"❌ Missing required fields: {missing_fields}")
        await self._send_ack(
          success=False,
          device_id=data.get("device_id"),
          mac_address=data.get("mac_address"),
          timestamp=data.get("timestamp"),
          error=f"Missing fields: {missing_fields}"
        )
        return

      # Extract and validate data
      device_id = str(data["device_id"])
      mac_address = str(data["mac_address"])
      temperature = float(data["temperature"])
      humidity = float(data["humidity"])
      timestamp = data["timestamp"]  # ← Keep as-is (string or int)

      # Validate timestamp is string
      if not isinstance(timestamp, str):
        logger.error(f"❌ Timestamp must be string, got {type(timestamp).__name__}")
        await self._send_ack(
          success=False,
          device_id=device_id,
          mac_address=mac_address,
          timestamp=str(timestamp),
          error=f"Timestamp must be ISO 8601 string (e.g., '2025-01-11T12:30:45'), got {type(timestamp).__name__}"
        )
        return

      # Validate timestamp format (ISO 8601)
      try:
        # Normalize timestamp: "2025-01-11T12:30:45" or "2025-01-11 12:30:45"
        timestamp_clean = timestamp.replace('T', ' ').replace('Z', '').strip()
        datetime.fromisoformat(timestamp_clean)
      except ValueError as e:
        logger.error(f"❌ Invalid datetime format: {timestamp}")
        await self._send_ack(
          success=False,
          device_id=device_id,
          mac_address=mac_address,
          timestamp=timestamp,
          error=f"Invalid datetime format: '{timestamp}'. Use ISO 8601 (e.g., '2025-01-11T12:30:45')"
        )
        return

      # Insert to database with timeout
      try:
        log_id = await asyncio.wait_for(
          insert_sensor_data_from_mqtt(
            device_id=device_id,
            mac_address=mac_address,
            temperature=temperature,
            humidity=humidity,
            timestamp=timestamp
          ),
          timeout=env.MQTT_ACK_TIMEOUT
        )

        if log_id:
          # Send success acknowledgment
          await self._send_ack(
            success=True,
            device_id=device_id,
            mac_address=mac_address,
            timestamp=timestamp,
            log_id=log_id
          )

          # Broadcast to SSE clients
          if broadcast_callback:
            await broadcast_callback({
              "log_id": log_id,
              "device_id": device_id,
              "mac_address": mac_address,
              "temperature": temperature,
              "humidity": humidity,
              "timestamp": timestamp,
              "datetime": timestamp.replace('T', ' ').replace('Z', '').strip(),
              "unix_timestamp": int(datetime.fromisoformat(timestamp.replace('T', ' ').replace('Z', '').strip()).timestamp())
            })
        else:
          # Send failure acknowledgment
          await self._send_ack(
            success=False,
            device_id=device_id,
            mac_address=mac_address,
            timestamp=timestamp,
            error="Database insertion failed"
          )

      except asyncio.TimeoutError:
        logger.error(f"⏱️ Database insertion timeout for device {device_id}")
        await self._send_ack(
          success=False,
          device_id=device_id,
          mac_address=mac_address,
          timestamp=timestamp,
          error="Database timeout"
        )

    except json.JSONDecodeError as e:
      logger.error(f"❌ Invalid JSON payload: {e}")
    except ValueError as e:
      logger.error(f"❌ Invalid data type: {e}")
    except Exception as e:
      logger.error(f"❌ Error handling message: {e}")

  async def _send_ack(
    self,
    success: bool,
    device_id: Optional[str] = None,
    mac_address: Optional[str] = None,
    timestamp: Optional[str] = None,  # ← Changed to str
    log_id: Optional[int] = None,
    error: Optional[str] = None
  ):
    """Send acknowledgment message back to MQTT"""
    try:
      # Check if client exists
      if not self.client:
        logger.error("❌ MQTT client not initialized, cannot send ACK")
        return

      ack_payload = {
        "success": success,
        "device_id": device_id,
        "mac_address": mac_address,
        "timestamp": timestamp  # ← Return original timestamp
      }

      if success and log_id:
        ack_payload["log_id"] = log_id
        ack_payload["message"] = "Data logged successfully"
      elif error:
        ack_payload["error"] = error

      # Publish acknowledgment
      await self.client.publish(
        env.MQTT_TOPIC_ACK,
        payload=json.dumps(ack_payload),
        qos=env.MQTT_QOS
      )

      status = "✅" if success else "❌"
      logger.info(f"{status} Sent ACK to {env.MQTT_TOPIC_ACK}: {ack_payload}")

    except Exception as e:
      logger.error(f"❌ Failed to send ACK: {e}")

# Singleton instance
mqtt_client = MQTTClient()