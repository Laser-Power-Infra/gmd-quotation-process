import "dotenv/config";
import { syncPhysicalStockErpStock } from "@/schedular_function/physical-stock-erp-stock";

/**
 * One-off run of the hourly step: ITEM MASTER ERP `STOCK` -> PhysicalStock.stock_as_per_erp.
 *
 *   npm run physical:erp-stock          # dry run, counts only
 *   npm run physical:erp-stock:apply    # write
 */
const apply = process.argv.includes("--apply");

syncPhysicalStockErpStock({ dryRun: !apply })
  .then((r) => {
    console.log(`\n=== Physical Stock "stock as per erp" ${apply ? "(APPLY - writes)" : "(DRY RUN)"} ===`);
    console.log(`sheet codes with STOCK : ${r.sheetCodes}`);
    console.log(`stock rows scanned     : ${r.scanned}`);
    console.log(`rows ${apply ? "updated" : "to update"}        : ${r.updated}`);
    console.log(`rows not in the sheet  : ${r.unmatched} (left as they are)`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
