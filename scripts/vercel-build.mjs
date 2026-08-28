import { execSync } from "node:child_process";

function firstPostgresUrl() {
  const candidates = [
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DATABASE_URL_UNPOOLED,
    process.env.DIRECT_URL,
    process.env.POSTGRES_URL,
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
  ];
  for (const value of candidates) {
    if (!value) continue;
    if (value.startsWith("postgres://") || value.startsWith("postgresql://")) {
      return value;
    }
  }
  return "";
}

function run(command) {
  console.log(`\n$ ${command}\n`);
  try {
    execSync(command, { stdio: "inherit", env: process.env });
  } catch (error) {
    const err = error;
    if (err.stdout) console.error(String(err.stdout));
    if (err.stderr) console.error(String(err.stderr));
    throw error;
  }
}

const dummy = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const resolved = firstPostgresUrl();
const hasRealDb =
  Boolean(resolved) &&
  !resolved.includes("127.0.0.1") &&
  !resolved.includes("localhost") &&
  !resolved.includes("USER:PASSWORD");

process.env.DATABASE_URL = hasRealDb ? resolved : dummy;

run("npx prisma generate");

if (hasRealDb) {
  try {
    run("npx prisma db push --skip-generate --accept-data-loss");
  } catch {
    console.error(
      "Prisma could not update the database. The Next.js build will still continue. Check Neon/Postgres in Vercel Storage.",
    );
  }
} else {
  console.warn("No Postgres URL found. Skipping database sync. Add Neon in Vercel Storage, then Redeploy.");
}

run("npx next build");
