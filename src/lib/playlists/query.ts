import { z } from "zod";
import { UUID_PATTERN } from "@/lib/catalog/id";

export const PLAYLIST_LIMIT = 100;
export const PLAYLIST_SONG_LIMIT = 500;
export const PLAYLIST_COLLABORATOR_LIMIT = 20;
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const optionalDescription = z.string().trim().max(500).transform((value) => value || null);

export const playlistCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: optionalDescription,
});

export const playlistUpdateSchema = playlistCreateSchema.extend({
  playlistId: z.string().regex(UUID_PATTERN),
});

export const playlistIdSchema = z.object({
  playlistId: z.string().regex(UUID_PATTERN),
});

export const playlistSongSchema = playlistIdSchema.extend({
  songId: z.string().regex(UUID_PATTERN),
});

export const playlistMoveSchema = playlistSongSchema.extend({
  direction: z.enum(["up", "down"]),
});

export const playlistVisibilitySchema = z.object({
  playlistId: z.string().regex(UUID_PATTERN),
  visibility: z.enum(["PRIVATE", "PUBLIC"]),
});

export const collaboratorSchema = z.object({
  playlistId: z.string().regex(UUID_PATTERN),
  email: z.string().trim().email().max(320),
});

export const collaboratorIdSchema = z.object({
  playlistId: z.string().regex(UUID_PATTERN),
  userId: z.string().regex(UUID_PATTERN),
});

export const playlistTokenSchema = z.object({
  playlistId: z.string().regex(UUID_PATTERN),
});
