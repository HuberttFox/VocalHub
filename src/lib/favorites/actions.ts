"use server";

import { revalidatePath } from "next/cache";
import { requireViewerForMutation } from "@/lib/auth/session";
import { favoriteInputSchema } from "@/lib/favorites/query";
import { setFavorite } from "@/lib/favorites/repository";

export async function setFavoriteAction(formData: FormData): Promise<void> {
  const viewer = await requireViewerForMutation();
  const input = favoriteInputSchema.parse({
    songId: formData.get("songId"),
    desired: formData.get("desired"),
  });
  const result = await setFavorite(viewer.id, input.songId, input.desired);
  if (result === "NOT_FOUND") throw new Error("SONG_NOT_FOUND");
  revalidatePath("/favorites");
  revalidatePath(`/songs/${input.songId}`);
}
