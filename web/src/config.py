from pydantic_settings import BaseSettings
from functools import lru_cache
from dotenv import load_dotenv
from os.path import join, dirname, exists
from os import getenv

# Try to load .env from different locations
env_paths = [
  join(dirname(__file__), '../.env'), # Development
  '/app/.env',                        # Docker
]

for env_path in env_paths:
  if exists(env_path):
    load_dotenv(env_path)
    break

class AppEnvironment(BaseSettings):
  APP_VERSION: str = getenv("APP_VERSION", "0.0.1")
  APP_SECRET_KEY: str = getenv("APP_SECRET_KEY", "This-is-not-safe-for-production!")
  DEBUG: bool = getenv("DEBUG", "False") == "True"
  
  # MySQL Configuration
  MYSQL_HOST: str = getenv("MYSQL_HOST", "localhost")
  MYSQL_USER: str = getenv("MYSQL_USER", "root")
  MYSQL_PASSWORD: str = getenv("MYSQL_PASSWORD", "password")
  MYSQL_ROOT_PASSWORD: str = getenv("MYSQL_ROOT_PASSWORD", "password")
  MYSQL_DATABASE: str = getenv("MYSQL_DATABASE", "dht_logger")
  MYSQL_PORT: int = int(getenv("MYSQL_PORT", "3306"))
  MYSQL_POOL_MIN_SIZE: int = 5
  MYSQL_POOL_MAX_SIZE: int = 20
  
  # MQTT Configuration
  MQTT_BROKER_URL: str = getenv("MQTT_BROKER_URL", "broker.emqx.io")
  MQTT_BROKER_PORT: int = int(getenv("MQTT_BROKER_PORT", "8883"))
  MQTT_CA_CERT_FILE: str = getenv("MQTT_CA_CERT_FILE", "/app/emqxsl-ca.crt")
  MQTT_USERNAME: str = getenv("MQTT_USERNAME", "")
  MQTT_PASSWORD: str = getenv("MQTT_PASSWORD", "")
  MQTT_QOS: int = int(getenv("MQTT_QOS", "1"))
  MQTT_KEEPALIVE: int = int(getenv("MQTT_KEEPALIVE", "60"))
  
  # MQTT Topics
  MQTT_TOPIC_SENSOR_DATA: str = getenv("MQTT_TOPIC_SENSOR_DATA", "sensors/dht/data")
  MQTT_TOPIC_ACK: str = getenv("MQTT_TOPIC_ACK", "sensors/dht/ack")
  MQTT_ACK_TIMEOUT: int = int(getenv("MQTT_ACK_TIMEOUT", "3"))
  
  class Config:
    case_sensitive = True
    env_file_encoding = 'utf-8'

@lru_cache()
def get_settings() -> AppEnvironment:
  """Get cached settings instance"""
  return AppEnvironment()