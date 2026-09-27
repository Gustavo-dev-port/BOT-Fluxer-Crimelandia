-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "image" TEXT,
    "oldPrice" INTEGER NOT NULL,
    "currentPrice" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "discount" INTEGER NOT NULL,
    "expiresAt" DATETIME,
    "url" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "channelId" TEXT,
    "messageId" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Promotion_active_discount_idx" ON "Promotion"("active", "discount");

