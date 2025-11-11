# Usa imagem Node estável
FROM node:22-bullseye

# Instala dependências necessárias pro Chromium do Puppeteer
RUN apt-get update && apt-get install -y \
  wget \
  gnupg \
  libxshmfence1 \
  libnss3 \
  libgbm1 \
  libasound2 \
  libxss1 \
  libgtk-3-0 \
  libdrm2 \
  libxdamage1 \
  libxcomposite1 \
  libxrandr2 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libatspi2.0-0 \
  libpangocairo-1.0-0 \
  libpango-1.0-0 \
  libcairo2 \
  libx11-xcb1 \
  libx11-6 \
  fonts-liberation \
  libappindicator3-1 \
  libgbm-dev \
  xdg-utils \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copia os arquivos
WORKDIR /app
COPY . .

# Instala dependências do Node
RUN npm install --omit=dev

# Expõe porta padrão do Railway
EXPOSE 8080

# Inicia o app
CMD ["npm", "start"]
