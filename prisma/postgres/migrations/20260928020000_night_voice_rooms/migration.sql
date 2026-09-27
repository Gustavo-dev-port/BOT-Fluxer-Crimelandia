-- CreateTable
CREATE TABLE "WeeklyEvent" (
    "id" SERIAL NOT NULL,
    "tournamentId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VOTING',
    "options" TEXT NOT NULL,
    "game" TEXT,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WeeklyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventVote" (
    "id" SERIAL NOT NULL,
    "weeklyEventId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "option" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTeam" (
    "id" SERIAL NOT NULL,
    "weeklyEventId" INTEGER NOT NULL,
    "teamId" INTEGER,
    "name" TEXT NOT NULL,
    "voiceChannelId" TEXT,

    CONSTRAINT "EventTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceRoom" (
    "id" SERIAL NOT NULL,
    "channelId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userLimit" INTEGER NOT NULL DEFAULT 0,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emptySince" TIMESTAMP(3),

    CONSTRAINT "VoiceRoom_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyEvent_tournamentId_key" ON "WeeklyEvent"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "EventVote_weeklyEventId_playerId_key" ON "EventVote"("weeklyEventId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceRoom_channelId_key" ON "VoiceRoom"("channelId");

-- CreateIndex
CREATE INDEX "VoiceRoom_ownerId_idx" ON "VoiceRoom"("ownerId");

-- AddForeignKey
ALTER TABLE "WeeklyEvent" ADD CONSTRAINT "WeeklyEvent_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventVote" ADD CONSTRAINT "EventVote_weeklyEventId_fkey" FOREIGN KEY ("weeklyEventId") REFERENCES "WeeklyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTeam" ADD CONSTRAINT "EventTeam_weeklyEventId_fkey" FOREIGN KEY ("weeklyEventId") REFERENCES "WeeklyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

