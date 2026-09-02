# Multi-stage build for GHL-NUVEI Custom App
# Stage 1: Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Stage 2: Production stage
FROM node:18-alpine

WORKDIR /app

# Copy relevant files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY public ./public

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# su-exec drops from root to the nodejs user in the entrypoint, after that
# script has fixed ownership of the mounted volume — see docker-entrypoint.sh
# and src/services/ghlTokenStore.js for why this is needed.
RUN apk add --no-cache su-exec

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Deliberately no USER directive here — the container starts as root so the
# entrypoint can chown the volume mount, then immediately drops to nodejs.

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Expose port
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
