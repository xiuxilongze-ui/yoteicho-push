FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# 依存関係だけ先に入れて、キャッシュを効かせる
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# アプリ本体（.dockerignore で node_modules / data は除外済み）
COPY . .

ENV PORT=3000
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
