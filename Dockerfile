ARG NODE_VERSION=22-bookworm-slim

# =========================
# Stage 1: Install dependencies + Chrome
# =========================
FROM node:${NODE_VERSION} AS stage1

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then \
        npm ci --no-audit --no-fund; \
    else \
        echo "no lock file" && exit 1; \
    fi

# Install Puppeteer's required Chrome
RUN npx puppeteer browsers install chrome


# =========================
# Stage 2: Build application
# =========================
FROM node:${NODE_VERSION} AS stage2

WORKDIR /app

COPY --from=stage1 /app/node_modules ./node_modules
COPY --from=stage1 /app/prisma ./prisma

COPY . .

ENV NODE_OPTIONS="--max-old-space-size=4096"

# Dummy DATABASE_URL for Prisma/Next.js build
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

RUN npx prisma generate

RUN if [ -f package-lock.json ]; then \
        npm run build; \
    else \
        echo "build failed" && exit 1; \
    fi


# =========================
# Stage 3: Production
# =========================
FROM node:${NODE_VERSION} AS stage3

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Puppeteer cache location for the node user
ENV PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer

# Copy Chrome downloaded in stage 1
COPY --from=stage1 /root/.cache/puppeteer /home/node/.cache/puppeteer

# Copy application
COPY --from=stage2 --chown=node:node /app/public ./public

RUN mkdir .next
RUN chown node:node .next

COPY --from=stage2 --chown=node:node /app/.next/standalone ./
COPY --from=stage2 --chown=node:node /app/.next/static ./.next/static

# Give node ownership of Puppeteer Chrome
RUN chown -R node:node /home/node/.cache/puppeteer

USER node

EXPOSE 4173

CMD ["node", "server.js"]