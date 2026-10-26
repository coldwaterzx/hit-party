// 全部用 WebAudio 即時合成，不需要音檔。
import { P } from './config.js';

let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) {
    ctx.resume();
    return;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = P.volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  master.connect(comp);
  comp.connect(ctx.destination);

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

export function setVolume(v) {
  if (master) master.gain.value = v;
}

// 暫停時把整個音訊停掉（蓄力聲之類的持續音也會停），繼續時恢復
export function suspendAudio() {
  chargeStop();
  if (ctx && ctx.state === 'running') ctx.suspend();
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

const ready = () => ctx && P.soundOn && ctx.state === 'running';

function envelope(g, t0, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function tone(type, f0, f1, dur, peak, t0 = ctx.currentTime) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  envelope(g, t0, peak, 0.003, dur);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(dur, peak, filterType, f0, f1, q = 1, t0 = ctx.currentTime) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain();
  envelope(g, t0, peak, 0.002, dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.05);
}

export const sfx = {
  // 秒揮打中：悶擊＋短促的敲擊聲
  tap() {
    if (!ready()) return;
    tone('sine', 170, 55, 0.13, 0.9);
    tone('triangle', 650, 300, 0.06, 0.25);
    noise(0.03, 0.35, 'highpass', 3000, 3000, 0.7);
  },
  // 秒揮沒打中：錘子砸地
  tapGround() {
    if (!ready()) return;
    tone('sine', 120, 50, 0.12, 0.5);
    noise(0.08, 0.2, 'lowpass', 900, 250, 1);
  },
  whiff(tier) {
    if (!ready()) return;
    noise(0.12 + 0.05 * tier, 0.12 + 0.05 * tier, 'bandpass', 600, 2600, 1.4);
  },
  // 「鏘——！」：金屬球棒打中球。段數越高越亮、越長、越大聲。
  clang(tier) {
    if (!ready()) return;
    const t = ctx.currentTime;
    const base = 880 + 140 * tier;
    const decay = [0.2, 0.3, 0.55, 0.95][tier];
    const vol = [0.25, 0.35, 0.5, 0.65][tier];
    const ratios = [1, 2.76, 5.4, 8.93];
    ratios.forEach((r, i) => {
      tone('sine', base * r, base * r * 0.996, decay / (1 + i * 0.6), vol / (1 + i * 0.8), t);
    });
    noise(0.035 + 0.02 * tier, 0.7, 'highpass', 2600, 2600, 0.7, t); // 清脆的「喀」
    tone('sine', 150, 45, 0.16 + 0.06 * tier, 0.9, t); // 打在身體上的悶響
    if (tier >= 3) {
      tone('sawtooth', 230, 55, 0.3, 0.22, t);
      noise(0.4, 0.3, 'lowpass', 1800, 200, 1, t);
    }
  },
  tierUp(tier) {
    if (!ready()) return;
    const f = [0, 1500, 1900, 2500][tier];
    tone('sine', f, f, 0.22, 0.22);
    tone('sine', f * 2.01, f * 2.01, 0.12, 0.08);
  },
  wall() {
    if (!ready()) return;
    tone('sine', 95, 38, 0.28, 1);
    noise(0.24, 0.7, 'lowpass', 1100, 180, 1);
    tone('square', 150, 70, 0.08, 0.18);
  },
  bowl() {
    if (!ready()) return;
    tone('sine', 330, 160, 0.1, 0.6);
    noise(0.07, 0.4, 'bandpass', 1400, 900, 2);
  },
  ringOut() {
    if (!ready()) return;
    tone('sine', 1700, 280, 0.75, 0.22);
    noise(0.6, 0.18, 'highpass', 3500, 2500, 0.7, ctx.currentTime + 0.45);
  },
  ko() {
    if (!ready()) return;
    tone('sine', 75, 28, 0.7, 1);
    noise(0.5, 0.45, 'lowpass', 3200, 200, 1);
  },
  land() {
    if (!ready()) return;
    tone('sine', 120, 60, 0.1, 0.35);
    noise(0.08, 0.15, 'lowpass', 800, 300, 1);
  },
  poof() {
    if (!ready()) return;
    noise(0.22, 0.3, 'bandpass', 2200, 500, 1);
    tone('triangle', 520, 200, 0.15, 0.15);
  },
  hurt() {
    if (!ready()) return;
    tone('square', 280, 120, 0.13, 0.22);
  },
  enemySwing() {
    if (!ready()) return;
    noise(0.12, 0.12, 'bandpass', 500, 1500, 1.5);
  },
  roll() {
    if (!ready()) return;
    noise(0.18, 0.18, 'bandpass', 400, 1300, 1.5);
  },
  throwBall() {
    if (!ready()) return;
    noise(0.1, 0.14, 'bandpass', 800, 1700, 2);
  },
  pop() {
    if (!ready()) return;
    tone('sine', 400, 950, 0.1, 0.3);
  },
  spawn() {
    if (!ready()) return;
    tone('sine', 210, 80, 0.15, 0.35);
  },
  // 捕獲成功：叮叮的金幣聲，大獎多一段上行琶音
  coin(big) {
    if (!ready()) return;
    const t = ctx.currentTime;
    tone('sine', 1320, 1320, 0.1, 0.3, t);
    tone('sine', 1760, 1760, 0.22, 0.3, t + 0.07);
    if (big) [2093, 2637, 3136].forEach((f, i) => tone('triangle', f, f, 0.2, 0.2, t + 0.16 + i * 0.07));
  },
  error() {
    if (!ready()) return;
    tone('square', 150, 110, 0.14, 0.2);
  },
  bet() {
    if (!ready()) return;
    tone('sine', 900, 900, 0.04, 0.15);
  },
  stageClear() {
    if (!ready()) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.25, 0.3, t + i * 0.09));
  },
  fail() {
    if (!ready()) return;
    const t = ctx.currentTime;
    [392, 311, 233].forEach((f, i) => tone('sawtooth', f, f * 0.97, 0.3, 0.18, t + i * 0.18));
  },
};

// ── 蓄力聲：持續音，隨蓄力時間升高（金屬被拉緊的感覺） ──
let charge = null;

export function chargeStart() {
  if (!ready() || charge) return;
  const t = ctx.currentTime;
  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  o1.type = 'sawtooth';
  o2.type = 'sawtooth';
  o1.frequency.value = 110;
  o2.frequency.value = 111.7;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 9;
  lp.frequency.value = 300;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
  o1.connect(lp);
  o2.connect(lp);
  lp.connect(g);
  g.connect(master);

  const n = ctx.createBufferSource();
  n.buffer = noiseBuf;
  n.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 14;
  bp.frequency.value = 700;
  const ng = ctx.createGain();
  ng.gain.value = 0.05;
  n.connect(bp);
  bp.connect(ng);
  ng.connect(master);

  o1.start(t);
  o2.start(t);
  n.start(t);
  charge = { o1, o2, lp, g, n, bp, ng };
}

export function chargeUpdate(holdT, tier) {
  if (!charge) return;
  const t = ctx.currentTime;
  const k = Math.min(1, holdT / P.chargeLv3);
  charge.lp.frequency.setTargetAtTime(300 + 2400 * k, t, 0.03);
  charge.o1.frequency.setTargetAtTime(110 + 150 * k, t, 0.03);
  charge.o2.frequency.setTargetAtTime(111.7 + 152 * k, t, 0.03);
  charge.bp.frequency.setTargetAtTime(600 + 1600 * k, t, 0.03);
  const wobble = tier >= 3 ? 0.05 * Math.sin(t * 45) : 0;
  charge.g.gain.setTargetAtTime(0.09 + 0.04 * k + wobble, t, 0.02);
}

export function chargeStop() {
  if (!charge) return;
  const c = charge;
  charge = null;
  const t = ctx.currentTime;
  c.g.gain.cancelScheduledValues(t);
  c.g.gain.setTargetAtTime(0.0001, t, 0.015);
  c.ng.gain.setTargetAtTime(0.0001, t, 0.015);
  c.o1.stop(t + 0.1);
  c.o2.stop(t + 0.1);
  c.n.stop(t + 0.1);
}
