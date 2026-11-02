import { cookies, headers } from "next/headers";
import { LANG_COOKIE, isLang, makeT, pickLang, type Lang, type T } from "./i18n";

export async function getLang(): Promise<Lang> {
  const c = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(c)) return c;
  return pickLang((await headers()).get("accept-language"));
}

export async function getT(): Promise<T> {
  return makeT(await getLang());
}
