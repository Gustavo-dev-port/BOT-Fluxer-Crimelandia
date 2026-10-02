-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN     "automaticPromotionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "defaultMemberRoleId" TEXT,
ADD COLUMN     "minimumActivityPoints" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "minimumDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "promotionRoleId" TEXT,
ADD COLUMN     "welcomeChannelId" TEXT,
ADD COLUMN     "welcomeDMEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "welcomeEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "welcomeMessage" TEXT;

-- CreateTable
CREATE TABLE "CommunityMember" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "joinedAt" TIMESTAMP(3),
    "welcomedAt" TIMESTAMP(3),
    "welcomeMessageId" TEXT,
    "initialRoleId" TEXT,
    "initialRoleAt" TIMESTAMP(3),
    "activityPoints" INTEGER NOT NULL DEFAULT 0,
    "promotedAt" TIMESTAMP(3),
    "promotionCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "actorId" TEXT,
    "roleId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunityMember_guildId_promotedAt_activityPoints_idx" ON "CommunityMember"("guildId", "promotedAt", "activityPoints");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMember_guildId_userId_key" ON "CommunityMember"("guildId", "userId");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt");
