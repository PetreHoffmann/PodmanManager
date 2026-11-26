import Link from "next/link";
import { redirect } from "next/navigation";
import CreateContainerForm from "@/components/CreateContainerForm";
import { listAgents } from "@/lib/agents";
import { getT } from "@/lib/lang";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewContainer() {
  const session = await requireAuth();
  if (session.access !== "all") redirect("/containers");
  const t = await getT();
  const hosts = listAgents().filter((a) => a.enabled && a.status !== "offline").map((a) => ({ id: a.id, label: `${a.agent_id} (${a.hostname})` }));
  return (
    <div className="space-y-4">
      <Link className="text-sm text-sky-400 hover:underline" href="/containers">← {t("cont.title")}</Link>
      <h1 className="text-xl font-semibold">{t("cr.title")}</h1>
      {hosts.length === 0 ? <p className="card text-sm text-slate-400">{t("cr.noHosts")}</p> : <CreateContainerForm hosts={hosts} />}
    </div>
  );
}
