"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { agentUpdateAction } from "@/app/actions";
import { useT } from "./I18nProvider";

export default function AgentUpdate({ id }: { id: number }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-1">
      <button
        className="btn !px-2 !py-0.5 text-xs"
        disabled={pending || msg?.ok === true}
        onClick={() =>
          start(async () => {
            const r = await agentUpdateAction(id);
            setMsg({ ok: r.ok, text: r.message });
            if (r.ok) setTimeout(() => router.refresh(), 45000);
          })
        }
      >
        {pending ? "…" : t("update.btn")}
      </button>
      {msg && <div className={`max-w-xs text-xs ${msg.ok ? "text-emerald-300" : "text-amber-300"}`}>{msg.text}</div>}
    </div>
  );
}
