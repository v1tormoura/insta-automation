# Build a partir da raiz do monorepo: docker build -f apps/api/Dockerfile .
# A mesma imagem roda a API (padrão) e o worker (command: node dist/worker.js).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN MONGOMS_DISABLE_POSTINSTALL=1 npm ci --workspace @nexora/api --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @nexora/api

FROM node:22-alpine AS runtime
# ffmpeg/ffprobe: duração, resolução e miniatura dos vídeos enviados.
RUN apk add --no-cache ffmpeg tini
ENV NODE_ENV=production \
    STORAGE_DIR=/data/storage \
    # IPv4 primeiro: rotas IPv6 quebradas até a Meta já causaram respostas sem sentido do fetch.
    NODE_OPTIONS=--dns-result-order=ipv4first
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN MONGOMS_DISABLE_POSTINSTALL=1 npm ci --omit=dev --workspace @nexora/api --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
