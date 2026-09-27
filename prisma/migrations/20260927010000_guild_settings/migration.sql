-- CreateTable
CREATE TABLE "GuildSettings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "commandsChannelId" TEXT,
    "scoreboardChannelId" TEXT,
    "matchesChannelId" TEXT,
    "eventChannelId" TEXT,
    "promoChannelId" TEXT,
    "freeGamesChannelId" TEXT,
    "musicChannelId" TEXT,
    "promoRoleId" TEXT,
    "championRoleId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

