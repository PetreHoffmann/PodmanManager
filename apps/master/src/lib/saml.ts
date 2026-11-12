import { SAML, SamlStatusError, ValidateInResponseTo, generateServiceProviderMetadata, type CacheProvider, type Profile } from "@node-saml/node-saml";
import { DbCacheProvider, REQUEST_TTL_MS } from "./saml-cache";
import { spAcsUrl, spEntityId, splitCerts, type SamlConfig } from "./saml-config";
import type { MappedSamlGroup } from "./saml-access";

/** Tolerated difference between the clocks of ADFS and this master. */
export const CLOCK_SKEW_MS = 120_000;

/** SAML client (ADFS, Entra ID, Okta, Keycloak, ...): assertion must be signed, requests are single use, assertions cannot be replayed. */
export function createSaml(cfg: SamlConfig, cache: CacheProvider = new DbCacheProvider(), opts: { forceAuthn?: boolean } = {}): SAML {
  return new SAML({
    callbackUrl: spAcsUrl(cfg),
    issuer: spEntityId(cfg),
    audience: spEntityId(cfg),
    entryPoint: cfg.idpSsoUrl,
    idpCert: splitCerts(cfg.idpCert),
    idpIssuer: cfg.idpEntityId,
    // ADFS rejects a NameID policy it cannot satisfy and a requested authentication context (Kerberos/WIA logins);
    // other providers can be asked for a format explicitly (settings).
    identifierFormat: cfg.nameIdFormat || null,
    disableRequestedAuthnContext: true,
    // The assertion must be signed (ADFS and Okta do by default; Keycloak: enable "Sign assertions"); the response itself need not be.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: REQUEST_TTL_MS,
    rejectReplayedAssertions: true,
    cacheProvider: cache,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    // after a logout in this master: the identity provider must authenticate the user again instead of reusing its session
    forceAuthn: opts.forceAuthn === true,
  });
}

/** Address to send the browser to (HTTP-Redirect binding); `relayState` comes back unchanged with the response. */
export async function startLogin(cfg: SamlConfig, relayState: string, cache?: CacheProvider, opts: { forceAuthn?: boolean } = {}): Promise<string> {
  return createSaml(cfg, cache, opts).getAuthorizeUrlAsync(relayState, undefined, {});
}

export type SamlLoginResult = { ok: true; username: string; groups: string[] } | { ok: false; reason: string };

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 256);

/** Attribute values as a list of strings (single value, list, or nested objects are reduced to text). */
export function claimValues(profile: object, claim: string): string[] {
  const attrs = (profile as { attributes?: Record<string, unknown> }).attributes;
  if (!attrs || !claim || !Object.prototype.hasOwnProperty.call(attrs, claim)) return [];
  const v = attrs[claim];
  const list = Array.isArray(v) ? v : [v];
  return list.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x !== "");
}

const STATUS_PREFIX = "urn:oasis:names:tc:SAML:2.0:status:";

const STATUS_HINTS: Record<string, string> = {
  RequestDenied:
    "The identity provider refused the request and does not say why. Typical causes on its side: the access control policy / authorization rules of the relying party trust or application do not permit this user, " +
    "or the trust's identifier or endpoint does not match what this master sends (see below). The reason is in the provider's own log (ADFS: Event Viewer > Applications and Services Logs > AD FS > Admin; Entra ID: sign-in logs; Okta: System Log; Keycloak: Events)",
  AuthnFailed: "the user could not be authenticated at the identity provider",
  NoPassive: "the identity provider cannot sign in without user interaction",
  InvalidNameIDPolicy: "the identity provider does not support the requested NameID format (change or clear it in the SSO settings)",
  UnsupportedBinding: "the identity provider does not support the requested binding",
  RequestUnsupported: "the identity provider does not support this kind of request",
  RequestVersionTooLow: "the identity provider does not support this SAML version",
};

/** A failure status of the identity provider, with what this master sent so it can be compared with the relying party trust. */
export function describeStatusError(e: SamlStatusError, cfg: Pick<SamlConfig, "publicUrl">): string {
  const codes = [...e.xmlStatus.matchAll(/<StatusCode[^>]*\sValue="([^"]+)"/g)].map((m) => m[1]!.replace(STATUS_PREFIX, ""));
  const message = /<StatusMessage>([\s\S]*?)<\/StatusMessage>/.exec(e.xmlStatus)?.[1]?.trim();
  const detail = /<StatusDetail>([\s\S]*?)<\/StatusDetail>/.exec(e.xmlStatus)?.[1]?.replace(/<[^>]+>/g, " ").trim();
  const hint = codes.map((c) => STATUS_HINTS[c]).find((h) => h !== undefined);
  return (
    `The identity provider answered with an error: ${codes.join(" > ") || "unknown status"}${message ? `; message: ${message}` : ""}${detail ? `; detail: ${detail}` : ""}` +
      `${hint ? `. ${hint}` : ""}. This master sent: identifier ${spEntityId(cfg)}, sign-in endpoint ${spAcsUrl(cfg)}`
  ).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);
}

const sameUrl = (a: string, b: string): boolean => {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
};

/** Recipients of the bearer SubjectConfirmationData elements of the (signed) assertion. */
export function bearerRecipients(profile: Profile): string[] {
  const a = profile.getAssertion?.() as { Assertion?: { Subject?: { SubjectConfirmation?: { $?: { Method?: string }; SubjectConfirmationData?: { $?: { Recipient?: string } }[] }[] }[] } } | undefined;
  const out: string[] = [];
  for (const subject of a?.Assertion?.Subject ?? []) {
    for (const c of subject.SubjectConfirmation ?? []) {
      if (c.$?.Method !== "urn:oasis:names:tc:SAML:2.0:cm:bearer") continue;
      for (const d of c.SubjectConfirmationData ?? []) if (d.$?.Recipient) out.push(d.$.Recipient);
    }
  }
  return out;
}

/** Checks the response (signature, issuer, audience, time window, request id, replay) and reads user name and groups. */
export async function completeLogin(cfg: SamlConfig, samlResponse: string, cache?: CacheProvider): Promise<SamlLoginResult> {
  let profile: Profile | null;
  try {
    ({ profile } = await createSaml(cfg, cache).validatePostResponseAsync({ SAMLResponse: samlResponse }));
  } catch (e) {
    if (e instanceof SamlStatusError) return { ok: false, reason: describeStatusError(e, cfg) };
    return { ok: false, reason: clean(e instanceof Error ? e.message : String(e)) };
  }
  if (!profile) return { ok: false, reason: "no profile in the response" };
  // node-saml 5 only logs a warning when the bearer confirmation names another endpoint: enforce it here.
  if (!bearerRecipients(profile).some((r) => sameUrl(r, spAcsUrl(cfg)))) {
    return { ok: false, reason: "the assertion is not addressed to this sign-in endpoint (Recipient does not match the ACS address)" };
  }
  const fromClaim = cfg.usernameClaim ? claimValues(profile, cfg.usernameClaim)[0] : undefined;
  const username = clean(fromClaim ?? (typeof profile.nameID === "string" ? profile.nameID : ""));
  if (!username) return { ok: false, reason: "no user name in the response (claim and NameID missing)" };
  return { ok: true, username, groups: claimValues(profile, cfg.groupClaim).map(clean) };
}

/** Service provider metadata for the identity provider (ADFS relying party trust, Entra/Okta/Keycloak application). */
export function spMetadataXml(cfg: SamlConfig): string {
  return generateServiceProviderMetadata({ issuer: spEntityId(cfg), callbackUrl: spAcsUrl(cfg), wantAssertionsSigned: true, identifierFormat: cfg.nameIdFormat || null });
}

export type { MappedSamlGroup };
