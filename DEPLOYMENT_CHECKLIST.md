# Production Deployment Checklist

Use this checklist when deploying to production for the first time.

## Pre-Deployment

### Server Setup

- [ ] SSH access to server configured
- [ ] Docker and Docker Compose installed
- [ ] Git installed on server
- [ ] At least 2 vCPUs, 4GB RAM, 50GB storage
- [ ] Firewall configured to allow necessary ports
- [ ] Domain DNS records configured (A records pointing to server IP)

### External Services

- [ ] WorkOS application created and configured
- [ ] WorkOS redirect URI updated to production domain
- [ ] WorkOS webhook endpoint configured
- [ ] Stripe account created (if using billing)
- [ ] Stripe webhook endpoint configured: `https://your-domain.com/convex/stripe`
- [ ] SSL certificate obtained (Let's Encrypt, Cloudflare, etc.)

### Security

- [ ] Strong INSTANCE_SECRET generated: `openssl rand -base64 64`
- [ ] Strong POSTGRES_PASSWORD generated
- [ ] Strong GF_SECURITY_ADMIN_PASSWORD generated
- [ ] ENCRYPTION_KEY generated for API keys
- [ ] Admin key storage plan (will be saved to `./data/admin_key.txt`)

## Initial Deployment

### 1. Clone Repository

- [ ] Repository cloned to server
- [ ] Created `.env` from `.env.production` template
- [ ] All environment variables filled in:
  - [ ] `DEPLOY_ON_PUSH` (true/false)
  - [ ] `CONVEX_CLOUD_ORIGIN`
  - [ ] `CONVEX_SITE_ORIGIN`
  - [ ] `INSTANCE_SECRET`
  - [ ] `INSTANCE_NAME`
  - [ ] `POSTGRES_URL`
  - [ ] `POSTGRES_USER`
  - [ ] `POSTGRES_PASSWORD`
  - [ ] `POSTGRES_DB`
  - [ ] `WORKOS_CLIENT_ID`
  - [ ] `WORKOS_API_KEY`
  - [ ] `WORKOS_REDIRECT_URI`
  - [ ] `WORKOS_WEBHOOK_SECRET`
  - [ ] `WORKOS_COOKIE_PASSWORD`
  - [ ] `STRIPE_SECRET_KEY` (if using billing)
  - [ ] `STRIPE_WEBHOOK_SECRET` (if using billing)
  - [ ] `STRIPE_*_PRICE_ID` (if using billing)
  - [ ] `ENCRYPTION_KEY`
  - [ ] `CONVEX_EXPORTER_ADMIN_KEY_PATH`
  - [ ] `GF_SECURITY_ADMIN_PASSWORD`

### 2. Database & Backend Setup

- [ ] Run `./scripts/setup-db.sh`
- [ ] PostgreSQL started successfully
- [ ] Convex backend started successfully
- [ ] Admin key generated and saved to `./data/admin_key.txt`
- [ ] Admin key copied and saved to `.env` as `CONVEX_SELF_HOSTED_ADMIN_KEY`

### 3. Monitoring Setup

- [ ] Run `./scripts/monitor-stack.sh`
- [ ] Prometheus started (port 9090)
- [ ] Grafana started (port 3001)
- [ ] Grafana accessible at http://localhost:3001
- [ ] Grafana logged in with admin credentials
- [ ] Prometheus data source configured
- [ ] Dashboards loaded automatically

### 4. Full Stack Startup

- [ ] Run `docker compose -f docker-compose.prod.yml up -d`
- [ ] All containers started successfully
- [ ] Next.js app running on port 3000
- [ ] Convex backend running on port 3210
- [ ] Convex dashboard running on port 6791

### 5. Health Checks

- [ ] Next.js app responds: `curl http://localhost:3000/api/health`
- [ ] Convex backend responds: `curl http://localhost:3210/version`
- [ ] Dashboard accessible at http://localhost:6791
- [ ] Prometheus accessible at http://localhost:9090
- [ ] Grafana accessible at http://localhost:3001

### 6. Convex Dashboard

- [ ] Access Convex Dashboard at http://localhost:6791
- [ ] Paste admin key to authenticate
- [ ] View function logs
- [ ] View deployment status
- [ ] Test functions via dashboard

### 7. External Load Balancer

- [ ] nginx/Cloudflare/ALB configured
- [ ] Routing configured:
  - [ ] `/` → Next.js app (port 3000)
  - [ ] `/convex` → Convex backend (port 3210)
  - [ ] `/dashboard` → Convex dashboard (port 6791)
  - [ ] `/prometheus` → Prometheus (port 9090)
  - [ ] `/grafana` → Grafana (port 3001)
- [ ] SSL/HTTPS configured
- [ ] Test external access to https://your-domain.com

### 8. Convex Code Deployment

- [ ] Run `npx convex deploy` locally
- [ ] Functions deployed successfully
- [ ] Dashboard shows new functions

### 9. Final Testing

- [ ] User registration works
- [ ] Login with WorkOS works
- [ ] Main application features work
- [ ] Stripe checkout (if billing)
- [ ] Subscription status updates
- [ ] API keys work (if applicable)

## CI/CD Setup (Optional)

- [ ] GitHub repository connected
- [ ] `SERVER_HOST` secret added to GitHub
- [ ] `SERVER_USER` secret added to GitHub
- [ ] `SSH_KEY` secret added to GitHub
- [ ] `.github/workflows/deploy.yml` configured
- [ ] Test push to `main` branch triggers deployment

## Ongoing Operations

### Daily

- [ ] Check Grafana dashboards for errors
- [ ] Review Convex function logs
- [ ] Monitor system resources

### Weekly

- [ ] Review backup status
- [ ] Check for Docker image updates
- [ ] Review error logs

### Monthly

- [ ] Review and prune old backups (if needed)
- [ ] Update Docker images: `docker compose -f docker-compose.prod.yml pull`
- [ ] Review SSL certificate expiration

## Disaster Recovery

- [ ] Backup script tested: `./scripts/backup.sh`
- [ ] Backup location known
- [ ] Restore process documented
- [ ] Rollback procedure tested

## Security Review

- [ ] `.env` never committed to git
- [ ] Admin key stored securely
- [ ] Dashboard access restricted (firewall/VPN)
- [ ] Regular security updates applied
- [ ] Access logs reviewed periodically

## Post-Deployment

- [ ] Monitor system for 24-48 hours
- [ ] Document any issues
- [ ] Update team on deployment
- [ ] Create monitoring alerts
- [ ] Schedule regular reviews

## Notes

- Keep all backups forever (no auto-cleanup)
- Convex manages PostgreSQL - no direct DB access needed
- Always use `deploy.sh` for deployments (includes rollback)
- Admin key is required for dashboard access - keep it safe
