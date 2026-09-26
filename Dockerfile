# syntax=docker/dockerfile:1.4
FROM node:24-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY apps/web/services/navigator apps/web/services/navigator
RUN npm --prefix apps/web/services/navigator ci
RUN npm run build:web:navigator

FROM nginx:1.27-alpine AS runtime

LABEL org.opencontainers.image.source="https://github.com/DoHorizon-AI/Cyrene-Client"

COPY --from=builder /app/apps/web/services/navigator/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY cyrene-proxy.conf /etc/nginx/cyrene-proxy.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:80/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
