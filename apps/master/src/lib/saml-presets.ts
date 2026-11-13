/** Claim types ADFS uses by default (this file has no imports: it is also used by a client component). */
export const DEFAULT_USERNAME_CLAIM = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn";
export const DEFAULT_GROUP_CLAIM = "http://schemas.xmlsoap.org/claims/Group";

/**
 * Starting values for the claim fields per identity provider (a convenience for the settings form; nothing is stored
 * but the fields themselves). Claim names that depend on the provider's own configuration are marked in the docs.
 */
export const SAML_PRESETS = {
  adfs: { usernameClaim: DEFAULT_USERNAME_CLAIM, groupClaim: DEFAULT_GROUP_CLAIM, nameIdFormat: "", displayNameClaim: "" },
  // Entra ID: UPN in the "name" claim; groups arrive as object IDs (GUIDs) unless configured otherwise
  entra: { usernameClaim: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name", groupClaim: "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups", nameIdFormat: "", displayNameClaim: "http://schemas.microsoft.com/identity/claims/displayname" },
  // Okta: the NameID carries the user name; "groups" is the name of the group attribute statement to create
  okta: { usernameClaim: "", groupClaim: "groups", nameIdFormat: "", displayNameClaim: "" },
  // Keycloak: the NameID carries the user name; "groups" is the attribute name of the "Group list" mapper to create
  keycloak: { usernameClaim: "", groupClaim: "groups", nameIdFormat: "", displayNameClaim: "" },
} as const;

export type SamlPresetKey = keyof typeof SAML_PRESETS;
