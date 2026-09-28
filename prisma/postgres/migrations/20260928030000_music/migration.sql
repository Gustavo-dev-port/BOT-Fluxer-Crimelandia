-- CreateTable
CREATE TABLE "MusicQueue" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "query" TEXT,
    "durationSeconds" INTEGER,
    "thumbnail" TEXT,
    "source" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicHistory" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "durationSeconds" INTEGER,
    "requestedById" TEXT NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MusicQueue_guildId_position_idx" ON "MusicQueue"("guildId", "position");

-- CreateIndex
CREATE INDEX "MusicHistory_guildId_playedAt_idx" ON "MusicHistory"("guildId", "playedAt");

-- CreateIndex
CREATE INDEX "MusicHistory_requestedById_idx" ON "MusicHistory"("requestedById");

