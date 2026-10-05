FROM node:22.21.0-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY server.js .

EXPOSE 8000

CMD ["node", "server.js"]
