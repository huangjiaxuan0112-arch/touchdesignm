// Expectations only: none of this code drives the simulated GPIO or AVR program.
export const modes = {
  WIND: { sketch: '卒研music/wind/sketch_oct21a/sketch_oct21a.ino', nominalMs: 24000,
    cues: ['INITIAL FILL', 'PLAY WIND AUDIO NOW', 'FINAL SHRINK', 'NEXT WIND CYCLE'], repeatCue: 'INITIAL FILL' },
  WAVE: { sketch: '卒研music/ocean waves/sketch_oct21b/sketch_oct21b.ino', nominalMs: 25000,
    cues: ['INITIAL FILL', 'PLAY WAVE AUDIO NOW', 'FINAL SHRINK', 'NEXT WAVE CYCLE'], repeatCue: 'INITIAL FILL' },
  BUBBLE: { sketch: '卒研music/bubbles/sketch_sep30a/sketch_oct21a/sketch_oct21a.ino', nominalMs: 27420,
    cues: ['PLAY AUDIO NOW', 'BUBBLE START', 'FINAL SHRINK', 'NEXT ROUND'] },
};

// Independent source-level expectation, compared with the existing timeline and
// the compiled execution trace. In particular, do not resample BUBBLE pop events.
export function sourceActions(text, mode) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
  const constants = Object.fromEntries([...source.matchAll(/const\s+(?:unsigned long|int)\s+(\w+)\s*=\s*(\d+)/g)].map(m => [m[1], +m[2]]));
  const calls = code => [...code.matchAll(/\b(inflate|deflate)\((\w+)\)/g)].map(m => {
    const ms = /^\d+$/.test(m[2]) ? +m[2] : constants[m[2]];
    if (!Number.isInteger(ms)) throw Error(`Unresolved legacy delay: ${m[2]}`);
    return [ms, +(m[1] === 'inflate')];
  });
  const loop = source.split('void loop()')[1];
  if (mode !== 'BUBBLE') return calls(loop);
  const pops = source.match(/const unsigned long pops\[\]\s*=\s*\{([\s\S]*?)\}/);
  if (!pops) throw Error('Missing original BUBBLE pops array');
  const times = [...pops[1].matchAll(/\d+/g)].map(m => +m[0]);
  const actions = calls(loop.split('for (')[0]); // preserve both 4420 and 580 ms calls
  for (let i = 0; i < times.length && times[i] < constants.MUSIC_LENGTH; i++) {
    const end = Math.min(times[i + 1] ?? constants.MUSIC_LENGTH, constants.MUSIC_LENGTH);
    const interval = end - times[i];
    const out = Math.floor(interval * constants.OUT_PERCENT / 100);
    actions.push([out, 0], [interval - out, 1]);
  }
  actions.push([constants.FINAL_DEFLATE, 0]);
  return actions;
}
