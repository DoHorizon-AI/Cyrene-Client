FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM build AS control
ENV NODE_ENV=production STUDIO_CONTROL_HOST=0.0.0.0
USER node
EXPOSE 5182
CMD ["node", "--import", "tsx", "apps/control/main.ts"]

FROM nginx:stable-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
