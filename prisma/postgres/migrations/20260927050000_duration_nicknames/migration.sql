-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "durationSeconds" INTEGER;

-- CreateTable
CREATE TABLE "TempNickname" (
    "playerId" TEXT NOT NULL,
    "nick" TEXT NOT NULL,
    "previousNick" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TempNickname_pkey" PRIMARY KEY ("playerId")
);

-- AddForeignKey
ALTER TABLE "TempNickname" ADD CONSTRAINT "TempNickname_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

