#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "========================================="
echo "Setting up Convex Database & Backend"
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

# Create data directory if it doesn't exist
mkdir -p ./data

# Start PostgreSQL if not running
echo "Starting PostgreSQL..."
docker compose -f docker-compose.prod.yml up -d postgres

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
until docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U ${POSTGRES_USER}; do
    echo "PostgreSQL is not ready yet..."
    sleep 2
done

echo "PostgreSQL is ready!"

# Verify database exists (Convex creates and manages it)
echo "Checking database '${POSTGRES_DB}'..."
DB_EXISTS=$(docker compose -f docker-compose.prod.yml exec -T postgres psql -U ${POSTGRES_USER} -lqt | cut -d \| -f 1 | grep -w ${POSTGRES_DB} | wc -l)

if [ "$DB_EXISTS" -eq 0 ]; then
    echo "Database '${POSTGRES_DB}' does not exist yet. Convex will create it automatically."
else
    echo "Database '${POSTGRES_DB}' exists."
    echo "NOTE: Convex manages all database operations (schema, migrations, queries)."
    echo "      You should only interact with Convex API, never directly with PostgreSQL."
fi

# Start Convex backend
echo "Starting Convex backend..."
docker compose -f docker-compose.prod.yml up -d backend

# Wait for backend to be ready
echo "Waiting for Convex backend to be ready..."
until docker compose -f docker-compose.prod.yml exec -T backend curl -f http://localhost:3210/version > /dev/null 2>&1; do
    echo "Convex backend is not ready yet..."
    sleep 2
done

echo "Convex backend is ready!"

# Generate admin key
echo "========================================="
echo "Generating Convex Admin Key"
echo "========================================="

# Generate admin key and capture output
ADMIN_KEY=$(docker compose -f docker-compose.prod.yml exec -T backend ./generate_admin_key.sh)

# Save admin key to file
echo "$ADMIN_KEY" > ./data/admin_key.txt
chmod 600 ./data/admin_key.txt

# Display admin key
echo ""
echo "========================================="
echo "ADMIN KEY SAVED TO: ./data/admin_key.txt"
echo "========================================="
echo ""
echo "Your admin key:"
echo "$ADMIN_KEY"
echo ""
echo "IMPORTANT:"
echo "  1. Copy this key to access Convex Dashboard"
echo "  2. Keep this key secret - do not commit to git"
echo "  3. This key is also used by the metrics exporter"
echo ""
echo "========================================="

echo ""
echo "========================================="
echo "Database Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Update your .env file with the admin key:"
echo "     CONVEX_SELF_HOSTED_ADMIN_KEY=\"$ADMIN_KEY\""
echo ""
echo "  2. Start the monitoring stack:"
echo "     ./scripts/monitor-stack.sh"
echo ""
echo "  3. Start the full application stack:"
echo "     docker compose -f docker-compose.prod.yml up -d"
echo ""
echo "  4. Access Convex Dashboard at:"
echo "     http://localhost:6791"
echo ""
echo "  5. Paste the admin key to authenticate"
echo ""
