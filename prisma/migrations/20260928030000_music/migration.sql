-- CreateTable
CREATE TABLE "MusicQueue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MusicHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "durationSeconds" INTEGER,
    "requestedById" TEXT NOT NULL,
    "playedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "MusicQueue_guildId_position_idx" ON "MusicQueue"("guildId", "position");

-- CreateIndex
CREATE INDEX "MusicHistory_guildId_playedAt_idx" ON "MusicHistory"("guildId", "playedAt");

-- CreateIndex
CREATE INDEX "MusicHistory_requestedById_idx" ON "MusicHistory"("requestedById");

