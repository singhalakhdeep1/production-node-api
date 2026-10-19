# syntax=docker/dockerfile:1
# --- build: compile TypeScript ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY monitoring ./monitoring
RUN npm run build

# --- runtime: production deps only, PM2 cluster via pm2-runtime ---
FROM node:20-alpine AS runtime
ENV NODE_ENV=production PORT=5000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY ecosystem.config.js ./
RUN mkdir -p logs uploads && chown -R node:node /app
USER node
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/api/health/live || exit 1
CMD ["npx", "pm2-runtime", "start", "ecosystem.config.js", "--env", "production"]
