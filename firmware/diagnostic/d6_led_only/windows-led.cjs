// Run manually with a confirmed COM port, ONLY after fixture and upload approval.
// No upload, no automatic trial, no reconnection. Reuses installed serialport.
const { createRequire } = require('node:module');
const { resolve, join } = require('node:path');
const { mkdirSync, appendFileSync } = require('node:fs');
const { createInterface } = require('node:readline');
const { SerialPort } = createRequire(resolve(__dirname, '../../../desktop/package.json'))('serialport');
const path = process.argv[2];
if (!/^COM\d+$/i.test(path || '')) {
  console.log('用法：node firmware/diagnostic/d6_led_only/windows-led.cjs COM数字');
  console.log('仅在负载隔离、授权上传完成后启动；本次不会连接。');
  process.exit(0);
}
const folder = resolve(__dirname, '../../../docs/evidence/d6-led-sessions');
mkdirSync(folder, { recursive: true });
const logPath = join(folder, new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl');
function log(kind, text) {
  const entry = { utc: new Date().toISOString(), kind, text };
  appendFileSync(logPath, JSON.stringify(entry) + '\n');
  console.log(entry.utc + ' ' + kind + ' ' + text);
}
let freshAt = 0, buffer = '', discard = false, closing = false;
let candidate = null, applied = null;
const port = new SerialPort({ path: path.toUpperCase(), baudRate: 9600, autoOpen: false });
const input = createInterface({ input: process.stdin, output: process.stdout });
function send(text) {
  if (!port.isOpen || closing) throw Error('串口未就绪');
  log('TX', text);
  port.write(text + '\n', error => {
    if (error) { freshAt = 0; candidate = null; log('ERROR', error.message); }
  });
}
port.on('data', chunk => {
  for (const c of chunk.toString()) {
    if (c === '\n') {
      const text = buffer.trim(); buffer = '';
      if (discard) { discard = false; continue; }
      log('RX', text);
      const m = /^D6LED\/1 t=\d+ event=(\w+) attached=([01]) active_us=(\d+) applied=(\d+) pending=(\d+) requested_us=(\d+) physical_off=UNVERIFIED led=UNOBSERVED$/.exec(text);
      if (m) {
        freshAt = Date.now();
        candidate = Number(m[5]) ? { id: m[5], us: m[6] } : null;
        if (m[1] === 'APPLIED') applied = { id: m[4], us: m[3] };
        if (m[1] === 'READY_NO_SIGNAL') { candidate = null; applied = null; }
      }
    } else if (!discard && buffer.length < 320) buffer += c;
    else { discard = true; buffer = ''; freshAt = 0; candidate = null; }
  }
});
let heartbeat;
function close() {
  if (closing) return;
  if (port.isOpen) { try { send('STOP'); } catch (e) { log('ERROR', e.message); } }
  closing = true; clearInterval(heartbeat);
  if (port.isOpen) port.drain(() => port.close());
}
port.on('error', error => { freshAt = 0; candidate = null; log('ERROR', error.message); input.close(); });
port.on('close', () => { freshAt = 0; candidate = null; clearInterval(heartbeat); log('DISCONNECTED', '物理 OFF 未验证'); input.close(); });
port.open(error => {
  if (error) return; // error event logs it.
  if (closing) { port.close(); return; }
  log('CONNECTED', path.toUpperCase() + '；打开串口可能复位；不会自动输出');
  heartbeat = setInterval(() => { try { send('STATUS'); } catch (e) { log('ERROR', e.message); } }, 500);
});
console.log('只测试隔离负载后的 C93 LED。日志：' + logPath);
console.log('SHORT_PULSE / LONG_PULSE → 等待编号 → CONFIRM 编号（每次人工输入，5秒内）');
console.log('OBSERVE ON|OFF|UNKNOWN 备注：记录最近一次 APPLIED 的人工观察，不是电流反馈。');
console.log('STOP 移除信号，不保证物理 OFF；STATUS；QUIT。每次最多5秒，无自动循环。');
input.on('line', text => {
  const value = text.trim();
  try {
    if (/^OBSERVE (ON|OFF|UNKNOWN)(?: .*|)$/i.test(value)) {
      if (!applied) throw Error('尚无 APPLIED 记录，不能关联 LED 观察');
      log('HUMAN_OBSERVATION', JSON.stringify({ ...applied, observation: value, physicalOffVerified: false }));
    } else if (value.toUpperCase() === 'QUIT') input.close();
    else if (['SHORT_PULSE', 'LONG_PULSE', 'STOP', 'STATUS'].includes(value.toUpperCase()) || /^CONFIRM \d+$/.test(value.toUpperCase())) {
      const cmd = value.toUpperCase();
      if (!['STOP', 'STATUS'].includes(cmd) && Date.now() - freshAt > 1500) throw Error('D6LED/1 身份未确认或响应过期');
      if (cmd.startsWith('CONFIRM ') && (!candidate || cmd.slice(8) !== candidate.id)) throw Error('确认编号不匹配');
      send(cmd);
    } else throw Error('命令无效；不支持 START、自动确认或自动循环');
  } catch (e) { log('ERROR', e.message); }
});
input.on('close', close);
process.on('SIGINT', () => input.close());
