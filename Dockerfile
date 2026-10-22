# Build stage
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Ensure essential build tools are present
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    tar \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Enable corepack for yarn
RUN corepack enable

# Install build dependencies
COPY package.json yarn.lock* ./
RUN yarn install || npm install

# Copy project source
COPY . .

# Download GBDK toolchains and engine dependencies
RUN npm run fetch-deps

# Build the web application and bundled Express server
RUN npm run make:web

# Production runtime stage
FROM node:24-bookworm-slim

WORKDIR /app

# Copy built web application bundle and server
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/appData ./appData
COPY --from=builder /app/buildTools ./buildTools
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/README.md ./README.md

# Create volume for persistent project storage
RUN mkdir -p /data/projects
ENV PROJECTS_DIR=/data/projects
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3000

VOLUME ["/data/projects"]

CMD ["node", "out/web/server.js"]
