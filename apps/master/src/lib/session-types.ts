export interface SessionInfo {
  username: string;
  kind: "local" | "ldap" | "saml";
  /** "all": every agent (local admin, LDAP/SAML administrators); "groups": only agents of groupIds. */
  access: "all" | "groups";
  groupIds: number[];
}
