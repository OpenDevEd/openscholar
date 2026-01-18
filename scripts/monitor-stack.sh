#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "========================================="
echo "Setting up Monitoring Stack"
echo "========================================="

# Create Prometheus config directory
mkdir -p ./prometheus

# Create Prometheus configuration
cat > ./prometheus/prometheus.yml <<'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    monitor: 'openalex-count-monitor'

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'nextjs-app'
    static_configs:
      - targets: ['app:3000']
    metrics_path: '/metrics'

  - job_name: 'convex-backend'
    static_configs:
      - targets: ['backend:3210']

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres:5432']

  - job_name: 'convex-exporter'
    static_configs:
      - targets: ['convex-exporter:9101']
    scrape_interval: 30s

  - job_name: 'docker'
    static_configs:
      - targets: ['172.17.0.1:9323']
EOF

echo "Prometheus configuration created."

# Create Grafana provisioning directories
mkdir -p ./grafana/provisioning/datasources
mkdir -p ./grafana/provisioning/dashboards

# Create Grafana datasource configuration
cat > ./grafana/provisioning/datasources/prometheus.yml <<'EOF'
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
    jsonData:
      timeInterval: "15s"
EOF

echo "Grafana datasource configuration created."

# Create Grafana dashboard provisioning
cat > ./grafana/provisioning/dashboards/default.yml <<'EOF'
apiVersion: 1

providers:
  - name: 'default'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards
      foldersFromFilesStructure: false
EOF

echo "Grafana dashboard provisioning created."

echo ""
echo "========================================="
echo "Starting Monitoring Stack"
echo "========================================="

# Start Prometheus and Grafana
echo "Starting Prometheus..."
docker compose -f docker-compose.prod.yml up -d prometheus

echo "Starting Grafana..."
docker compose -f docker-compose.prod.yml up -d grafana

# Wait for services to be ready
echo "Waiting for services to start..."
sleep 10

# Check if services are running
echo ""
echo "Checking service status..."
docker compose -f docker-compose.prod.yml ps prometheus grafana

echo ""
echo "========================================="
echo "Monitoring Stack Setup Complete!"
echo "========================================="
echo ""
echo "Access URLs:"
echo "  - Prometheus: http://localhost:9090"
echo "  - Grafana: http://localhost:3001"
echo ""
echo "Grafana Credentials:"
echo "  - Username: admin"
echo "  - Password: (set in GF_SECURITY_ADMIN_PASSWORD env var)"
echo ""
echo "Next steps:"
echo "  1. Access Grafana at http://localhost:3001"
echo "  2. Login with admin credentials"
echo "  3. Dashboards are automatically loaded from ./grafana/dashboards/"
echo "  4. Import Convex-specific dashboards from Grafana dashboard library"
echo ""
