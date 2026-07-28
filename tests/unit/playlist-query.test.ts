import { describe, expect, it } from "vitest";
import {
  playlistCreateSchema,
  playlistMoveSchema,
  playlistSongSchema,
} from "@/lib/playlists/query";

const playlistId = "11111111-1111-4111-8111-111111111111";
const songId = "22222222-2222-4222-8222-222222222222";

describe("playlist validation", () => {
  it("trims fields and normalizes an empty description", () => {
    expect(playlistCreateSchema.parse({ name: "  Picks  ", description: " " })).toEqual({
      name: "Picks",
      description: null,
    });
  });

  it("requires local UUIDs", () => {
    expect(() => playlistSongSchema.parse({ playlistId: "123", songId })).toThrow();
    expect(playlistSongSchema.parse({ playlistId, songId })).toEqual({ playlistId, songId });
  });

  it("only accepts adjacent move directions", () => {
    expect(playlistMoveSchema.parse({ playlistId, songId, direction: "up" }).direction).toBe("up");
    expect(() => playlistMoveSchema.parse({ playlistId, songId, direction: "first" })).toThrow();
  });
});
