const r=require('C:/Users/LASERA~1/AppData/Local/Temp/claude/D--gmd-quotation-process/75d91572-921d-439f-b025-4dc155b7eafb/scratchpad/all.json');
const ps=process.argv.slice(2);
const a=r.filter(x=>x.erpItemCode&&ps.some(p=>x.erpItemCode.startsWith(p))).sort((x,y)=>x.erpItemCode.localeCompare(y.erpItemCode));
for(const x of a)console.log([x.erpItemCode,x.l2ValveType,x.l3Dia,x.l4Component,x.l5Material,x.l6Std,x.l7Dimension,x.l8ItemCategory,x.currentStatus].join('|').replace('CARBON STEEL/CAST STEEL','CS').replace('METAL TO RUBBER','MR').replace('METAL TO METAL','MM'));
