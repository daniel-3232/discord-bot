FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

VOLUME ["/app/data"]
ENV DB_PATH=/app/data/bot_memory.db

EXPOSE 3000

CMD ["node", "bot.js"]
