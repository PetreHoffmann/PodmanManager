"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions";

export default function ActionForm({
  action, children, className, inline,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  inline?: boolean;
}) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className={className} aria-busy={pending}>
      {children}
      {state && (
        <p role="status" className={`${inline ? "ml-2 inline" : "mt-2"} text-xs ${state.ok ? "text-emerald-400" : "text-red-400"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
