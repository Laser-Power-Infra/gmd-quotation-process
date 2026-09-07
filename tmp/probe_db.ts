import { prisma } from "../lib/prisma";
async function main(){
  const rows = await prisma.supplyHistoryItem.findMany({
    where: { partyOrderNo: { contains: 'BJ25Y-00004' } },
    select: { invoiceNo:true, itemName:true, partyOrderNo:true, orderList:true, syncedAt:true, date:true }
  });
  console.log('FOUND', rows.length);
  for(const r of rows){
    console.log(JSON.stringify(r));
    const s = r.partyOrderNo||'';
    console.log('  charCodes:', [...s].map(c=> c.charCodeAt(0)+'('+c+')').join(' '));
    console.log('  normalized:', s.trim().replace(/\s+/g,' ').toUpperCase());
    console.log('  orderList empty?', r.orderList===null || String(r.orderList).trim()==='');
  }
  const totalWithOrder = await prisma.supplyHistoryItem.count({ where: { orderList: { not: null } }});
  console.log('totalWithOrder not null:', totalWithOrder);
  // raw query alternative without $queryRawUnsafe escaping issues
  const raw = await prisma.$queryRaw`SELECT COUNT(*)::int as c FROM "SupplyHistoryItem" WHERE trim("orderList") != ''`;
  console.log('raw non-empty count:', raw);
  const sample = await prisma.supplyHistoryItem.findMany({ where: { orderList: { not: null }}, select:{ partyOrderNo:true, orderList:true }, take:5 });
  console.log('sample:', JSON.stringify(sample,null,2));
  const maxSynced = await prisma.supplyHistoryItem.aggregate({ _max: { syncedAt:true }});
  console.log('maxSyncedAt', maxSynced._max.syncedAt);
  const total = await prisma.supplyHistoryItem.count();
  console.log('total rows', total);
}
main().catch(e=>{ console.error(e); process.exit(1); }).finally(async()=>{ await prisma.$disconnect(); });
