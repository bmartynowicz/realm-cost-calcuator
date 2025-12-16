import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { parse } from "dotenv";

import { validateDeploymentEnv } from "../backend/services/shared/dist/runtimeEnvGuard.js";

const defaultEnvFilesByProfile = {
  prod: [
    "infra/k8s/apps/common/prod/core-config.env",
    "infra/k8s/apps/common/prod/core-secrets.env",
  ],
  staging: [
    "infra/k8s/apps/common/staging/core-config.env",
    "infra/k8s/apps/common/staging/core-secrets.env",
  ],
};

const PLACEHOLDER_RULES = [
  { name: "TODO placeholder", test: (value) => /(^|\b)TODO([_-]|\b)/i.test(value) },
  { name: "angle-bracket placeholder", test: (value) => /<[^>]+>/.test(value) },
];

const normalizeProfile = (value) => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "production") return "prod";
  return normalized || "prod";
};

const isRestrictedProfile = (profile) => {
  const normalized = normalizeProfile(profile);
  return normalized === "prod" || normalized === "staging";
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  let profile = "prod";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "--profile" || arg === "-p") && args[i + 1]) {
      profile = args[i + 1];
      i += 1;
    }
  }

  const profileKey = normalizeProfile(profile);
  const envFiles = [...(defaultEnvFilesByProfile[profileKey] ?? defaultEnvFilesByProfile.prod)];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "--profile" || arg === "-p") && args[i + 1]) {
      i += 1;
    } else if (arg === "--env" && args[i + 1]) {
      envFiles.push(args[i + 1]);
      i += 1;
    } else if (arg === "--reset-env-files") {
      envFiles.length = 0;
    }
  }

  return { envFiles, profile };
};

const loadEnvFilesWithMetadata = async (filePaths) => {
  const merged = {};
  const files = [];

  for (const filePath of filePaths) {
    const absolutePath = path.resolve(process.cwd(), filePath);
    try {
      const raw = await fs.readFile(absolutePath, "utf8");
      const parsed = parse(raw);
      Object.assign(merged, parsed);
      files.push({ filePath, absolutePath, raw, parsed });
    } catch (error) {
      console.error(`[env-validate] Failed to read ${absolutePath}`);
      throw error;
    }
  }

  return { merged, files };
};

const collectPlaceholderViolations = ({ files }) => {
  const violations = [];

  for (const file of files) {
    for (const [key, rawValue] of Object.entries(file.parsed)) {
      const value = typeof rawValue === "string" ? rawValue.trim() : "";
      if (value.length === 0) continue;

      const rule = PLACEHOLDER_RULES.find((entry) => entry.test(value));
      if (!rule) continue;

      violations.push(
        `${path.relative(process.cwd(), file.absolutePath)}: ${key} contains ${rule.name} (${rawValue})`,
      );
    }
  }

  return violations;
};

const main = async () => {
  const { envFiles, profile } = parseArgs();
  if (envFiles.length === 0) {
    console.error("[env-validate] No env files specified; pass --env to add at least one.");
    process.exit(1);
  }

  const restrictedProfile = isRestrictedProfile(profile);
  const normalizedProfile = normalizeProfile(profile);

  const { merged: fileEnv, files } = await loadEnvFilesWithMetadata(envFiles);

  if (restrictedProfile) {
    const violations = collectPlaceholderViolations({ files });
    if (violations.length > 0) {
      console.error(`[env-validate] ${violations.length} placeholder value(s) detected in env files:`);
      for (const entry of violations) {
        console.error(`- ${entry}`);
      }
      process.exit(1);
    }
  }

  if (normalizedProfile === "prod") {
    const requiredFromFiles = validateDeploymentEnv({
      env: {
        PROFILE: profile,
        NODE_ENV: "production",
        ...fileEnv,
      },
      profileName: profile,
      serviceName: `ci-${profile}`,
      checks: [
        "bypass-flags",
        "auth-base",
        "gateway-origin",
        "linkedin-credentials",
        "growth-connections",
        "analytics-connections",
      ],
    });

    if (requiredFromFiles.errors.length > 0) {
      console.error(
        `[env-validate] ${requiredFromFiles.errors.length} error(s) detected in env files for PROFILE=${requiredFromFiles.profile.name}:`,
      );
      for (const entry of requiredFromFiles.errors) {
        console.error(`- ${entry}`);
      }
      console.error(
        `[env-validate] Checked files: ${envFiles
          .map((file) => path.relative(process.cwd(), path.resolve(process.cwd(), file)))
          .join(", ")}`,
      );
      process.exit(1);
    }
  }

  const mergedEnv = {
    PROFILE: profile,
    NODE_ENV: "production",
    ...fileEnv,
    ...process.env,
  };

  const result = validateDeploymentEnv({
    env: mergedEnv,
    profileName: profile,
    serviceName: `ci-${profile}`,
    checks: [
      "bypass-flags",
      "auth-base",
      "gateway-origin",
      "linkedin-credentials",
      "growth-connections",
      "analytics-connections",
    ],
  });

  if (result.errors.length > 0) {
    console.error(`[env-validate] ${result.errors.length} error(s) detected for PROFILE=${result.profile.name}:`);
    for (const entry of result.errors) {
      console.error(`- ${entry}`);
    }
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    console.warn(`[env-validate] ${result.warnings.length} warning(s):`);
    for (const entry of result.warnings) {
      console.warn(`- ${entry}`);
    }
  }

  console.log(
    `[env-validate] PROFILE=${result.profile.name} passed for files: ${envFiles
      .map((file) => path.relative(process.cwd(), path.resolve(process.cwd(), file)))
      .join(", ")}`,
  );
};

main().catch((error) => {
  console.error("[env-validate] Unexpected failure", error);
  process.exit(1);
});
