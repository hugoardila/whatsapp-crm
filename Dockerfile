FROM node:20-bookworm

RUN apt-get update     && apt-get install -y --no-install-recommends python3 make g++     && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server /app/server
COPY web /app/web

RUN cd /app/server     && npm ci --omit=dev     && cd /app/web     && npm ci     && npm run build     && rm -rf /app/web/node_modules

WORKDIR /app/server
ENV NODE_ENV=production
CMD ["node", "app.js"]
