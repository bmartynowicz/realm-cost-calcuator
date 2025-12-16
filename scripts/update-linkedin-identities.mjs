#!/usr/bin/env node

import { Pool } from "pg";

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=", 2);
    options[key] = value ?? "";
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const accessToken = options.access?.trim();
const refreshToken = options.refresh?.trim();
const references = options.refs?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];

if (!accessToken || !refreshToken || references.length === 0) {
  console.error(
    "Usage: node scripts/update-linkedin-identities.mjs --access=ACCESS_TOKEN --refresh=REFRESH_TOKEN --refs=urn1,urn2",
  );
  process.exit(1);
}

const connectionString =
  process.env.POSTGRES_URL ||
  process.env.AUTH_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.PGURL;

if (!connectionString) {
  console.error("Set POSTGRES_URL (or AUTH_DATABASE_URL) in the environment.");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  const result = await pool.query(
    `update auth_identities
        set access_token = $1,
            refresh_token = $2,
            revoked_at = null,
            updated_at = now()
      where provider = $3
        and provider_user_id = any($4)
      returning id, team_id, provider_user_id, token_reference`,
    [accessToken, refreshToken, "linkedin", references],
  );
  console.log(`Updated ${result.rowCount} LinkedIn identities.`);
  for (const row of result.rows) {
  console.log(
    `- ${row.provider_user_id} (team_id=${row.team_id ?? "unknown"}, token_reference=${row.token_reference})`,
  );
  }
} finally {
  await pool.end();
}
