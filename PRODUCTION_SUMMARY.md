# Production Deployment - Summary

## What Was Created

### Core Infrastructure Files

1. **Dockerfile** - Multi-stage Next.js production build
   - Optimized image size
   - Health checks
   - Production-ready

2. **docker-compose.prod.yml** - Production orchestration
   - 7 services: app, backend, dashboard, postgres, prometheus, grafana, convex-exporter
   - Persistent volumes
   - Health checks
   - Internal networking

3. **.env.production** - Environment variable template
   - All required variables documented
   - Customizable deployment trigger (`DEPLOY_ON_PUSH`)
   - Security best practices

### Deployment Scripts

1. **scripts/deploy.sh** - Automated deployment
   - Checks `DEPLOY_ON_PUSH` flag
   - Pulls latest code
   - Builds new images
   - Auto-rollback on health check failure
   - Deploys Convex code

2. **scripts/setup-db.sh** - Database initialization
   - Starts PostgreSQL
   - Starts Convex backend
   - Generates admin key
   - **Saves admin key to file** (`./data/admin_key.txt`)
   - **Displays admin key in terminal** for copying

3. **scripts/backup.sh** - Backup creation
   - Backs up PostgreSQL
   - Backs up Convex data volume
   - Backs up Grafana config
   - Backs up Prometheus data
   - **Keeps all backups forever** (no cleanup)

4. **scripts/monitor-stack.sh** - Monitoring setup
   - Creates Prometheus config
   - Creates Grafana provisioning
   - Starts monitoring stack
   - 15-day retention

### Monitoring & Observability

1. **Prometheus** - Metrics collection (port 9090)
   - Scrapes every 15s
   - 15-day data retention
   - Targets: app, backend, postgres, convex-exporter

2. **Grafana** - Metrics visualization (port 3001)
   - Pre-configured data source (Prometheus)
   - Auto-loaded dashboards

3. **Grafana Dashboards** - 4 dashboards included
   - `docker-containers.json` - Container CPU, memory, network
   - `postgres-metrics.json` - Connections, queries, performance
   - `system-overview.json` - Host CPU, memory, disk, network
   - `convex-metrics.json` - Function execution, DB I/O, errors

4. **convex-exporter/** - Custom Convex metrics exporter
   - `Dockerfile` - Go-based exporter
   - `main.go` - Queries Convex logs API, exports Prometheus metrics
   - `go.mod` - Go dependencies
   - Port 9101
   - Metrics exported:
     - Function execution times
     - Function call counts
     - Database read/write bytes
     - Error rates
     - Query cache hit rate

### CI/CD

1. **.github/workflows/deploy.yml** - GitHub Actions workflow
   - Triggers on push to `main`
   - Runs `deploy.sh` on server
   - Success/failure notifications

### Documentation

1. **DEPLOYMENT.md** - Complete deployment guide
   - Architecture overview
   - Quick start guide
   - Configuration details
   - Troubleshooting section

2. **DEPLOYMENT_CHECKLIST.md** - Deployment checklist
   - Pre-deployment requirements
   - Step-by-step deployment process
   - Ongoing operations
   - Disaster recovery

3. **README.md** - Updated with deployment section

## Key Features Implemented

### ✅ Convex Self-Hosted Setup
- Convex backend configured for production
- Convex dashboard with admin key authentication
- Admin key saved to file AND displayed in terminal
- PostgreSQL managed entirely by Convex (you only provide connection string)

### ✅ Customizable Deployment Trigger
- `DEPLOY_ON_PUSH=true` - Auto-deploy on git push
- `DEPLOY_ON_PUSH=false` - Manual deployment only
- CI/CD checks flag before deploying

### ✅ Auto-Rollback on Failure
- Health checks after deployment
- Automatic rollback if 3+ services unhealthy
- Restores previous container state

### ✅ Complete Monitoring Stack
- Prometheus + Grafana
- 4 pre-configured dashboards
- Custom Convex metrics exporter
- 15-day data retention

### ✅ Backup Strategy
- Manual backup script
- Backs up all critical data
- **Keeps all backups forever** (no auto-cleanup)

### ✅ Build Directly on Server
- No external Docker registry
- Docker Compose builds images
- Faster deployment for small teams

## Architecture Summary

```
┌─────────────────────────────────────────────────────┐
│           External Load Balancer (Cloudflare/ALB)   │
│                      SSL Termination                 │
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
    │  PostgreSQL 17           │ ← Port 5432 (Convex-managed)
    │  Convex-managed         │
    └───────────────────────────┘
    
    ┌───────────┐
    │ Prometheus │ ← Port 9090
    │ Grafana    │ ← Port 3001
    └───────────┘
    
    ┌─────────────────┐
    │ Convex Exporter│ ← Port 9101 (bridges Convex → Prometheus)
    └─────────────────┘
```

## Port Exposure

| Port | Service           | Description                          |
|------|-------------------|--------------------------------------|
| 3000 | Next.js App       | Main application                     |
| 3210 | Convex API       | Convex backend API                   |
| 3211 | Convex HTTP      | Convex HTTP actions                  |
| 5432 | PostgreSQL       | Database (internal only)              |
| 6791 | Convex Dashboard | Admin interface                      |
| 9090 | Prometheus       | Metrics collector                    |
| 9101 | Convex Exporter  | Convex metrics → Prometheus          |
| 3001 | Grafana          | Metrics visualization                |

## Deployment Process

### Initial Setup (one-time)
```bash
# 1. Clone repository
git clone https://github.com/your-username/openalex-count.git
cd openalex-count

# 2. Create environment file
cp .env.production .env
nano .env  # Fill in all variables

# 3. Setup database and backend
./scripts/setup-db.sh
# → Admin key saved to ./data/admin_key.txt
# → Admin key displayed in terminal (copy it)

# 4. Update .env with admin key
# CONVEX_SELF_HOSTED_ADMIN_KEY="your-admin-key"

# 5. Setup monitoring
./scripts/monitor-stack.sh

# 6. Start full stack
docker compose -f docker-compose.prod.yml up -d

# 7. Access services
# - Next.js: http://localhost:3000
# - Dashboard: http://localhost:6791 (paste admin key)
# - Prometheus: http://localhost:9090
# - Grafana: http://localhost:3001
```

### Ongoing Deployment

**Automatic** (if `DEPLOY_ON_PUSH=true`):
```bash
git push origin main
# → GitHub Actions triggers deployment
# → deploy.sh runs automatically
# → Auto-rollback on failure
```

**Manual**:
```bash
./scripts/deploy.sh
```

### Backup
```bash
./scripts/backup.sh
# → Creates backup in ./backups/YYYYMMDD-HHMMSS/
# → Keeps all backups forever
```

## Security Checklist

- [x] Admin key saved to file (`./data/admin_key.txt`)
- [x] Admin key displayed in terminal for copying
- [x] All secrets in `.env` (not in git)
- [x] Admin key file permission: 600
- [x] Grafana password configurable
- [x] Dashboard should be behind firewall
- [x] PostgreSQL internal only (not exposed)

## Next Steps

### Immediate
1. Review `DEPLOYMENT.md` for detailed setup
2. Complete `DEPLOYMENT_CHECKLIST.md` during deployment
3. Test deployment in staging environment first

### Before First Production Deployment
1. Generate all required secure tokens
2. Configure WorkOS webhooks
3. Configure Stripe webhooks (if using billing)
4. Set up SSL certificates
5. Configure external load balancer routing

### After Deployment
1. Monitor Grafana dashboards for 24-48 hours
2. Set up monitoring alerts
3. Document any issues found
4. Schedule regular reviews

## Questions Resolved

✅ **Customizable deployment trigger** - Set `DEPLOY_ON_PUSH=true/false` in `.env`
✅ **Convex metrics included** - Custom exporter + Grafana dashboard
✅ **Admin key saved to file** - Saved to `./data/admin_key.txt`
✅ **Admin key displayed in terminal** - Shown by `setup-db.sh`
✅ **Keep all backups** - No auto-cleanup in backup script
✅ **PostgreSQL managed by Convex** - You only provide connection string
✅ **Auto-rollback on failure** - Implemented in `deploy.sh`
✅ **Build directly on server** - No external Docker registry needed
✅ **Monitoring exposed on ports** - Prometheus (9090), Grafana (3001)

## Support

- [DEPLOYMENT.md](./DEPLOYMENT.md) - Complete deployment guide
- [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) - Step-by-step checklist
- Convex Discord: https://discord.gg/convex
- GitHub Issues: https://github.com/get-convex/convex-backend/issues
