-- CreateIndex
CREATE INDEX "SongArtistCredit_artistId_songId_idx"
ON "SongArtistCredit"("artistId", "songId")
WHERE "artistId" IS NOT NULL;
