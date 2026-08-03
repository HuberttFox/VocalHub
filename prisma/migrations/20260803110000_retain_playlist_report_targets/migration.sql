ALTER TABLE "PlaylistReport"
  ALTER COLUMN "playlistId" DROP NOT NULL,
  ADD COLUMN "targetPlaylistId" UUID;

UPDATE "PlaylistReport" SET "targetPlaylistId" = "playlistId";

ALTER TABLE "PlaylistReport"
  ALTER COLUMN "targetPlaylistId" SET NOT NULL,
  DROP CONSTRAINT "PlaylistReport_playlistId_fkey",
  ADD CONSTRAINT "PlaylistReport_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
