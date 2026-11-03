// One expressly user-authorized SHORT_PULSE trial. Never uploads or sends LONG_PULSE.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolve, join } = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
if (process.argv[2] !== '--authorized-short-once') throw Error('Explicit per-trial human approval required.');
const root = resolve(__dirname, '../..');
const upload = JSON.parse(fs.readFileSync(join(root, 'docs/evidence/d6-led-upload-boyQHR/upload.json'), 'utf8'));
assert.equal(upload.result, 'PASS');
const hash = createHash('sha256').update(fs.readFileSync(join(root, 'firmware/diagnostic/d6_led_only/d6_led_only.ino'))).digest('hex');
assert.equal(hash, upload.sourceSha256);
const { SerialPort } = createRequire(join(root, 'desktop/package.json'))('serialport');
async function main() {
  const devices = await SerialPort.list();
  assert.ok(devices.some(p => p.path === 'COM5' && p.serialNumber === upload.device.serialNumber && p.vendorId === upload.device.vendorId && p.productId === upload.device.productId));
  const out = fs.mkdtempSync(join(root, 'docs/evidence/d6-led-short-'));
  const events = [];
  const record = { result: 'INCOMPLETE', authorization: 'User explicitly approved one 1200us SHORT_PULSE test in chat; all five fixture conditions previously confirmed.',
    utc: new Date().toISOString(), port: 'COM5', requestedUs: 1200, maximumMs: 5000,
    firmwareSourceSha256: hash, events, physicalObservations: [], ledState: 'AWAIT_USER_REPORT',
    repeatability: 'NOT_TESTED', physicalOffVerified: false };
  function log(kind, text) {
    const entry = { utc: new Date().toISOString(), kind, text };
    events.push(entry); fs.appendFileSync(join(out, 'serial.jsonl'), JSON.stringify(entry) + '\n');
    if (kind !== 'TX' || text !== 'STATUS') console.log(kind + ' ' + text);
  }
  function save() { fs.writeFileSync(join(out, 'trial.json'), JSON.stringify(record, null, 2)); }
  save();
  const port = new SerialPort({ path: 'COM5', baudRate: 9600, autoOpen: false });
  let phase = 'IDENTITY', buffer = '', discard = false, finishing = false, heartbeat, deadline;
  let selected = false, confirmed = false, applied = false;
  function send(text) {
    if (!port.isOpen || finishing) return;
    assert.ok(text === 'STATUS' || text === 'STOP' || text === 'SHORT_PULSE' || /^CONFIRM \d+$/.test(text));
    log('TX', text);
    port.write(text + '\n', error => { if (error) finish(false, error.message); });
  }
  function finish(success, reason) {
    if (finishing) return;
    // On an error, request removal once if application identity was established.
    if (!success && phase !== 'IDENTITY' && port.isOpen) send('STOP');
    finishing = true; clearInterval(heartbeat); clearTimeout(deadline);
    record.result = success ? 'SOFTWARE_SEQUENCE_COMPLETE_AWAIT_OBSERVATION' : 'ERROR';
    record.finishedUtc = new Date().toISOString(); record.reason = reason;
    record.selected = selected; record.confirmed = confirmed; record.applied = applied;
    save();
    const done = () => { console.log('Evidence: ' + out); if (!success) process.exitCode = 1; };
    if (port.isOpen) port.drain(() => port.close(done)); else done();
  }
  port.on('data', chunk => {
    for (const c of chunk.toString()) {
      if (c !== '\n') {
        if (buffer.length < 320 && !discard) buffer += c;
        else { discard = true; buffer = ''; }
        continue;
      }
      const text = buffer.trim(); buffer = '';
      if (discard) { discard = false; finish(false, 'Overlong serial frame'); continue; }
      log('RX', text);
      if (finishing) continue;
      const m = /^D6LED\/1 t=\d+ event=(\w+) attached=([01]) active_us=(\d+) applied=(\d+) pending=(\d+) requested_us=(\d+) physical_off=UNVERIFIED led=UNOBSERVED$/.exec(text);
      if (!m) continue;
      const [, event, attached, activeUs, id, pending, requested] = m;
      if (phase === 'IDENTITY') {
        if (event !== 'STATUS' && event !== 'READY_NO_SIGNAL') continue;
        if (attached !== '0' || pending !== '0') { finish(false, 'Unexpected initial output or pending command'); continue; }
        phase = 'SELECTED'; selected = true;
        send('SHORT_PULSE');
      } else if (phase === 'SELECTED' && event === 'AWAIT_CONFIRM') {
        if (requested !== '1200' || attached !== '0' || pending === '0') { finish(false, 'Unexpected prepared pulse'); continue; }
        phase = 'CONFIRMED'; confirmed = true; record.ticket = pending;
        // Human approval for THIS SINGLE trial was obtained before this process.
        send('CONFIRM ' + pending);
      } else if (phase === 'CONFIRMED' && event === 'APPLIED') {
        if (activeUs !== '1200' || attached !== '1' || id !== record.ticket) { finish(false, 'Unexpected applied pulse'); continue; }
        phase = 'ACTIVE'; applied = true; record.appliedResponse = text; save();
      } else if (phase === 'ACTIVE' && event === 'MAX_TEST_SIGNAL_REMOVED') {
        if (attached !== '0' || activeUs !== '0') { finish(false, 'Signal-removal status inconsistent'); continue; }
        record.removedResponse = text;
        finish(true, 'Exactly one requested pulse train; firmware 5s limit removed signal. LED/current require user observation.');
      } else if (/ERROR|REJECT|EXPIRED|FAILED|HOST_TIMEOUT|STOP_SIGNAL/.test(event)) finish(false, text);
    }
  });
  port.on('error', error => finish(false, error.message));
  port.on('close', () => { if (!finishing) finish(false, 'Unexpected serial disconnect'); });
  deadline = setTimeout(() => finish(false, 'Overall 15s deadline'), 15000);
  port.open(error => {
    if (error) { finish(false, error.message); return; }
    if (finishing) { port.close(); return; }
    log('CONNECTED', 'COM5; opening may reset Nano; no automatic output before identity and approved command.');
    heartbeat = setInterval(() => send('STATUS'), 500);
  });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
