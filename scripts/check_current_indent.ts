import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const count = await prisma.indentListing.count();
  console.log(`Total IndentListing rows: ${count}`);
  const sample = await prisma.indentListing.findMany({ take: 10 });
  console.log("Sample rows in IndentListing:");
  console.log(sample);
}

main().catch(console.error).finally(() => prisma.$disconnect());
