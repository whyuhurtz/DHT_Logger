-- MySQL Initialization Script
-- This runs automatically when the container is first created

-- Ensure proper character set
ALTER DATABASE dht_logger CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Grant all privileges to application user
GRANT ALL PRIVILEGES ON dht_logger.* TO 'dht_user'@'%';
FLUSH PRIVILEGES;

-- Log initialization
SELECT 'Database initialized successfully' AS status;