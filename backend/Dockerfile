FROM node:22-bookworm-slim

# ffmpeg: humanização, marca d'água, capa, story 9:16 e texto queimado.
# fonts-inter: a fonte do texto do story (DejaVu fica de reserva).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-inter fonts-dejavu-core tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    # Em VPS com IPv6 quebrado, o fetch do Node tenta IPv6 primeiro e a Graph
    # API devolve respostas sem sentido. IPv4 primeiro, sempre.
    NODE_OPTIONS=--dns-result-order=ipv4first \
    PORT=3000

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
RUN mkdir -p uploads && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "src/server.js"]
