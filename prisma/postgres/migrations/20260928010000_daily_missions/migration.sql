-- CreateTable
CREATE TABLE "DailyMission" (
    "id" SERIAL NOT NULL,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "reward" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyMission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerMission" (
    "id" SERIAL NOT NULL,
    "missionId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "PlayerMission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyMission_date_idx" ON "DailyMission"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMission_date_kind_key" ON "DailyMission"("date", "kind");

-- CreateIndex
CREATE INDEX "PlayerMission_playerId_idx" ON "PlayerMission"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerMission_missionId_playerId_key" ON "PlayerMission"("missionId", "playerId");

-- AddForeignKey
ALTER TABLE "PlayerMission" ADD CONSTRAINT "PlayerMission_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "DailyMission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMission" ADD CONSTRAINT "PlayerMission_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

