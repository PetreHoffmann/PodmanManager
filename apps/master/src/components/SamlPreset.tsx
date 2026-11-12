"use client";

import { SAML_PRESETS, type SamlPresetKey } from "@/lib/saml-presets";
import { useT } from "./I18nProvider";

/** Fills the claim and NameID fields of the surrounding form with the usual values of an identity provider (nothing is saved until the form is). */
export default function SamlPreset() {
  const t = useT();
  return (
    <label className="block text-sm">{t("saml.preset")}
      <select
        defaultValue=""
        className="input mt-1 block w-auto"
        onChange={(e) => {
          const key = e.currentTarget.value as SamlPresetKey | "";
          const form = e.currentTarget.form;
          if (!key || !form) return;
          const p = SAML_PRESETS[key];
          const set = (name: string, v: string) => {
            const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
            if (el) el.value = v;
          };
          set("usernameClaim", p.usernameClaim);
          set("groupClaim", p.groupClaim);
          set("nameIdFormat", p.nameIdFormat);
        }}
      >
        <option value="">{t("saml.presetPick")}</option>
        <option value="adfs">ADFS</option>
        <option value="entra">Microsoft Entra ID</option>
        <option value="okta">Okta</option>
        <option value="keycloak">Keycloak</option>
      </select>
      <span className="block text-xs text-slate-500">{t("saml.presetHint")}</span>
    </label>
  );
}
