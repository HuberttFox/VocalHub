"use server";

import { revalidatePath } from "next/cache";
import { requireViewerForMutation } from "@/lib/auth/session";
import {
  collaboratorIdSchema,
  collaboratorSchema,
  playlistCreateSchema,
  playlistIdSchema,
  playlistTokenSchema,
  playlistReportSchema,
  playlistVisibilitySchema,
  playlistMoveSchema,
  playlistSongSchema,
  playlistUpdateSchema,
} from "@/lib/playlists/query";
import {
  addPlaylistSong,
  addPlaylistCollaborator,
  createPlaylist,
  createPlaylistReport,
  deletePlaylist,
  leavePlaylist,
  movePlaylistSong,
  removePlaylistCollaborator,
  removePlaylistSong,
  setPlaylistVisibility,
  updatePlaylist,
} from "@/lib/playlists/repository";

export type ReportPlaylistState =
  | { status: "idle" }
  | { status: "created"; message: string }
  | { status: "already-reported"; message: string }
  | { status: "not-found"; message: string }
  | { status: "invalid"; message: string }
  | { status: "unauthenticated"; message: string };

export async function reportPlaylistAction(
  _previousState: ReportPlaylistState,
  formData: FormData,
): Promise<ReportPlaylistState> {
  try {
    const viewer = await requireViewerForMutation();
    const parsed = playlistReportSchema.safeParse({
      playlistId: formData.get("playlistId"),
      reason: formData.get("reason"),
      note: formData.get("note") ?? "",
      shareToken: formData.get("shareToken"),
    });
    if (!parsed.success) return { status: "invalid", message: "报告内容无效，请检查后重试。" };
    const input = parsed.data;
    const result = await createPlaylistReport(viewer.id, input.playlistId, input.reason, input.note, input.shareToken);
    if (result === "CREATED") return { status: "created", message: "报告已提交。感谢你的反馈。" };
    if (result === "ALREADY_REPORTED") return { status: "already-reported", message: "你已报告过此歌单。" };
    return { status: "not-found", message: "此分享链接已失效或歌单已不可用。" };
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return { status: "unauthenticated", message: "登录状态已失效，请重新登录。" };
    }
    throw error;
  }
}

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
  revalidatePath(`/playlists/${input.playlistId}`);
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
