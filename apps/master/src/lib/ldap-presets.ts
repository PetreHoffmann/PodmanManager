/** Defaults of Active Directory. Kept free of imports: this file is also used by a client component. */
export const DEFAULT_FILTER =
  "(&(objectClass=user)(objectCategory=person)(|(sAMAccountName={username})(userPrincipalName={username})))";

/**
 * How membership of a group is determined:
 *  - "chain": Active Directory's matching rule "in chain" (direct and nested groups)
 *  - "user":  the user entry lists its groups in an attribute (memberOf, isMemberOf), direct membership only
 *  - "group": the group entry lists its members (member, uniqueMember: the user DN; memberUid: the login name), direct membership only
 */
export const GROUP_MODES = ["chain", "user", "group"] as const;
export type GroupMode = (typeof GROUP_MODES)[number];

export interface LdapAttrs {
  filter: string;
  /** attribute with the account (login) name, shown in brackets and used as the user name */
  accountAttr: string;
  /** attribute with the display name */
  displayAttr: string;
  groupMode: GroupMode;
  /** attribute that carries the membership (user mode: on the user; group mode: on the group) */
  memberAttr: string;
}

export const AD_ATTRS: LdapAttrs = { filter: DEFAULT_FILTER, accountAttr: "sAMAccountName", displayAttr: "displayName", groupMode: "chain", memberAttr: "" };

const INET = "(&(objectClass=inetOrgPerson)(|(uid={username})(mail={username})))";

/**
 * Typical values per directory server (a starting point for the settings form; check them against your directory).
 * The login filter holds what a user may type: account name, mail address, user principal name.
 */
export const LDAP_PRESETS = {
  ad: AD_ATTRS,
  samba: AD_ATTRS,
  openldap: { filter: INET, accountAttr: "uid", displayAttr: "cn", groupMode: "group", memberAttr: "member" },
  openldapUnique: { filter: INET, accountAttr: "uid", displayAttr: "cn", groupMode: "group", memberAttr: "uniqueMember" },
  openldapPosix: { filter: "(&(objectClass=posixAccount)(uid={username}))", accountAttr: "uid", displayAttr: "cn", groupMode: "group", memberAttr: "memberUid" },
  openldapMemberOf: { filter: INET, accountAttr: "uid", displayAttr: "cn", groupMode: "user", memberAttr: "memberOf" },
  freeipa: { filter: "(&(objectClass=posixAccount)(|(uid={username})(krbPrincipalName={username})(mail={username})))", accountAttr: "uid", displayAttr: "displayName", groupMode: "user", memberAttr: "memberOf" },
  ds389: { filter: INET, accountAttr: "uid", displayAttr: "cn", groupMode: "group", memberAttr: "member" },
  apacheds: { filter: INET, accountAttr: "uid", displayAttr: "cn", groupMode: "group", memberAttr: "member" },
  edirectory: { filter: "(&(objectClass=inetOrgPerson)(|(cn={username})(uid={username})(mail={username})))", accountAttr: "cn", displayAttr: "fullName", groupMode: "group", memberAttr: "member" },
  oracle: { filter: INET, accountAttr: "uid", displayAttr: "cn", groupMode: "user", memberAttr: "isMemberOf" },
  jumpcloud: { filter: "(&(objectClass=inetOrgPerson)(|(uid={username})(mail={username})))", accountAttr: "uid", displayAttr: "displayName", groupMode: "user", memberAttr: "memberOf" },
  univention: { filter: "(&(objectClass=posixAccount)(|(uid={username})(mail={username})))", accountAttr: "uid", displayAttr: "displayName", groupMode: "user", memberAttr: "memberOf" },
} as const satisfies Record<string, LdapAttrs>;

export type LdapPresetKey = keyof typeof LDAP_PRESETS;
