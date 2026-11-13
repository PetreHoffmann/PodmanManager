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
}
