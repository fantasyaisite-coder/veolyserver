FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_CHROME_PATH=/usr/bin/google-chrome

COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
