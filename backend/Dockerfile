FROM node:22-bookworm-slim

# ffmpeg: conversão dos vídeos, marca d'água e logo, capas, stories 9:16 e Variações de Mídia.
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
COPY scripts ./scripts
# Só a pasta de uploads é escrita pelo app. Um `chown -R /app` aqui regravava
# o node_modules inteiro numa camada nova a cada deploy — tempo e disco à toa.
RUN mkdir -p uploads && chown node:node uploads
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "src/server.js"]
