from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from contextlib import asynccontextmanager
from os.path import join, dirname
import logging
import asyncio
import json

from src.config import get_settings
from src.database import db
from src.models import (
  init_tables, 
  get_latest_readings, 
  get_device_stats, 
  get_device_logs,
  get_logs_by_mac,
  get_total_logs,
  get_device_chart_data,
  get_all_devices,
  get_all_devices_chart_data
)
from src.mqtt import (
  mqtt_client,
  set_broadcast_callback
)

# Logging setup
logging.basicConfig(
  level=logging.INFO,
  format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

#######################
# Lifespan Management #
#######################

env = get_settings()

@asynccontextmanager
async def lifespan(app: FastAPI):
  """Manage application lifecycle (startup & shutdown)"""
  # STARTUP
  logger.info("🚀 Starting up application...")
  
  # Create database pool
  await db.create_pool(
    host=env.MYSQL_HOST,
    port=env.MYSQL_PORT,
    user=env.MYSQL_USER,
    password=env.MYSQL_PASSWORD,
    db=env.MYSQL_DATABASE,
    minsize=env.MYSQL_POOL_MIN_SIZE,
    maxsize=env.MYSQL_POOL_MAX_SIZE
  )
  
  # Initialize tables
  await init_tables()
  
  # Set broadcast callback for SSE
  await set_broadcast_callback(broadcast_new_log)
  
  # Connect to MQTT broker
  await mqtt_client.connect()
  
  logger.info("✅ Application startup complete")
  
  yield  # Application runs here
  
  # SHUTDOWN
  logger.info("🛑 Shutting down application...")
  
  # Disconnect MQTT
  await mqtt_client.disconnect()
  
  # Close database pool
  await db.close_pool()
  
  logger.info("✅ Application shutdown complete")

#############
# App Setup #
#############

app: FastAPI = FastAPI(
  title="DHT Logger API",
  version=env.APP_VERSION,
  description="API for logging DHT sensor data via MQTT to a MySQL database.",
  docs_url="/docs",
  redoc_url="/redoc",
  lifespan=lifespan
)

app.mount('/static', StaticFiles(directory=join(dirname(__file__), "static")), name='static')
templ = Jinja2Templates(directory=join(dirname(__file__), "templates"))

#############
# Endpoints #
#############

@app.get("/health", tags=["Health"])
async def health_check():
  """Health check endpoint"""
  return {
    "status": "ok",
    "version": env.APP_VERSION,
    "database": "connected" if db.pool else "disconnected",
    "mqtt": "connected" if mqtt_client.client else "disconnected"
  }

@app.get("/", tags=["Index"], response_class=HTMLResponse)
async def root(request: Request):
  """Main dashboard page"""
  return templ.TemplateResponse(
    request=request,
    name='index.html'
  )

@app.get("/api/logs", tags=["Logs"])
async def get_logs(page: int = 1, limit: int = 10):
  """
  Get paginated sensor logs
  
  Args:
    page: Page number (starts from 1)
    limit: Number of records per page (default: 10)
  """
  try:
    # Calculate offset
    offset = (page - 1) * limit
    
    # Get total count
    total = await get_total_logs()
    
    # Calculate total pages
    total_pages = (total + limit - 1) // limit  # Ceiling division
    
    # No FROM_UNIXTIME needed, timestamp is already DATETIME
    query = f"""
    SELECT 
      log_id, 
      device_id, 
      mac_address, 
      temperature, 
      humidity, 
      timestamp,
      DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%s') as datetime,
      UNIX_TIMESTAMP(timestamp) as unix_timestamp
    FROM sensor_data 
    ORDER BY timestamp DESC 
    LIMIT {limit} OFFSET {offset}
    """
    
    async with db.get_cursor() as cursor:
      await cursor.execute(query)
      logs = await cursor.fetchall()
    
    return {
      "success": True,
      "page": page,
      "limit": limit,
      "total": total,
      "total_pages": total_pages,
      "data": logs
    }
  except Exception as e:
    logger.error(f"Error fetching logs: {e}")
    return {"success": False, "error": str(e)}

@app.get("/api/logs/latest", tags=["Logs"])
async def get_latest_sensor_data(limit: int = 10):
  """Get latest sensor readings from database"""
  try:
    readings = await get_latest_readings(limit)
    return {
      "success": True,
      "count": len(readings),
      "data": readings
    }
  except Exception as e:
    logger.error(f"Error fetching latest readings: {e}")
    return {"success": False, "error": str(e)}

@app.get("/api/logs/device/{device_id}", tags=["Logs"])
async def get_device_log_history(device_id: str, limit: int = 50):
  """Get log history for a specific device"""
  try:
    logs = await get_device_logs(device_id, limit)
    return {
      "success": True,
      "device_id": device_id,
      "count": len(logs),
      "data": logs
    }
  except Exception as e:
    logger.error(f"Error fetching device logs: {e}")
    return {"success": False, "error": str(e)}

@app.get("/api/logs/mac/{mac_address}", tags=["Logs"])
async def get_logs_by_mac_address(mac_address: str, limit: int = 50):
  """Get logs for a specific MAC address"""
  try:
    logs = await get_logs_by_mac(mac_address, limit)
    return {
      "success": True,
      "mac_address": mac_address,
      "count": len(logs),
      "data": logs
    }
  except Exception as e:
    logger.error(f"Error fetching logs by MAC: {e}")
    return {"success": False, "error": str(e)}

@app.get("/api/stats/device/{device_id}", tags=["Stats"])
async def get_device_statistics(device_id: str):
  """Get statistics for a specific device"""
  try:
    stats = await get_device_stats(device_id)
    return {
      "success": True,
      "device_id": device_id,
      "stats": stats
    }
  except Exception as e:
    logger.error(f"Error fetching device stats: {e}")
    return {"success": False, "error": str(e)}

@app.get("/api/stats/overview", tags=["Stats"])
async def get_overview_stats():
  """Get overall statistics"""
  try:
    total = await get_total_logs()
    
    # Get unique devices count
    query = "SELECT COUNT(DISTINCT device_id) as unique_devices FROM sensor_data"
    async with db.get_cursor() as cursor:
      await cursor.execute(query)
      result = await cursor.fetchone()
      unique_devices = result['unique_devices']
    
    # No FROM_UNIXTIME needed
    query_latest = """
    SELECT 
      MAX(timestamp) as latest_time,
      UNIX_TIMESTAMP(MAX(timestamp)) as latest_ts
    FROM sensor_data
    """
    async with db.get_cursor() as cursor:
      await cursor.execute(query_latest)
      result_latest = await cursor.fetchone()
    
    return {
      "success": True,
      "stats": {
          "total_logs": total,
          "unique_devices": unique_devices,
          "latest_timestamp": result_latest['latest_ts'],
          "latest_time": str(result_latest['latest_time']) if result_latest['latest_time'] else None
      }
    }
  except Exception as e:
    logger.error(f"Error fetching overview stats: {e}")
    return {"success": False, "error": str(e)}

@app.get("/api/devices", tags=["Devices"])
async def get_devices_list():
  """Get list of all unique devices"""
  try:
    devices = await get_all_devices()
    return {
      "success": True,
      "count": len(devices),
      "devices": devices
    }
  except Exception as e:
    logger.error(f"Error fetching devices: {e}")
    return {"success": False, "error": str(e)}

@app.get("/api/chart/device/{device_id}", tags=["Chart"])
async def get_device_chart(device_id: str, limit: int = 50):
  """Get chart data for a specific device"""
  try:
    data = await get_device_chart_data(device_id, limit)
    return {
      "success": True,
      "device_id": device_id,
      "count": len(data),
      "data": data
    }
  except Exception as e:
    logger.error(f"Error fetching chart data: {e}")
    return {"success": False, "error": str(e)}

@app.get("/api/chart/all-devices", tags=["Chart"])
async def get_all_devices_chart(metric: str = "temperature", limit: int = 50):
  """
  Get chart data for all devices for a specific metric
  
  Args:
    metric: 'temperature' or 'humidity' (default: temperature)
    limit: Number of latest readings per device (default: 50)
  """
  try:
    if metric not in ['temperature', 'humidity']:
      return {
        "success": False,
        "error": "Invalid metric. Must be 'temperature' or 'humidity'"
      }
    
    data = await get_all_devices_chart_data(metric, limit)
    
    return {
      "success": True,
      "metric": metric,
      "devices": list(data.keys()),
      "data": data
    }
  except Exception as e:
    logger.error(f"Error fetching all devices chart data: {e}")
    return {"success": False, "error": str(e)}

# v0.1.5: New endpoint for fetching device data by time range
@app.get("/api/chart/range/{device_id}", tags=["Chart"])
async def get_device_chart_by_range(device_id: str, range: str = "1d"):
  """
  Get device data by time range
  
  Args:
    device_id: Device ID
    range: Time range (15d, 7d, 1d, 1h, 30m, live)
  
  Returns:
    Current value + historical data (max 100 points)
  """
  try:
    # Calculate time range in minutes
    range_mapping = {
      "15d": 21600,   # 15 days = 21,600 minutes
      "7d": 10080,    # 7 days = 10,080 minutes
      "1d": 1440,     # 1 day = 1,440 minutes
      "1h": 60,       # 1 hour = 60 minutes
      "30m": 30,      # 30 minutes
      "live": 5       # Live = last 5 minutes (rolling)
    }
    
    minutes = range_mapping.get(range, 1440)
    
    logger.info(f"📊 Fetching data for range: {range} ({minutes} minutes)")
    
    # Different logic for "live" vs historical ranges
    if range == "live":
      # Live: Rolling window from NOW
      count_query = """
      SELECT COUNT(*) as total
      FROM sensor_data 
      WHERE device_id = %s
      AND timestamp >= DATE_SUB(NOW(), INTERVAL %s MINUTE)
      """
      
      async with db.get_cursor() as cursor:
          await cursor.execute(count_query, (device_id, minutes))
          count_result = await cursor.fetchone()
          total_records = count_result['total']
      
      logger.info(f"📊 Total records in range (Live): {total_records}")
      
      # Calculate sampling interval
      target_points = 100
      interval = max(1, total_records // target_points) if total_records > 0 else 1
      
      logger.info(f"📊 Sampling interval: {interval}, Expected points: ~{total_records // interval if total_records > 0 else 0}")
      
      # Query data (rolling window from NOW)
      query = """
      SELECT 
          temperature,
          humidity,
          timestamp,
          DATE_FORMAT(timestamp, '%%Y-%%m-%%d %%H:%%i:%%s') as datetime
      FROM (
          SELECT 
              temperature,
              humidity,
              timestamp,
              ROW_NUMBER() OVER (ORDER BY timestamp ASC) as row_num
          FROM sensor_data 
          WHERE device_id = %s
          AND timestamp >= DATE_SUB(NOW(), INTERVAL %s MINUTE)
      ) AS numbered
      WHERE MOD(row_num - 1, %s) = 0
      ORDER BY timestamp ASC
      """
      
      async with db.get_cursor() as cursor:
          await cursor.execute(query, (device_id, minutes, interval))
          history = await cursor.fetchall()
      
      # Calculate window for live
      from datetime import datetime, timedelta
      now = datetime.now()
      window_start = now - timedelta(minutes=minutes)
      window_end = now
      
    else:
      # Historical ranges: Fixed window from FIRST timestamp
      query_first = """
      SELECT MIN(timestamp) as first_timestamp
      FROM sensor_data 
      WHERE device_id = %s
      """
      
      async with db.get_cursor() as cursor:
        await cursor.execute(query_first, (device_id,))
        first_result = await cursor.fetchone()
        first_timestamp = first_result['first_timestamp']
      
      if not first_timestamp:
        return {
          "success": False,
          "error": "No data found for this device"
        }
      
      logger.info(f"📊 First data timestamp: {first_timestamp}")
      
      # Count total records in fixed time window
      count_query = """
      SELECT COUNT(*) as total
      FROM sensor_data 
      WHERE device_id = %s
      AND timestamp >= %s
      AND timestamp <= DATE_ADD(%s, INTERVAL %s MINUTE)
      """
      
      async with db.get_cursor() as cursor:
        await cursor.execute(count_query, (device_id, first_timestamp, first_timestamp, minutes))
        count_result = await cursor.fetchone()
        total_records = count_result['total']
      
      logger.info(f"📊 Total records in range ({range}): {total_records}")
      
      # Calculate sampling interval
      target_points = 100
      interval = max(1, total_records // target_points) if total_records > 0 else 1
      
      logger.info(f"📊 Sampling interval: {interval}, Expected points: ~{total_records // interval if total_records > 0 else 0}")
      
      # Query data (fixed window from first_timestamp)
      query = """
      SELECT 
        temperature,
        humidity,
        timestamp,
        DATE_FORMAT(timestamp, '%%Y-%%m-%%d %%H:%%i:%%s') as datetime
      FROM (
        SELECT 
          temperature,
          humidity,
          timestamp,
          ROW_NUMBER() OVER (ORDER BY timestamp ASC) as row_num
        FROM sensor_data 
        WHERE device_id = %s
        AND timestamp >= %s
        AND timestamp <= DATE_ADD(%s, INTERVAL %s MINUTE)
      ) AS numbered
      WHERE MOD(row_num - 1, %s) = 0
      ORDER BY timestamp ASC
      """
      
      async with db.get_cursor() as cursor:
        await cursor.execute(query, (device_id, first_timestamp, first_timestamp, minutes, interval))
        history = await cursor.fetchall()
      
      # Calculate window for historical ranges
      from datetime import timedelta
      window_start = first_timestamp
      window_end = first_timestamp + timedelta(minutes=minutes)
    
    logger.info(f"✅ Returned {len(history)} data points")
    
    # Get current (latest) value
    query_current = """
    SELECT temperature, humidity, timestamp
    FROM sensor_data 
    WHERE device_id = %s
    ORDER BY timestamp DESC
    LIMIT 1
    """
    
    async with db.get_cursor() as cursor:
      await cursor.execute(query_current, (device_id,))
      current = await cursor.fetchone()
    
    if not current:
      return {
        "success": False,
        "error": "No data found for this device"
      }
    
    return {
      "success": True,
      "device_id": device_id,
      "range": range,
      "range_minutes": minutes,
      "window_start": window_start.strftime('%Y-%m-%d %H:%M:%S'),
      "window_end": window_end.strftime('%Y-%m-%d %H:%M:%S'),
      "total_records": total_records,
      "sampled_points": len(history),
      "sampling_interval": interval,
      "current": {
        "temperature": current['temperature'],
        "humidity": current['humidity'],
        "timestamp": str(current['timestamp'])
      },
      "history": history
    }
  except Exception as e:
    logger.error(f"❌ Error fetching range data: {e}")
    return {"success": False, "error": str(e)}

# Custom 404 Handler
@app.exception_handler(404)
async def custom_404_handler(request: Request, exc):
  """Custom 404 error page"""
  return templ.TemplateResponse(
    request=request,
    name="404.html",
    status_code=404
  )


################
# SSE Endpoint #
################

# SSE event queue
sse_clients = []

async def sse_event_generator():
  """Generator for Server-Sent Events"""
  queue = asyncio.Queue()
  sse_clients.append(queue)
  
  try:
    while True:
      data = await queue.get()
      yield f"data: {json.dumps(data)}\n\n"
  except asyncio.CancelledError:
    sse_clients.remove(queue)

@app.get("/api/events/stream", tags=["SSE"])
async def sse_stream():
  """Server-Sent Events stream for realtime updates"""
  return StreamingResponse(
    sse_event_generator(),
    media_type="text/event-stream",
    headers={
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    }
  )

async def broadcast_new_log(log_data: dict):
  """Broadcast new log to all SSE clients"""
  for queue in sse_clients:
    try:
      await queue.put(log_data)
    except Exception as e:
      logger.error(f"Failed to broadcast to SSE client: {e}")