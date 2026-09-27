-- CreateTable
CREATE TABLE "FreeGame" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'free',
    "description" TEXT,
    "image" TEXT,
    "url" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "channelId" TEXT,
    "messageId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreeGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FreeGame_active_endsAt_idx" ON "FreeGame"("active", "endsAt");

