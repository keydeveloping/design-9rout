# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/package.json
COPY packages/workflow-builder/package.json ./packages/workflow-builder/package.json
RUN pnpm config set minimumReleaseAge 0 \
    && pnpm config set onlyBuiltDependencies sharp,unrs-resolver \
    && pnpm install --frozen-lockfile

FROM deps AS builder
COPY packages/workflow-builder ./packages/workflow-builder
RUN pnpm -C packages/workflow-builder build
COPY client ./client
ARG API_URL=http://server:8000
ENV API_URL=${API_URL}
WORKDIR /app/client
RUN pnpm build

FROM base AS production
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/client/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/client/public ./client/public
COPY --from=builder --chown=nextjs:nodejs /app/client/.next/static ./client/.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "client/server.js"]
