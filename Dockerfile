# syntax=docker/dockerfile:1.4
FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY apps/web/services/navigator apps/web/services/navigator
RUN npm run build:web:navigator

FROM nginx:1.27-alpine AS runtime

# Workspace BFF routing stays disabled until ACA Easy Auth token issuance,
# audience validation, and the internal BFF app are configured.
ENV CYRENE_WORKSPACE_BFF_ENABLED=false \
    CYRENE_WORKSPACE_BFF_UPSTREAM="" \
    CYRENE_WORKSPACE_BFF_DNS_RESOLVER=168.63.129.16 \
    NGINX_ENVSUBST_FILTER="^CYRENE_WORKSPACE_BFF_(ENABLED|UPSTREAM|DNS_RESOLVER)$"

LABEL org.opencontainers.image.source="https://github.com/DoHorizon-AI/Cyrene-Client"

RUN rm -f /etc/nginx/conf.d/default.conf

COPY --from=builder /app/apps/web/services/navigator/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY cyrene-proxy.conf /etc/nginx/cyrene-proxy.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:80/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
