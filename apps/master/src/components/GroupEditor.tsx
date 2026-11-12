"use client";

import { useState } from "react";
import { groupAction } from "@/app/actions";
import ActionForm from "./ActionForm";
import { useT } from "./I18nProvider";

export interface GroupData {
  id?: number;
  name: string;
  adGroupDn: string;
  samlGroup: string;
  agentIds: number[];
}

export default function GroupEditor({ group, agents }: { group: GroupData; agents: { id: number; label: string }[] }) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const isNew = group.id === undefined;
  return (
    <ActionForm action={groupAction} resetOnSuccess={isNew} className="space-y-3 rounded-lg border border-slate-800 p-3">
      {!isNew && <input type="hidden" name="id" value={group.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">{t("groups.name")}
          <input name="name" defaultValue={group.name} required maxLength={64} className="input mt-1" />
        </label>
        <label className="block text-sm">{t("groups.adDn")}
          <input name="adGroupDn" defaultValue={group.adGroupDn} maxLength={512} placeholder="CN=Team-A,OU=Groups,DC=example,DC=com" className="input mt-1" />
        </label>
        <label className="block text-sm sm:col-span-2">{t("groups.samlGroup")}
          <input name="samlGroup" defaultValue={group.samlGroup} maxLength={256} placeholder="CORP\Team-A" className="input mt-1" />
          <span className="text-xs text-slate-500">{t("groups.samlHint")}</span>
        </label>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm">{t("groups.agents")}</legend>
        {agents.length === 0 ? (
          <p className="text-xs text-slate-500">{t("groups.noAgents")}</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {agents.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="agents" value={a.id} defaultChecked={group.agentIds.includes(a.id)} /> {a.label}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {/* Distinct keys: otherwise React reuses the "Delete" (type=button) node as the "Confirm" submit button and the same click submits the form. */}
      <div className="flex flex-wrap items-center gap-2">
        {confirm ? (
          <>
            <span key="question" className="text-sm text-amber-300">{t("groups.deleteQ", { name: group.name })}</span>
            <button key="confirm" name="intent" value="delete" formNoValidate className="btn btn-danger">{t("common.confirm")}</button>
            <button key="cancel" type="button" className="btn" onClick={() => setConfirm(false)}>{t("common.cancel")}</button>
          </>
        ) : (
          <>
            <button key="save" name="intent" value="save" className="btn btn-primary">{isNew ? t("groups.add") : t("groups.save")}</button>
            {!isNew && <button key="ask" type="button" className="btn" onClick={() => setConfirm(true)}>{t("groups.delete")}</button>}
          </>
        )}
      </div>
    </ActionForm>
  );
}
