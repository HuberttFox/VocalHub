-- Add public playlist moderation state and report records.
CREATE TYPE "PlaylistModerationStatus" AS ENUM ('ACTIVE', 'HIDDEN');
CREATE TYPE "PlaylistReportReason" AS ENUM ('ILLEGAL', 'ABUSIVE', 'PERSONAL_DATA', 'SPAM', 'OTHER');
CREATE TYPE "PlaylistReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

ALTER TABLE "Playlist"
  ADD COLUMN "moderationStatus" "PlaylistModerationStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE "PlaylistReport" (
  "id" UUID NOT NULL,
  "reporterId" UUID,
  "playlistId" UUID NOT NULL,
  "reason" "PlaylistReportReason" NOT NULL,
  "note" TEXT,
  "status" "PlaylistReportStatus" NOT NULL DEFAULT 'OPEN',
  "resolutionCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "PlaylistReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlaylistReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PlaylistReport_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Playlist_moderationStatus_idx" ON "Playlist"("moderationStatus");
CREATE INDEX "PlaylistReport_status_createdAt_idx" ON "PlaylistReport"("status", "createdAt");
CREATE INDEX "PlaylistReport_playlistId_status_idx" ON "PlaylistReport"("playlistId", "status");
CREATE INDEX "PlaylistReport_reporterId_createdAt_idx" ON "PlaylistReport"("reporterId", "createdAt");
CREATE UNIQUE INDEX "PlaylistReport_open_reporter_playlist_key"
  ON "PlaylistReport"("reporterId", "playlistId")
  WHERE "status" = 'OPEN' AND "reporterId" IS NOT NULL;
