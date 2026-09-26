-- CreateTable
CREATE TABLE "ReactionPrompt" (
    "messageId" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "matchId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ReactionPrompt_matchId_idx" ON "ReactionPrompt"("matchId");
