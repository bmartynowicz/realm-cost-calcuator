import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
loadEnv({ path: path.join(repoRoot, ".env") });
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

// Default to the mock toolset so local stacks can boot without credentials while still
// exercising the scheduler and workers end-to-end.
process.env.FORCE_MOCK_TOOLSET = process.env.FORCE_MOCK_TOOLSET ?? "true";

const services = [
  { name: "auth", args: ["--filter", "@latitude/auth-service", "dev"] },
  { name: "growth", args: ["--filter", "@latitude/growth-engine", "dev"] },
  { name: "gateway", args: ["--filter", "@latitude/api-gateway", "dev"] },
  { name: "web", args: ["--filter", "web", "dev"] },
];

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: options.stdio ?? "inherit",
      env: { ...process.env, ...options.env },
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

async function runMigrations() {
  const scriptPath = path.join(repoRoot, "scripts", "run-migrations.mjs");
  await runCommand(process.execPath, [scriptPath]);
}

async function runServiceMigrationsAndSeeds() {
  const scriptPath = path.join(repoRoot, "scripts", "setup-services.mjs");
  await runCommand(process.execPath, [scriptPath]);
}

function startService(service) {
  const child = spawn(pnpmCommand, service.args, {
    cwd: repoRoot,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const prefix = `[${service.name}]`;
  child.stdout.on("data", (data) => {
    process.stdout.write(`${prefix} ${data}`);
  });
  child.stderr.on("data", (data) => {
    process.stderr.write(`${prefix} ${data}`);
  });
  child.on("close", (code) => {
    console.log(`${prefix} exited with code ${code ?? "unknown"}`);
    process.exitCode = process.exitCode ?? code ?? 0;
  });
  return child;
}

async function main() {
  console.log("Running database migrations...");
  await runMigrations();
  console.log("Running service migrations and seeds...");
  await runServiceMigrationsAndSeeds();
  console.log("Starting services...");
  const children = services.map((service) => startService(service));
  const shutdown = () => {
    console.log("\nStopping services...");
    for (const child of children) {
      child.kill("SIGINT");
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
