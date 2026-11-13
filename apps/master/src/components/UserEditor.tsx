"use client";

import { useState } from "react";
import { userAction } from "@/app/actions";
import ActionForm from "./ActionForm";
import { useT } from "./I18nProvider";
import Icon from "./Icon";

export interface UserData {
  id?: number;
  username: string;
  isAdmin: boolean;
  enabled: boolean;
  mustChange: boolean;
  groupIds: number[];
}

export default function UserEditor({ user, groups }: { user: UserData; groups: { id: number; name: string }[] }) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const isNew = user.id === undefined;
  return (
    <ActionForm action={userAction} resetOnSuccess={isNew} className="space-y-3 rounded-lg border border-slate-800 p-3">
      {!isNew && <input type="hidden" name="id" value={user.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">{t("users.name")}
          {isNew
            ? <input name="username" required maxLength={64} autoComplete="off" className="input mt-1" />
            : <input name="username" value={user.username} readOnly className="input mt-1 opacity-70" />}
        </label>
        <label className="block text-sm">{t("users.password")}
          <input name="password" type="password" required={isNew} minLength={10} autoComplete="new-password" className="input mt-1" />
          {!isNew && <span className="text-xs text-slate-500">{t("users.passwordHint")}</span>}
        </label>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="isAdmin" defaultChecked={user.isAdmin} />{t("users.admin")}</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={user.enabled} />{t("users.enabled")}</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="mustChange" defaultChecked={user.mustChange} />{t("users.mustChange")}</label>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm">{t("users.groups")}</legend>
        {groups.length === 0 ? (
          <p className="text-xs text-slate-500">{t("users.noGroups")}</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {groups.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="groups" value={g.id} defaultChecked={user.groupIds.includes(g.id)} /> {g.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        {confirm ? (
          <>
            <span key="question" className="text-sm text-amber-300">{t("users.deleteQ", { name: user.username })}</span>
            <button key="confirm" name="intent" value="delete" formNoValidate className="btn btn-danger"><Icon name="check" />{t("common.confirm")}</button>
            <button key="cancel" type="button" className="btn" onClick={() => setConfirm(false)}><Icon name="x" />{t("common.cancel")}</button>
          </>
        ) : (
          <>
            <button key="save" name="intent" value="save" className="btn btn-primary">{isNew ? <Icon name="plus-circle" /> : <Icon name="floppy-disk" />}{isNew ? t("users.add") : t("users.save")}</button>
            {!isNew && <button key="ask" type="button" className="btn" onClick={() => setConfirm(true)}><Icon name="trash" />{t("users.delete")}</button>}
          </>
        )}
      </div>
    </ActionForm>
  );
}
