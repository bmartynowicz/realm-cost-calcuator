import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(".env") });

const MIGRATIONS_TABLE = "schema_history";
const ADVISORY_LOCK_KEY = 8342719;

async function main() {
  const connectionString = process.argv[2] ?? process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("Provide a Postgres connection string via argument or POSTGRES_URL.");
  }

  const migrationsDir = path.resolve(process.cwd(), "infra/db/migrations");
  const migrationFiles = await loadMigrationFiles(migrationsDir);
  if (migrationFiles.length === 0) {
    console.log("No migration files found.");
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();
  let lockAcquired = false;

  try {
    await ensureHistoryTable(client);
    lockAcquired = await acquireLock(client);
    if (!lockAcquired) {
      throw new Error("Could not acquire migration lock; another migration may be running.");
    }

    const appliedMigrations = await fetchAppliedMigrations(client);

    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = await readFile(filePath, "utf8");
      const checksum = hashMigration(sql);

      const applied = appliedMigrations.get(file);
      if (applied) {
        if (applied.checksum !== checksum) {
          throw new Error(
            `Checksum mismatch for ${file}. The file has changed since it was applied at ${applied.applied_at}.`,
          );
        }

        console.log(`Skipping already applied migration ${file}`);
        continue;
      }

      console.log(`Applying migration ${file}`);
      await applyMigration(client, file, sql, checksum);
    }

    console.log("Migrations complete.");
  } finally {
    if (lockAcquired) {
      await releaseLock(client);
    }

    await client.end();
  }
}

async function loadMigrationFiles(migrationsDir) {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

async function ensureHistoryTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function acquireLock(client) {
  const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [ADVISORY_LOCK_KEY]);
  return result.rows[0]?.locked === true;
}

async function releaseLock(client) {
  await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
}

async function fetchAppliedMigrations(client) {
  const result = await client.query(`SELECT filename, checksum, applied_at FROM ${MIGRATIONS_TABLE}`);
  return new Map(result.rows.map((row) => [row.filename, row]));
}

async function applyMigration(client, filename, sql, checksum) {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (filename, checksum) VALUES ($1, $2)`, [filename, checksum]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function hashMigration(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

main().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});
