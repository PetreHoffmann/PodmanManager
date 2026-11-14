// Emergency reset of the second factor of one account, for someone who lost the authenticator app AND the recovery codes.
// Run on the host with access to the master container:
//   podman exec podmanmanager-master node /app/reset-2fa.mjs admin
// It needs no password: whoever may run commands in the container controls the database anyway.
import { DatabaseSync } from "node:sqlite";

const user = process.argv[2];
if (!user || user.startsWith("-")) {
  console.error("Usage: node reset-2fa.mjs <account>   (admin, or the name of a local user)");
  process.exit(2);
}
const path = (process.env.DATABASE_URL || "file:./data/master.db").replace(/^file:/, "");
const db = new DatabaseSync(path);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
try {
  const r = db.prepare("DELETE FROM mfa WHERE username = ? COLLATE NOCASE").run(user);
  const pk = db.prepare("DELETE FROM passkeys WHERE username = ? COLLATE NOCASE").run(user);
  db.prepare("DELETE FROM pending_logins WHERE username = ? COLLATE NOCASE").run(user);
  if (Number(r.changes) === 0 && Number(pk.changes) === 0) {
    console.log(`"${user}" has no second factor or passkey; nothing changed.`);
  } else {
    db.prepare("INSERT INTO audit (ts, username, kind, action, target) VALUES (?, 'host', 'cli', 'mfa.reset', ?)").run(new Date().toISOString(), user);
    console.log(`Second factor and passkeys of "${user}" removed. It can sign in with the password and set up new ones.`);
  }
} catch (e) {
  console.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
} finally {
  db.close();
}
