import { P, saveParams } from './config.js';
import { initAudio, setVolume, suspendAudio, resumeAudio } from './audio.js';
import { createWorld } from './world.js';
import { registerMaps } from './maps.js';
import { FX } from './fx.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { VERSION, VERSION_NAME } from './version.js';

document.title = `打擊操作基底 v${VERSION}（${VERSION_NAME}）`;

const canvas = document.getElementById('c');
const world = createWorld(canvas);
registerMaps(world);
world.resize();
const fx = new FX(world.scene, world.camera, document.getElementById('fx-layer'));
const input = new Input(canvas);
const game = new Game(world, fx, input);
window.addEventListener('resize', () => world.resize());
window.__game = game; // 除錯用

// ── 提示訊息 ──
const toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 1400);
}

// ── 開始一場時左下角的操作提示（幾秒後淡出） ──
const hintEl = document.getElementById('hint');
let hintTimer = 0;
function showHint() {
  const two = P.twoPlayers ? '<br><b>2P</b>　方向鍵移動・<kbd>/</kbd> 揮錘・<kbd>.</kbd> 翻滾' : '';
  hintEl.innerHTML = `<kbd>WASD</kbd> 移動・<kbd>J</kbd>／左鍵 揮錘（按住蓄力）・<kbd>空白</kbd> 翻滾・<kbd>Esc</kbd> 暫停${two}`;
  hintEl.classList.add('on');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.remove('on'), 7000);
}

// ── 流程：主選單 → 遊戲（→ 暫停）→ 結算 → 主選單 ──
let started = false;
let paused = false;
const ui = new UI({
  game,
  world,
  toast,
  onStart: (mode) => start(mode),
  onResume: () => setPaused(false),
  onRestart: () => {
    setPaused(false);
    game.startMode(game.mode);
    ui.showLab(game.mode === 'lab');
  },
  onQuit: () => quit(),
});

function start(mode) {
  if (started) return;
  started = true;
  initAudio();
  setVolume(P.volume);
  ui.hideMenu();
  game.startMode(mode);
  ui.showLab(mode === 'lab');
  if (mode !== 'lab') showHint();
  last = performance.now();
}

function quit() {
  setPaused(false);
  started = false;
  for (const f of game.fighters) game.cancelCharge(f);
  // 收掉模式留在場上的東西（守超市的門口標記等），主選單背景回到預覽
  if (game.mini && game.mini.stop) game.mini.stop();
  game.mini = null;
  game.mode = 'practice';
  game.match.hideOverlays();
  game.endKO();
  hintEl.classList.remove('on');
  ui.showLab(false);
  ui.showMenu();
}

game.match.onAgain = () => {
  game.startMode(game.mode);
  ui.showLab(game.mode === 'lab');
};
game.match.onQuit = () => quit();

// ── 暫停（Esc、右下角按鈕；切到別的視窗也會自動暫停） ──
function setPaused(on) {
  if (!started || paused === on) return;
  paused = on;
  if (on) {
    game.cancelCharge(game.player);
    suspendAudio();
    ui.openPause();
  } else {
    resumeAudio();
    ui.closePause();
    last = performance.now(); // 避免恢復時一次跳很大一步
  }
}
document.getElementById('pause-btn').onclick = () => setPaused(!paused);
// 滾輪：跟隨鏡頭（高爾夫）拉遠拉近
canvas.addEventListener('wheel', (e) => {
  if (!started) return;
  e.preventDefault();
  game.camZoom = Math.max(0.6, Math.min(2.4, game.camZoom * (e.deltaY > 0 ? 1.1 : 0.9)));
}, { passive: false });
window.addEventListener('blur', () => setPaused(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});

// ── 快捷鍵 ──
const HOTKEYS = { Digit1: ['hitstopOn', '打擊停頓'], Digit2: ['shakeOn', '畫面震動'], Digit3: ['soundOn', '音效'], Digit4: ['koOn', 'K.O. 特寫'], Digit5: ['flashOn', '受擊閃白'] };
const TIME_STEPS = [1, 0.5, 0.25, 0.1];
input.onKey = (code) => {
  if (!started) {
    if (code === 'Enter') start(ui.firstMode());
    return;
  }
  if (code === 'Escape') {
    setPaused(!paused);
    return;
  }
  if (paused || game.match.overlay) return;
  const lab = game.mode === 'lab' && game.mini;
  if (HOTKEYS[code]) {
    const [k, name] = HOTKEYS[code];
    P[k] = !P[k];
    saveParams();
    ui.syncLab();
    toast(`${name}：${P[k] ? '開' : '關'}`);
  } else if (code === 'KeyH') {
    // 測試場：隱藏左右面板；其他模式：隱藏 HUD（截圖用）
    if (lab) document.body.classList.toggle('lab-hidden');
    else document.body.classList.toggle('hud-hidden');
    ui.layoutStage();
  } else if (code === 'KeyR' && (game.mode === 'practice' || lab)) {
    if (lab) game.mini.resetField();
    else game.resetRoster();
    toast('場地已重置');
  } else if (lab && code === 'KeyF') {
    game.labFrozen = !game.labFrozen;
    ui.syncLab();
  } else if (lab && code === 'KeyN') {
    game.labFrozen = true;
    game.labStep = true;
    ui.syncLab();
  } else if (lab && code === 'KeyT') {
    const i = TIME_STEPS.indexOf(game.labScale);
    game.labScale = TIME_STEPS[(i + 1) % TIME_STEPS.length];
    ui.syncLab();
    toast(`時間 ${game.labScale}×`);
  }
};

// ── 主迴圈 ──
let last = performance.now();
let fps = 60;
function frame(now) {
  const realDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(realDt, 1e-3) - fps) * 0.05;
  if (window.__paused || paused || game.match.overlay) {
    // 暫停、結算畫面：只畫面不更新（除錯用的 window.__paused 也走這裡）
    if (paused || game.match.overlay) world.renderer.render(world.scene, world.camera);
    requestAnimationFrame(frame);
    return;
  }
  if (!started) {
    const pad = input.pad();
    if (pad && pad.buttons.some((b) => b.pressed)) start(ui.firstMode());
    game.syncVisuals(0, realDt);
    game.updateCamera(realDt);
  } else if (game.labFrozen && !game.labStep) {
    // 測試場凍結：畫面照畫，遊戲不前進
    game.syncVisuals(0, realDt);
    game.updateCamera(realDt);
  } else if (game.labStep) {
    game.labStep = false;
    game.update(1 / 60);
  } else {
    game.update(realDt);
  }
  ui.tick(Math.round(fps));
  world.tick(realDt);
  world.renderer.render(world.scene, world.camera);
  requestAnimationFrame(frame);
}
ui.showMenu();
requestAnimationFrame(frame);
