# 從 repo 根目錄 build：docker build -f apps/worker/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter worker...
COPY packages/shared packages/shared
COPY apps/worker apps/worker
RUN pnpm --filter worker build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Taipei
RUN apk add --no-cache tzdata
COPY --from=build /repo/apps/worker/dist ./dist
EXPOSE 8787
CMD ["node", "dist/index.mjs"]
