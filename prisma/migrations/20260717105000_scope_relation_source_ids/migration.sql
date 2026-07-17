-- DropIndex
DROP INDEX "SongArtistCredit_vocadbId_key";

-- DropIndex
DROP INDEX "SongPV_vocadbId_key";

-- CreateIndex
CREATE UNIQUE INDEX "SongArtistCredit_songId_vocadbId_key" ON "SongArtistCredit"("songId", "vocadbId");

-- CreateIndex
CREATE UNIQUE INDEX "SongPV_songId_vocadbId_key" ON "SongPV"("songId", "vocadbId");

