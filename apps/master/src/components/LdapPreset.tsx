"use client";

import { LDAP_PRESETS, type LdapPresetKey } from "@/lib/ldap-presets";
import { useT } from "./I18nProvider";

const NAMES: { key: LdapPresetKey; name: string }[] = [
  { key: "ad", name: "Active Directory" },
  { key: "samba", name: "Samba AD" },
  { key: "openldap", name: "OpenLDAP (groupOfNames)" },
  { key: "openldapUnique", name: "OpenLDAP (groupOfUniqueNames)" },
  { key: "openldapPosix", name: "OpenLDAP (posixGroup, memberUid)" },
  { key: "openldapMemberOf", name: "OpenLDAP (memberOf overlay)" },
  { key: "freeipa", name: "FreeIPA / Red Hat IdM" },
  { key: "ds389", name: "389 Directory Server / Red Hat DS" },
  { key: "apacheds", name: "Apache Directory Server" },
  { key: "edirectory", name: "OpenText / Novell eDirectory" },
  { key: "oracle", name: "Oracle Unified Directory / DSEE" },
  { key: "jumpcloud", name: "JumpCloud LDAP" },
  { key: "univention", name: "Univention (UCS)" },
];

/** Fills the user filter and the attribute fields of the surrounding form with the usual values of a directory server (nothing is saved until the form is). */
export default function LdapPreset() {
  const t = useT();
  return (
    <label className="block text-sm">{t("ldap.preset")}
      <select
        defaultValue=""
        className="input mt-1 block w-auto"
        onChange={(e) => {
          const key = e.currentTarget.value as LdapPresetKey | "";
          const form = e.currentTarget.form;
          if (!key || !form) return;
          const p = LDAP_PRESETS[key];
          const set = (name: string, v: string) => {
            const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
            if (el) el.value = v;
          };
          set("filter", p.filter);
          set("accountAttr", p.accountAttr);
          set("displayAttr", p.displayAttr);
          set("groupMode", p.groupMode);
          set("memberAttr", p.memberAttr);
        }}
      >
        <option value="">{t("ldap.presetPick")}</option>
        {NAMES.map((n) => <option key={n.key} value={n.key}>{n.name}</option>)}
      </select>
      <span className="block text-xs text-slate-500">{t("ldap.presetHint")}</span>
    </label>
  );
}
