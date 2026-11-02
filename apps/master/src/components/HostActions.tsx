"use client";

import { useState } from "react";
import { removeAgentAction, testAgentAction, toggleAgentAction } from "@/app/actions";
import ActionForm from "./ActionForm";

export default function HostActions({ id, enabled, hostname }: { id: number; enabled: boolean; hostname: string }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <ActionForm action={testAgentAction} inline>
        <input type="hidden" name="id" value={id} />
        <button className="btn" disabled={!enabled}>Test</button>
      </ActionForm>
      <ActionForm action={toggleAgentAction} inline>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="enable" value={enabled ? "0" : "1"} />
        <button className="btn">{enabled ? "Disable" : "Enable"}</button>
      </ActionForm>
      {confirm ? (
        <ActionForm action={removeAgentAction} inline>
          <input type="hidden" name="id" value={id} />
          <span className="mr-1 text-xs text-amber-300">Remove {hostname}?</span>
          <button className="btn btn-danger">Confirm</button>
          <button type="button" className="btn ml-1" onClick={() => setConfirm(false)}>Cancel</button>
        </ActionForm>
      ) : (
        <button className="btn" onClick={() => setConfirm(true)}>Remove</button>
      )}
    </div>
  );
}
