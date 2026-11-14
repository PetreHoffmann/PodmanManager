export interface SessionInfo {
  username: string;
  kind: "local" | "user" | "ldap" | "saml";
  /** "all": every agent (local admin, LDAP/SAML administrators); "groups": only agents of groupIds. */
  access: "all" | "groups";
  groupIds: number[];
  /** how the user is shown ("Max Mustermann (MustermannM)"); absent = show `username` */
  displayName?: string;
  /** local user must choose a new password before anything else */
  mustChange?: boolean;
  /** the administrator requires a second factor of local accounts and this one has none yet */
  mustMfa?: boolean;
  /** signed in with a passkey (user verification = two factors in one step) */
  strong?: boolean;
}
