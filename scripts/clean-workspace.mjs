import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const staticTargets = [
  "frontend/web/.next",
  "frontend/web/.turbo",
  "frontend/web/dist",
  "frontend/web/.cache",
  "frontend/web/out",
  "frontend/web/.eslintcache",
  "frontend/web/.tsbuildinfo",
  "backend/api-gateway/dist",
  "backend/api-gateway/.turbo",
  "backend/integration-tests/.turbo",
  "start.log",
];

async function addServiceTargets() {
  const servicesDir = path.join(repoRoot, "backend", "services");
  let entries = [];
  try {
    entries = await readdir(servicesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => [
      path.join("backend", "services", entry.name, "dist"),
      path.join("backend", "services", entry.name, ".turbo"),
    ]);
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error ?? {}).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function removeTarget(relPath) {
  const abs = path.join(repoRoot, relPath);
  if (!(await pathExists(abs))) {
    return false;
  }
  await rm(abs, { recursive: true, force: true });
  return true;
}

async function main() {
  const targets = [...staticTargets, ...(await addServiceTargets())];
  const removed = [];
  for (const relPath of targets) {
    try {
      const didRemove = await removeTarget(relPath);
      if (didRemove) {
        removed.push(relPath);
      }
    } catch (error) {
      console.error(`Failed to remove ${relPath}:`, error instanceof Error ? error.message : error);
    }
  }

  if (removed.length === 0) {
    console.log("Workspace already clean. No build artifacts found.");
  } else {
    console.log("Removed artifacts:");
    for (const entry of removed) {
      console.log(` - ${entry}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
