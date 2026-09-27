-- AlterTable
ALTER TABLE "Match" ADD COLUMN "durationSeconds" INTEGER;

-- CreateTable
CREATE TABLE "TempNickname" (
    "playerId" TEXT NOT NULL PRIMARY KEY,
    "nick" TEXT NOT NULL,
    "previousNick" TEXT,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "TempNickname_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

