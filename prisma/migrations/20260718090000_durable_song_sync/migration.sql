-- CreateEnum
CREATE TYPE "SyncRunMode" AS ENUM ('IDS', 'SEED', 'INCREMENTAL', 'RECONCILE');

-- AlterTable
ALTER TABLE "SyncRun"
ADD COLUMN "sequence" BIGSERIAL NOT NULL,
ADD COLUMN "mode" "SyncRunMode" NOT NULL DEFAULT 'IDS',
ADD COLUMN "discoveryCompletedAt" TIMESTAMP(3),
ADD COLUMN "activityWindowStart" TIMESTAMP(3),
ADD COLUMN "activityWindowEnd" TIMESTAMP(3),
ADD COLUMN "baselineAt" TIMESTAMP(3),
ADD COLUMN "expectedStateVersion" INTEGER,
ADD COLUMN "sourceIdCount" INTEGER,
ADD COLUMN "sourceIdDigest" TEXT,
ADD COLUMN "errorCode" TEXT,
ADD COLUMN "errorMessage" TEXT,
ALTER COLUMN "requestedCount" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "SyncItem"
ALTER COLUMN "startedAt" DROP NOT NULL,
ALTER COLUMN "startedAt" DROP DEFAULT,
ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VocaDbSongSyncState" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "activityCheckpoint" TIMESTAMP(3),
    "lastSeedCompletedAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VocaDbSongSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncRun_sequence_key" ON "SyncRun"("sequence");
