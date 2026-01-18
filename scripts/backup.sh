#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "========================================="
echo "Creating Backup"
echo "========================================="

# Load environment variables
if [ -f .env ]; then
    set -a
    source .env
    set +a
else
    echo "ERROR: .env file not found. Please create it from .env.production"
    exit 1
fi

# Create backup directory
BACKUP_DIR="./backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Backup directory: $BACKUP_DIR"

# Backup PostgreSQL (managed by Convex, but good to have)
echo "Backing up PostgreSQL..."
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U ${POSTGRES_USER} ${POSTGRES_DB} > "$BACKUP_DIR/postgres.sql"

# Backup Convex data volume
echo "Backing up Convex data volume..."
docker run --rm \
  -v convex_data:/data \
  -v "$BACKUP_DIR:/backup" \
  alpine tar czf /backup/convex_data.tar.gz -C /data .

# Backup Grafana config
echo "Backing up Grafana config..."
docker run --rm \
  -v grafana_data:/data \
  -v "$BACKUP_DIR:/backup" \
  alpine tar czf /backup/grafana_config.tar.gz -C /data .

# Backup Prometheus data
echo "Backing up Prometheus data..."
docker run --rm \
  -v prometheus_data:/data \
  -v "$BACKUP_DIR:/backup" \
  alpine tar czf /backup/prometheus_data.tar.gz -C /data .

# Backup environment variables (without sensitive data)
echo "Creating backup manifest..."
cat > "$BACKUP_DIR/backup_manifest.txt" <<EOF
Backup created: $(date)
Backup ID: $(date +%Y%m%d-%H%M%S)
Git commit: $(git rev-parse HEAD 2>/dev/null || echo "N/A")
Git branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "N/A")

Files included:
  - postgres.sql (PostgreSQL dump)
  - convex_data.tar.gz (Convex data volume)
  - grafana_config.tar.gz (Grafana configuration)
  - prometheus_data.tar.gz (Prometheus data)

Environment variables:
  - CONVEX_CLOUD_ORIGIN=${CONVEX_CLOUD_ORIGIN}
  - CONVEX_SITE_ORIGIN=${CONVEX_SITE_ORIGIN}
  - INSTANCE_NAME=${INSTANCE_NAME}

NOTE: This backup is for disaster recovery only.
Convex manages all database operations.
Restore only if instructed by Convex team or for complete system failure.
EOF

# Calculate backup size
BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)

echo ""
echo "========================================="
echo "Backup Complete!"
echo "========================================="
echo "Location: $BACKUP_DIR"
echo "Size: $BACKUP_SIZE"
echo ""
echo "Note: All backups are kept forever (no auto-cleanup)"
echo "      Manage old backups manually if needed"
echo ""
ls -lh "$BACKUP_DIR"
