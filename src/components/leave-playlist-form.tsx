"use client";

import { useFormStatus } from "react-dom";

export function LeavePlaylistForm({ action, playlistId }: { action: (formData: FormData) => void; playlistId: string }) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm("确认离开此歌单协作？离开后将无法继续编辑。")) event.preventDefault();
      }}
    >
      <input name="playlistId" type="hidden" value={playlistId} />
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button-secondary" disabled={pending} type="submit">
      {pending ? "处理中…" : "离开协作"}
    </button>
  );
}
