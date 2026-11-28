// Backfills Contract Review poNo / dateOfContract from the SALE CONTRACT tab
// (PARTYREFNO / PARTYREFDATE), blank fields only. Dry run unless --apply.
import "dotenv/config";
import { runSaleContractFill } from "../lib/contractReviewSaleContract";

const apply = process.argv.includes("--apply");

runSaleContractFill({ apply }).then(
  (r) => {
    console.log(apply ? `Applied: ${r.matched} rows, ${r.updated} field writes.` : `Dry run: ${r.matched} rows would be filled. Re-run with --apply to write.`);
    process.exit(0);
  },
  (e) => {
    console.error("Backfill failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
