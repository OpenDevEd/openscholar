# Built from the repository root (Coolify: base directory "/", Dockerfile "/marketing/Dockerfile"), because the
# site shares its analytics and consent code with the app, in lib/.
FROM node:26-alpine AS build
WORKDIR /site/marketing
COPY marketing/package.json marketing/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY lib /site/lib
COPY marketing ./
RUN npm run build

FROM caddy:2-alpine
COPY marketing/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /site/marketing/dist /srv
