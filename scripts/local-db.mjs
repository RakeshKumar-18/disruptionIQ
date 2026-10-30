// Runs a real Postgres server on this machine for development (no Docker or install needed).
// Usage: npm run db:local   (leave it running; Ctrl+C stops it). Data is kept in .localdb/
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // no .env yet: use the defaults below
}
const port = Number(process.env.LOCAL_DB_PORT || 54329);
const dir = fileURLToPath(new URL("../.localdb", import.meta.url));
// Create whichever database DATABASE_URL names (defaults to "disruptioniq").
const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL).pathname.slice(1) || "disruptioniq";
  } catch {
    return "disruptioniq";
  }
})();

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
});

if (!existsSync(join(dir, "PG_VERSION"))) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase(dbName);
} catch {
  // database already exists
}

console.log(`Local Postgres is running on port ${port}.`);
console.log(`DATABASE_URL="postgresql://postgres:postgres@localhost:${port}/${dbName}"`);
console.log("Leave this window open. Press Ctrl+C to stop.");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
