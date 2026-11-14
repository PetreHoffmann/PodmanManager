"use client";

import type { PasskeyCreateOptions } from "@/app/actions";

const toBuf = (s: string): ArrayBuffer => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out.buffer;
};
const toB64u = (b: ArrayBuffer | null): string => {
  if (!b) return "";
  let s = "";
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Browser and address allow passkeys (https or localhost). */
export const passkeysSupported = (): boolean => typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential !== "undefined";

export async function createPasskey(o: PasskeyCreateOptions): Promise<{ id: string; clientDataJSON: string; attestationObject: string }> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...o,
      challenge: toBuf(o.challenge),
      user: { ...o.user, id: toBuf(o.user.id) },
      excludeCredentials: o.excludeCredentials.map((c) => ({ ...c, id: toBuf(c.id) })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("cancelled");
  const r = cred.response as AuthenticatorAttestationResponse;
  return { id: toB64u(cred.rawId), clientDataJSON: toB64u(r.clientDataJSON), attestationObject: toB64u(r.attestationObject) };
}

export async function getPasskey(o: { challenge: string; rpId: string; timeout: number }): Promise<{ id: string; clientDataJSON: string; authenticatorData: string; signature: string }> {
  const cred = (await navigator.credentials.get({
    publicKey: { challenge: toBuf(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: "required" },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("cancelled");
  const r = cred.response as AuthenticatorAssertionResponse;
  return { id: toB64u(cred.rawId), clientDataJSON: toB64u(r.clientDataJSON), authenticatorData: toB64u(r.authenticatorData), signature: toB64u(r.signature) };
}
