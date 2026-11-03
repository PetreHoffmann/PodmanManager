import { redirect } from "next/navigation";
import ActionForm from "@/components/ActionForm";
import { setupAction } from "@/app/actions";
import LangSelect from "@/components/LangSelect";
import { getT } from "@/lib/lang";
import { adminExists } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getT();
  if (adminExists()) redirect("/login");
  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("auth.createAdmin")}</h1>
        <LangSelect />
      </div>
      <ActionForm action={setupAction} className="card space-y-3">
        <p className="text-xs text-slate-400">{t("auth.setupHint")}</p>
        <input name="password" type="password" required autoFocus placeholder={t("auth.password")} autoComplete="new-password" className="input" />
        <input name="confirm" type="password" required placeholder={t("auth.repeat")} autoComplete="new-password" className="input" />
        <button className="btn btn-primary w-full justify-center">{t("auth.createAdmin")}</button>
      </ActionForm>
    </div>
  );
}
