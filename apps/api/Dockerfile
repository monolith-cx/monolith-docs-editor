FROM node:24-alpine AS deps

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/db/index.js ./packages/db/
COPY packages/db/index.d.ts ./packages/db/
RUN pnpm install --frozen-lockfile --filter @monolith-docs/api...

FROM deps AS build

COPY apps/api/ ./apps/api/
COPY packages/db/ ./packages/db/
RUN pnpm --filter @monolith-docs/api run build

FROM node:24-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /workspace

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/db/index.js ./packages/db/
COPY packages/db/index.d.ts ./packages/db/
RUN pnpm install --frozen-lockfile --prod --filter @monolith-docs/api...

COPY --from=build /workspace/apps/api/dist/ ./apps/api/dist/
COPY --from=build /workspace/apps/api/src/fixtures/ ./apps/api/dist/fixtures/
# The bridge plugin's served files only (EDIT-5.1); its tests and package metadata stay out.
COPY apps/plugin/config.json apps/plugin/index.html apps/plugin/bridge.js apps/plugin/commands.js apps/plugin/icon.png ./apps/plugin/

EXPOSE 3020
CMD ["node", "apps/api/dist/server.js"]
