"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import type { FormState } from "@/app/actions";

/**
 * Submits via a transition instead of `<form action>`: React 19 resets uncontrolled
 * fields after a form action completes, which would wipe what the user typed
 * (e.g. after a failed login or an LDAP connection test).
 */
export default function ActionForm({
  action, children, className, inline, resetOnSuccess, bar,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  inline?: boolean;
  /** Clears the fields after a successful submit (e.g. a "new item" form). */
  resetOnSuccess?: boolean;
  /** Buttons that stay at the bottom of the screen on phones (long forms); the status message is shown with them. */
  bar?: React.ReactNode;
}) {
  const [state, run, actionPending] = useActionState(action, null);
  const [transitionPending, startTransition] = useTransition();
  const pending = actionPending || transitionPending;
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const status = state && (
    <p role="status" className={`${inline ? "ml-2 inline" : "mt-2"} whitespace-pre-line text-xs ${state.ok ? "text-emerald-400" : "text-red-400"}`}>
      {state.message}
    </p>
  );
  return (
    <form
      ref={ref}
      className={className}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => run(fd));
      }}
    >
      {children}
      {bar !== undefined ? (
        <div className="sticky bottom-0 -mx-4 mt-3 -mb-4 space-y-2 rounded-b-xl border-t border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:mb-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          <div className="flex flex-wrap gap-2">{bar}</div>
          {status}
        </div>
      ) : (
        status
      )}
    </form>
  );
}
