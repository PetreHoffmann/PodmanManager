import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ActionForm from "@/components/ActionForm";
import { mfaCancelAction, mfaLoginAction } from "@/app/actions";
import Icon from "@/components/Icon";
import LangSelect from "@/components/LangSelect";
import { loadBranding } from "@/lib/branding";
import { APP_NAME } from "@/lib/brand";
import { getT } from "@/lib/lang";
import { MFA_COOKIE, getPending } from "@/lib/mfa";
import { getVersion } from "@/lib/version";

export const dynamic = "force-dynamic";

/** Second step of the sign-in (the password was right, the code is missing). */
export default async function Page() {
  const t = await getT();
  if (!getPending((await cookies()).get(MFA_COOKIE)?.value)) redirect("/login");
  const brand = loadBranding();
  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <div className="mb-4 flex flex-col items-center gap-3">
        {brand.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/brand/logo?v=${brand.logo}`} alt={brand.text ?? APP_NAME} className="h-16 max-h-16 w-auto max-w-full object-contain" />
        )}
        <h1 className="text-xl font-semibold">{t("mfa.loginTitle")}</h1>
        <LangSelect />
      </div>
      <p className="mb-3 text-center text-sm text-slate-400">{t("mfa.loginHint")}</p>
      <ActionForm action={mfaLoginAction} className="card space-y-3">
        <input name="code" required autoFocus placeholder={t("mfa.loginCode")} autoComplete="one-time-code" inputMode="text" maxLength={16} className="input font-mono" />
        <button className="btn btn-primary w-full justify-center"><Icon name="shield-check" />{t("mfa.loginBtn")}</button>
      </ActionForm>
      <form action={mfaCancelAction} className="mt-3 text-center">
        <button className="text-xs text-slate-400 hover:text-white">{t("mfa.loginBack")}</button>
      </form>
      <p className="mt-6 text-center text-xs text-slate-500">{t("about.version")} {getVersion()}</p>
    </div>
  );
}
