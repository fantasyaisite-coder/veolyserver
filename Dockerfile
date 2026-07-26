FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /app

COPY package*.json ./

USER root
RUN npm install
USER pptruser

COPY . .

ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
