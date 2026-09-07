import { buildGmdClientwiseOrderLinkMap, normalizePo, matchOrderLink, mergeOrderListCsv, splitCsvLinks } from '../lib/gmd_lib/contract-order-links.ts';

async function main(){
  const map = await buildGmdClientwiseOrderLinkMap();
  console.log('map size', map.size);
  // check BJ
  const key = normalizePo('BJ25Y-00004');
  console.log('key', key);
  console.log('has BJ?', map.has(key));
  console.log('exact', map.get(key));
  if(map.get(key)){
    console.log('split', splitCsvLinks(map.get(key)).length, splitCsvLinks(map.get(key)));
  }
  console.log('matchOrderLink test', matchOrderLink('BJ25Y-00004', map));
  console.log('match with spaces', matchOrderLink(' BJ25Y-00004 ', map));
  console.log('match lower', matchOrderLink('bj25y-00004', map));
  console.log('match with DT', matchOrderLink('BJ25Y-00004 DT 09.01.25', map));
  // also test merge
  console.log('merge null + map', mergeOrderListCsv(null, map.get(key)));
  console.log('merge existing empty + map length', mergeOrderListCsv('', map.get(key))?.split(',').length);
  console.log('merge existing one + map', mergeOrderListCsv('https://drive.google.com/open?id=1ADOAxEqv-MuV5kEu52HgwhzQSoh25Gez', map.get(key)));

  // also list first 5 entries
  let i=0;
  for(const [k,v] of map){
    if(i++<5) console.log(k, '->', v.slice(0,120));
  }
  // list all BJ related keys
  for(const [k,v] of map){
    if(k.includes('BJ25Y')) console.log('BJ key', k, v);
  }
}
main().catch(e=>{ console.error(e); if(e.response) console.error(JSON.stringify(e.response.data,null,2)); process.exit(1); });
