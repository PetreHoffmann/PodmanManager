export interface SessionInfo {
  username: string;
  kind: "local" | "ldap";
  /** "all": every agent (local admin, LDAP administrators); "groups": only agents of groupIds. */
  access: "all" | "groups";
  groupIds: number[];
}
