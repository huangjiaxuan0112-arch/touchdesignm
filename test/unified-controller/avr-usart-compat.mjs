// Test-side AVR8js 0.21.1 compatibility, not a firmware or dependency-file patch.
// The installed USART UCSRB hook clears pending RXC when RXEN remains enabled,
// including Arduino core UDRIE toggles. Real RXC must persist until UDR is read
// or the receiver is disabled. See the Microchip datasheet links in the report.
export function preservePendingReceive(cpu, config) {
  const original = cpu.writeHooks[config.UCSRB];
  const repairs = [];
  const receiveInterrupt = { address: config.rxCompleteInterrupt,
    flagRegister: config.UCSRA, flagMask: 0x80,
    enableRegister: config.UCSRB, enableMask: 0x80, constant: true };
  cpu.writeHooks[config.UCSRB] = (value, old, mask) => {
    const pending = Boolean(cpu.data[config.UCSRA] & 0x80);
    const remainsEnabled = Boolean((old & 0x10) && (value & 0x10));
    const result = original(value, old, mask);
    if (pending && remainsEnabled && !(cpu.data[config.UCSRA] & 0x80)) {
      cpu.setInterruptFlag(receiveInterrupt);
      repairs.push({ cycle: cpu.cycles, virtualMs: cpu.cycles / 16000, oldUCSRB: old, newUCSRB: value });
    }
    return result;
  };
  return repairs;
}
