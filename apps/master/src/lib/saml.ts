import { SAML, ValidateInResponseTo, generateServiceProviderMetadata, type CacheProvider, type Profile } from "@node-saml/node-saml";
import { DbCacheProvider, REQUEST_TTL_MS } from "./saml-cache";
import { spAcsUrl, spEntityId, splitCerts, type SamlConfig } from "./saml-config";
import type { MappedSamlGroup } from "./saml-access";

/** Tolerated difference between the clocks of ADFS and this master. */
export const CLOCK_SKEW_MS = 120_000;

/** SAML client configured for ADFS: assertion must be signed, requests are single use, assertions cannot be replayed. */
export function createSaml(cfg: SamlConfig, cache: CacheProvider = new DbCacheProvider()): SAML {
  return new SAML({
    callbackUrl: spAcsUrl(cfg),
    issuer: spEntityId(cfg),
    audience: spEntityId(cfg),
    entryPoint: cfg.idpSsoUrl,
    idpCert: splitCerts(cfg.idpCert),
    idpIssuer: cfg.idpEntityId,
    // ADFS rejects a NameID policy it cannot satisfy and a requested authentication context (Kerberos/WIA logins).
    identifierFormat: null,
    disableRequestedAuthnContext: true,
    // ADFS signs the assertion by default; the response itself only if configured.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: REQUEST_TTL_MS,
    rejectReplayedAssertions: true,
    cacheProvider: cache,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
  });
}

/** Address to send the browser to (HTTP-Redirect binding); `relayState` comes back unchanged with the response. */
export async function startLogin(cfg: SamlConfig, relayState: string, cache?: CacheProvider): Promise<string> {
  return createSaml(cfg, cache).getAuthorizeUrlAsync(relayState, undefined, {});
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

/** Service provider metadata for the ADFS relying party trust. */
export function spMetadataXml(cfg: SamlConfig): string {
  return generateServiceProviderMetadata({ issuer: spEntityId(cfg), callbackUrl: spAcsUrl(cfg), wantAssertionsSigned: true, identifierFormat: null });
}

export type { MappedSamlGroup };
