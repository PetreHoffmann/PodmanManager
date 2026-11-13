import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ActionForm from "@/components/ActionForm";
import { changePasswordAction } from "@/app/actions";
import Icon from "@/components/Icon";
import LangSelect from "@/components/LangSelect";
import { loadBranding } from "@/lib/branding";
import { getT } from "@/lib/lang";
import { getVersion } from "@/lib/version";
import { APP_NAME } from "@/lib/brand";
import { COOKIE, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** First login of a local user whose password was set by an administrator. */
export default async function Page() {
  const t = await getT();
  const s = getSession((await cookies()).get(COOKIE)?.value);
  if (!s) redirect("/login");
  if (!s.mustChange) redirect("/");
  const brand = loadBranding();
  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <div className="mb-4 flex flex-col items-center gap-3">
        {brand.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/brand/logo?v=${brand.logo}`} alt={brand.text ?? APP_NAME} className="h-16 max-h-16 w-auto max-w-full object-contain" />
        )}
        <h1 className="text-xl font-semibold">{t("set.changePw")}</h1>
        <LangSelect />
      </div>
      <p className="mb-4 text-center text-sm text-slate-400">{t("set.mustChange")}</p>
      <ActionForm action={changePasswordAction} className="card space-y-3">
        <input name="current" type="password" required placeholder={t("set.current")} autoComplete="current-password" className="input" />
        <input name="password" type="password" required minLength={10} placeholder={t("set.new")} autoComplete="new-password" className="input" />
        <input name="confirm" type="password" required placeholder={t("set.repeat")} autoComplete="new-password" className="input" />
        <button className="btn btn-primary"><Icon name="key" />{t("set.changeBtn")}</button>
      </ActionForm>
      <p className="mt-6 text-center text-xs text-slate-500" data-testid="login-version">{t("about.version")} {getVersion()}</p>
    </div>
  );
}
