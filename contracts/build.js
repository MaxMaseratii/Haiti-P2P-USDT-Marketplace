// Compile with solcjs (no compiler download needed). Output: build/contracts.json
import solc from 'solc';
import fs from 'node:fs';
const sources = {};
for (const f of fs.readdirSync('src')) if (f.endsWith('.sol')) sources[f] = { content: fs.readFileSync('src/' + f, 'utf8') };
const out = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources,
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
})));
const errs = (out.errors || []).filter((e) => e.severity === 'error');
for (const e of out.errors || []) console.error(e.formattedMessage);
if (errs.length) process.exit(1);
const res = {};
for (const [file, cs] of Object.entries(out.contracts))
  for (const [name, c] of Object.entries(cs)) res[name] = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/contracts.json', JSON.stringify(res));
console.log('compiled:', Object.keys(res).join(', '));
