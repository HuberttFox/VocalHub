-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'SOURCE_MISSING', 'SOURCE_DELETED');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "Song" (
    "id" UUID NOT NULL,
    "vocadbId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "defaultName" TEXT NOT NULL,
    "defaultNameLanguage" TEXT NOT NULL,
    "artistString" TEXT NOT NULL,
    "songType" TEXT NOT NULL,
    "sourceStatus" TEXT NOT NULL,
    "sourceDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceCreatedAt" TIMESTAMP(3) NOT NULL,
    "publishDate" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL,
    "favoritedTimes" INTEGER NOT NULL,
    "ratingScore" INTEGER NOT NULL,
    "originalVersionId" INTEGER,
    "cultureCodes" TEXT[],
    "coverUrlOriginal" TEXT,
    "coverUrlThumb" TEXT,
    "sourceVersion" INTEGER NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Song_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SongName" (
    "id" UUID NOT NULL,
    "songId" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "SongName_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" UUID NOT NULL,
    "vocadbId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "artistType" TEXT NOT NULL,
    "sourceStatus" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "sourceDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SongArtistCredit" (
    "id" UUID NOT NULL,
    "vocadbId" INTEGER NOT NULL,
    "songId" UUID NOT NULL,
    "artistId" UUID,
    "name" TEXT NOT NULL,
    "categories" TEXT[],
    "roles" TEXT[],
    "effectiveRoles" TEXT[],
    "isSupport" BOOLEAN NOT NULL,
    "isCustomName" BOOLEAN NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "SongArtistCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" UUID NOT NULL,
    "vocadbId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "additionalNames" TEXT[],
    "categoryName" TEXT,
    "urlSlug" TEXT,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SongTag" (
    "songId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "count" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "SongTag_pkey" PRIMARY KEY ("songId","tagId")
);

-- CreateTable
CREATE TABLE "SongPV" (
    "id" UUID NOT NULL,
    "vocadbId" INTEGER NOT NULL,
    "songId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "pvType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "author" TEXT,
    "thumbnailUrl" TEXT,
    "publishDate" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "SongPV_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" UUID NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "requestedCount" INTEGER NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncItem" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "vocadbId" INTEGER NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Song_vocadbId_key" ON "Song"("vocadbId");

-- CreateIndex
CREATE INDEX "Song_publishDate_idx" ON "Song"("publishDate");

-- CreateIndex
CREATE INDEX "Song_sourceStatus_idx" ON "Song"("sourceStatus");

-- CreateIndex
CREATE INDEX "Song_syncStatus_idx" ON "Song"("syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SongName_songId_position_key" ON "SongName"("songId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_vocadbId_key" ON "Artist"("vocadbId");

-- CreateIndex
CREATE UNIQUE INDEX "SongArtistCredit_vocadbId_key" ON "SongArtistCredit"("vocadbId");

-- CreateIndex
CREATE INDEX "SongArtistCredit_songId_position_idx" ON "SongArtistCredit"("songId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_vocadbId_key" ON "Tag"("vocadbId");

-- CreateIndex
CREATE INDEX "SongTag_songId_position_idx" ON "SongTag"("songId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SongPV_vocadbId_key" ON "SongPV"("vocadbId");

-- CreateIndex
CREATE INDEX "SongPV_songId_position_idx" ON "SongPV"("songId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SyncItem_runId_vocadbId_key" ON "SyncItem"("runId", "vocadbId");

-- AddForeignKey
ALTER TABLE "SongName" ADD CONSTRAINT "SongName_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongArtistCredit" ADD CONSTRAINT "SongArtistCredit_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongArtistCredit" ADD CONSTRAINT "SongArtistCredit_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongTag" ADD CONSTRAINT "SongTag_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongTag" ADD CONSTRAINT "SongTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongPV" ADD CONSTRAINT "SongPV_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncItem" ADD CONSTRAINT "SyncItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
