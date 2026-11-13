/** "Max Mustermann (MustermannM)": the display name with the account name; null when there is no display name (the caller then shows the login name). */
export function formatDisplayName(displayName: unknown, account: string): string | null {
  const raw = Array.isArray(displayName) ? displayName[0] : displayName;
  // eslint-disable-next-line no-control-regex
  const name = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) : "";
  if (!name) return null;
  const acc = account.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  return acc && acc.toLowerCase() !== name.toLowerCase() ? `${name} (${acc})` : name;
}

/** The account name from a user principal name: the part before the @ (a name without @ is returned as it is). */
export const accountFromUpn = (upn: string): string => upn.split("@")[0]!.trim();
