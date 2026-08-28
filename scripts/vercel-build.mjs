import { execSync } from "node:child_process";

function resolveDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    ""
  );
}

const dummy = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const resolved = resolveDatabaseUrl();
const hasRealDb =
  resolved.startsWith("postgres") &&
  !resolved.includes("127.0.0.1") &&
  !resolved.includes("localhost") &&
  !resolved.includes("USER:PASSWORD");

process.env.DATABASE_URL = hasRealDb ? resolved : resolved || dummy;

execSync("npx prisma generate", { stdio: "inherit", env: process.env });

if (hasRealDb) {
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
} else {
  console.warn(
    "No production Postgres URL found (DATABASE_URL / POSTGRES_URL). Skipping migrate. Add Neon in Vercel Storage, then Redeploy.",
  );
}

execSync("npx next build", { stdio: "inherit", env: process.env });
