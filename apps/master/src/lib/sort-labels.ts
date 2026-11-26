import type { Key, T } from "./i18n";

/** Texts of the phone sort form (shared by all list pages). */
export const sortLabels = (t: T) => ({
  by: t("hosts.sortBy" as Key), dflt: t("hosts.sortDefault" as Key), dir: t("hosts.sortDir" as Key),
  asc: t("hosts.sortAsc" as Key), desc: t("hosts.sortDesc" as Key), apply: t("hosts.sortApply" as Key),
});
