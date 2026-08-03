"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { reportPlaylistAction, type ReportPlaylistState } from "@/lib/playlists/actions";

const initialState: ReportPlaylistState = { status: "idle" };

export function PlaylistReportForm({ playlistId, shareToken }: { playlistId: string; shareToken: string }) {
  const [state, formAction] = useActionState(reportPlaylistAction, initialState);
  const settled = state.status === "created" || state.status === "already-reported";
  const messageClass = settled ? "text-emerald-300" : "text-red-300";

  return (
    <form action={formAction} className="mt-4 grid gap-3">
      <input name="playlistId" type="hidden" value={playlistId} />
      <input name="shareToken" type="hidden" value={shareToken} />
      <select className="field" defaultValue="OTHER" disabled={settled} name="reason">
        <option value="ILLEGAL">违法内容</option>
        <option value="ABUSIVE">骚扰或仇恨</option>
        <option value="PERSONAL_DATA">个人信息</option>
        <option value="SPAM">垃圾内容</option>
        <option value="OTHER">其他</option>
      </select>
      <textarea className="field min-h-24" disabled={settled} maxLength={1000} name="note" placeholder="补充说明（可选）" />
      <ReportButton settled={settled} />
      {state.status !== "idle" && <p className={`text-sm ${messageClass}`} role="status">{state.message}</p>}
    </form>
  );
}

function ReportButton({ settled }: { settled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="button-secondary" disabled={pending || settled} type="submit">
      {pending ? "提交中…" : settled ? "已处理" : "提交报告"}
    </button>
  );
}
