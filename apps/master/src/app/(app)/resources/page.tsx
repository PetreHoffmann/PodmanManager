import Link from "next/link";
import { getT } from "@/lib/lang";
import { groupNames } from "@/lib/groups";
import { requireAuth } from "@/lib/session";
import ImagesTab from "./ImagesTab";
import NetworksTab from "./NetworksTab";
import VolumesTab from "./VolumesTab";

export const dynamic = "force-dynamic";

const TABS = ["images", "networks", "volumes"] as const;
type Tab = (typeof TABS)[number];
type SP = Promise<{ tab?: string; host?: string; q?: string }>;

export default async function Resources({ searchParams }: { searchParams: SP }) {
  const session = await requireAuth();
  const t = await getT();
  const sp = await searchParams;
  const tab: Tab = TABS.find((x) => x === sp.tab) ?? "images";
  const host = sp.host ?? "";
  const q = sp.q ?? "";
  const label: Record<Tab, string> = { images: t("res.tabImages"), networks: t("res.tabNetworks"), volumes: t("res.tabVolumes") };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("res.title")}</h1>
      {session.access === "groups" && <p className="text-xs text-slate-400">{t("scope.note", { groups: groupNames(session).join(", ") || "—" })}</p>}
      <nav aria-label={t("res.tabs")} className="-mx-4 overflow-x-auto overflow-y-hidden border-b border-slate-800 px-4 md:mx-0 md:px-0">
        <ul className="flex min-w-max gap-1">
          {TABS.map((x) => (
            <li key={x}>
              <Link
                href={`/resources?tab=${x}`}
                aria-current={x === tab ? "page" : undefined}
                className={`-mb-px block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition ${x === tab ? "border-sky-400 text-white" : "border-transparent text-slate-400 hover:text-white"}`}
              >
                {label[x]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {tab === "images" && <ImagesTab host={host} q={q} />}
      {tab === "networks" && <NetworksTab host={host} q={q} />}
      {tab === "volumes" && <VolumesTab host={host} q={q} />}
    </div>
  );
}
