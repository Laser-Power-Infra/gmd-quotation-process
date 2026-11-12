import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export * from "./generated/client";

const globalForPrisma = globalThis as unknown as { stockPrisma?: PrismaClient };

const TAG = "[db-stock]";
const log = (msg: string, err?: Error & { code?: string }) =>
  console.error(`${new Date().toISOString()} ${TAG} ${msg}${err ? `: ${err.code ?? ""} ${err.message}` : ""}`);

/** host/dbname only, never credentials. */
function target(url: string | undefined) {
  try {
    const u = new URL(url ?? "");
    return `${u.host}${u.pathname}`;
  } catch {
    return "(STOCK_DATABASE_URL unset or invalid)";
  }
}

function create() {
  const url = process.env.STOCK_DATABASE_URL;
  // Postgres' own reason for dropping a connection (restart, idle/admin termination, network reset) only surfaces in these hooks.
  const adapter = new PrismaPg({ connectionString: url, connectionTimeoutMillis: 10_000 }, {
    onPoolError: (err) => log("idle pool connection dropped", err),
    onConnectionError: (err) => log("connection dropped during a transaction", err),
  });
  console.info(`${new Date().toISOString()} ${TAG} pool created for ${target(url)} (pid ${process.pid})`);
  return new PrismaClient({ adapter });
}

export const stockPrisma = globalForPrisma.stockPrisma ?? create();
if (process.env.NODE_ENV !== "production") globalForPrisma.stockPrisma = stockPrisma;
