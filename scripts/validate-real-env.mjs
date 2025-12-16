import path from "node:path";
import process from "node:process";

import { config as loadEnv } from "dotenv";

import { assertRealEnvironment } from "../backend/services/shared/dist/realEnvValidation.js";

const profilePath = path.resolve(process.cwd(), ".env.real.example");

const { parsed } = loadEnv({ path: profilePath });
const env = { ...parsed, ...process.env, NODE_ENV: "production" };

assertRealEnvironment({ serviceName: "real-env-profile", env, profilePath });

console.log("Validated .env.real.example for production readiness.");
