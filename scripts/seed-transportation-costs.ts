import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const mapping = [
  { state: "FOR (Site In West Bengal)", fullLoad: "2.00%", partLoad: "4.00%" },
  { state: "FOR (Site In Maharashtra)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Madhya Pradesh)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Karnataka)", fullLoad: "4.00%", partLoad: "6.00%" },
  { state: "FOR (Site In Gujarat)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Tamil Nadu)", fullLoad: "10.00%", partLoad: "10.00%" },
  { state: "FOR (Site In Chattisgarh)", fullLoad: "3.00%", partLoad: "6.00%" },
  { state: "FOR (Site In Odisha)", fullLoad: "2.50%", partLoad: "4.00%" },
  { state: "FOR (Site In Jharkhand)", fullLoad: "2.00%", partLoad: "4.00%" },
  { state: "FOR (Site In Telangana)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Uttar Pradesh)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Rajasthan)", fullLoad: "4.00%", partLoad: "6.00%" },
  { state: "FOR (Site In Andhra Pradesh)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "OTHER COUNTRY", fullLoad: "0.00%", partLoad: "0.00%" },
  { state: "Ex-Works - Kharagpur", fullLoad: "0.50%", partLoad: "0.50%" },
  { state: "FOR (Site In Haryana)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Bihar)", fullLoad: "2.00%", partLoad: "5.00%" },
  { state: "FOR (Site In Kerala)", fullLoad: "6.00%", partLoad: "9.00%" },
  { state: "FOR (Site In Delhi)", fullLoad: "4.00%", partLoad: "6.00%" },
  { state: "FOR (Site In Himachal Pradesh)", fullLoad: "7.00%", partLoad: "10.00%" },
  { state: "FOR (Site In Meghalaya)", fullLoad: "10.00%", partLoad: "13.00%" },
  { state: "FOR (Site In Assam)", fullLoad: "10.00%", partLoad: "13.00%" },
  { state: "FOR (Site In Punjab)", fullLoad: "4.00%", partLoad: "7.00%" },
  { state: "FOR (Site In Goa)", fullLoad: "5.00%", partLoad: "8.00%" },
  { state: "FOR (Site)", fullLoad: "10.00%", partLoad: "15.00%" },
  { state: "FOR (Site In Pondicherry)", fullLoad: "15.00%", partLoad: "15.00%" },
  { state: "FOR (Site In Uttrakhand)", fullLoad: "10.00%", partLoad: "10.00%" },
  { state: "FOR (Site In Andaman)", fullLoad: "25.00%", partLoad: "25.00%" },
  { state: "FOR (Site In J&K)", fullLoad: "25.00%", partLoad: "25.00%" },
];

async function main() {
  console.log("Seeding Transportation Costs mapping (String keys and values)...");
  
  for (const entry of mapping) {
    const normalizedState = entry.state.trim();
    await prisma.transportationCost.upsert({
      where: { state: normalizedState },
      update: { fullLoad: entry.fullLoad, partLoad: entry.partLoad },
      create: { state: normalizedState, fullLoad: entry.fullLoad, partLoad: entry.partLoad },
    });
    console.log(`Upserted: State = "${normalizedState}" -> Full = ${entry.fullLoad}, Part = ${entry.partLoad}`);
  }

  console.log("Seeding complete!");
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
