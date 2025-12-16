import { spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(".env") });

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isCI = process.env.CI === "true";
const skipSeeds = process.argv.includes("--skip-seeds") || process.env.SKIP_SERVICE_SEEDS === "true";

const steps = [
  {
    id: "content-service",
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
    id: "growth-engine",
    description: "Apply @latitude/growth-engine migrations",
    migrationsDir: path.join(workspaceRoot, "backend", "services", "growth-engine", "migrations"),
    connectionKeys: ["DATABASE_URL", "POSTGRES_URL"],
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
    id: "analytics-service",
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
    id: "linkedin-service",
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
    id: "dev-agent-service",
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
    id: "designer-service",
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
    id: "user-service",
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
    id: "user-service-seed",
    description: "Seed default @latitude/user-service records",
    optional: true,
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

async function directoryHasMigrations(dir) {
  const exists = await pathExists(dir);
  if (!exists) {
    return false;
  }

  const contents = await readdir(dir);
  return contents.some((entry) => entry.endsWith(".ts") || entry.endsWith(".js") || entry.endsWith(".sql"));
}

function resolveConnection(connectionKeys) {
  for (const key of connectionKeys ?? []) {
    const value = process.env[key];
    if (value) {
      return { key, value };
    }
  }

  return undefined;
}

async function runCommand(name, command, envOverrides = {}) {
  const child = spawn(command[0], command.slice(1), {
    cwd: workspaceRoot,
    env: { ...process.env, ...envOverrides },
    stdio: "inherit",
  });

  await new Promise((resolve, reject) => {
    child.on("error", (error) => reject(new Error(`[db:${name}] Failed to start: ${error.message}`)));
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(new Error(`[db:${name}] Exited due to signal: ${signal}`));
        return;
      }

      reject(new Error(`[db:${name}] Exited with status ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  console.info("[db] Running service migrations and seeds sequentially (safe to rerun).");

  for (const step of steps) {
    if (step.optional && skipSeeds) {
      console.info(`[db:${step.id}] Skipping optional seed step (--skip-seeds or SKIP_SERVICE_SEEDS=true).`);
      continue;
    }

    if (step.migrationsDir) {
      const hasMigrations = await directoryHasMigrations(step.migrationsDir);
      if (!hasMigrations) {
        console.info(`[db:${step.id}] No migrations found in ${step.migrationsDir}; skipping.`);
        continue;
      }
    }

    const connection = resolveConnection(step.connectionKeys ?? []);
    if (!connection) {
      if (isCI) {
        throw new Error(
          `[db:${step.id}] Missing connection string. Set one of: ${(step.connectionKeys ?? []).join(", ")}.`,
        );
      }

      console.info(
        `[db:${step.id}] Skipping because no connection string was configured (${(step.connectionKeys ?? []).join(", ")}).`,
      );
      continue;
    }

    const envOverrides = {};
    for (const key of step.connectionKeys ?? []) {
      if (!process.env[key]) {
        envOverrides[key] = connection.value;
      }
    }

    const command = step.buildCommand(connection.value);
    console.info(`[db:${step.id}] ${step.description}`);
    await runCommand(step.id, command, envOverrides);
    console.info(`[db:${step.id}] Completed successfully.`);
  }

  console.info("[db] Service migrations/seeds finished.");
}

main().catch((error) => {
  console.error("[db] Database setup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
