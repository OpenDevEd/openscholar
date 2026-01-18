# Production Deployment Setup

This guide covers deploying openalex-count to production using Docker Compose.

## Prerequisites

- Docker and Docker Compose installed
- VPS/Cloud server (AWS, GCP, DigitalOcean, etc.)
- Domain name configured with DNS
- SSL certificate (or use Cloudflare)
- Git clone of this repository on the server

## Architecture

```
┌─────────────────────────────────────────────────────┐
│           External Load Balancer (Cloudflare/ALB)   │
└───────────┬─────────────────────────────┬───────────┘
            │                             │
    ┌───────▼──────┐             ┌────────▼────────┐
    │  Next.js App │             │ Convex Dashboard│
    │  Port 3000    │             │ Port 6791        │
    └───────┬──────┘             └─────────────────┘
            │
    ┌───────▼──────────────────┐
    │  Convex Backend          │ ← Port 3210 (API)
    │  Port 3211 (HTTP actions)│
    └───────┬──────────────────┘
            │
    ┌───────▼──────────────────┐
    │  PostgreSQL 17           │ ← Convex-managed
    │  Port 5432              │
    └───────────────────────────┘
    
    ┌───────────┐
    │ Prometheus │ ← Port 9090
    │ Grafana    │ ← Port 3001
    └───────────┘
```

## Quick Start

### 1. Clone and Setup

```bash
# Clone repository on your server
git clone https://github.com/your-username/openalex-count.git
cd openalex-count

# Create environment file
cp .env.production .env

# Edit .env with your values
nano .env
```

### 2. Generate Secure Tokens

```bash
# Generate instance secret
openssl rand -base64 64

# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate Grafana password
openssl rand -base64 12
```

Update `.env` with these values.

### 3. Setup Database & Backend

```bash
# Start PostgreSQL and Convex backend
./scripts/setup-db.sh

# Copy the admin key displayed
# Update .env: CONVEX_SELF_HOSTED_ADMIN_KEY="your-admin-key"
```

### 4. Setup Monitoring

```bash
./scripts/monitor-stack.sh
```

### 5. Start Full Stack

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 6. Access Services

- **Next.js App**: http://localhost:3000
- **Convex Dashboard**: http://localhost:6791 (paste admin key)
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin / your-password)

## Configuration

### Environment Variables

See `.env.production` for all required variables. Key variables:

- `DEPLOY_ON_PUSH`: Set to `true` for auto-deploy on git push
- `CONVEX_CLOUD_ORIGIN`: https://api.your-domain.com
- `CONVEX_SITE_ORIGIN`: https://your-domain.com
- `POSTGRES_URL`: PostgreSQL connection string
- `INSTANCE_SECRET`: Generated with `openssl rand -base64 64`
- `WORKOS_*`: Your WorkOS credentials
- `STRIPE_*`: Your Stripe credentials

### External Load Balancer

Configure your external load balancer (nginx, Cloudflare, ALB) to route:

- `/` → Next.js app (port 3000)
- `/convex` → Convex backend (port 3210)
- `/dashboard` → Convex dashboard (port 6791)
- `/prometheus` → Prometheus (port 9090)
- `/grafana` → Grafana (port 3001)

## Deployment

### Manual Deployment

```bash
./scripts/deploy.sh
```

### Automatic Deployment (CI/CD)

1. Set `DEPLOY_ON_PUSH=true` in `.env`
2. Push to `main` branch
3. GitHub Actions will automatically deploy

### Auto-Rollback

If health checks fail, `deploy.sh` automatically:
1. Stops new containers
2. Restores previous version
3. Exits with error

### Convex Code Deployment

```bash
# Locally
npx convex deploy

# Or automatically via deploy.sh
```

## Monitoring

### Grafana Dashboards

Access http://localhost:3001 to view:

1. **Docker Containers** - CPU, memory, network
2. **PostgreSQL** - Connections, queries, performance
3. **System Overview** - Host CPU, memory, disk, network
4. **Convex Function Metrics** - Execution times, DB I/O, errors

### Prometheus Metrics

Prometheus scrapes metrics every 15s and retains data for 15 days.

Access at http://localhost:9090

## Backup

### Manual Backup

```bash
./scripts/backup.sh
```

Backup includes:
- PostgreSQL dump
- Convex data volume
- Grafana configuration
- Prometheus data

**Note**: All backups are kept forever. Manage old backups manually.

### Restore Backup

```bash
# PostgreSQL (only for disaster recovery)
docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres convex_self_hosted < backup/postgres.sql

# Convex data
docker run --rm -v convex_data:/data -v ./backup:/backup alpine tar xzf /backup/convex_data.tar.gz -C /
```

## Convex Database

**Important**: Convex manages the PostgreSQL database entirely.

- Convex creates the `convex_self_hosted` database
- Convex handles all migrations
- You only interact with Convex API, never directly with PostgreSQL
- The backup script saves DB state for disaster recovery only

## Port Exposure

| Port | Service           | Description                          |
|------|-------------------|--------------------------------------|
| 3000 | Next.js App       | Main application                     |
| 3210 | Convex API       | Convex backend API                   |
| 3211 | Convex HTTP      | Convex HTTP actions                  |
| 5432 | PostgreSQL       | Database (internal only)              |
| 6791 | Convex Dashboard | Admin interface (protect with nginx)  |
| 9090 | Prometheus       | Metrics collector                    |
| 9101 | Convex Exporter  | Convex metrics to Prometheus          |
| 3001 | Grafana          | Metrics visualization                |

## Security

- [x] Admin key stored in `./data/admin_key.txt` (not in git)
- [x] All secrets in `.env` (not in git)
- [x] Grafana password configurable
- [x] Convex dashboard should be behind firewall
- [x] Regular security updates: `docker compose -f docker-compose.prod.yml pull`

## Maintenance

### Update Images

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f backend
```

### Restart Services

```bash
docker compose -f docker-compose.prod.yml restart
```

## Troubleshooting

### Services Not Starting

```bash
# Check container status
docker compose -f docker-compose.prod.yml ps

# Check logs
docker compose -f docker-compose.prod.yml logs

# Check health
curl http://localhost:3210/version
```

### Convex Dashboard Can't Connect

1. Verify admin key is correct
2. Check backend is healthy: `curl http://localhost:3210/version`
3. Check `CONVEX_CLOUD_ORIGIN` is correct in `.env`

### Database Connection Issues

1. Verify PostgreSQL is running: `docker compose -f docker-compose.prod.yml ps postgres`
2. Check connection string in `.env`
3. Wait for PostgreSQL to be ready (can take 30s on first start)

## Resource Requirements

**Minimum**:
- 2 vCPUs
- 4GB RAM
- 50GB storage

**Production Recommended**:
- 4 vCPUs
- 8GB RAM
- 100GB SSD storage

## Support

- Convex Discord: https://discord.gg/convex
- GitHub Issues: https://github.com/get-convex/convex-backend/issues
