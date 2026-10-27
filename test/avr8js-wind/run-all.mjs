import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const output = resolve(process.env.AVR_RESULTS_ROOT || join(here, 'results-step3'));
mkdirSync(output, { recursive: true });
const startedAtUtc = new Date().toISOString();
writeFileSync(join(output, 'all-modes.json'), JSON.stringify({ result: 'INCOMPLETE', startedAtUtc }) + '\n');
const modes = [];
for (const mode of ['WIND', 'WAVE', 'BUBBLE']) {
  const run = spawnSync(process.execPath, [join(here, 'simulate.mjs'), mode], {
    stdio: 'inherit', env: { ...process.env, AVR_RESULTS_ROOT: output },
  });
  let result;
  try { result = JSON.parse(readFileSync(join(output, mode.toLowerCase(), 'results.json'))); }
  catch { result = { result: 'INCOMPLETE' }; }
  modes.push({ mode, exitCode: run.status, error: run.error?.message, result: result.result,
    checks: result.checks?.length, virtualSeconds: result.virtualSeconds,
    loopMs: result.measuredLoopMs, results: `${mode.toLowerCase()}/results.json` });
}
const baseline = JSON.parse(readFileSync(join(here, 'preservation-baseline.json'), 'utf8').replace(/^\uFEFF/, ''));
const preservation = baseline.map(entry => {
  let actual;
  try { actual = createHash('sha256').update(readFileSync(join(root, entry.path))).digest('hex'); }
  catch { actual = 'MISSING'; }
  return { ...entry, actualSha256: actual, result: actual === entry.sha256 ? 'PASS' : 'FAIL' };
});
const result = modes.every(m => m.result === 'PASS' && m.exitCode === 0) && preservation.every(p => p.result === 'PASS') ? 'PASS' : 'FAIL';
writeFileSync(join(output, 'all-modes.json'), JSON.stringify({ result, startedAtUtc, modes, preservation }, null, 2) + '\n');
console.log(JSON.stringify({ result, modes, preservedFiles: preservation.length }, null, 2));
process.exitCode = result === 'PASS' ? 0 : 1;
