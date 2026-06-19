# Imagen base Node.js 20 slim (Linux)
FROM node:20-slim

# Instalar Chromium y dependencias necesarias para Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Indicar a Puppeteer que use el Chromium del sistema (evita descarga duplicada)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# Instalar dependencias primero (layer cache)
COPY package*.json ./
RUN npm ci --only=production

# Copiar el codigo fuente
COPY . .

# Crear directorio de sesion de WhatsApp
RUN mkdir -p .wwebjs_auth

EXPOSE 5000

CMD ["node", "server.js"]
