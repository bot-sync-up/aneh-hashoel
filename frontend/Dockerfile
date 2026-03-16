# ─────────────────────────────────────────────────────────────────────────────
#  Stage 1 — Build React app
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Accept build-time API URLs as ARGs so the Vite build bakes them in
ARG VITE_API_URL=http://localhost:3001
ARG VITE_WS_URL=ws://localhost:3001

ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL

# Install dependencies first (cached layer)
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

# Copy source and build
COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
#  Stage 2 — Serve with Nginx
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.25-alpine AS production

# Remove default Nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom Nginx config
COPY nginx.conf /etc/nginx/conf.d/app.conf

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Nginx runs as root by default inside Alpine; the process itself drops privs.
# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
