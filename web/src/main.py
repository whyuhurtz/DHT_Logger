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
  get_total_logs
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
    
    # ✅ UPDATED: No FROM_UNIXTIME needed
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