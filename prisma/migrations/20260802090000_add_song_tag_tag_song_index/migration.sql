-- CreateIndex
CREATE INDEX "SongTag_tagId_songId_idx"
ON "SongTag"("tagId", "songId");
