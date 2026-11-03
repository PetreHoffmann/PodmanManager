import pkg from "../../package.json";


const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Docker images get APP_VERSION from the git tag at build time; otherwise package.json. */
export function getVersion(env: Record<string, string | undefined> = process.env): string {
  const v = (env.APP_VERSION ?? "").trim().replace(/^v/, "");
  return SEMVER.test(v) ? v : pkg.version;
}
