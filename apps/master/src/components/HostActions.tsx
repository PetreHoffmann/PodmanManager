"use client";

import { useState } from "react";
import { removeAgentAction, testAgentAction, toggleAgentAction } from "@/app/actions";
import ActionForm from "./ActionForm";
import { useT } from "./I18nProvider";
import Icon from "./Icon";

export default function HostActions({ id, enabled, hostname }: { id: number; enabled: boolean; hostname: string }) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className={`flex items-center gap-1 ${confirm ? "flex-wrap" : "flex-nowrap whitespace-nowrap"}`}>
      <ActionForm action={testAgentAction} inline>
        <input type="hidden" name="id" value={id} />
        <button className="btn !px-2.5 !py-1 text-xs" disabled={!enabled}><Icon name="plugs-connected" />{t("hosts.test")}</button>
      </ActionForm>
      <ActionForm action={toggleAgentAction} inline>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="enable" value={enabled ? "0" : "1"} />
        <button className="btn !px-2.5 !py-1 text-xs">{enabled ? <Icon name="prohibit" /> : <Icon name="power" />}{enabled ? t("hosts.disable") : t("hosts.enable")}</button>
      </ActionForm>
      {confirm ? (
        <ActionForm action={removeAgentAction} inline>
          <input type="hidden" name="id" value={id} />
          <span className="mr-1 text-xs text-amber-300">{t("hosts.removeQ", { name: hostname })}</span>
          <button className="btn btn-danger !px-2.5 !py-1 text-xs"><Icon name="check" />{t("common.confirm")}</button>
          <button type="button" className="btn ml-1 !px-2.5 !py-1 text-xs" onClick={() => setConfirm(false)}><Icon name="x" />{t("common.cancel")}</button>
        </ActionForm>
      ) : (
        <button className="btn !px-2.5 !py-1 text-xs" onClick={() => setConfirm(true)}><Icon name="trash" />{t("hosts.remove")}</button>
      )}
    </div>
  );
}
