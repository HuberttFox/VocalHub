-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Favorite" (
    "userId" UUID NOT NULL,
    "songId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("userId", "songId")
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Playlist_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 100),
    CONSTRAINT "Playlist_description_check" CHECK ("description" IS NULL OR char_length("description") <= 500)
);

-- CreateTable
CREATE TABLE "PlaylistSong" (
    "playlistId" UUID NOT NULL,
    "songId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistSong_pkey" PRIMARY KEY ("playlistId", "songId"),
    CONSTRAINT "PlaylistSong_position_check" CHECK ("position" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expires_idx" ON "Session"("expires");
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");
CREATE INDEX "Favorite_userId_createdAt_songId_idx" ON "Favorite"("userId", "createdAt", "songId");
CREATE INDEX "Favorite_songId_idx" ON "Favorite"("songId");
CREATE INDEX "Playlist_userId_updatedAt_id_idx" ON "Playlist"("userId", "updatedAt", "id");
CREATE UNIQUE INDEX "PlaylistSong_playlistId_position_key" ON "PlaylistSong"("playlistId", "position");
CREATE INDEX "PlaylistSong_songId_idx" ON "PlaylistSong"("songId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistSong" ADD CONSTRAINT "PlaylistSong_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistSong" ADD CONSTRAINT "PlaylistSong_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
