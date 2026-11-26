import Link from "next/link";
import { redirect } from "next/navigation";
import CreatePodForm from "@/components/CreatePodForm";
import { listAgents } from "@/lib/agents";
import { getT } from "@/lib/lang";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewPod() {
  const session = await requireAuth();
  if (session.access !== "all") redirect("/pods");
  const t = await getT();
  const hosts = listAgents().filter((a) => a.enabled && a.status !== "offline").map((a) => ({ id: a.id, label: `${a.agent_id} (${a.hostname})` }));
  return (
    <div className="space-y-4">
      <Link className="text-sm text-sky-400 hover:underline" href="/pods">← {t("pods.title")}</Link>
      <h1 className="text-xl font-semibold">{t("crp.title")}</h1>
      {hosts.length === 0 ? <p className="card text-sm text-slate-400">{t("cr.noHosts")}</p> : <CreatePodForm hosts={hosts} />}
    </div>
  );
}
