# Build from the repo root: docker build -f infra/api/Dockerfile -t kahanmilega-api .
# Pinned to an exact version and digest; bump with .nvmrc and ADR-0008.
ARG NODE_IMAGE=node:24.21.0-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY apps/simulator/package.json apps/simulator/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
# The API serves the web app's build under /app/ (ADR-0017): one image, one deploy.
RUN npm run build -w @askbuy/shared && npm run build -w @askbuy/api && npm run build -w @askbuy/web

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY apps/simulator/package.json apps/simulator/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev -w @askbuy/api

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ARG GIT_SHA=
ENV GIT_SHA=${GIT_SHA}
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --chown=node:node packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/apps/web/dist apps/web/dist
COPY --chown=node:node apps/api/package.json apps/api/package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
