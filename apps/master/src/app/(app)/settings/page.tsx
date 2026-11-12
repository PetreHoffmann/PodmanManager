import Link from "next/link";
import AppLogs from "@/components/AppLogs";
import ActionForm from "@/components/ActionForm";
import { appLogsAction, brandingAction, samlAction, samlImportAction, changePasswordAction, hiddenAction, ldapAction, logoutAction } from "@/app/actions";
import { getConfig } from "@/lib/config";
import { DEFAULT_FILTER } from "@/lib/ldap";
import { EMPTY_LDAP, loadLdapConfig } from "@/lib/ldap-config";
import { getT } from "@/lib/lang";
import GroupEditor from "@/components/GroupEditor";
import LogoInput from "@/components/LogoInput";
import { listAgents } from "@/lib/agents";
import { groupNames, listGroups } from "@/lib/groups";
import { loadHiddenPatterns } from "@/lib/hidden";
import { EMPTY_SAML, MAX_BUTTON_LABEL, loadSamlConfig, spAcsUrl, spEntityId, spMetadataUrl } from "@/lib/saml-config";
import { MAX_LOGO_BYTES, MAX_TEXT_CHARS, loadBranding } from "@/lib/branding";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

const TABS = ["general", "access", "sso", "ldap", "logs"] as const;
type Tab = (typeof TABS)[number];
type SP = Promise<{ tab?: string }>;

function StatusPill({ on, text }: { on: boolean; text: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-normal ${on ? "border-emerald-700 bg-emerald-950/60 text-emerald-300" : "border-slate-700 bg-slate-900 text-slate-400"}`} data-testid="status-pill">
      {on ? "● " : "○ "}{text}
    </span>
  );
}

export default async function Settings({ searchParams }: { searchParams: SP }) {
  const session = await requireAuth();
  const t = await getT();
  const c = getConfig();
  const local = session.kind === "local";
  const admin = session.access === "all";
  // the local administrator manages everything; other administrators only read the logs; everybody else sees the general page
  const tabs: Tab[] = local ? [...TABS] : admin ? ["general", "logs"] : [];
  const q = (await searchParams).tab;
  const tab: Tab = tabs.find((x) => x === q) ?? "general";
  const l = (local ? loadLdapConfig() : null) ?? EMPTY_LDAP;
  const agentOptions = local ? listAgents().map((a) => ({ id: a.id, label: `${a.agent_id} (${a.hostname})` })) : [];
  const groups = local ? listGroups() : [];
  const hiddenText = local ? loadHiddenPatterns().join("\n") : "";
  const brand = loadBranding();
  const saml = (local ? loadSamlConfig() : null) ?? EMPTY_SAML;
  const insecure = l.enabled && l.url.startsWith("ldap://") && !l.startTls;
  const label: Record<Tab, string> = { general: t("set.tabGeneral"), access: t("set.tabAccess"), sso: t("set.tabSso"), ldap: t("set.tabLdap"), logs: t("set.tabLogs") };

  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-xl font-semibold">{t("set.title")}</h1>

      {tabs.length > 0 && (
        <nav aria-label={t("set.tabs")} className="-mx-4 overflow-x-auto border-b border-slate-800 px-4 md:mx-0 md:px-0">
          <ul className="flex min-w-max gap-1">
            {tabs.map((x) => (
              <li key={x}>
                <Link
                  href={`/settings?tab=${x}`}
                  aria-current={x === tab ? "page" : undefined}
                  className={`-mb-px block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition ${x === tab ? "border-sky-400 text-white" : "border-transparent text-slate-400 hover:text-white"}`}
                >
                  {label[x]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {tab === "general" && (
        <div className="space-y-5">
          <section className="card space-y-1">
            <p className="text-sm">{t("set.signedIn", { name: session.username })}</p>
            <p className="text-xs text-slate-400">
              {admin ? t("set.accessAll") : t("set.accessGroups", { groups: groupNames(session).join(", ") || "—" })}
            </p>
          </section>

          <section className="card">
            <h2 className="mb-2 font-medium">{t("set.monitoring")}</h2>
            <dl className="grid grid-cols-[minmax(0,12rem)_1fr] gap-y-1 text-sm">
              <dt className="text-slate-400">{t("set.interval")}</dt><dd>{c.heartbeatIntervalSec} s</dd>
              <dt className="text-slate-400">{t("set.timeout")}</dt><dd>{c.agentTimeoutSec} s</dd>
              <dt className="text-slate-400">{t("set.failures")}</dt><dd>{c.offlineAfterFailures}</dd>
            </dl>
          </section>

          {local ? (
            <>
              <section className="card">
                <h2 className="mb-1 font-medium">{t("brand.title")}</h2>
                <p className="mb-3 text-xs text-slate-400">{t("brand.intro")}</p>
                <ActionForm action={brandingAction} className="space-y-3">
                  <label className="block text-sm">{t("brand.text")}
                    <input name="text" defaultValue={brand.text ?? ""} maxLength={MAX_TEXT_CHARS} placeholder="PodmanManager" autoComplete="off" className="input mt-1" />
                  </label>
                  <label className="block text-sm">{t("brand.logo")}
                    <LogoInput name="logo" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" />
                    <span className="text-xs text-slate-500">{t("brand.hint", { max: Math.round(MAX_LOGO_BYTES / 1024) })}</span>
                  </label>
                  {brand.logo && (
                    <div className="flex items-center gap-3 text-sm">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/brand/logo?v=${brand.logo}`} alt="" className="h-8 w-auto max-w-[14rem] rounded border border-slate-800 bg-slate-950 object-contain p-1" />
                      <label className="flex items-center gap-2"><input type="checkbox" name="removeLogo" />{t("brand.remove")}</label>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button name="intent" value="save" className="btn btn-primary">{t("brand.save")}</button>
                    <button name="intent" value="reset" className="btn" formNoValidate>{t("brand.reset")}</button>
                  </div>
                </ActionForm>
              </section>
              <section className="card">
                <h2 className="mb-3 font-medium">{t("set.changePw")}</h2>
                <ActionForm action={changePasswordAction} className="space-y-3">
                  <input name="current" type="password" required placeholder={t("set.current")} autoComplete="current-password" className="input" />
                  <input name="password" type="password" required minLength={10} placeholder={t("set.new")} autoComplete="new-password" className="input" />
                  <input name="confirm" type="password" required placeholder={t("set.repeat")} autoComplete="new-password" className="input" />
                  <button className="btn btn-primary">{t("set.changeBtn")}</button>
                </ActionForm>
              </section>
            </>
          ) : (
            <p className="card text-sm text-slate-400">{t("set.localOnly")}</p>
          )}

          <form action={logoutAction}><button className="btn">{t("set.logout")}</button></form>
        </div>
      )}

      {tab === "access" && local && (
        <div className="space-y-5">
          <section className="card">
            <h2 className="mb-1 font-medium">{t("groups.title")}</h2>
            <p className="mb-3 text-xs text-slate-400">{t("groups.intro")}</p>
            <div className="space-y-3">
              {groups.length === 0 && <p className="text-xs text-slate-500">{t("groups.none")}</p>}
              {groups.map((g) => (
                <GroupEditor key={g.id} group={{ id: g.id, name: g.name, adGroupDn: g.ad_group_dn, samlGroup: g.saml_group, agentIds: g.agentIds }} agents={agentOptions} />
              ))}
              <GroupEditor key="new" group={{ name: "", adGroupDn: "", samlGroup: "", agentIds: [] }} agents={agentOptions} />
            </div>
          </section>
          <section className="card">
            <h2 className="mb-1 font-medium">{t("hidden.title")}</h2>
            <p className="mb-3 text-xs text-slate-400">{t("hidden.intro")}</p>
            <ActionForm action={hiddenAction} className="space-y-3">
              <label className="block text-sm">{t("hidden.patterns")}
                <textarea name="patterns" defaultValue={hiddenText} rows={4} spellCheck={false} placeholder={"podmanmanager*\n*-secret"} className="input mt-1 font-mono text-xs" />
                <span className="text-xs text-slate-500">{t("hidden.hint")}</span>
              </label>
              <label className="block text-sm">{t("hidden.testName")}
                <input name="testName" autoComplete="off" maxLength={128} placeholder="podmanmanager-agent" className="input mt-1" />
              </label>
              <div className="flex gap-2">
                <button name="intent" value="save" className="btn btn-primary">{t("hidden.save")}</button>
                <button name="intent" value="test" className="btn" formNoValidate>{t("hidden.test")}</button>
              </div>
            </ActionForm>
          </section>
        </div>
      )}

      {tab === "sso" && local && (
        <section className="card">
          <h2 className="mb-1 flex items-center gap-2 font-medium">{t("saml.title")} <StatusPill on={saml.enabled} text={saml.enabled ? t("set.statusOn") : t("set.statusOff")} /></h2>
          <p className="mb-3 text-xs text-slate-400">{t("saml.intro")}</p>
          <ActionForm action={samlImportAction} className="mb-4 space-y-2">
            <label className="block text-sm">{t("saml.importLabel")}
              <textarea name="metadata" rows={2} spellCheck={false} placeholder="https://adfs.example.com/FederationMetadata/2007-06/FederationMetadata.xml" className="input mt-1 font-mono text-xs" />
              <span className="text-xs text-slate-500">{t("saml.importHint")}</span>
            </label>
            <button className="btn">{t("saml.importBtn")}</button>
          </ActionForm>
          <ActionForm key={`${saml.idpEntityId}|${saml.idpSsoUrl}|${saml.idpCert.length}`} action={samlAction} className="space-y-3" bar={<><button name="intent" value="save" className="btn btn-primary">{t("saml.save")}</button>
              <button name="intent" value="check" className="btn" formNoValidate>{t("saml.check")}</button></>}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="samlEnabled" defaultChecked={saml.enabled} /> {t("saml.enabled")}
            </label>
            <label className="block text-sm">{t("saml.buttonLabel")}
              <input name="buttonLabel" defaultValue={saml.buttonLabel} maxLength={MAX_BUTTON_LABEL} placeholder={t("auth.ssoSignIn")} autoComplete="off" className="input mt-1" />
              <span className="text-xs text-slate-500">{t("saml.buttonHint")}</span>
            </label>
            <label className="block text-sm">{t("saml.publicUrl")}
              <input name="publicUrl" defaultValue={saml.publicUrl} placeholder="https://master.example.com" className="input mt-1" />
              <span className="text-xs text-slate-500">{t("saml.publicUrlHint")}</span>
            </label>
            <label className="block text-sm">{t("saml.entityId")}
              <input name="idpEntityId" defaultValue={saml.idpEntityId} placeholder="http://adfs.example.com/adfs/services/trust" className="input mt-1" />
            </label>
            <label className="block text-sm">{t("saml.ssoUrl")}
              <input name="idpSsoUrl" defaultValue={saml.idpSsoUrl} placeholder="https://adfs.example.com/adfs/ls/" className="input mt-1" />
            </label>
            <label className="block text-sm">{t("saml.cert")}
              <textarea name="idpCert" defaultValue={saml.idpCert} rows={4} spellCheck={false} placeholder={"-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"} className="input mt-1 font-mono text-xs" />
              <span className="text-xs text-slate-500">{t("saml.certHint")}</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">{t("saml.usernameClaim")}
                <input name="usernameClaim" defaultValue={saml.usernameClaim} className="input mt-1 font-mono text-xs" />
              </label>
              <label className="block text-sm">{t("saml.groupClaim")}
                <input name="groupClaim" defaultValue={saml.groupClaim} className="input mt-1 font-mono text-xs" />
              </label>
            </div>
            <p className="-mt-2 text-xs text-slate-500">{t("saml.claimHint")}</p>
            <label className="block text-sm">{t("saml.adminGroup")}
              <input name="adminGroup" defaultValue={saml.adminGroup} placeholder="CORP\PodmanAdmins" autoComplete="off" className="input mt-1" />
              <span className="text-xs text-slate-500">{t("saml.adminHint")}</span>
            </label>
          </ActionForm>
          <div className="mt-4 text-sm" data-testid="saml-sp-info">
            <p className="mb-1 text-xs text-slate-400">{t("saml.spInfo")}</p>
            {saml.publicUrl ? (
              <dl className="grid grid-cols-[12rem_1fr] gap-y-1 text-xs">
                <dt className="text-slate-400">{t("saml.spEntity")}</dt><dd className="break-all font-mono">{spEntityId(saml)}</dd>
                <dt className="text-slate-400">{t("saml.spAcs")}</dt><dd className="break-all font-mono">{spAcsUrl(saml)}</dd>
                <dt className="text-slate-400">{t("saml.spMeta")}</dt><dd className="break-all font-mono"><a className="text-sky-400 hover:underline" href="/saml/metadata" target="_blank" rel="noopener noreferrer">{spMetadataUrl(saml)}</a></dd>
              </dl>
            ) : (
              <p className="text-xs text-slate-500">{t("saml.spNeedUrl")}</p>
            )}
          </div>
        </section>
      )}

      {tab === "ldap" && local && (
        <section className="card">
          <h2 className="mb-1 flex items-center gap-2 font-medium">{t("ldap.title")} <StatusPill on={l.enabled} text={l.enabled ? t("set.statusOn") : t("set.statusOff")} /></h2>
          <p className="mb-3 text-xs text-slate-400">{t("ldap.intro")}</p>
          {insecure && <p className="mb-3 text-xs text-amber-400">{t("ldap.insecure")}</p>}
          <ActionForm action={ldapAction} className="space-y-3" bar={<><button name="intent" value="save" className="btn btn-primary">{t("ldap.save")}</button>
              <button name="intent" value="test" className="btn">{t("ldap.test")}</button></>}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={l.enabled} /> {t("ldap.enabled")}
            </label>
            <label className="block text-sm">{t("ldap.url")}
              <input name="url" defaultValue={l.url} placeholder="ldaps://dc.example.com:636" required className="input mt-1" />
              <span className="text-xs text-slate-500">{t("ldap.urlHint")}</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="startTls" defaultChecked={l.startTls} /> {t("ldap.startTls")}
            </label>
            <label className="block text-sm">{t("ldap.ca")}
              <textarea name="caCert" defaultValue={l.caCert} rows={3} placeholder="-----BEGIN CERTIFICATE-----" className="input mt-1 font-mono text-xs" />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">{t("ldap.bindDn")}
                <input name="bindDn" defaultValue={l.bindDn} placeholder="CN=svc-podman,OU=Service,DC=example,DC=com" required autoComplete="off" className="input mt-1" />
              </label>
              <label className="block text-sm">{t("ldap.bindPw")}
                <input name="bindPassword" type="password" autoComplete="new-password" placeholder={l.bindPassword ? t("ldap.bindPwKeep") : ""} className="input mt-1" />
              </label>
            </div>
            <label className="block text-sm">{t("ldap.baseDn")}
              <input name="baseDn" defaultValue={l.baseDn} placeholder="DC=example,DC=com" required className="input mt-1" />
            </label>
            <label className="block text-sm">{t("ldap.filter")}
              <input name="filter" defaultValue={l.filter || DEFAULT_FILTER} className="input mt-1 font-mono text-xs" />
              <span className="text-xs text-slate-500">{t("ldap.filterHint")}</span>
            </label>
            <label className="block text-sm">{t("ldap.groupDn")}
              <input name="groupDn" defaultValue={l.groupDn} placeholder="CN=PodmanManager-Admins,OU=Groups,DC=example,DC=com" className="input mt-1" />
            </label>
            <label className="block text-sm">{t("ldap.testUser")}
              <input name="testUser" autoComplete="off" maxLength={256} className="input mt-1" />
            </label>
          </ActionForm>
        </section>
      )}

      {tab === "logs" && admin && <AppLogs title={t("alogs.master")} load={appLogsAction} />}
    </div>
  );
}
