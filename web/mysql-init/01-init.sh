#!/bin/bash
# MySQL Initialization Script with Environment Variables

# Create temporary MySQL config file (avoid password warning)
cat > /tmp/mysql-init.cnf <<EOF
[client]
user=root
password=${MYSQL_ROOT_PASSWORD}
EOF

# Use config file instead of command line password
mysql --defaults-extra-file=/tmp/mysql-init.cnf <<-EOSQL
  -- Disable host cache to avoid deprecation warning
  SET GLOBAL host_cache_size=0;
  
  -- Ensure proper character set
  ALTER DATABASE ${MYSQL_DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  
  -- Grant all privileges to application user from environment
  GRANT ALL PRIVILEGES ON ${MYSQL_DATABASE}.* TO '${MYSQL_USER}'@'%';
  FLUSH PRIVILEGES;
  
  -- Log initialization
  SELECT 'Database initialized successfully for user: ${MYSQL_USER}' AS status;
EOSQL

# Clean up
rm -f /tmp/mysql-init.cnf