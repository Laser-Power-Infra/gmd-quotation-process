import pg from 'pg';
const conn = process.env.DATABASE_URL || 'postgresql://postgres:postgres@192.168.1.190:5432/gmd-quotation';
const c = new pg.Client({ connectionString: conn });
await c.connect();
const r = await c.query('select "partyOrderNo", "orderList", "invoiceNo", "itemName" from "SupplyHistoryItem" where "partyOrderNo" ilike $1 limit 10', ['%BJ25Y-00004%']);
console.log('rows', r.rows.length);
console.log(JSON.stringify(r.rows,null,2));
for (const row of r.rows){
  const s = row.partyOrderNo||'';
  console.log('charCodes', [...s].map(ch=> ch.charCodeAt(0)+'('+JSON.stringify(ch)+')').join(' '));
  console.log('normalized', s.trim().replace(/\s+/g,' ').toUpperCase());
}
const r2 = await c.query('select count(*)::int as total, count("orderList")::int as with_orders, count(nullif(trim("orderList"),\'\'))::int as non_empty from "SupplyHistoryItem"');
console.log('counts', r2.rows);
const r3 = await c.query('select "partyOrderNo", "orderList" from "SupplyHistoryItem" where "orderList" is not null and trim("orderList") != \'\' limit 5');
console.log('samples with orderList', JSON.stringify(r3.rows,null,2));
const r4 = await c.query('select max("syncedAt") as max_synced from "SupplyHistoryItem"');
console.log('max synced', r4.rows);
await c.end();
