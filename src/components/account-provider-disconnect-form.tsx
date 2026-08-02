"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { disconnectProviderAction, type DisconnectProviderState } from "@/lib/account/actions";

const initialState: DisconnectProviderState = { error: null };

export function AccountProviderDisconnectForm({ provider }: { provider: string }) {
  const [state, formAction] = useActionState(disconnectProviderAction, initialState);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`确认断开 ${provider} 登录来源？当前所有设备都会退出。`)) {
          event.preventDefault();
        }
      }}
    >
      <input name="provider" type="hidden" value={provider} />
      <DisconnectButton />
      {state.error && <p className="mt-2 text-sm text-red-300" role="alert">{state.error}</p>}
    </form>
  );
}

function DisconnectButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button-secondary" disabled={pending} type="submit">
      {pending ? "处理中…" : "断开"}
    </button>
  );
}
