import { readFile } from "node:fs/promises";
import { hostname } from "node:os";

const devLockPath = new URL("../.next/dev/lock", import.meta.url);

let lock;
try {
  lock = JSON.parse(await readFile(devLockPath, "utf8"));
} catch {
  process.exit(0);
}

const pid = Number(lock?.pid);
const isLocalLock = !lock?.hostname || lock.hostname === hostname();
if (!isLocalLock || !Number.isInteger(pid) || pid <= 0) {
  process.exit(0);
}

try {
  process.kill(pid, 0);
} catch (error) {
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "ESRCH") process.exit(0);
  }
  // An inaccessible process cannot be confirmed as this project's dev server.
  process.exit(0);
}

console.error(
  "Refusing to run `next build` while this project's `next dev` is active. Stop `npm run dev` first: both commands write to .next.",
);
process.exit(1);
