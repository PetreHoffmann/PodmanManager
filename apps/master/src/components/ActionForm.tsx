"use client";

import { useActionState, useTransition } from "react";
import type { FormState } from "@/app/actions";

/**
 * Submits via a transition instead of `<form action>`: React 19 resets uncontrolled
 * fields after a form action completes, which would wipe what the user typed
 * (e.g. after a failed login or an LDAP connection test).
 */
export default function ActionForm({
  action, children, className, inline,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  inline?: boolean;
}) {
  const [state, run, actionPending] = useActionState(action, null);
  const [transitionPending, startTransition] = useTransition();
  const pending = actionPending || transitionPending;
  return (
    <form
      className={className}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => run(fd));
      }}
    >
      {children}
      {state && (
        <p role="status" className={`${inline ? "ml-2 inline" : "mt-2"} whitespace-pre-line text-xs ${state.ok ? "text-emerald-400" : "text-red-400"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
