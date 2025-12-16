#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(repoRoot, "backend", "services", "docker-compose.test.yml");
const postgresUrl = "postgres://latitude:latitude@127.0.0.1:5433/latitude_integration";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let cleanedUp = false;
const cleanup = async () => {
  if (cleanedUp) {
    return;
  }
  cleanedUp = true;
  try {
    await run("docker", ["compose", "-f", composeFile, "down", "-v", "--remove-orphans"], { stdio: "ignore" });
  } catch (error) {
    console.warn("[integration] Failed to clean up containers:", error.message);
  }
};

const handleSignal = (signal) => {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(1));
  });
};

handleSignal("SIGINT");
handleSignal("SIGTERM");
process.on("exit", () => {
  void cleanup();
});

async function ensureDockerAvailable() {
  try {
    await run("docker", ["version"], { stdio: "ignore" });
  } catch (error) {
    throw new Error(`Docker is required to run integration tests: ${error.message}`);
  }
}

async function startServices() {
  await run("docker", ["compose", "-f", composeFile, "up", "-d", "--wait"]);
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await run(
        "docker",
        ["compose", "-f", composeFile, "exec", "-T", "postgres", "pg_isready", "-U", "latitude", "-d", "latitude_integration"],
        { stdio: "ignore" },
      );
      return;
    } catch {
      await delay(1000);
    }
  }
  throw new Error("Postgres did not become ready in time");
}

async function runServiceTests() {
  const filters = [
    "@latitude/content-service",
    "@latitude/analytics-service",
    "@latitude/designer-service",
    "@latitude/linkedin-service",
    "@latitude/dev-agent-service",
    "@latitude/auth-service",
    "@latitude/agent-orchestrator",
    "@latitude/growth-engine",
    "@latitude/user-service",
  ];

  for (const filter of filters) {
    await run(pnpmCommand, ["--filter", filter, "test:integration"], {
      shell: process.platform === "win32",
    });
  }
}

async function main() {
  await ensureDockerAvailable();
  process.env.AUTH_DATABASE_URL = postgresUrl;
  process.env.POSTGRES_URL = postgresUrl;

  await startServices();
  await waitForPostgres();

  try {
    await runServiceTests();
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
