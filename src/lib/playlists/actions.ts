"use server";

import { revalidatePath } from "next/cache";
import { requireViewerForMutation } from "@/lib/auth/session";
import {
  collaboratorIdSchema,
  collaboratorSchema,
  playlistCreateSchema,
  playlistIdSchema,
  playlistTokenSchema,
  playlistVisibilitySchema,
  playlistMoveSchema,
  playlistSongSchema,
  playlistUpdateSchema,
} from "@/lib/playlists/query";
import {
  addPlaylistSong,
  addPlaylistCollaborator,
  createPlaylist,
  deletePlaylist,
  leavePlaylist,
  movePlaylistSong,
  removePlaylistCollaborator,
  removePlaylistSong,
  setPlaylistVisibility,
  updatePlaylist,
} from "@/lib/playlists/repository";

export async function setPlaylistVisibilityAction(formData: FormData): Promise<void> {
  const viewer = await requireViewerForMutation();
  const input = playlistVisibilitySchema.parse(Object.fromEntries(formData));
  const result = await setPlaylistVisibility(viewer.id, input.playlistId, input.visibility);
  if (result.status !== "UPDATED") throw new Error("PLAYLIST_NOT_FOUND");
  revalidatePath("/playlists");
  revalidatePath(`/playlists/${input.playlistId}`);
}

export async function addPlaylistCollaboratorAction(formData: FormData): Promise<void> {
  const viewer = await requireViewerForMutation();
  const input = collaboratorSchema.parse(Object.fromEntries(formData));
  const result = await addPlaylistCollaborator(viewer.id, input.playlistId, input.email);
  if (result !== "ADDED") throw new Error(result);
  revalidatePath(`/playlists/${input.playlistId}`);
}

export async function removePlaylistCollaboratorAction(formData: FormData): Promise<void> {
  const viewer = await requireViewerForMutation();
  const input = collaboratorIdSchema.parse(Object.fromEntries(formData));
  if (!await removePlaylistCollaborator(viewer.id, input.playlistId, input.userId)) throw new Error("PLAYLIST_NOT_FOUND");
  revalidatePath(`/playlists/${input.playlistId}`);
}

export async function leavePlaylistAction(formData: FormData): Promise<void> {
  const viewer = await requireViewerForMutation();
  const input = playlistTokenSchema.parse(Object.fromEntries(formData));
  if (!await leavePlaylist(viewer.id, input.playlistId)) throw new Error("PLAYLIST_NOT_FOUND");
  revalidatePath("/playlists");
}
export async function createPlaylistAction(formData: FormData): Promise<void> {
  const viewer = await requireViewerForMutation();
  const input = playlistCreateSchema.parse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
  });
  if (await createPlaylist(viewer.id, input) === "LIMIT_REACHED") {
    throw new Error("PLAYLIST_LIMIT_REACHED");
  }
  revalidatePath("/playlists");
}



export async function updatePlaylistAction(formData: FormData): Promise<void> {
  const viewer = await requireViewerForMutation();
  const { playlistId, name, description } = playlistUpdateSchema.parse(
    Object.fromEntries(formData),
  );
  if (!(await updatePlaylist(viewer.id, playlistId, { name, description }))) {
    throw new Error("PLAYLIST_NOT_FOUND");
  }
  revalidatePath("/playlists");
  revalidatePath(`/playlists/${playlistId}`);
}

export async function deletePlaylistAction(formData: FormData): Promise<void> {
  const viewer = await requireViewerForMutation();
  const input = playlistIdSchema.parse(Object.fromEntries(formData));
  if (!(await deletePlaylist(viewer.id, input.playlistId))) {
    throw new Error("PLAYLIST_NOT_FOUND");
  }
  revalidatePath("/playlists");
}

export async function addPlaylistSongAction(formData: FormData): Promise<void> {
  const viewer = await requireViewerForMutation();
  const input = playlistSongSchema.parse(Object.fromEntries(formData));
  const result = await addPlaylistSong(viewer.id, input.playlistId, input.songId);
  if (result !== "UPDATED") throw new Error(result);
  revalidatePath("/playlists");
  revalidatePath(`/playlists/${input.playlistId}`);
  revalidatePath(`/songs/${input.songId}`);
}

export async function removePlaylistSongAction(formData: FormData): Promise<void> {
  const viewer = await requireViewerForMutation();
  const input = playlistSongSchema.parse(Object.fromEntries(formData));
  if (!(await removePlaylistSong(viewer.id, input.playlistId, input.songId))) {
    throw new Error("PLAYLIST_NOT_FOUND");
  }
  revalidatePath(`/playlists/${input.playlistId}`);
}

export async function movePlaylistSongAction(formData: FormData): Promise<void> {
  const viewer = await requireViewerForMutation();
  const input = playlistMoveSchema.parse(Object.fromEntries(formData));
  if (!(await movePlaylistSong(viewer.id, input.playlistId, input.songId, input.direction))) {
    throw new Error("PLAYLIST_NOT_FOUND");
  }
  revalidatePath(`/playlists/${input.playlistId}`);
}
