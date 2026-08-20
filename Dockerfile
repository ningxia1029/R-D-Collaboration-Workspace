# syntax=docker/dockerfile:1.7

FROM node:24.12.0-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM dependencies AS builder
COPY . .
# 构建只使用不可连接的占位配置；真实 Secret 仅在运行容器时注入。
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/workbuddy_build_not_used \
    AUTH_SECRET=build-only-secret-never-used-at-runtime-32bytes \
    AUTH_TRUST_HOST=true \
    NEXT_PUBLIC_DEMO_MODE=false \
    DEPLOYMENT_ENV=production \
    AUTH_RATE_LIMIT_MODE=gateway \
    npx prisma generate && npm run build && npm run standalone:prepare

FROM dependencies AS migration
ENTRYPOINT ["npx", "prisma", "migrate", "deploy"]

FROM dependencies AS uat-tools
COPY . .

FROM node:24.12.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nextjs \
    && useradd --system --uid 1001 --gid nextjs nextjs

COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
