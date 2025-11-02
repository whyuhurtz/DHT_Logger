FROM python:3.13.5-alpine

# Install system dependencies
RUN apk update && apk add --no-cache \
    build-base \
    mariadb-dev \
    mariadb-connector-c \
    linux-headers \
    python3-dev \
    gcc \
    musl-dev \
    libffi-dev \
    openssl-dev \
    ca-certificates \
    tzdata \
    wget \
    curl && \
    rm -rf /var/cache/apk/*

# Set timezone
ENV TZ=Asia/Jakarta
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Set working directory
WORKDIR /app

# Copy requirements first (for better Docker layer caching)
COPY requirements-prod.txt /app/requirements-prod.txt

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements-prod.txt

# Copy application source code to /app/src
COPY src/ /app/src/

# Copy CA certificate file for MQTTS
COPY emqxsl-ca.crt /app/emqxsl-ca.crt

# Copy .env file (optional, can be mounted via volume)
COPY .env /app/.env

# Create non-root user for security
RUN addgroup -g 1000 appuser && \
    adduser -D -u 1000 -G appuser appuser && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose FastAPI port
EXPOSE 8000

# Health check using wget (already installed)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

# Run the application
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]