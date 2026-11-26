/**
 * Does this response of the master's own /login come from the running master? A redirect (opaque with redirect: "manual",
 * e.g. when already signed in) and any answer below 500 do. A reverse proxy answers 502/503/504 while the master container
 * restarts: that counts as "down", otherwise the page would never notice the restart behind a proxy.
 */
export function masterAnswers(res: { type?: string; status: number }): boolean {
  if (res.type === "opaqueredirect") return true;
  return res.status > 0 && res.status < 500;
}
