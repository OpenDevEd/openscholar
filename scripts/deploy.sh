#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "========================================="
echo "Deployment started at $(date)"
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

# Check if auto-deploy is enabled
if [ "$DEPLOY_ON_PUSH" != "true" ]; then
    echo "INFO: Auto-deploy disabled (DEPLOY_ON_PUSH=$DEPLOY_ON_PUSH)"
    echo "To enable, set DEPLOY_ON_PUSH=true in .env"
    exit 0
fi

# Backup current running containers
BACKUP_TAG="backup-$(date +%Y%m%d-%H%M%S)"
echo "Creating backup tag: $BACKUP_TAG"

# Pull latest code
echo "Pulling latest code from main branch..."
git fetch origin main
git reset --hard origin/main

# Stop old containers and remove old images
echo "Stopping old containers..."
docker compose -f docker-compose.prod.yml down

# Build new images
echo "Building new images..."
docker compose -f docker-compose.prod.yml build --no-cache

# Start new containers
echo "Starting new containers..."
docker compose -f docker-compose.prod.yml up -d

# Wait for health checks
echo "Waiting for services to become healthy..."
sleep 40

# Check health status
echo "Checking service health..."
HEALTHY_SERVICES=$(docker compose -f docker-compose.prod.yml ps --format json | jq -r '[.[] | select(.Health == "healthy")] | length')
TOTAL_SERVICES=$(docker compose -f docker-compose.prod.yml ps --format json | jq -r 'length')

echo "Healthy services: $HEALTHY_SERVICES / $TOTAL_SERVICES"

if [ "$HEALTHY_SERVICES" -lt 3 ]; then
    echo "ERROR: Health check failed. Rolling back..."
    echo "Stopping failed containers..."
    docker compose -f docker-compose.prod.yml down

    echo "Restoring backup..."
    # Rebuild with previous code
    git log -1 --format="%H" > /tmp/rollback_commit.txt
    ROLLBACK_COMMIT=$(cat /tmp/rollback_commit.txt)
    git reset --hard HEAD~1

    echo "Rebuilding previous version..."
    docker compose -f docker-compose.prod.yml build --no-cache
    docker compose -f docker-compose.prod.yml up -d

    echo "Waiting for rollback to complete..."
    sleep 40

    echo "Rollback completed."
    exit 1
fi

# Deploy Convex code
if [ ! -z "$CONVEX_SELF_HOSTED_URL" ] && [ ! -z "$CONVEX_SELF_HOSTED_ADMIN_KEY" ]; then
    echo "Deploying Convex code..."
    CONVEX_SELF_HOSTED_URL="$CONVEX_SELF_HOSTED_URL" \
    CONVEX_SELF_HOSTED_ADMIN_KEY="$CONVEX_SELF_HOSTED_ADMIN_KEY" \
    npx convex deploy
else
    echo "WARNING: Convex deployment skipped (missing credentials)"
fi

echo "========================================="
echo "Deployment successful at $(date)"
echo "========================================="
echo ""
echo "Services:"
docker compose -f docker-compose.prod.yml ps
echo ""
echo "Access URLs:"
echo "  - Next.js App: http://localhost:3000"
echo "  - Convex Dashboard: http://localhost:6791"
echo "  - Prometheus: http://localhost:9090"
echo "  - Grafana: http://localhost:3001"
