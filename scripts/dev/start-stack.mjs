import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { validateEnvironment } from "../validate-env.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const composeFile = path.join(repoRoot, "backend", "services", "docker-compose.test.yml");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const pidRegistryPath = path.join(repoRoot, ".dev-stack-pids.json");

loadEnv({ path: path.join(repoRoot, ".env") });
const envLocalPath = path.join(repoRoot, ".env.local");
try {
  await fs.access(envLocalPath);
  loadEnv({ path: envLocalPath, override: true });
} catch {
  // ignore
}
const cleanOnly = process.env.DEV_STACK_CLEAN_ONLY === "1";
validateEnvironment();

const orchestratorUrl = process.env.AGENT_ORCHESTRATOR_HTTP_URL ?? "http://localhost:8090";
process.env.AGENT_ORCHESTRATOR_HTTP_URL = orchestratorUrl;
process.env.AGENT_ORCHESTRATOR_URL = process.env.AGENT_ORCHESTRATOR_URL ?? orchestratorUrl;
process.env.ASSETS_S3_BUCKET = process.env.ASSETS_S3_BUCKET ?? "dev-assets";
process.env.S3_ENDPOINT = process.env.S3_ENDPOINT ?? "http://localhost:9000";
process.env.S3_REGION = process.env.S3_REGION ?? "us-east-1";
process.env.S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID ?? "latitude";
process.env.S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY ?? "latitude123";
process.env.S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE ?? "true";
process.env.GROWTH_ENGINE_URL = process.env.GROWTH_ENGINE_URL ?? "http://localhost:8080";
process.env.GROWTH_ENGINE_BASE_PATH = process.env.GROWTH_ENGINE_BASE_PATH ?? "/api/growth";
process.env.CONTENT_SERVICE_URL = process.env.CONTENT_SERVICE_URL ?? "http://localhost:8083";

const inferPortFromUrl = (value) => {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.port) {
      return url.port;
    }
    return url.protocol === "https:" ? "443" : "80";
  } catch {
    return undefined;
  }
};

const resolvedContentEngineUrl = process.env.CONTENT_ENGINE_URL?.trim();
const contentEnginePort =
  process.env.CONTENT_ENGINE_PORT ??
  inferPortFromUrl(resolvedContentEngineUrl) ??
  "8088";

if (!resolvedContentEngineUrl) {
  process.env.CONTENT_ENGINE_URL = `http://localhost:${contentEnginePort}`;
}

const services = [
  {
    name: "orchestrator",
    args: ["--filter", "@latitude/agent-orchestrator", "dev"],
    env: { CONTENT_ENGINE_URL: process.env.CONTENT_ENGINE_URL, DESIGNER_SERVICE_URL: "http://localhost:8085" },
  },
  { name: "auth", args: ["--filter", "@latitude/auth-service", "dev"] },
  { name: "content", args: ["--filter", "@latitude/content-service", "dev"] },
  { name: "content-engine", args: ["--filter", "@latitude/content-engine", "dev"], env: { PORT: contentEnginePort } },
  { name: "designer", args: ["--filter", "@latitude/designer-service", "dev"] },
  {
    name: "linkedin",
    args: ["--filter", "@latitude/linkedin-service", "dev"],
    env: { AGENT_ORCHESTRATOR_HTTP_URL: orchestratorUrl, GROWTH_ENGINE_URL: process.env.GROWTH_ENGINE_URL },
  },
  { name: "growth", args: ["--filter", "@latitude/growth-engine", "dev"] },
  {
    name: "analytics",
    args: ["--filter", "@latitude/analytics-service", "dev"],
    env: { ANALYTICS_KAFKA_LOG_LEVEL: "debug" },
  },
  { name: "dev-agent", args: ["--filter", "@latitude/dev-agent-service", "dev"] },
  { name: "user", args: ["--filter", "@latitude/user-service", "dev"] },
  {
    name: "gateway",
    args: ["--filter", "@latitude/api-gateway", "dev"],
    env: { PORT: process.env.API_GATEWAY_PORT ?? "3100" },
  },
  { name: "web", args: ["--filter", "web", "dev"], env: { PORT: process.env.WEB_PORT ?? "3001" } },
];

const shouldUseShell = process.platform === "win32";
const quoteIfNeeded = (value) => (shouldUseShell && /\s/.test(value) ? `"${value}"` : value);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let runningChildren = [];
let isShutdownRequested = false;
let isOutputBroken = false;

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
        resolve(undefined);
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
      }
    });
  });

const runSilently = (command, args, options = {}) =>
  run(command, args, { stdio: "ignore", ...options }).catch((error) => {
    if (!options.ignoreErrors) {
      throw error;
    }
  });

const ensureDocker = async () => {
  await runSilently("docker", ["version"], { shell: shouldUseShell });
};

const resetInfra = async () => {
  await runSilently("docker", ["compose", "-f", quoteIfNeeded(composeFile), "down", "-v", "--remove-orphans"], {
    shell: shouldUseShell,
    ignoreErrors: true,
  });
};

const startInfra = async () => {
  await run("docker", ["compose", "-f", quoteIfNeeded(composeFile), "up", "-d", "--wait"], { shell: shouldUseShell });
};

const stopInfra = async () => {
  await runSilently("docker", ["compose", "-f", quoteIfNeeded(composeFile), "down", "-v", "--remove-orphans"], {
    shell: shouldUseShell,
    ignoreErrors: true,
  });
};

const runInfraMigrations = async () => {
  const scriptPath = path.join(repoRoot, "scripts", "run-migrations.mjs");
  await run(process.execPath, [scriptPath]);
};

const runServiceMigrations = async () => {
  const scriptPath = path.join(repoRoot, "scripts", "setup-services.mjs");
  // Avoid running through a shell so Windows paths with spaces (e.g. "C:\\Program Files\\nodejs\\node.exe")
  // are handled correctly.
  await run(process.execPath, [scriptPath]);
};

const ensureWorkspaceDependencies = async () => {
  await run(pnpmCommand, ["install", "--recursive", "--prefer-offline"], { shell: shouldUseShell });
};

const ensureWorkspaceBuilds = async () => {
  const builds = [
    "@latitude/domain-types",
    "@latitude/observability",
    "@latitude/tools",
    "@latitude/shared-db",
    "@latitude/content-service",
    "@latitude/model-router",
    "@latitude/mock-mode",
  ];
  for (const pkg of builds) {
    await run(pnpmCommand, ["--filter", pkg, "exec", "--", "tsc", "-p", "tsconfig.json"], {
      shell: shouldUseShell,
    });
  }
};

const readPidRegistry = async () => {
  try {
    const raw = await fs.readFile(pidRegistryPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.pids)) {
      return parsed.pids.filter((pid) => Number.isInteger(pid));
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`[dev-stack] Failed to read ${pidRegistryPath}: ${error.message}`);
    }
  }
  return [];
};

const removePidRegistry = async () => {
  try {
    await fs.unlink(pidRegistryPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`[dev-stack] Failed to remove ${pidRegistryPath}: ${error.message}`);
    }
  }
};

const writePidRegistry = async (pids) => {
  try {
    if (!pids.length) {
      await removePidRegistry();
      return;
    }
    await fs.writeFile(pidRegistryPath, JSON.stringify({ pids }, null, 2), "utf8");
  } catch (error) {
    console.warn(`[dev-stack] Failed to write ${pidRegistryPath}: ${error.message}`);
  }
};

const getRunningChildPids = () =>
  runningChildren
    .map((child) => child?.pid)
    .filter((pid) => Number.isInteger(pid));

const persistRunningChildPids = async () => {
  await writePidRegistry(getRunningChildPids());
};

const isPidRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

const requestProcessStop = async (pid) => {
  if (!Number.isInteger(pid)) {
    return;
  }
  if (process.platform === "win32") {
    await runSilently("taskkill", ["/PID", pid.toString(), "/T"], {
      shell: shouldUseShell,
      ignoreErrors: true,
    });
    return;
  }
  try {
    process.kill(pid, "SIGINT");
  } catch (error) {
    if (error.code !== "ESRCH") {
      console.warn(`[dev-stack] Failed to send SIGINT to process ${pid}: ${error.message}`);
    }
  }
};

const forceKillProcess = async (pid) => {
  if (!Number.isInteger(pid)) {
    return;
  }
  if (process.platform === "win32") {
    await runSilently("taskkill", ["/PID", pid.toString(), "/T", "/F"], {
      shell: shouldUseShell,
      ignoreErrors: true,
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") {
      console.warn(`[dev-stack] Failed to SIGKILL process ${pid}: ${error.message}`);
    }
  }
};

const handleBrokenPipe = () => {
  if (isOutputBroken) {
    return;
  }
  isOutputBroken = true;
  if (!isShutdownRequested) {
    isShutdownRequested = true;
    void shutdown(runningChildren).finally(() => process.exit(0));
  }
};

const safeWrite = (stream, chunk) => {
  try {
    stream.write(chunk);
  } catch (error) {
    if (error?.code === "EPIPE") {
      handleBrokenPipe();
      return;
    }
    throw error;
  }
};

const stopPreviousStackProcesses = async () => {
  const stalePids = await readPidRegistry();
  if (!stalePids.length) {
    return;
  }
  console.warn(
    `[dev-stack] Found ${stalePids.length} previously-started service processes. Attempting to stop them...`,
  );
  await Promise.all(stalePids.map((pid) => requestProcessStop(pid)));
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const alive = stalePids.filter((pid) => isPidRunning(pid));
    if (!alive.length) {
      break;
    }
    await wait(250);
  }
  const stillAlive = stalePids.filter((pid) => isPidRunning(pid));
  if (stillAlive.length) {
    await Promise.all(stillAlive.map((pid) => forceKillProcess(pid)));
  }
  await removePidRegistry();
};

const startService = (service) => {
  const child = spawn(pnpmCommand, service.args, {
    cwd: repoRoot,
    env: { ...process.env, ...service.env },
    stdio: ["inherit", "pipe", "pipe"],
    shell: shouldUseShell,
  });
  const prefix = `[${service.name}]`;
  child.stdout.on("data", (data) => {
    safeWrite(process.stdout, `${prefix} ${data}`);
  });
  child.stderr.on("data", (data) => {
    safeWrite(process.stderr, `${prefix} ${data}`);
  });
  child.on("close", (code, signal) => {
    const expectedShutdown = isShutdownRequested || Boolean(signal);
    if (!expectedShutdown && code !== null && code !== 0) {
      console.log(`${prefix} exited with code ${code}`);
    }
    runningChildren = runningChildren.filter((running) => running !== child);
    void persistRunningChildPids();
  });
  return child;
};

const shutdown = async (children) => {
  await Promise.all(
    (children ?? [])
      .map((child) => child?.pid)
      .filter((pid) => Number.isInteger(pid))
      .map((pid) => requestProcessStop(pid)),
  );
  await writePidRegistry([]);
  await stopInfra();
};

const handleExitSignal = (signal) => {
  if (isShutdownRequested) {
    return;
  }
  isShutdownRequested = true;
  console.log(`\nReceived ${signal}. Shutting down...`);
  void shutdown(runningChildren).finally(() => process.exit(0));
};

process.on("SIGINT", () => handleExitSignal("SIGINT"));
process.on("SIGTERM", () => handleExitSignal("SIGTERM"));

async function main() {
  await ensureDocker();
  if (cleanOnly) {
    await stopPreviousStackProcesses();
    await stopInfra();
    console.log("[dev-stack] Cleaned up existing dev stack processes and containers.");
    return;
  }
  await stopPreviousStackProcesses();
  await resetInfra();
  await ensureWorkspaceDependencies();
  await ensureWorkspaceBuilds();
  await startInfra();

  console.log("[dev-stack] Running infrastructure migrations...");
  await runInfraMigrations();

  console.log("[dev-stack] Running service migrations and seeds...");
  await runServiceMigrations();

  console.log("[dev-stack] Migration steps complete. Launching services...");

  console.log("Starting application services...");
  const startedChildren = services.map((service) => startService(service));
  runningChildren = startedChildren;
  await persistRunningChildPids();
}

main().catch((error) => {
  console.error("[dev-stack] Failed to start stack", error);
  void shutdown(runningChildren).finally(() => process.exit(1));
});
