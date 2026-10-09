FROM node:20.19.5-alpine

WORKDIR /app

# Install curl for healthchecks
RUN apk add --no-cache curl

COPY package*.json ./
RUN npm install --production

COPY server.js .

EXPOSE 8000

CMD ["node", "server.js"]
