-- CreateTable
CREATE TABLE "CommunityMember" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "joinedAt" DATETIME,
    "welcomedAt" DATETIME,
    "welcomeMessageId" TEXT,
    "initialRoleId" TEXT,
    "initialRoleAt" DATETIME,
    "activityPoints" INTEGER NOT NULL DEFAULT 0,
    "promotedAt" DATETIME,
    "promotionCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "actorId" TEXT,
    "roleId" TEXT,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GuildSettings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "commandsChannelId" TEXT,
    "scoreboardChannelId" TEXT,
    "matchesChannelId" TEXT,
    "eventChannelId" TEXT,
    "promoChannelId" TEXT,
    "freeGamesChannelId" TEXT,
    "musicChannelId" TEXT,
    "hallChannelId" TEXT,
    "promoRoleId" TEXT,
    "championRoleId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "welcomeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "welcomeChannelId" TEXT,
    "welcomeMessage" TEXT,
    "welcomeDMEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultMemberRoleId" TEXT,
    "automaticPromotionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "minimumDays" INTEGER NOT NULL DEFAULT 7,
    "minimumActivityPoints" INTEGER NOT NULL DEFAULT 50,
    "promotionRoleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_GuildSettings" ("championRoleId", "commandsChannelId", "createdAt", "eventChannelId", "freeGamesChannelId", "guildId", "hallChannelId", "language", "matchesChannelId", "musicChannelId", "promoChannelId", "promoRoleId", "scoreboardChannelId", "updatedAt") SELECT "championRoleId", "commandsChannelId", "createdAt", "eventChannelId", "freeGamesChannelId", "guildId", "hallChannelId", "language", "matchesChannelId", "musicChannelId", "promoChannelId", "promoRoleId", "scoreboardChannelId", "updatedAt" FROM "GuildSettings";
DROP TABLE "GuildSettings";
ALTER TABLE "new_GuildSettings" RENAME TO "GuildSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CommunityMember_guildId_promotedAt_activityPoints_idx" ON "CommunityMember"("guildId", "promotedAt", "activityPoints");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMember_guildId_userId_key" ON "CommunityMember"("guildId", "userId");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt");
