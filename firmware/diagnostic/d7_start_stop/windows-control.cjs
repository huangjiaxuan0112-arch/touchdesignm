// Explicit terminal interface. Importing this file never opens a serial port.
const { EventEmitter } = require('node:events');
class D7Control extends EventEmitter {
  constructor(write, now = Date.now) {
    super(); this.write = write; this.now = now; this.reset();
  }
  reset() { this.verifiedAt = null; this.state = 'UNKNOWN'; this.buffer = ''; }
  receive(chunk) {
    for (const c of String(chunk)) {
      if (c === '\n') {
        const text = this.buffer.trim(); this.buffer = '';
        this.emit('log', 'RX ' + text);
        const m = /^D7DIAG\/1 t=\d+ event=\w+ state=(STOPPED|SIM_RUNNING|TIMEOUT_LOCKED) elapsed=\d+ output=DISABLED off=UNVERIFIED$/.exec(text);
        if (m) { this.verifiedAt = this.now(); this.state = m[1]; }
      } else if (this.buffer.length < 256) this.buffer += c;
      else { this.reset(); this.emit('log', 'RX 行过长，身份确认已清除'); }
    }
  }
  command(command) {
    if (!['START', 'STOP', 'STATUS', 'PING'].includes(command)) throw Error('无效命令');
    if (command === 'START' && (this.verifiedAt === null || this.now() - this.verifiedAt > 2500))
      throw Error('诊断固件身份未确认或响应过期，禁止 START');
    this.emit('log', 'TX ' + command); this.write(command + '\n');
  }
}
module.exports = { D7Control };

if (require.main === module) {
  const { createRequire } = require('node:module');
  const { resolve } = require('node:path');
  // Reuse the installed desktop serialport dependency; no installation needed.
  const { SerialPort } = createRequire(resolve(__dirname, '../../../desktop/package.json'))('serialport');
  const readline = require('node:readline');
  let port = null, timer = null, closing = false;
  const log = text => console.log(new Date().toISOString() + ' ' + text);
  const control = new D7Control(text => {
    if (!port?.isOpen) throw Error('串口未连接');
    port.write(text, error => { if (error) { control.reset(); log('发送失败：' + error.message); } });
  });
  control.on('log', log);
  const clear = () => { clearInterval(timer); timer = null; control.reset(); };
  const disconnect = () => {
    clear();
    if (port?.isOpen) {
      try { control.command('STOP'); } catch (e) { log(e.message); }
      port.drain(() => port?.close());
    }
  };
  console.log('D7 输出禁用诊断；逻辑 STOP ≠ 已确认物理 OFF。不会自动连接或上传。');
  console.log('命令：connect COM数字 / START / STOP / status / disconnect / quit');
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  input.on('line', text => {
    const value = text.trim();
    try {
      if (/^connect COM\d+$/i.test(value)) {
        if (port) throw Error('请先断开当前连接');
        port = new SerialPort({ path: value.split(/\s+/)[1].toUpperCase(), baudRate: 9600, autoOpen: false });
        port.on('data', chunk => control.receive(chunk));
        port.on('error', error => { clear(); log('串口错误：' + error.message); });
        port.on('close', () => { clear(); port = null; log('连接：已断开，物理 OFF 未确认'); });
        port.open(error => {
          if (error) { port = null; clear(); log('连接失败：' + error.message); return; }
          log('连接：串口已打开，等待 D7DIAG/1 身份；开串口可能复位 Nano');
          // Query only. Never send START on connection, READY or reconnection.
          timer = setInterval(() => {
            try { control.command('STATUS'); } catch (e) { log(e.message); }
          }, 1000);
        });
      } else if (value.toLowerCase() === 'status') {
        log(`连接=${port?.isOpen ? '已打开' : '未连接'} 逻辑状态=${control.state} 输出=禁用 物理OFF=未验证`);
        if (port?.isOpen) control.command('STATUS');
      } else if (value.toLowerCase() === 'disconnect') disconnect();
      else if (value.toLowerCase() === 'quit') input.close();
      else control.command(value.toUpperCase());
    } catch (e) { log(e.message); }
  });
  input.on('close', () => {
    if (closing) return; closing = true; disconnect();
    // Serial close is best effort; board watchdog is the secondary protection.
  });
  process.on('SIGINT', () => input.close());
}
