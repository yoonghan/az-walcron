# ─── Stage 1: Build & Bundle ─────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY applicationinsights.json ./
RUN npm run build

# ─── Stage 2: Minimal runtime image ──────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Run as a non-root user
USER node

# We only need the bundled output to minimize image size
COPY --from=builder /app/dist/index.js ./index.js

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "index.js"]
