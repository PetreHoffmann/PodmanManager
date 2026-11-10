import ActionForm from "@/components/ActionForm";
import { changePasswordAction, hiddenAction, ldapAction, logoutAction } from "@/app/actions";
import { getConfig } from "@/lib/config";
import { DEFAULT_FILTER } from "@/lib/ldap";
import { EMPTY_LDAP, loadLdapConfig } from "@/lib/ldap-config";
import { getT } from "@/lib/lang";
import GroupEditor from "@/components/GroupEditor";
import { listAgents } from "@/lib/agents";
import { groupNames, listGroups } from "@/lib/groups";
import { loadHiddenPatterns } from "@/lib/hidden";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const session = await requireAuth();
  const t = await getT();
  const c = getConfig();
  const local = session.kind === "local";
  const l = (local ? loadLdapConfig() : null) ?? EMPTY_LDAP;
  const agentOptions = local ? listAgents().map((a) => ({ id: a.id, label: `${a.agent_id} (${a.hostname})` })) : [];
  const groups = local ? listGroups() : [];
  const hiddenText = local ? loadHiddenPatterns().join("\n") : "";
  const insecure = l.enabled && l.url.startsWith("ldap://") && !l.startTls;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">{t("set.title")}</h1>
      <p className="text-sm text-slate-400">{t("set.signedIn", { name: session.username })}</p>
      <p className="text-xs text-slate-500">
        {session.access === "all" ? t("set.accessAll") : t("set.accessGroups", { groups: groupNames(session).join(", ") || "—" })}
      </p>

      <section className="card">
        <h2 className="mb-2 font-medium">{t("set.monitoring")}</h2>
        <dl className="grid grid-cols-[14rem_1fr] gap-y-1 text-sm">
          <dt className="text-slate-400">{t("set.interval")}</dt><dd>{c.heartbeatIntervalSec} s</dd>
          <dt className="text-slate-400">{t("set.timeout")}</dt><dd>{c.agentTimeoutSec} s</dd>
          <dt className="text-slate-400">{t("set.failures")}</dt><dd>{c.offlineAfterFailures}</dd>
        </dl>
      </section>

      {local ? (
        <>
          <section className="card">
            <h2 className="mb-3 font-medium">{t("set.changePw")}</h2>
            <ActionForm action={changePasswordAction} className="space-y-3">
              <input name="current" type="password" required placeholder={t("set.current")} autoComplete="current-password" className="input" />
              <input name="password" type="password" required minLength={10} placeholder={t("set.new")} autoComplete="new-password" className="input" />
              <input name="confirm" type="password" required placeholder={t("set.repeat")} autoComplete="new-password" className="input" />
              <button className="btn btn-primary">{t("set.changeBtn")}</button>
            </ActionForm>
          </section>

          <section className="card">
            <h2 className="mb-1 font-medium">{t("ldap.title")}</h2>
            <p className="mb-3 text-xs text-slate-400">{t("ldap.intro")}</p>
            {insecure && <p className="mb-3 text-xs text-amber-400">{t("ldap.insecure")}</p>}
            <ActionForm action={ldapAction} className="space-y-3">
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
              <label className="block text-sm">{t("ldap.bindDn")}
                <input name="bindDn" defaultValue={l.bindDn} placeholder="CN=svc-podman,OU=Service,DC=example,DC=com" required autoComplete="off" className="input mt-1" />
              </label>
              <label className="block text-sm">{t("ldap.bindPw")}
                <input name="bindPassword" type="password" autoComplete="new-password" placeholder={l.bindPassword ? t("ldap.bindPwKeep") : ""} className="input mt-1" />
              </label>
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
              <div className="flex gap-2">
                <button name="intent" value="save" className="btn btn-primary">{t("ldap.save")}</button>
                <button name="intent" value="test" className="btn">{t("ldap.test")}</button>
              </div>
            </ActionForm>
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

          <section className="card">
            <h2 className="mb-1 font-medium">{t("groups.title")}</h2>
            <p className="mb-3 text-xs text-slate-400">{t("groups.intro")}</p>
            <div className="space-y-3">
              {groups.length === 0 && <p className="text-xs text-slate-500">{t("groups.none")}</p>}
              {groups.map((g) => (
                <GroupEditor key={g.id} group={{ id: g.id, name: g.name, adGroupDn: g.ad_group_dn, agentIds: g.agentIds }} agents={agentOptions} />
              ))}
              <GroupEditor key="new" group={{ name: "", adGroupDn: "", agentIds: [] }} agents={agentOptions} />
            </div>
          </section>
        </>
      ) : (
        <p className="card text-sm text-slate-400">{t("set.localOnly")}</p>
      )}

      <form action={logoutAction}><button className="btn">{t("set.logout")}</button></form>
    </div>
  );
}
