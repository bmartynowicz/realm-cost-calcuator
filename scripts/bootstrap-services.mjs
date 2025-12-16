import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(".env") });

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipSeedsFlag = process.argv.includes("--skip-seeds") || process.env.BOOTSTRAP_SKIP_SEEDS === "true";

const steps = [
  {
    name: "shared-migrations",
    description: "Apply shared infra/db migrations (schema_history)",
    migrationsDir: path.join(workspaceRoot, "infra", "db", "migrations"),
    connectionKeys: ["POSTGRES_URL"],
    buildCommand: (connectionString) => ["pnpm", "migrate", "--", connectionString],
  },
  {
    name: "content-service-migrations",
    description: "Apply @latitude/content-service migrations",
    migrationsDir: path.join(workspaceRoot, "backend", "services", "content-service", "migrations"),
    connectionKeys: ["POSTGRES_URL", "DATABASE_URL"],
    buildCommand: (connectionString) => [
      "pnpm",
      "--filter",
      "@latitude/content-service",
      "run",
      "migrate",
      "--",
      "--url",
      connectionString,
    ],
  },
  {
    name: "growth-engine-migrations",
    description: "Apply @latitude/growth-engine migrations",
    migrationsDir: path.join(workspaceRoot, "backend", "services", "growth-engine", "migrations"),
    connectionKeys: ["POSTGRES_URL", "DATABASE_URL"],
    buildCommand: (connectionString) => [
      "pnpm",
      "--filter",
      "@latitude/growth-engine",
      "run",
      "migrate",
      "--",
      "--url",
      connectionString,
    ],
  },
  {
    name: "analytics-service-migrations",
    description: "Apply @latitude/analytics-service migrations",
    migrationsDir: path.join(workspaceRoot, "backend", "services", "analytics-service", "migrations"),
    connectionKeys: ["ANALYTICS_DATABASE_URL", "POSTGRES_URL"],
    buildCommand: (connectionString) => [
      "pnpm",
      "--filter",
      "@latitude/analytics-service",
      "run",
      "migrate",
      "--",
      "--url",
      connectionString,
    ],
  },
  {
    name: "linkedin-service-migrations",
    description: "Apply @latitude/linkedin-service migrations",
    migrationsDir: path.join(workspaceRoot, "backend", "services", "linkedin-service", "migrations"),
    connectionKeys: ["LINKEDIN_DATABASE_URL", "POSTGRES_URL"],
    buildCommand: (connectionString) => [
      "pnpm",
      "--filter",
      "@latitude/linkedin-service",
      "run",
      "migrate",
      "--",
      "--url",
      connectionString,
    ],
  },
  {
    name: "dev-agent-service-migrations",
    description: "Apply @latitude/dev-agent-service migrations",
    migrationsDir: path.join(workspaceRoot, "backend", "services", "dev-agent-service", "migrations"),
    connectionKeys: ["DEV_AGENT_DATABASE_URL", "POSTGRES_URL"],
    buildCommand: (connectionString) => [
      "pnpm",
      "--filter",
      "@latitude/dev-agent-service",
      "run",
      "migrate",
      "--",
      "--url",
      connectionString,
    ],
  },
  {
    name: "designer-service-migrations",
    description: "Apply @latitude/designer-service migrations",
    migrationsDir: path.join(workspaceRoot, "backend", "services", "designer-service", "migrations"),
    connectionKeys: ["POSTGRES_URL", "DATABASE_URL"],
    buildCommand: (connectionString) => [
      "pnpm",
      "--filter",
      "@latitude/designer-service",
      "run",
      "migrate",
      "--",
      "--url",
      connectionString,
    ],
  },
  {
    name: "user-service-migrations",
    description: "Apply @latitude/user-service migrations",
    migrationsDir: path.join(workspaceRoot, "backend", "services", "user-service", "migrations"),
    connectionKeys: ["POSTGRES_URL", "DATABASE_URL"],
    buildCommand: (connectionString) => [
      "pnpm",
      "--filter",
      "@latitude/user-service",
      "run",
      "migrate",
      "--",
      "--url",
      connectionString,
    ],
  },
  {
    name: "user-service-seed",
    description: "Seed default users/workspaces for @latitude/user-service",
    optional: true,
    skipReason: skipSeedsFlag ? "--skip-seeds flag or BOOTSTRAP_SKIP_SEEDS=true" : undefined,
    connectionKeys: ["POSTGRES_URL", "DATABASE_URL"],
    buildCommand: () => ["pnpm", "--filter", "@latitude/user-service", "run", "seed"],
  },
];

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveConnection(connectionKeys, stepName) {
  for (const key of connectionKeys) {
    const value = process.env[key];
    if (value) {
      return { key, value };
    }
  }

  throw new Error(
    `[setup:${stepName}] Missing connection string. Set one of: ${connectionKeys.join(", ")}.`,
  );
}

async function runCommand(name, command, envOverrides = {}) {
  const child = spawn(command[0], command.slice(1), {
    cwd: workspaceRoot,
    env: { ...process.env, ...envOverrides },
    stdio: "inherit",
  });

  await new Promise((resolve, reject) => {
    child.on("error", (error) => reject(new Error(`[setup:${name}] Failed to start: ${error.message}`)));
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(new Error(`[setup:${name}] Exited due to signal: ${signal}`));
        return;
      }

      reject(new Error(`[setup:${name}] Exited with status ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  console.info("[setup] Starting database migrations and seeds. These steps are safe to rerun.");

  for (const step of steps) {
    if (step.optional && skipSeedsFlag) {
      console.info(`[setup:${step.name}] Skipping optional step (${step.skipReason}).`);
      continue;
    }

    if (step.migrationsDir) {
      const exists = await pathExists(step.migrationsDir);
      if (!exists) {
        console.info(`[setup:${step.name}] No migrations directory found at ${step.migrationsDir}; skipping.`);
        continue;
      }
    }

    const connection = step.connectionKeys ? resolveConnection(step.connectionKeys, step.name) : undefined;
    const command = step.buildCommand(connection?.value ?? "");
    const envOverrides = {};

    if (connection) {
      for (const key of step.connectionKeys ?? []) {
        if (!process.env[key]) {
          envOverrides[key] = connection.value;
        }
      }
    }

    console.info(`[setup:${step.name}] ${step.description}`);
    await runCommand(step.name, command, envOverrides);
    console.info(`[setup:${step.name}] Completed successfully.`);
  }

  console.info("[setup] All requested migrations and seeds completed.");
}

main().catch((error) => {
  console.error("[setup] Migrations/seeds failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
