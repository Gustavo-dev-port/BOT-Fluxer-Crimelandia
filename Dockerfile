FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# O postinstall roda "prisma generate", que precisa do schema.
COPY prisma ./prisma
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    DATABASE_URL=file:/data/fluxer.db \
    TZ=America/Sao_Paulo
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
VOLUME /data
# Aplica migrações e sobe o bot.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
