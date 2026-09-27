# syntax=docker/dockerfile:1.4
FROM node:24-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_WORKSPACE_BFF_ENABLED=false
ENV VITE_WORKSPACE_BFF_ENABLED=${VITE_WORKSPACE_BFF_ENABLED}
RUN npm run build

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache ca-certificates
ENV CYRENE_WORKSPACE_BFF_ENABLED=false \
    CYRENE_WORKSPACE_BFF_UPSTREAM="" \
    CYRENE_WORKSPACE_BFF_DNS_RESOLVER=168.63.129.16 \
    CYRENE_WORKSPACE_BFF_EXPECTED_ENV_DOMAIN=whitefield-8c4d4393.eastasia.azurecontainerapps.io \
    NGINX_ENVSUBST_FILTER="^(STUDIO_CONTROL_ORIGIN|CYRENE_WORKSPACE_BFF_(ENABLED|UPSTREAM|DNS_RESOLVER))$"

LABEL org.opencontainers.image.source="https://github.com/DoHorizon-AI/Cyrene-Client"

COPY --from=builder /app/dist /usr/share/nginx/html
ENV STUDIO_CONTROL_ORIGIN=http://studio-control:5182
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY cyrene-proxy.conf /etc/nginx/cyrene-proxy.conf
COPY --chmod=755 tooling/validate-workspace-bff-upstream.sh /docker-entrypoint.d/10-validate-workspace-bff-upstream.sh

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:80/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
