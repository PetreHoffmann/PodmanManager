"use client";

import { useState } from "react";
import { removeAgentAction, testAgentAction, toggleAgentAction } from "@/app/actions";
import ActionForm from "./ActionForm";
import { useT } from "./I18nProvider";

export default function HostActions({ id, enabled, hostname }: { id: number; enabled: boolean; hostname: string }) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <ActionForm action={testAgentAction} inline>
        <input type="hidden" name="id" value={id} />
        <button className="btn" disabled={!enabled}>{t("hosts.test")}</button>
      </ActionForm>
      <ActionForm action={toggleAgentAction} inline>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="enable" value={enabled ? "0" : "1"} />
        <button className="btn">{enabled ? t("hosts.disable") : t("hosts.enable")}</button>
      </ActionForm>
      {confirm ? (
        <ActionForm action={removeAgentAction} inline>
          <input type="hidden" name="id" value={id} />
          <span className="mr-1 text-xs text-amber-300">{t("hosts.removeQ", { name: hostname })}</span>
          <button className="btn btn-danger">{t("common.confirm")}</button>
          <button type="button" className="btn ml-1" onClick={() => setConfirm(false)}>{t("common.cancel")}</button>
        </ActionForm>
      ) : (
        <button className="btn" onClick={() => setConfirm(true)}>{t("hosts.remove")}</button>
      )}
    </div>
  );
}
