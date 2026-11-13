import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ActionForm from "@/components/ActionForm";
import { changePasswordAction } from "@/app/actions";
import Icon from "@/components/Icon";
import { getT } from "@/lib/lang";
import { COOKIE, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** First login of a local user whose password was set by an administrator. */
export default async function Page() {
  const t = await getT();
  const s = getSession((await cookies()).get(COOKIE)?.value);
  if (!s) redirect("/login");
  if (!s.mustChange) redirect("/");
  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-1 text-xl font-semibold">{t("set.changePw")}</h1>
      <p className="mb-4 text-sm text-slate-400">{t("set.mustChange")}</p>
      <ActionForm action={changePasswordAction} className="card space-y-3">
        <input name="current" type="password" required placeholder={t("set.current")} autoComplete="current-password" className="input" />
        <input name="password" type="password" required minLength={10} placeholder={t("set.new")} autoComplete="new-password" className="input" />
        <input name="confirm" type="password" required placeholder={t("set.repeat")} autoComplete="new-password" className="input" />
        <button className="btn btn-primary"><Icon name="key" />{t("set.changeBtn")}</button>
      </ActionForm>
    </div>
  );
}
