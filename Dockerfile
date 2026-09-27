# syntax=docker/dockerfile:1.4
FROM node:24-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime

LABEL org.opencontainers.image.source="https://github.com/DoHorizon-AI/Cyrene-Client"

COPY --from=builder /app/dist /usr/share/nginx/html
ENV STUDIO_CONTROL_ORIGIN=http://studio-control:5182
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY cyrene-proxy.conf /etc/nginx/cyrene-proxy.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:80/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
