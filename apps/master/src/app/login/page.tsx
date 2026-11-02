import { redirect } from "next/navigation";
import ActionForm from "@/components/ActionForm";
import { loginAction } from "@/app/actions";
import LangSelect from "@/components/LangSelect";
import { getT } from "@/lib/lang";
import { adminExists } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getT();
  if (!adminExists()) redirect("/setup");
  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("auth.signIn")}</h1>
        <LangSelect />
      </div>
      <ActionForm action={loginAction} className="card space-y-3">
        <input name="password" type="password" required autoFocus placeholder={t("auth.password")} autoComplete="current-password" className="input" />
        
        <button className="btn btn-primary w-full justify-center">{t("auth.signIn")}</button>
      </ActionForm>
    </div>
  );
}
