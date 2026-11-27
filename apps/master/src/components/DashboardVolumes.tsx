import Link from "next/link";
import { listAgents } from "@/lib/agents";
import { sumImages, sumVolumes } from "@/lib/dashboard";
import { getLang, getT } from "@/lib/lang";
import { Stat, fmtBytes } from "@/components/ui";
import { hostStorage } from "@/components/HostStorage";

/**
 * Number and size of all volumes over the hosts the user may see. Rendered inside <Suspense>: `podman system df` can be slow,
 * so the dashboard appears at once and this card fills in.
 */
export default async function DashboardVolumes({ allowed }: { allowed: ReadonlySet<number> | null }) {
  const t = await getT();
  const lang = await getLang();
  const agents = listAgents().filter((a) => a.enabled && (allowed === null || allowed.has(a.id)) && a.status !== "offline");
  const results = await Promise.all(
    agents.map(async (a) => {
      try {
        const r = await hostStorage(a.id);
        return r && r.ok ? r.data : null;
      } catch {
        return null;
      }
    }),
  );
  const v = sumVolumes(results);
  const tone = v.missing > 0 ? "warn" : undefined;
  const title = v.missing > 0 ? t("dash.volumesMissing", { n: v.missing }) : undefined;
  return (
    <>
      <Link href="/resources?tab=volumes" className="block transition hover:opacity-90" title={title} data-testid="dash-volumes"><Stat label={t("dash.volumes")} value={v.count} tone={tone} /></Link>
      <Link href="/resources?tab=volumes" className="block transition hover:opacity-90" title={title} data-testid="dash-volumes-size"><Stat label={t("dash.volumesSize")} value={fmtBytes(v.size, lang)} tone={tone} /></Link>
    </>
  );
}

/** Size of all images over the hosts the user may see; asks the same (per request cached) storage data as the volume cards. */
export async function DashboardImagesSize({ allowed }: { allowed: ReadonlySet<number> | null }) {
  const t = await getT();
  const lang = await getLang();
  const agents = listAgents().filter((a) => a.enabled && (allowed === null || allowed.has(a.id)) && a.status !== "offline");
  const results = await Promise.all(
    agents.map(async (a) => {
      try {
        const r = await hostStorage(a.id);
        return r && r.ok ? r.data : null;
      } catch {
        return null;
      }
    }),
  );
  const s = sumImages(results);
  const tone = s.missing > 0 ? "warn" : undefined;
  const title = s.missing > 0 ? t("dash.volumesMissing", { n: s.missing }) : undefined;
  return (
    <Link href="/resources?tab=images" className="block transition hover:opacity-90" title={title} data-testid="dash-images-size"><Stat label={t("dash.imagesSize")} value={fmtBytes(s.size, lang)} tone={tone} /></Link>
  );
}

export function DashboardVolumesFallback({ labels }: { labels: string[] }) {
  return (
    <>
      {labels.map((label) => <Stat key={label} label={label} value="…" />)}
    </>
  );
}
