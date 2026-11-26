"use client";

import { useRef, useState } from "react";
import { agentAddressAction, agentSetupAction, removeAgentAction, rotateAgentTokenAction, testAgentAction, toggleAgentAction, type SetupResult } from "@/app/actions";
import AgentSetupPanel from "./AgentSetupPanel";
import ActionForm from "./ActionForm";
import { useT } from "./I18nProvider";
import Icon from "./Icon";

export default function HostActions({ id, enabled, hostname, url = "", local = false }: { id: number; enabled: boolean; hostname: string; url?: string; local?: boolean }) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [rotateAsk, setRotateAsk] = useState(false);
  const [addr, setAddr] = useState(url);
  const [addrMsg, setAddrMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [addrBusy, setAddrBusy] = useState(false);
  const saveAddr = async () => {
    setAddrBusy(true);
    setAddrMsg(null);
    try {
      const r = await agentAddressAction(id, addr);
      if (r.ok) setSetup({ ok: true, id, setup: r.setup, message: "" });
      setAddrMsg({ ok: r.ok && r.reachable, text: r.message });
    } finally {
      setAddrBusy(false);
    }
  };
  const openSetup = async () => {
    setSetup(null);
    setRotateAsk(false);
    setAddr(url);
    setAddrMsg(null);
    dlg.current?.showModal();
    setSetup(await agentSetupAction(id));
  };
  const rotate = async () => {
    setRotateAsk(false);
    setSetup(await rotateAgentTokenAction(id));
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <ActionForm action={testAgentAction} inline>
        <input type="hidden" name="id" value={id} />
        <button className="btn !px-2.5 !py-1 text-xs" disabled={!enabled}><Icon name="plugs-connected" />{t("hosts.test")}</button>
      </ActionForm>
      <ActionForm action={toggleAgentAction} inline>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="enable" value={enabled ? "0" : "1"} />
        <button className="btn !px-2.5 !py-1 text-xs">{enabled ? <Icon name="prohibit" /> : <Icon name="power" />}{enabled ? t("hosts.disable") : t("hosts.enable")}</button>
      </ActionForm>
      {local ? null : (
        <>
          <button type="button" className="btn !px-2.5 !py-1 text-xs" onClick={openSetup}><Icon name="key" />{t("wiz.setup")}</button>
          <dialog ref={dlg} className="m-auto w-[min(48rem,92vw)] rounded-xl border border-slate-700 bg-slate-950 p-5 text-slate-100 backdrop:bg-black/60 whitespace-normal">
            <div className="space-y-3">
              <h3 className="font-medium">{t("wiz.setup")}: {hostname}</h3>
              <div className="space-y-1">
                <label className="block text-xs text-slate-400" htmlFor={`addr-${id}`}>{t("wiz.address")}</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input id={`addr-${id}`} value={addr} onChange={(e) => setAddr(e.target.value)} className="input !w-auto min-w-[16rem] flex-1 font-mono text-xs" />
                  <button type="button" className="btn !px-2.5 !py-1 text-xs" disabled={addrBusy || addr.trim() === ""} onClick={saveAddr}><Icon name="floppy-disk" />{addrBusy ? "…" : t("wiz.addressSave")}</button>
                </div>
                {addrMsg && <p role="status" className={`text-xs ${addrMsg.ok ? "text-emerald-300" : "text-amber-300"}`}>{addrMsg.text}</p>}
              </div>
              {setup === null && <p className="animate-pulse text-sm text-slate-400">…</p>}
              {setup && !setup.ok && <p className="text-sm text-red-400">{setup.message}</p>}
              {setup?.ok && (
                <>
                  {setup.message && <p role="status" className="text-xs text-amber-300">{setup.message}</p>}
                  <AgentSetupPanel key={setup.setup.hash} setup={setup.setup} />
                </>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {rotateAsk ? (
                  <>
                    <span className="text-xs text-amber-300">{t("wiz.rotateQ")}</span>
                    <button type="button" className="btn btn-danger !px-2.5 !py-1 text-xs" onClick={rotate}><Icon name="check" />{t("common.confirm")}</button>
                    <button type="button" className="btn !px-2.5 !py-1 text-xs" onClick={() => setRotateAsk(false)}><Icon name="x" />{t("common.cancel")}</button>
                  </>
                ) : (
                  <button type="button" className="btn !px-2.5 !py-1 text-xs" onClick={() => setRotateAsk(true)}><Icon name="arrows-clockwise" />{t("wiz.rotate")}</button>
                )}
                <button type="button" className="btn ml-auto !px-2.5 !py-1 text-xs" onClick={() => dlg.current?.close()}><Icon name="x" />{t("wiz.close")}</button>
              </div>
            </div>
          </dialog>
        </>
      )}
      {local ? null : confirm ? (
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
