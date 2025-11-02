import aiomysql
import logging
from typing import Optional
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

class Database:
  def __init__(self):
    self.pool: Optional[aiomysql.Pool] = None
  
  async def create_pool(
    self,
    host: str,
    port: int,
    user: str,
    password: str,
    db: str,
    minsize: int = 5,
    maxsize: int = 20
  ):
    """Create connection pool with proper authentication"""
    try:
      self.pool = await aiomysql.create_pool(
        host=host,
        port=port,
        user=user,
        password=password,
        db=db,
        minsize=minsize,
        maxsize=maxsize,
        autocommit=False,
        charset='utf8mb4',
        # Enable caching_sha2_password support
        auth_plugin='caching_sha2_password',
        # Connection options
        connect_timeout=10,
        echo=False
      )
      logger.info(f"✅ Database pool created (min={minsize}, max={maxsize})")
    except Exception as e:
      logger.error(f"❌ Failed to create database pool: {e}")
      raise
  
  async def close_pool(self):
    """Close connection pool"""
    if self.pool:
      self.pool.close()
      await self.pool.wait_closed()
      logger.info("🔒 Database pool closed")
  
  @asynccontextmanager
  async def get_cursor(self):
    """Get database cursor from pool"""
    if not self.pool:
      raise RuntimeError("Database pool not initialized")
    
    async with self.pool.acquire() as conn:
      async with conn.cursor(aiomysql.DictCursor) as cursor:
        try:
          yield cursor
        except Exception as e:
          await conn.rollback()
          logger.error(f"Database error: {e}")
          raise
        else:
          await conn.commit()

# Singleton instance
db = Database()