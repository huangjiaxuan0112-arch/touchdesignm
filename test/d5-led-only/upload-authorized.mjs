// Explicit one-shot upload ONLY. No application serial commands or pulse tests.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv[2] !== '--authorized-upload') throw Error('Requires explicit fixture confirmation and user upload authorization.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = join(root, 'docs/evidence/d5-led-only-y9EySZ');
const reviewed = JSON.parse(readFileSync(join(evidence, 'results.json'), 'utf8'));
assert.equal(reviewed.result, 'PASS');
const digest = value => createHash('sha256').update(value).digest('hex');
assert.equal(digest(readFileSync(join(root, 'firmware/diagnostic/d5_led_only/d5_led_only.ino'))), reviewed.sourceSha256);
for (const [path, expected] of Object.entries(reviewed.before)) assert.equal(digest(readFileSync(join(root, path))), expected, path);
const hex = readFileSync(join(reviewed.build, 'd5_led_only.ino.hex'));
assert.deepEqual(hex, readFileSync(join(evidence, 'diagnostic.hex.txt')));
const require = createRequire(join(root, 'desktop/package.json'));
const { SerialPort } = require('serialport');
const ports = await SerialPort.list();
const matches = ports.filter(p => p.path === 'COM5' && p.vendorId?.toUpperCase() === '1A86' &&
  p.productId?.toUpperCase() === '7523' && p.serialNumber === '5&26B53364&0&9');
assert.equal(matches.length, 1, 'Previously identified Nano must be present exactly once.');
const out = mkdtempSync(join(root, 'docs/evidence/d5-led-upload-'));
const input = join(out, 'd5_led_only.ino.hex');
writeFileSync(input, hex);
const args = ['--config-file', reviewed.config, 'upload', '--fqbn', reviewed.fqbn,
  '--port', matches[0].path, '--input-file', input, '--verify', '--verbose'];
const record = { result: 'INCOMPLETE', startedUtc: new Date().toISOString(),
  authorization: 'User confirmed all five isolation/readiness conditions and explicitly authorized D5 LED-only diagnostic upload in this chat. No pulse-test authorization.',
  sourceSha256: reviewed.sourceSha256, hexSha256: digest(hex), device: matches[0],
  command: { executable: reviewed.cli, args }, physicalControlCommands: [], physicalObservations: [],
  ledA: 'NOT_TESTED', ledB: 'NOT_TESTED', repeatability: 'NOT_TESTED' };
writeFileSync(join(out, 'upload.json'), JSON.stringify(record, null, 2));
const run = spawnSync(reviewed.cli, args, { encoding: 'utf8', timeout: 90000 });
const log = (run.stdout || '') + (run.stderr || '');
writeFileSync(join(out, 'upload.log'), log);
record.finishedUtc = new Date().toISOString(); record.exitCode = run.status;
record.verified = /5316 bytes of flash verified/i.test(log);
record.error = run.error?.message;
record.result = run.status === 0 && record.verified ? 'PASS' : 'FAIL';
writeFileSync(join(out, 'upload.json'), JSON.stringify(record, null, 2));
console.log(log); console.log('Evidence: ' + out);
if (record.result !== 'PASS') process.exitCode = 1;
