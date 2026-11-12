import { redirect } from "next/navigation";
import ActionForm from "@/components/ActionForm";
import { loginAction } from "@/app/actions";
import LangSelect from "@/components/LangSelect";
import { getT } from "@/lib/lang";
import { loadSamlConfig, samlReady } from "@/lib/saml-config";
import { adminExists } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ sso?: string }> }) {
  const t = await getT();
  const { sso } = await searchParams;
  const saml = samlReady(loadSamlConfig());
  if (!adminExists()) redirect("/setup");
  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("auth.signIn")}</h1>
        <LangSelect />
      </div>
      <ActionForm action={loginAction} className="card space-y-3">
        <input name="username" required autoFocus placeholder={t("auth.username")} autoComplete="username" maxLength={256} className="input" />
        <input name="password" type="password" required placeholder={t("auth.password")} autoComplete="current-password" className="input" />
        
        <button className="btn btn-primary w-full justify-center">{t("auth.signIn")}</button>
      </ActionForm>
      {sso === "failed" && <p role="alert" className="mt-3 text-sm text-red-400">{t("msg.ssoFailed")}</p>}
      {sso === "denied" && <p role="alert" className="mt-3 text-sm text-amber-300">{t("msg.ssoDenied")}</p>}
      {saml && (
        <div className="mt-4 space-y-3">
          <p className="text-center text-xs text-slate-500">{t("auth.or")}</p>
          {/* a plain link: the browser must follow the redirect to the identity provider */}
          <a href="/saml/login" className="btn w-full justify-center">{t("auth.ssoSignIn")}</a>
        </div>
      )}
    </div>
  );
}
