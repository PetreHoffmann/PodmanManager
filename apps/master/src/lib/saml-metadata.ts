import { DOMParser } from "@xmldom/xmldom";
import * as xpath from "xpath";
import { splitCerts } from "./saml-config";

export interface IdpMetadata {
  entityId: string;
  ssoUrl: string;
  /** signing certificates, PEM */
  certs: string[];
}

export type MetadataResult = { ok: true; data: IdpMetadata } | { ok: false; error: "err.samlMetaParse" | "err.samlMetaNoIdp" | "err.samlMetaFetch" | "err.samlMetaTooLarge" };

const MAX_BYTES = 1024 * 1024;
const BIND_REDIRECT = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
const BIND_POST = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";

/** Extracts entity id, SSO address and signing certificates from IdP metadata (e.g. ADFS FederationMetadata.xml). */
export function parseIdpMetadata(xml: string): MetadataResult {
  if (xml.length > MAX_BYTES) return { ok: false, error: "err.samlMetaTooLarge" };
  let doc: Document;
  try {
    const errors: string[] = [];
    doc = new DOMParser({ errorHandler: { warning: () => {}, error: (m: string) => errors.push(m), fatalError: (m: string) => errors.push(m) } }).parseFromString(xml, "text/xml") as unknown as Document;
    if (errors.length > 0 || !doc?.documentElement) return { ok: false, error: "err.samlMetaParse" };
  } catch {
    return { ok: false, error: "err.samlMetaParse" };
  }
  const sel = xpath.useNamespaces({ md: "urn:oasis:names:tc:SAML:2.0:metadata", ds: "http://www.w3.org/2000/09/xmldsig#" });
  const idps = sel("//md:EntityDescriptor[md:IDPSSODescriptor]", doc as unknown as Node) as Element[];
  const ed = idps[0];
  if (!ed) return { ok: false, error: "err.samlMetaNoIdp" };
  const idp = (sel("md:IDPSSODescriptor", ed) as Element[])[0]!;
  const entityId = ed.getAttribute("entityID") ?? "";
  const services = sel("md:SingleSignOnService", idp) as Element[];
  const pick = (b: string) => services.find((s) => s.getAttribute("Binding") === b)?.getAttribute("Location") ?? "";
  const ssoUrl = pick(BIND_REDIRECT) || pick(BIND_POST);
  const keys = sel("md:KeyDescriptor[not(@use) or @use='signing']/ds:KeyInfo/ds:X509Data/ds:X509Certificate", idp) as Element[];
  const certs = keys.flatMap((k) => splitCerts(k.textContent ?? ""));
  if (!entityId || !ssoUrl || certs.length === 0) return { ok: false, error: "err.samlMetaNoIdp" };
  return { ok: true, data: { entityId, ssoUrl, certs: [...new Set(certs)] } };
}

/** Reads metadata from an address (https, or http for localhost) or takes pasted XML. */
export async function loadIdpMetadata(input: string, fetchImpl: typeof fetch = fetch): Promise<MetadataResult> {
  const t = input.trim();
  if (!/^https?:\/\//i.test(t)) return parseIdpMetadata(t);
  try {
    const res = await fetchImpl(t, { redirect: "error", signal: AbortSignal.timeout(10_000), headers: { Accept: "application/samlmetadata+xml, application/xml, text/xml" } });
    if (!res.ok) return { ok: false, error: "err.samlMetaFetch" };
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_BYTES) return { ok: false, error: "err.samlMetaTooLarge" };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return { ok: false, error: "err.samlMetaTooLarge" };
    return parseIdpMetadata(new TextDecoder().decode(buf));
  } catch {
    return { ok: false, error: "err.samlMetaFetch" };
  }
}
