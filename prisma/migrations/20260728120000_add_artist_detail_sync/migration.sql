-- AlterEnum
ALTER TYPE "SyncRunMode" ADD VALUE 'REFRESH';

-- CreateEnum
CREATE TYPE "SyncEntity" AS ENUM ('SONG', 'ARTIST');

-- AlterTable
ALTER TABLE "SyncRun"
ADD COLUMN "entity" "SyncEntity" NOT NULL DEFAULT 'SONG',
ADD COLUMN "refreshCutoffAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Artist"
ADD COLUMN "defaultName" TEXT,
ADD COLUMN "defaultNameLanguage" TEXT,
ADD COLUMN "additionalNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "description" TEXT,
ADD COLUMN "sourceCreatedAt" TIMESTAMP(3),
ADD COLUMN "releaseDate" TIMESTAMP(3),
ADD COLUMN "mergedToVocaDbId" INTEGER,
ADD COLUMN "pictureMime" TEXT,
ADD COLUMN "pictureUrlOriginal" TEXT,
ADD COLUMN "pictureUrlThumb" TEXT,
ADD COLUMN "pictureUrlSmallThumb" TEXT,
ADD COLUMN "pictureUrlTinyThumb" TEXT,
ADD COLUMN "detailLastAttemptAt" TIMESTAMP(3),
ADD COLUMN "detailLastSyncedAt" TIMESTAMP(3),
ADD COLUMN "lastSyncError" TEXT,
ADD COLUMN "summaryName" TEXT,
ADD COLUMN "summaryArtistType" TEXT,
ADD COLUMN "summaryAdditionalNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "summarySourceStatus" TEXT,
ADD COLUMN "summarySourceVersion" INTEGER,
ADD COLUMN "summarySourceDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "summaryObservedAt" TIMESTAMP(3);

-- Backfill existing summary-derived Artist rows before enforcing ownership columns.
UPDATE "Artist"
SET
  "defaultName" = "name",
  "defaultNameLanguage" = 'Unspecified',
  "summaryName" = "name",
  "summaryArtistType" = "artistType",
  "summarySourceStatus" = "sourceStatus",
  "summarySourceVersion" = "sourceVersion",
  "summarySourceDeleted" = "sourceDeleted",
  "summaryObservedAt" = "lastSyncedAt";

ALTER TABLE "Artist"
ALTER COLUMN "defaultName" SET NOT NULL,
ALTER COLUMN "defaultNameLanguage" SET NOT NULL,
ALTER COLUMN "summaryName" SET NOT NULL,
ALTER COLUMN "summaryArtistType" SET NOT NULL,
ALTER COLUMN "summarySourceStatus" SET NOT NULL,
ALTER COLUMN "summarySourceVersion" SET NOT NULL;

-- CreateTable
CREATE TABLE "ArtistName" (
    "id" UUID NOT NULL,
    "artistId" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ArtistName_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistWebLink" (
    "id" UUID NOT NULL,
    "artistId" UUID NOT NULL,
    "vocadbId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ArtistWebLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Artist_detailLastSyncedAt_idx" ON "Artist"("detailLastSyncedAt");

-- CreateIndex
CREATE INDEX "Artist_syncStatus_idx" ON "Artist"("syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistName_artistId_position_key" ON "ArtistName"("artistId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistWebLink_artistId_vocadbId_key" ON "ArtistWebLink"("artistId", "vocadbId");

-- CreateIndex
CREATE INDEX "ArtistWebLink_artistId_position_idx" ON "ArtistWebLink"("artistId", "position");

-- CreateIndex
CREATE INDEX "SyncRun_entity_status_sequence_idx" ON "SyncRun"("entity", "status", "sequence");

-- AddForeignKey
ALTER TABLE "ArtistName" ADD CONSTRAINT "ArtistName_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistWebLink" ADD CONSTRAINT "ArtistWebLink_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
