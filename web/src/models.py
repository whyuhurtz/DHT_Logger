from src.database import db
import logging
from typing import Optional
from datetime import datetime

logger = logging.getLogger(__name__)

async def init_tables():
  """Initialize database tables with DATETIME (no created_at)"""
  create_table_query = """
  CREATE TABLE IF NOT EXISTS sensor_data (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(11) NOT NULL,
    mac_address VARCHAR(17) NOT NULL,
    temperature FLOAT NOT NULL,
    humidity FLOAT NOT NULL,
    timestamp DATETIME NOT NULL,
    INDEX idx_device_id (device_id),
    INDEX idx_mac_address (mac_address),
    INDEX idx_timestamp (timestamp)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  """
  
  try:
    async with db.get_cursor() as cursor:
      await cursor.execute(create_table_query)
      await cursor.connection.commit()
      logger.info("✅ Tables initialized successfully")
  except Exception as e:
    logger.error(f"❌ Failed to initialize tables: {e}")
    raise

async def insert_sensor_data_from_mqtt(
  device_id: str,
  mac_address: str,
  temperature: float,
  humidity: float,
  timestamp: str  # STRING datetime (ISO 8601)
) -> Optional[int]:
  """
  Insert sensor data from MQTT message
  
  Args:
    device_id: Device ID from ESP32
    mac_address: MAC address of the ESP32
    temperature: Temperature reading
    humidity: Humidity reading
    timestamp: ISO 8601 datetime string (e.g., "2025-01-11T12:30:45" or "2025-01-11 12:30:45")
  
  Returns:
    Last inserted log_id or None if failed
  """
  query = """
  INSERT INTO sensor_data (device_id, mac_address, temperature, humidity, timestamp) 
  VALUES (%s, %s, %s, %s, %s)
  """
  
  try:
    # Parse and validate datetime string
    # Support both ISO 8601 formats: "2025-01-11T12:30:45" and "2025-01-11 12:30:45"
    timestamp_clean = timestamp.replace('T', ' ').replace('Z', '').strip()
    
    # Validate datetime format
    try:
      dt = datetime.fromisoformat(timestamp_clean)
    except ValueError:
      logger.error(f"Invalid datetime format: {timestamp}")
      return None
    
    async with db.get_cursor() as cursor:
      await cursor.execute(query, (
        device_id, 
        mac_address, 
        temperature, 
        humidity, 
        timestamp_clean # "YYYY-MM-DD HH:MM:SS"
      ))
      await cursor.connection.commit()
      log_id = cursor.lastrowid
      
      logger.info(
          f"✅ [LOG {log_id}] Device {device_id} ({mac_address}): "
          f"Temp={temperature}°C, Humidity={humidity}%, Time={timestamp_clean}"
      )
      
      return log_id
  
  except Exception as e:
    logger.error(f"❌ Failed to insert sensor data: {e}")
    return None

async def get_latest_readings(limit: int = 10):
  """Get latest sensor readings"""
  query = """
  SELECT 
    log_id, 
    device_id, 
    mac_address, 
    temperature, 
    humidity, 
    timestamp,
    DATE_FORMAT(timestamp, '%%Y-%%m-%%d %%H:%%i:%%s') as datetime,
    UNIX_TIMESTAMP(timestamp) as unix_timestamp
  FROM sensor_data 
  ORDER BY timestamp DESC 
  LIMIT %s
  """
  
  async with db.get_cursor() as cursor:
    await cursor.execute(query, (limit,))
    results = await cursor.fetchall()
    return results

async def get_device_logs(device_id: str, limit: int = 50):
  """Get logs for a specific device"""
  query = """
  SELECT 
    log_id, 
    device_id, 
    mac_address, 
    temperature, 
    humidity, 
    timestamp,
    DATE_FORMAT(timestamp, '%%Y-%%m-%%d %%H:%%i:%%s') as datetime,
    UNIX_TIMESTAMP(timestamp) as unix_timestamp
  FROM sensor_data 
  WHERE device_id = %s
  ORDER BY timestamp DESC 
  LIMIT %s
  """
  
  async with db.get_cursor() as cursor:
    await cursor.execute(query, (device_id, limit))
    results = await cursor.fetchall()
    return results

async def get_logs_by_mac(mac_address: str, limit: int = 50):
  """Get logs for a specific MAC address"""
  query = """
  SELECT 
    log_id, 
    device_id, 
    mac_address, 
    temperature, 
    humidity, 
    timestamp,
    DATE_FORMAT(timestamp, '%%Y-%%m-%%d %%H:%%i:%%s') as datetime,
    UNIX_TIMESTAMP(timestamp) as unix_timestamp
  FROM sensor_data 
  WHERE mac_address = %s
  ORDER BY timestamp DESC 
  LIMIT %s
  """
  
  async with db.get_cursor() as cursor:
    await cursor.execute(query, (mac_address, limit))
    results = await cursor.fetchall()
    return results

async def get_device_stats(device_id: str):
  """Get statistics for a specific device"""
  query = """
  SELECT 
    COUNT(*) as total_logs,
    AVG(temperature) as avg_temp,
    MIN(temperature) as min_temp,
    MAX(temperature) as max_temp,
    AVG(humidity) as avg_humidity,
    MIN(humidity) as min_humidity,
    MAX(humidity) as max_humidity,
    MIN(timestamp) as first_log,
    MAX(timestamp) as last_log,
    UNIX_TIMESTAMP(MIN(timestamp)) as first_log_ts,
    UNIX_TIMESTAMP(MAX(timestamp)) as last_log_ts
  FROM sensor_data 
  WHERE device_id = %s
  """
  
  async with db.get_cursor() as cursor:
    await cursor.execute(query, (device_id,))
    result = await cursor.fetchone()
    return result

async def get_total_logs():
  """Get total number of logs"""
  query = "SELECT COUNT(*) as total FROM sensor_data"
  
  async with db.get_cursor() as cursor:
    await cursor.execute(query)
    result = await cursor.fetchone()
    return result['total']