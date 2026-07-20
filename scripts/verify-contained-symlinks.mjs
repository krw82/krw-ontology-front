#!/usr/bin/env node

import {
  lstatSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

const rootArgument = process.argv[2];
if (!rootArgument) {
  console.error("Usage: scripts/verify-contained-symlinks.mjs ROOT");
  process.exit(2);
}

try {
  const requestedRoot = path.resolve(rootArgument);
  const rootStats = lstatSync(requestedRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`Contained tree root must be a regular directory: ${requestedRoot}`);
  }
  const root = realpathSync(requestedRoot);
  const pending = [root];
  let symlinkCount = 0;

  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = realpathSync(candidate);
        const relative = path.relative(root, resolved);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new Error(
            `Symlink escapes the contained tree: ${candidate} -> ${resolved}`,
          );
        }
        symlinkCount += 1;
      } else if (entry.isDirectory()) {
        pending.push(candidate);
      }
    }
  }

  console.log(`Contained symlink verification passed: ${symlinkCount} links`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
