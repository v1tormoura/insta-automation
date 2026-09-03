FROM node:20-bookworm-slim

# Chromium para Puppeteer (sem baixar o bundled do Puppeteer)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    tzdata \
    curl \
    ffmpeg \
    python3 \
    fonts-noto \
    fonts-liberation \
    # Inter: a fonte do texto do story e da figurinha de link.
    #
    # O pedido foi "fonte do iPhone". SF Pro existe sob licença da Apple, que
    # cobre interfaces de apps das plataformas dela — não um container que
    # queima texto em imagem para o Instagram. Então ela não entra aqui.
    #
    # Inter foi desenhada como equivalente aberta (SIL OFL) e é a substituta
    # padrão: mesma classe de grotesca neutra, altura-x alta, terminais retos.
    # Sem este pacote o drawtext cai em DejaVu ou Liberation, que são de outra
    # época e deixam o texto com cara de documento, não de story.
    fonts-inter \
    # Emoji colorido: sem esta fonte o Chromium desenha uma caixa vazia no lugar
    # de cada emoji do texto da figurinha de link.
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libnspr4 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxss1 \
    --no-install-recommends \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "src/app.js"]
