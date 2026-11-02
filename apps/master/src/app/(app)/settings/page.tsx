import ActionForm from "@/components/ActionForm";
import { changePasswordAction, logoutAction } from "@/app/actions";
import { getConfig } from "@/lib/config";
import { getT } from "@/lib/lang";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Settings() {
  await requireAuth();
  const t = await getT();
  const c = getConfig();
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold">{t("set.title")}</h1>
      <section className="card">
        <h2 className="mb-2 font-medium">{t("set.monitoring")}</h2>
        <dl className="grid grid-cols-[14rem_1fr] gap-y-1 text-sm">
          <dt className="text-slate-400">{t("set.interval")}</dt><dd>{c.heartbeatIntervalSec} s</dd>
          <dt className="text-slate-400">{t("set.timeout")}</dt><dd>{c.agentTimeoutSec} s</dd>
          <dt className="text-slate-400">{t("set.failures")}</dt><dd>{c.offlineAfterFailures}</dd>
        </dl>
      </section>
      <section className="card">
        <h2 className="mb-3 font-medium">{t("set.changePw")}</h2>
        <ActionForm action={changePasswordAction} className="space-y-3">
          <input name="current" type="password" required placeholder={t("set.current")} autoComplete="current-password" className="input" />
          <input name="password" type="password" required minLength={10} placeholder={t("set.new")} autoComplete="new-password" className="input" />
          <input name="confirm" type="password" required placeholder={t("set.repeat")} autoComplete="new-password" className="input" />
          <button className="btn btn-primary">{t("set.changeBtn")}</button>
        </ActionForm>
      </section>
      <form action={logoutAction}><button className="btn">{t("set.logout")}</button></form>
    </div>
  );
}
