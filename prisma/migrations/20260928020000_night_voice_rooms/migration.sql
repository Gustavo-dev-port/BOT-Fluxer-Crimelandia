-- CreateTable
CREATE TABLE "WeeklyEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tournamentId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VOTING',
    "options" TEXT NOT NULL,
    "game" TEXT,
    "closesAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "WeeklyEvent_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventVote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "weeklyEventId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "option" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventVote_weeklyEventId_fkey" FOREIGN KEY ("weeklyEventId") REFERENCES "WeeklyEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventTeam" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "weeklyEventId" INTEGER NOT NULL,
    "teamId" INTEGER,
    "name" TEXT NOT NULL,
    "voiceChannelId" TEXT,
    CONSTRAINT "EventTeam_weeklyEventId_fkey" FOREIGN KEY ("weeklyEventId") REFERENCES "WeeklyEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VoiceRoom" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "channelId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userLimit" INTEGER NOT NULL DEFAULT 0,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emptySince" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyEvent_tournamentId_key" ON "WeeklyEvent"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "EventVote_weeklyEventId_playerId_key" ON "EventVote"("weeklyEventId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceRoom_channelId_key" ON "VoiceRoom"("channelId");

-- CreateIndex
CREATE INDEX "VoiceRoom_ownerId_idx" ON "VoiceRoom"("ownerId");

