import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const rows = await prisma.enquiry.findMany({
    where: { selectedContractNo: { isEmpty: false } },
    select: { docketNumber: true, contractNo: true, selectedContractNo: true, orderStatus: true },
    orderBy: { docketNumber: "asc" },
  });
  console.log("count:", rows.length);
  for (const r of rows) {
    console.log(r.docketNumber, "| contractNo:", JSON.stringify(r.contractNo), "| selectedContractNo:", JSON.stringify(r.selectedContractNo), "| orderStatus:", r.orderStatus);
  }
}

main().finally(() => prisma.$disconnect());