FROM node:22-bookworm-slim

# ffmpeg: conversão dos vídeos, marca d'água e logo, capas, stories 9:16 e Variações de Mídia.
# fonts-inter: a fonte do texto do story (DejaVu fica de reserva).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-inter fonts-dejavu-core tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Upscale de foto com IA (Real-ESRGAN na CPU, scripts/upscale_ia.py). O pacote
# traz a rede e os modelos; libvulkan1 é só o carregador que ele exige (roda em
# modo CPU, sem placa de vídeo) e libomp5 o paralelismo. --no-deps: o pacote
# pede o opencv completo (com libGL); o headless basta.
# Opcional: se algo aqui falhar, a imagem sobe igual e a tela mostra a IA
# como "não instalada" — o deploy nunca cai por causa dela. Fica numa camada
# própria: só é refeita quando esta linha muda, não a cada deploy.
RUN apt-get update \
 && ( ( apt-get install -y --no-install-recommends python3 python3-pip libvulkan1 libomp5-14 \
   && pip3 install --no-cache-dir --break-system-packages --no-deps realesrgan-ncnn-py==2.0.0 \
   && pip3 install --no-cache-dir --break-system-packages numpy==2.4.6 opencv-python-headless==5.0.0.93 pillow==12.3.0 \
   && python3 -c "import realesrgan_ncnn_py" && echo "IA instalada" ) \
   || echo "AVISO: upscale com IA não instalado" ) \
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
