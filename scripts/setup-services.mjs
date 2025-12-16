import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(repoRoot, ".env") });
try {
  loadEnv({ path: path.join(repoRoot, ".env.local"), override: true });
} catch {
  // optional local overrides
}

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const servicesRoot = path.join(repoRoot, "backend", "services");
const migrationScript = path.join(servicesRoot, "scripts", "runMigrations.ts");
const connectionString = (process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? process.env.PG_CONNECTION_STRING)?.trim();

if (!connectionString) {
  throw new Error("Set POSTGRES_URL or DATABASE_URL before running service migrations.");
}

const baseServiceEnv = {
  POSTGRES_URL: process.env.POSTGRES_URL ?? connectionString,
  DATABASE_URL: process.env.DATABASE_URL ?? connectionString,
  PG_CONNECTION_STRING: process.env.PG_CONNECTION_STRING ?? connectionString,
};

const targets = [
  { name: "auth", directory: "auth-service" },
  { name: "user", directory: "user-service", seed: { command: pnpmCommand, args: ["--filter", "@latitude/user-service", "run", "seed"] } },
  { name: "designer", directory: "designer-service" },
  { name: "dev-agent", directory: "dev-agent-service" },
  { name: "linkedin", directory: "linkedin-service" },
  { name: "analytics", directory: "analytics-service" },
  { name: "content", directory: "content-service" },
];

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...options.env },
      stdio: options.stdio ?? "inherit",
      shell: options.shell ?? false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
      }
    });
  });
}

async function runServiceMigrations(service) {
  const serviceRoot = path.join(servicesRoot, service.directory);
  console.log(`[setup] Running migrations for ${service.name} service...`);
  await run(process.execPath, ["--import", "tsx", migrationScript, "--url", connectionString], {
    cwd: serviceRoot,
    env: baseServiceEnv,
  });
}

async function seedServiceData(service) {
  if (!service.seed) {
    return;
  }
  console.log(`[setup] Seeding demo data for ${service.name} service...`);
  await run(service.seed.command, service.seed.args, { shell: process.platform === "win32", env: baseServiceEnv });
}

async function main() {
  for (const service of targets) {
    await runServiceMigrations(service);
    await seedServiceData(service);
  }
  console.log("[setup] Service migrations and seeds complete.");
}

main().catch((error) => {
  console.error("[setup] Failed to prepare services:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
