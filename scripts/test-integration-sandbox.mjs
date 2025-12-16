#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactsRoot = path.join(repoRoot, "debug", "integration-sandbox");
const runArtifactsDir = path.join(artifactsRoot, timestamp);
await mkdir(runArtifactsDir, { recursive: true });

const envFiles = [".env.sandbox", ".env"].map((file) => path.join(repoRoot, file));
for (const envFile of envFiles) {
  const result = dotenv.config({ path: envFile, override: false });
  if (result.error) {
    if (result.error.code !== "ENOENT") {
      console.warn(`[sandbox] Failed to load ${path.basename(envFile)}: ${result.error.message}`);
    }
  } else if (result.parsed) {
    console.log(`[sandbox] Loaded ${path.basename(envFile)}`);
  }
}

const sensitiveEnvKeys = [
  "LINKEDIN_ACCESS_TOKEN",
  "LINKEDIN_REFRESH_TOKEN",
  "LINKEDIN_COMMUNITY_ACCESS_TOKEN",
  "HUBSPOT_ACCESS_TOKEN",
  "SALESFORCE_ACCESS_TOKEN",
  "RESEND_API_KEY",
  "CALCOM_API_KEY",
  "OBJECT_STORAGE_ACCESS_KEY",
  "OBJECT_STORAGE_SECRET_KEY",
  "MODEL_ROUTER_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "MODEL_ROUTER_ANTHROPIC_API_KEY",
  "ANTHROPIC_API_KEY",
  "MODEL_ROUTER_GOOGLE_API_KEY",
  "GOOGLE_VERTEX_API_KEY",
];
const secretEntries = sensitiveEnvKeys
  .map((key) => [key, process.env[key]])
  .filter(([, value]) => typeof value === "string" && value.length > 0);

const maskValue = (value) => {
  if (!value) {
    return "";
  }
  if (value.length <= 6) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const maskText = (text) =>
  secretEntries.reduce(
    (masked, [, value]) =>
      value ? masked.replace(new RegExp(escapeRegex(value), "g"), maskValue(value)) : masked,
    text,
  );

const envSummaryPath = path.join(runArtifactsDir, "sandbox-env.txt");
if (secretEntries.length > 0) {
  const summary = secretEntries.map(([key, value]) => `${key}=${maskValue(value)}`).join("\n");
  await writeFile(envSummaryPath, summary + "\n", "utf8");
  console.log(`[sandbox] Wrote masked sandbox environment summary to ${path.relative(repoRoot, envSummaryPath)}`);
} else {
  await writeFile(envSummaryPath, "No sandbox provider secrets detected.\n", "utf8");
  console.warn("[sandbox] No sandbox provider secrets detected; tests may fall back to mocks.");
}

const logPath = path.join(runArtifactsDir, "vitest.log");
const junitPath = path.join(runArtifactsDir, "vitest-junit.xml");
const logStream = fs.createWriteStream(logPath, { flags: "a" });

const runIntegrationTests = () =>
  new Promise((resolve, reject) => {
    const child = spawn(
      pnpmCommand,
      ["--filter", "@latitude/integration-tests", "test", "--", "--reporter=junit", "--outputFile", junitPath],
      {
        cwd: repoRoot,
        env: { ...process.env, NODE_ENV: "test" },
        shell: process.platform === "win32",
        stdio: ["inherit", "pipe", "pipe"],
      },
    );

    const forwardOutput = (data, destination) => {
      const masked = maskText(data.toString());
      destination.write(masked);
      logStream.write(masked);
    };

    child.stdout?.on("data", (chunk) => forwardOutput(chunk, process.stdout));
    child.stderr?.on("data", (chunk) => forwardOutput(chunk, process.stderr));

    child.on("error", (error) => {
      logStream.end();
      reject(error);
    });

    child.on("exit", (code) => {
      logStream.end();
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Integration tests exited with code ${code ?? "unknown"}`));
      }
    });
  });

try {
  await runIntegrationTests();
  console.log(`[sandbox] Integration tests passed. Artifacts stored in ${path.relative(repoRoot, runArtifactsDir)}.`);
} catch (error) {
  console.error(`[sandbox] Integration tests failed: ${error.message}`);
  console.error(`[sandbox] Review ${path.relative(repoRoot, logPath)} and ${path.relative(repoRoot, junitPath)} for details.`);
  process.exitCode = 1;
}
