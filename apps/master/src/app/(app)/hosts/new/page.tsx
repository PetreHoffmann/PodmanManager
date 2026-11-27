import Link from "next/link";
import { redirect } from "next/navigation";
import ActionForm from "@/components/ActionForm";
import AgentWizard from "@/components/AgentWizard";
import Icon from "@/components/Icon";
import { addAgentAction } from "@/app/actions";
import { getT } from "@/lib/lang";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Setting up a new agent (administrators only): the wizard, and below it the manual registration of an agent that already runs. */
export default async function NewAgent() {
  const session = await requireAuth();
  if (session.access !== "all") redirect("/hosts");
  const t = await getT();
  return (
    <div className="space-y-4">
      <Link className="text-sm text-sky-400 hover:underline" href="/hosts">← {t("hosts.title")}</Link>
      <h1 className="text-xl font-semibold">{t("wiz.title")}</h1>
      <AgentWizard />
      <details className="max-w-xl">
        <summary className="cursor-pointer text-sm text-slate-400 hover:text-slate-200">{t("wiz.manual")}</summary>
        <section className="card mt-2">
          <h2 className="mb-3 font-medium">{t("hosts.add")}</h2>
          <ActionForm action={addAgentAction} className="space-y-3">
            <label className="block text-sm">{t("hosts.addrLabel")}
              <input name="url" required placeholder="http://192.168.1.21:9126" className="input mt-1" />
            </label>
            <label className="block text-sm">{t("hosts.tokenLabel")}
              <input name="token" type="password" required autoComplete="off" className="input mt-1" />
            </label>
            <button className="btn btn-primary" type="submit"><Icon name="plus-circle" />{t("hosts.register")}</button>
          </ActionForm>
        </section>
      </details>
    </div>
  );
}
