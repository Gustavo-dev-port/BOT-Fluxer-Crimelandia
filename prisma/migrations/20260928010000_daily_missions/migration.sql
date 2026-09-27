-- CreateTable
CREATE TABLE "DailyMission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "reward" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PlayerMission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "missionId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completedAt" DATETIME,
    "claimedAt" DATETIME,
    CONSTRAINT "PlayerMission_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "DailyMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlayerMission_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DailyMission_date_idx" ON "DailyMission"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMission_date_kind_key" ON "DailyMission"("date", "kind");

-- CreateIndex
CREATE INDEX "PlayerMission_playerId_idx" ON "PlayerMission"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerMission_missionId_playerId_key" ON "PlayerMission"("missionId", "playerId");

