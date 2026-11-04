// Copies compiled contracts into public/contracts.json for the site's owner-setup page.
import { readFileSync, writeFileSync } from 'node:fs';
const out = {};
for (const name of ['DawnMarket', 'Sunflower', 'SeedSwap']) {
  const a = JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`, 'utf8'));
  out[name] = { abi: a.abi, bytecode: a.bytecode.object };
}
writeFileSync('public/contracts.json', JSON.stringify(out));
console.log(Object.entries(out).map(([k, v]) => `${k}: ${v.bytecode.length / 2 - 1} bytes`).join(', '));
