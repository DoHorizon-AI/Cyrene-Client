# syntax=docker/dockerfile:1.4
FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY apps/web/services/navigator apps/web/services/navigator
RUN npm run build:web:navigator

FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/apps/web/services/navigator/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:80/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
