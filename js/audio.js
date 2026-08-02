// WebAudio synthesized sounds — no audio files. The context is created lazily
// on the first user gesture (iOS requirement) and resumed when the app regains
// visibility (iOS suspends it in the background).

let ctx = null;
let masterGain = null;
let soundOn = true;

export function setSoundOn(v) { soundOn = v; }

function ensureCtx() {
  if (!soundOn) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlock() { ensureCtx(); }
export function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

// Short filtered noise burst — a card sliding onto felt.
function noiseBurst(duration, freq, gain, delay = 0) {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const len = Math.ceil(c.sampleRate * duration);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  src.connect(filter).connect(g).connect(masterGain);
  src.start(t0);
}

function blip(freq, duration, gain, delay = 0, type = 'sine') {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  o.connect(g).connect(masterGain);
  o.start(t0);
  o.stop(t0 + duration + 0.05);
}

export const place = () => noiseBurst(0.07, 2600, 0.5);
export const flip = () => noiseBurst(0.05, 4200, 0.35);
export const drawSound = () => { noiseBurst(0.06, 3000, 0.4); };
export const foundation = () => { noiseBurst(0.05, 3200, 0.3); blip(880, 0.16, 0.22); blip(1318.5, 0.2, 0.16, 0.05); };
export const error = () => blip(180, 0.12, 0.2, 0, 'triangle');
export const undoSound = () => noiseBurst(0.06, 2000, 0.35);

export function win() {
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
  notes.forEach((f, i) => {
    blip(f, 0.35, 0.22, i * 0.09, 'triangle');
    blip(f * 2, 0.3, 0.08, i * 0.09, 'sine');
  });
}
