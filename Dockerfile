# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.json ./
# Only devDependencies needed (typescript) — no runtime deps
RUN npm install --include=dev

COPY src ./src
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Compiled JS (no node_modules needed — zero runtime dependencies)
COPY --from=builder /app/dist ./dist

# Static frontend
COPY public ./public

EXPOSE 3000

# Graceful shutdown: SIGTERM → 5sn drain → exit
STOPSIGNAL SIGTERM

CMD ["node", "dist/api/server.js"]
