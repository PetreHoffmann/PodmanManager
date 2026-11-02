import ActionForm from "@/components/ActionForm";
import { changePasswordAction, logoutAction } from "@/app/actions";
import { getConfig } from "@/lib/config";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Settings() {
  await requireAuth();
  const c = getConfig();
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <section className="card">
        <h2 className="mb-2 font-medium">Monitoring (set via environment)</h2>
        <dl className="grid grid-cols-[14rem_1fr] gap-y-1 text-sm">
          <dt className="text-slate-400">Heartbeat interval</dt><dd>{c.heartbeatIntervalSec} s</dd>
          <dt className="text-slate-400">Agent timeout</dt><dd>{c.agentTimeoutSec} s</dd>
          <dt className="text-slate-400">Offline after failed checks</dt><dd>{c.offlineAfterFailures}</dd>
        </dl>
      </section>
      <section className="card">
        <h2 className="mb-3 font-medium">Change password</h2>
        <ActionForm action={changePasswordAction} className="space-y-3">
          <input name="current" type="password" required placeholder="Current password" autoComplete="current-password" className="input" />
          <input name="password" type="password" required minLength={10} placeholder="New password (min. 10)" autoComplete="new-password" className="input" />
          <input name="confirm" type="password" required placeholder="Repeat new password" autoComplete="new-password" className="input" />
          <button className="btn btn-primary">Change password</button>
        </ActionForm>
      </section>
      <form action={logoutAction}><button className="btn">Log out</button></form>
    </div>
  );
}
