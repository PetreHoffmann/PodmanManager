import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions";
import MfaPanel from "@/components/MfaPanel";
import LangSelect from "@/components/LangSelect";
import { loadBranding } from "@/lib/branding";
import { APP_NAME } from "@/lib/brand";
import { getT } from "@/lib/lang";
import { mfaStatus } from "@/lib/mfa";
import { COOKIE, getSession } from "@/lib/session";
import { getVersion } from "@/lib/version";

export const dynamic = "force-dynamic";

/** The administrator requires a second factor and this account has none yet. */
export default async function Page() {
  const t = await getT();
  const s = getSession((await cookies()).get(COOKIE)?.value);
  if (!s) redirect("/login");
  // no redirect when the set-up just succeeded: the recovery codes must stay visible until the user confirms them
  const brand = loadBranding();
  const st = mfaStatus(s.username);
  return (
    <div className="mx-auto mt-16 max-w-lg px-4 pb-10">
      <div className="mb-4 flex flex-col items-center gap-3">
        {brand.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/brand/logo?v=${brand.logo}`} alt={brand.text ?? APP_NAME} className="h-16 max-h-16 w-auto max-w-full object-contain" />
        )}
        <h1 className="text-xl font-semibold">{t("mfa.requiredTitle")}</h1>
        <LangSelect />
      </div>
      <p className="mb-3 text-center text-sm text-slate-400">{t("mfa.requiredHint")}</p>
      <div className="card"><MfaPanel enabled={st.enabled} recoveryLeft={st.recoveryLeft} required forced /></div>
      <form action={logoutAction} className="mt-4 text-center">
        <button className="text-xs text-slate-400 hover:text-white">{t("set.logout")}</button>
      </form>
      <p className="mt-6 text-center text-xs text-slate-500">{t("about.version")} {getVersion()}</p>
    </div>
  );
}
