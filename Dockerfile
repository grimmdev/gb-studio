# Build stage
FROM oven/bun:1 AS builder

WORKDIR /app

# Install build dependencies
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# Copy project source
COPY . .

# Download GBDK toolchains and engine dependencies
RUN bun src/scripts/fetchDependencies.ts

# Build the web application bundle
RUN bun run build:web

# Production runtime stage
FROM oven/bun:1-slim

WORKDIR /app

# Copy built application and tools from builder
COPY --from=builder /app /app

# Create volume for persistent project storage
RUN mkdir -p /data/projects
ENV PROJECTS_DIR=/data/projects
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

VOLUME ["/data/projects"]

CMD ["bun", "run", "src/apps/gb-studio-web/server/index.ts"]
