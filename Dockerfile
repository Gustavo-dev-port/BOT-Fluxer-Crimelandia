# Imagem de produção: PostgreSQL. (SQLite é só para desenvolvimento local.)
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# O postinstall roda "prisma generate", que precisa do schema.
COPY prisma ./prisma
COPY scripts ./scripts
RUN npm ci
# Troca o Prisma Client para PostgreSQL.
RUN npm run db:postgres:generate
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# yt-dlp (música): binário independente oficial. O ffmpeg vem do pacote npm @ffmpeg-installer/ffmpeg.
ADD --chmod=755 https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux /usr/local/bin/yt-dlp
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    LOG_DIR=/app/logs
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
VOLUME /app/logs
# Aplica as migrações do PostgreSQL e sobe o bot.
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/postgres/schema.prisma && node dist/index.js"]
