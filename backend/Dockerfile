# ─────────────────────────────────────────────────────────────────────────────
#  Stage 1 — Install dependencies
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS dependencies

# Install build tools needed by native modules (bcrypt, etc.)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy manifests first so Docker can cache the npm install layer
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDeps for potential build steps)
RUN npm ci --prefer-offline

# ─────────────────────────────────────────────────────────────────────────────
#  Stage 2 — Production image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Security: add dumb-init so Node is not PID 1 (handles signals properly)
RUN apk add --no-cache dumb-init

# Set secure environment defaults
ENV NODE_ENV=production \
    PORT=3001 \
    NODE_OPTIONS="--max-old-space-size=512"

WORKDIR /app

# Copy only production node_modules from deps stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy application source
COPY package.json package-lock.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Create uploads directory with correct permissions before switching user
RUN mkdir -p uploads && \
    addgroup -g 1001 -S nodejs && \
    adduser  -u 1001 -S nodejs -G nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3001

# dumb-init wraps the node process for clean signal handling in containers
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
