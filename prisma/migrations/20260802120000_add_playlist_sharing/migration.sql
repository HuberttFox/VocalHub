-- CreateEnum
CREATE TYPE "PlaylistVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PlaylistCollaboratorRole" AS ENUM ('EDITOR');

-- AlterTable
ALTER TABLE "Playlist"
  ADD COLUMN "visibility" "PlaylistVisibility" NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_shareToken_key" ON "Playlist"("shareToken");
CREATE INDEX "Playlist_visibility_idx" ON "Playlist"("visibility");

-- CreateTable
CREATE TABLE "PlaylistCollaborator" (
  "playlistId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" "PlaylistCollaboratorRole" NOT NULL DEFAULT 'EDITOR',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaylistCollaborator_pkey" PRIMARY KEY ("playlistId", "userId"),
  CONSTRAINT "PlaylistCollaborator_playlistId_fkey"
    FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlaylistCollaborator_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PlaylistCollaborator_userId_playlistId_idx"
  ON "PlaylistCollaborator"("userId", "playlistId");
