-- CreateEnum
CREATE TYPE "DiscoverySnapshotStatus" AS ENUM ('BUILDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "DiscoveryCatalogState" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryCatalogState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryProfile" (
    "userId" UUID NOT NULL,
    "libraryVersion" INTEGER NOT NULL DEFAULT 0,
    "requiredCatalogVersion" INTEGER NOT NULL DEFAULT 0,
    "currentSnapshotId" UUID,
    "refreshStartedAt" TIMESTAMP(3),
    "lastRefreshError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "DiscoverySnapshot" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "libraryVersion" INTEGER NOT NULL,
    "catalogVersion" INTEGER NOT NULL,
    "status" "DiscoverySnapshotStatus" NOT NULL DEFAULT 'BUILDING',
    "seedCount" INTEGER NOT NULL DEFAULT 0,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DiscoverySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoverySnapshotItem" (
    "snapshotId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "songId" UUID NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "DiscoverySnapshotItem_pkey" PRIMARY KEY ("snapshotId", "rank")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryProfile_currentSnapshotId_key" ON "DiscoveryProfile"("currentSnapshotId");

-- CreateIndex
CREATE INDEX "DiscoveryProfile_requiredCatalogVersion_updatedAt_idx" ON "DiscoveryProfile"("requiredCatalogVersion", "updatedAt");

-- CreateIndex
CREATE INDEX "DiscoverySnapshot_userId_status_startedAt_idx" ON "DiscoverySnapshot"("userId", "status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverySnapshotItem_snapshotId_songId_key" ON "DiscoverySnapshotItem"("snapshotId", "songId");

-- AddForeignKey
ALTER TABLE "DiscoveryProfile" ADD CONSTRAINT "DiscoveryProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryProfile" ADD CONSTRAINT "DiscoveryProfile_currentSnapshotId_fkey" FOREIGN KEY ("currentSnapshotId") REFERENCES "DiscoverySnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoverySnapshot" ADD CONSTRAINT "DiscoverySnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoverySnapshotItem" ADD CONSTRAINT "DiscoverySnapshotItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DiscoverySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoverySnapshotItem" ADD CONSTRAINT "DiscoverySnapshotItem_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
