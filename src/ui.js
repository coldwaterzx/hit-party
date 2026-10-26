// 介面：主選單（分類分頁）、暫停選單、測試場的工具列與調整面板。
// 所有按鈕都是照下面的資料表產生的；遊戲邏輯只透過 hooks（onStart、onQuit…）跟這裡溝通。
import { P, DEFAULTS, saveParams, resetParams, exportParams } from './config.js';
import { TUNING, TUNING_CATS } from './tuning.js';
import { ITEMS } from './items.js';
import { setVolume } from './audio.js';
import { VERSION, VERSION_NAME } from './version.js';
import { COURSES } from './courses.js';
import { CUSTOM } from './golf.js';
import { CourseHole, buildHoleMesh, holeFromImage } from './course.js';

export const MAP_LABELS = {
  city: '超市停車場', table: '巨大撞球桌', ice: '冰湖', pinball: '彈珠台', rooftop: '頂樓',
  soccer: '足球場', hockey: '曲棍球桌', lane: '保齡球道', lab: '訓練室', course: '高爾夫球場',
};

// 主選單的選項（按鈕組）
const OPT = {
  map: { key: 'map', label: '地圖', vals: [['city', '超市停車場'], ['table', '巨大撞球桌'], ['ice', '冰湖'], ['pinball', '彈珠台'], ['rooftop', '頂樓']] },
  minions: { key: 'spawnMinions', label: '小怪', vals: [[true, '開'], [false, '關（只有玩家）']] },
  rivals: { key: 'rivalCount', label: 'AI 對手', vals: [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']] },
  allies: { key: 'coopAllies', label: 'AI 隊友', vals: [[0, '0'], [1, '1'], [2, '2'], [3, '3']] },
  relayMap: { key: 'map', label: '接力挑戰的地圖', vals: [['city', '停車場'], ['table', '撞球桌'], ['ice', '冰湖'], ['pinball', '彈珠台'], ['rooftop', '頂樓']] },
  soccerSize: { key: 'soccerSize', label: '人數', vals: [[2, '2 打 2'], [3, '3 打 3']] },
  soccerWin: { key: 'soccerWinGoals', label: '勝利條件', vals: [[0, '3 分鐘'], [3, '先進 3 球'], [5, '先進 5 球']] },
  hockeySize: { key: 'hockeySize', label: '人數', vals: [[1, '1 打 1'], [2, '2 打 2']] },
  hockeyPoints: { key: 'hockeyPoints', label: '先得', vals: [[3, '3 分'], [5, '5 分'], [7, '7 分']] },
  labMap: { key: 'labMap', label: '場地', vals: [['lab', '訓練室'], ['city', '停車場'], ['table', '撞球桌'], ['ice', '冰湖'], ['pinball', '彈珠台'], ['rooftop', '頂樓'], ['soccer', '足球場'], ['hockey', '曲棍球桌']] },
  golfCourse: { key: 'golfCourse', label: '球場', vals: [['party', '派對球場（9 洞）'], ['classic', '入門球場（5 洞）'], ['custom', '匯入的球場']] },
  golfHoles: { key: 'golfHoles', label: '打幾洞', vals: [[3, '前 3 洞'], [9, '全部']] },
  golfRivals: { key: 'golfRivals', label: 'AI 對手', vals: [[0, '0'], [1, '1'], [2, '2'], [3, '3']] },
  golfScoring: { key: 'golfScoring', label: '計分', vals: [['strokes', '比總桿數'], ['order', '比完成順序']] },
  players: { key: 'twoPlayers', label: '玩家', vals: [[false, '1 人'], [true, '2 人（本機）']] },
  items: { key: 'items', label: '道具', vals: [[true, '開'], [false, '關']] },
  events: { key: 'mapEvents', label: '地圖機關', vals: [[true, '開'], [false, '關']] },
};

// 主選單的分類：每一類有選項、模式卡片、背景預覽的地圖
const CATS = [
  {
    id: 'brawl', name: '大亂鬥', preview: () => P.map, minions: true,
    options: ['map', 'minions', 'rivals'],
    modes: [
      { mode: 'match', name: '對戰', badge: '戰', desc: '把小怪打進袋口或打下平台搶分，也能把對手打下去。', meta: ['3 分鐘', '比分數'] },
      { mode: 'survival', name: '最後存活', badge: '命', desc: '每人 3 條命，被打出場少一條，活到最後的人贏。', meta: ['淘汰制'] },
      { mode: 'egg', name: '搶寶', badge: '蛋', desc: '搶唯一的金蛋，拿著每秒 +1 分、移動變慢，被打到就掉。', meta: ['3 分鐘', '比分數'] },
      { mode: 'practice', name: '練習', badge: '練', desc: '沒有對手、不限時，有兩個木樁可以打。', meta: ['不限時'] },
    ],
  },
  {
    id: 'coop', name: '合作', preview: () => 'city',
    options: ['allies', 'relayMap'],
    modes: [
      { mode: 'defense', name: '守超市', badge: '守', desc: '一波波小怪衝向超市門口，守住門。每波選一個全隊強化，每 5 波來一隻胖墩王。', meta: ['波次防守'] },
      { mode: 'boss', name: 'Boss 戰', badge: '王', desc: '引胖墩王衝刺撞上庫邊暈眩，再大家一起把它打進袋口 3 次。', meta: ['撞球桌'] },
      { mode: 'escort', name: '護送購物車', badge: '車', desc: '把很重的購物車推到收銀台，小怪會一直來把車推走。', meta: ['送 3 台'] },
      { mode: 'relay', name: '接力挑戰', badge: '接', desc: '隊友之間接著打，接力越長分數越高，限時拿星星。', meta: ['90 秒', '三星'] },
    ],
  },
  {
    id: 'soccer', name: '足球', preview: () => 'soccer',
    options: ['soccerSize', 'soccerWin'],
    modes: [
      { mode: 'soccer', name: '開始足球', badge: '球', desc: '藍隊往右攻，用錘子把球打進對方球門；走路也能帶球。地圖機關開著時有守門員。', meta: ['團隊'] },
    ],
  },
  {
    id: 'hockey', name: '曲棍球', preview: () => 'hockey',
    options: ['hockeySize', 'hockeyPoints'],
    modes: [
      { mode: 'hockey', name: '開始桌上曲棍球', badge: '冰', desc: '四周圍起來，只有兩端中間的球門口要守。走路撞到冰球就能把它撞出去，揮錘會自動往對方球門修正方向。', meta: ['對打', '移動加快'] },
    ],
  },
  {
    id: 'golf', name: '高爾夫', preview: () => 'golf',
    options: ['golfCourse', 'golfHoles', 'golfRivals', 'golfScoring'],
    golfTools: true,
    modes: [
      { mode: 'golf', name: '開始高爾夫', badge: '桿', desc: '大家同時開打、各打各的球，誰先打進洞誰先完成。可以去打別人的球、把別人打下水。按住越久打越遠（箭頭就是距離），點一下是短推桿。滾輪可以拉遠鏡頭看路線。', meta: ['派對', '同時進行'] },
    ],
  },
  {
    id: 'mini', name: '小遊戲', preview: () => 'lane',
    options: [],
    modes: [
      { mode: 'bowling', name: '保齡球', badge: '瓶', desc: '5 格，站在紅線後把球打向 10 支球瓶。全倒 +10、補中 +5。', meta: ['單人'] },
      { mode: 'curling', name: '冰壺', badge: '壺', desc: '6 顆冰壺，停得離紅心越近分數越高，可以把前面的推進去。', meta: ['單人'] },
    ],
  },
  {
    id: 'lab', name: '測試場', preview: () => P.labMap || 'lab',
    options: ['labMap'],
    modes: [
      { mode: 'lab', name: '進入測試場', badge: '測', desc: '生成木樁和小怪、直接拿道具、慢動作和逐格、顯示判定範圍、量擊退距離，右邊面板可以調所有參數。', meta: ['訓練模式'] },
    ],
  },
];

const parseVal = (v) => (v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v));
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

// 操作說明（主選單、暫停選單共用）
function controlsHtml() {
  const rows = [
    ['移動', 'WASD', '方向鍵', '左搖桿'],
    ['揮錘（點一下＝秒揮，按住＝蓄力）', 'J／滑鼠左鍵', '/／Num1', 'X／RB／RT'],
    ['瞄準', '滑鼠', '移動方向', '右搖桿'],
    ['翻滾（短暫無敵）', '空白／K', '.／Num2', 'B／LB'],
    ['暫停', 'Esc', '', 'Start'],
  ];
  const tips = [
    '秒揮把東西挑起來，馬上蓄力再打＝浮空追擊（距離 ×1.3）',
    '打飛的東西會滑行、撞牆反彈、撞到別人把它一起撞走',
    '地上的箭頭長度＝擊退距離；AI 蓄力時也看得到它的箭頭',
    '道具箱（?）打破就拿到道具，效果顯示在頭上的名牌',
  ];
  return `<table class="keys"><thead><tr><th></th><th>1P</th><th>2P</th><th>手把</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((k) => `<td>${k ? k.split('／').map((x) => `<kbd>${x}</kbd>`).join('') : '—'}</td>`).join('')}</tr>`).join('')
  }</tbody></table><ul class="tips">${tips.map((t) => `<li>${t}</li>`).join('')}</ul>`;
}

export class UI {
  constructor(hooks) {
    this.h = hooks; // { game, world, onStart(mode), onResume(), onRestart(), onQuit(), toast(msg) }
    this.cat = 'brawl';
    this.buildMenu();
    this.buildPause();
    this.buildLab();
    this.restoreCustom();
    window.addEventListener('resize', () => this.layoutStage());
  }

  get game() {
    return this.h.game;
  }

  set(key, val) {
    P[key] = val;
    saveParams();
    this.syncChips();
    if (this.tuner) this.tuner.refresh();
  }

  // 一組選項按鈕
  chips(opt) {
    const o = OPT[opt];
    const row = el('div', 'opt-row');
    row.appendChild(el('span', 'opt-label', o.label));
    const box = el('div', 'chips');
    for (const [v, text] of o.vals) {
      const b = el('button', 'chip', text);
      b.dataset.key = o.key;
      b.dataset.val = String(v);
      b.onclick = () => {
        this.set(o.key, v);
        if (o.key === 'map' || o.key === 'labMap' || o.key === 'spawnMinions') this.preview();
      };
      box.appendChild(b);
    }
    row.appendChild(box);
    return row;
  }

  syncChips() {
    for (const b of document.querySelectorAll('.chip[data-key]')) b.classList.toggle('sel', P[b.dataset.key] === parseVal(b.dataset.val));
    const vol = document.getElementById('menu-volume');
    if (vol) vol.value = P.volume;
  }

  // ───────────────────────── 主選單 ─────────────────────────

  buildMenu() {
    const root = document.getElementById('menu');
    root.innerHTML = '';
    const side = el('aside', 'menu-panel');
    const head = el('header', 'menu-head', `<div class="logo">打擊操作基底</div><div class="ver">v${VERSION}・${VERSION_NAME}</div><p class="tagline">LoL 視角 × 撞球物理 × 錘子打擊</p>`);
    side.appendChild(head);
    const tabs = el('nav', 'menu-tabs');
    for (const c of CATS) {
      const t = el('button', 'tab', c.name);
      t.dataset.cat = c.id;
      t.onclick = () => this.selectCat(c.id);
      tabs.appendChild(t);
    }
    side.appendChild(tabs);
    this.menuBody = el('section', 'menu-body');
    side.appendChild(this.menuBody);
    const foot = el('footer', 'menu-foot');
    for (const o of ['players', 'items', 'events']) foot.appendChild(this.chips(o));
    const volRow = el('div', 'opt-row');
    volRow.appendChild(el('span', 'opt-label', '音量'));
    const volBox = el('div', 'vol');
    volRow.appendChild(volBox);
    const vol = el('input');
    vol.type = 'range';
    vol.min = 0;
    vol.max = 1;
    vol.step = 0.01;
    vol.id = 'menu-volume';
    vol.oninput = () => {
      P.volume = Number(vol.value);
      setVolume(P.volume);
      saveParams();
    };
    volBox.appendChild(vol);
    const help = el('button', 'link-btn', '操作說明');
    help.onclick = () => this.showControls();
    volBox.appendChild(help);
    foot.appendChild(volRow);
    side.appendChild(foot);
    root.appendChild(side);
    const pv = el('div', 'menu-preview');
    this.previewLabel = el('div', 'preview-label');
    pv.appendChild(this.previewLabel);
    pv.appendChild(el('div', 'preview-hint', '按 Enter 直接開始目前選的第一個模式'));
    root.appendChild(pv);
    this.selectCat(this.cat);
  }

  selectCat(id) {
    this.cat = id;
    const c = CATS.find((x) => x.id === id);
    for (const t of document.querySelectorAll('.menu-tabs .tab')) t.classList.toggle('sel', t.dataset.cat === id);
    const body = this.menuBody;
    body.innerHTML = '';
    if (c.options.length) {
      const opts = el('div', 'opt-box');
      for (const o of c.options) opts.appendChild(this.chips(o));
      body.appendChild(opts);
    }
    if (c.golfTools) body.appendChild(this.golfTools());
    const grid = el('div', 'mode-grid');
    for (const m of c.modes) {
      const card = el('button', 'mode-card');
      card.innerHTML = `<span class="badge">${m.badge}</span><span class="mode-text"><b>${m.name}</b><span class="desc">${m.desc}</span><span class="meta">${m.meta.map((x) => `<i>${x}</i>`).join('')}</span></span><span class="go">開始 ▶</span>`;
      card.onclick = () => this.h.onStart(m.mode);
      grid.appendChild(card);
    }
    body.appendChild(grid);
    this.syncChips();
    this.preview();
  }

  firstMode() {
    return CATS.find((x) => x.id === this.cat).modes[0].mode;
  }

  // 背景換成這一類會用到的地圖（高爾夫：選的球場的第一洞）
  preview() {
    const c = CATS.find((x) => x.id === this.cat);
    const map = c.preview();
    if (map === 'golf') {
      const hole = this.previewHole();
      this.game.preview('city', false);
      this.h.world.setCourse(hole);
      const p = this.game.player;
      Object.assign(p, { x: hole.tee.x - 1.2, z: hole.tee.z });
      this.game.camZoom = 1.45;
      this.previewLabel.textContent = `${hole.name}（Par ${hole.par}）`;
      return;
    }
    this.game.preview(map, c.minions && P.spawnMinions);
    this.previewLabel.textContent = MAP_LABELS[map] || '';
  }

  previewHole() {
    const course = P.golfCourse === 'custom' && CUSTOM.holes.length ? CUSTOM : COURSES[P.golfCourse] || COURSES.party;
    const d = course.holes[0];
    this.holeCache = this.holeCache || new Map();
    if (!this.holeCache.has(d)) {
      const h = d instanceof CourseHole ? d : new CourseHole(d);
      if (!h.group) buildHoleMesh(h);
      this.holeCache.set(d, h);
    }
    return this.holeCache.get(d);
  }

  // 高爾夫分頁：匯入自己畫的球場、下載範本
  golfTools() {
    const box = el('div', 'opt-box golf-tools');
    box.appendChild(el('div', 'opt-label', '自己畫球場：用小畫家等軟體畫 PNG，1 像素＝0.25 m。顏色：<b style="color:#5fae4a">球道</b>、<b style="color:#86d46c">果嶺</b>、<b style="color:#3b7a33">長草</b>、<b style="color:#e6cf94">沙坑</b>、<b style="color:#bfe8ff">冰面</b>、<b style="color:#2f7fc4">水</b>、<b style="color:#c08a5a">牆</b>（#8a5a32）、黑色＝虛空；白點＝發球台、紅點＝球洞。'));
    const row = el('div', 'chips');
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/png,image/*';
    file.style.display = 'none';
    file.onchange = () => {
      const f = file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => this.importCourse(reader.result, f.name.replace(/\.[^.]+$/, ''));
      reader.readAsDataURL(f);
      file.value = '';
    };
    const imp = el('button', 'chip', '匯入球場圖片');
    imp.onclick = () => file.click();
    const tpl = el('button', 'chip', '下載目前第 1 洞的地形圖');
    tpl.onclick = () => {
      const c = this.previewHole().toCanvas();
      const a = document.createElement('a');
      a.download = `球場-${this.previewHole().name}.png`;
      a.href = c.toDataURL('image/png');
      a.click();
    };
    row.append(imp, tpl, file);
    box.appendChild(row);
    return box;
  }

  importCourse(dataUrl, name) {
    const img = new Image();
    img.onload = () => {
      try {
        const hole = holeFromImage(img, name || '自訂球洞', 4);
        CUSTOM.holes = [hole];
        try {
          localStorage.setItem('hit-base-golf-custom', JSON.stringify({ dataUrl, name }));
        } catch {
          // 圖太大存不下就算了，這次還是能玩
        }
        this.set('golfCourse', 'custom');
        this.preview();
        this.h.toast(`已匯入「${hole.name}」（${hole.w}×${hole.h} m）`);
      } catch (e) {
        this.h.toast(e.message);
      }
    };
    img.src = dataUrl;
  }

  // 上次匯入的球場（存在瀏覽器裡）
  restoreCustom() {
    try {
      const s = JSON.parse(localStorage.getItem('hit-base-golf-custom') || 'null');
      if (!s) return;
      const img = new Image();
      img.onload = () => {
        try {
          CUSTOM.holes = [holeFromImage(img, s.name, 4)];
        } catch {
          // 壞掉的圖就不載入
        }
      };
      img.src = s.dataUrl;
    } catch {
      // localStorage 不能用
    }
  }

  // 遊戲畫面的位置：主選單時縮小放在面板右邊；測試場時放在左右兩個面板中間
  layoutStage() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const b = document.body;
    let left = 0;
    let right = 0;
    let bottom = 0;
    if (b.classList.contains('in-menu')) {
      left = Math.min(560, W) + 24;
      right = 24;
      bottom = 60;
    } else if (b.classList.contains('lab-mode') && !b.classList.contains('lab-hidden')) {
      left = 260;
      right = b.classList.contains('tuner-collapsed') ? 70 : 394;
      bottom = 0;
    }
    const room = W - left - right;
    const s = Math.max(0.3, Math.min(1, room / W, (H - bottom - 24) / H));
    b.style.setProperty('--st-s', s.toFixed(3));
    b.style.setProperty('--st-x', `${left + room / 2 - W / 2}px`);
  }

  showMenu() {
    document.body.classList.add('in-menu');
    this.layoutStage();
    document.body.classList.remove('in-game', 'lab-mode');
    this.syncChips();
    this.selectCat(this.cat);
  }

  hideMenu() {
    document.body.classList.remove('in-menu');
    document.body.classList.add('in-game');
    this.layoutStage();
  }

  showControls() {
    const m = document.getElementById('controls');
    document.getElementById('controls-body').innerHTML = controlsHtml();
    m.classList.add('on');
    document.getElementById('controls-close').onclick = () => m.classList.remove('on');
  }

  // ───────────────────────── 暫停選單 ─────────────────────────

  buildPause() {
    const card = document.querySelector('#pause .pause-card');
    card.innerHTML = '';
    const nav = el('nav', 'pause-nav');
    nav.appendChild(el('h2', '', '暫停'));
    const btn = (text, fn, cls = '') => {
      const b = el('button', `pause-btn ${cls}`, text);
      b.onclick = fn;
      nav.appendChild(b);
      return b;
    };
    btn('繼續', () => this.h.onResume(), 'primary');
    btn('重新開始', () => this.h.onRestart());
    this.pauseTabs = {
      controls: btn('操作說明', () => this.pauseTab('controls')),
      settings: btn('設定', () => this.pauseTab('settings')),
    };
    btn('回主選單', () => this.h.onQuit(), 'danger');
    card.appendChild(nav);
    this.pauseBody = el('div', 'pause-body');
    card.appendChild(this.pauseBody);
  }

  pauseTab(id) {
    for (const [k, b] of Object.entries(this.pauseTabs)) b.classList.toggle('sel', k === id);
    const body = this.pauseBody;
    body.innerHTML = '';
    if (id === 'controls') {
      body.appendChild(el('h3', '', '操作說明'));
      body.appendChild(el('div', '', controlsHtml()));
    } else {
      body.appendChild(el('h3', '', '設定'));
      body.appendChild(el('p', 'muted', '比較細的手感數值請到主選單的「測試場」調整。'));
      const list = el('div', 'tuner-rows');
      for (const def of TUNING.filter((t) => t.cat === 'toggles' || t.k === 'camPitch' || t.k === 'camFov')) list.appendChild(this.row(def));
      body.appendChild(list);
    }
  }

  openPause() {
    document.getElementById('pause').classList.add('on');
    this.pauseTab('controls');
  }

  closePause() {
    document.getElementById('pause').classList.remove('on');
  }

  // ───────────────────────── 調整面板 ─────────────────────────

  // 一列參數：名稱、滑桿、數字、還原預設
  row(def) {
    const r = el('div', 'trow');
    r.dataset.k = def.k;
    const isBool = typeof DEFAULTS[def.k] === 'boolean';
    const name = el('label', 'tname', `${def.name}${def.hotkey ? `<kbd>${def.hotkey}</kbd>` : ''}`);
    r.appendChild(name);
    const apply = (v) => {
      P[def.k] = v;
      saveParams();
      if (def.after === 'fit') this.h.world.fit();
      if (def.after === 'volume') setVolume(v);
      sync();
      this.syncChips();
    };
    let sync;
    if (isBool) {
      const sw = el('button', 'switch');
      sw.onclick = () => apply(!P[def.k]);
      r.appendChild(sw);
      sync = () => {
        sw.classList.toggle('on', !!P[def.k]);
        r.classList.toggle('changed', P[def.k] !== DEFAULTS[def.k]);
      };
    } else {
      const range = el('input');
      range.type = 'range';
      Object.assign(range, { min: def.min, max: def.max, step: def.step });
      const num = el('input', 'tnum');
      num.type = 'number';
      Object.assign(num, { min: def.min, max: def.max, step: def.step });
      const unit = el('span', 'tunit', def.unit || '');
      range.oninput = () => apply(Number(range.value));
      num.onchange = () => apply(Math.min(def.max, Math.max(def.min, Number(num.value))));
      r.append(range, num, unit);
      sync = () => {
        range.value = P[def.k];
        num.value = Math.round(P[def.k] * 1000) / 1000;
        r.classList.toggle('changed', Math.abs(P[def.k] - DEFAULTS[def.k]) > 1e-9);
      };
    }
    const reset = el('button', 'treset', '↺');
    reset.title = `還原預設值（${DEFAULTS[def.k]}）`;
    reset.onclick = () => apply(DEFAULTS[def.k]);
    r.appendChild(reset);
    r.sync = sync;
    sync();
    return r;
  }

  buildTuner(root) {
    root.innerHTML = '';
    const head = el('div', 'tuner-head');
    head.appendChild(el('b', '', '調整面板'));
    const search = el('input', 'tsearch');
    search.placeholder = '搜尋參數…';
    head.appendChild(search);
    const collapse = el('button', 'tcollapse', '⟩');
    collapse.title = '收合／展開';
    collapse.onclick = () => {
      const c = document.body.classList.toggle('tuner-collapsed');
      collapse.textContent = c ? '⟨' : '⟩';
      this.layoutStage();
    };
    head.appendChild(collapse);
    root.appendChild(head);
    const tabs = el('div', 'tuner-tabs');
    root.appendChild(tabs);
    const body = el('div', 'tuner-body');
    root.appendChild(body);
    const foot = el('div', 'tuner-foot');
    root.appendChild(foot);
    let cat = 'feel';
    const rows = [];
    const render = () => {
      body.innerHTML = '';
      rows.length = 0;
      const q = search.value.trim();
      for (const t of tabs.children) t.classList.toggle('sel', !q && t.dataset.cat === cat);
      const defs = q ? TUNING.filter((d) => d.name.includes(q) || d.group.includes(q) || d.k.toLowerCase().includes(q.toLowerCase())) : TUNING.filter((d) => d.cat === cat);
      if (!q) {
        const c = TUNING_CATS.find((x) => x.id === cat);
        body.appendChild(el('p', 'tdesc', c.desc));
      }
      let group = null;
      for (const d of defs) {
        const g = q ? `${TUNING_CATS.find((x) => x.id === d.cat).name}・${d.group}` : d.group;
        if (g !== group) {
          group = g;
          body.appendChild(el('div', 'tgroup', g));
        }
        const r = this.row(d);
        rows.push(r);
        body.appendChild(r);
      }
      if (!defs.length) body.appendChild(el('p', 'tdesc', '找不到這個參數'));
    };
    for (const c of TUNING_CATS) {
      const t = el('button', 'ttab', c.name);
      t.dataset.cat = c.id;
      t.onclick = () => {
        search.value = '';
        cat = c.id;
        render();
      };
      tabs.appendChild(t);
    }
    search.oninput = render;
    const fbtn = (text, fn, cls = '') => {
      const b = el('button', `small-btn ${cls}`, text);
      b.onclick = fn;
      foot.appendChild(b);
    };
    fbtn('這一類還原', () => {
      for (const d of TUNING.filter((x) => x.cat === cat)) P[d.k] = DEFAULTS[d.k];
      saveParams();
      this.h.world.fit();
      setVolume(P.volume);
      render();
      this.h.toast('這一類已還原預設值');
    });
    fbtn('匯出 JSON', async () => {
      const s = exportParams();
      try {
        await navigator.clipboard.writeText(s);
        this.h.toast('參數已複製到剪貼簿');
      } catch {
        window.prompt('複製下面的參數：', s);
      }
    });
    fbtn('匯入', () => {
      const s = window.prompt('貼上匯出的參數 JSON：');
      if (!s) return;
      try {
        const o = JSON.parse(s);
        for (const k of Object.keys(DEFAULTS)) if (typeof o[k] === typeof DEFAULTS[k]) P[k] = o[k];
        saveParams();
        this.h.world.fit();
        setVolume(P.volume);
        render();
        this.h.toast('參數已匯入');
      } catch {
        this.h.toast('格式不對，沒有匯入');
      }
    });
    fbtn('全部還原', () => {
      resetParams();
      this.h.world.fit();
      setVolume(P.volume);
      render();
      this.syncChips();
      this.h.toast('全部參數已還原預設值');
    }, 'danger');
    render();
    return { refresh: () => rows.forEach((r) => r.sync()) };
  }

  // ───────────────────────── 測試場 ─────────────────────────

  buildLab() {
    const tools = document.getElementById('lab-tools');
    tools.innerHTML = '';
    const section = (title) => {
      const s = el('div', 'lab-sec');
      s.appendChild(el('div', 'lab-sec-title', title));
      const box = el('div', 'lab-btns');
      s.appendChild(box);
      tools.appendChild(s);
      return box;
    };
    const lab = () => this.game.mini;
    const add = (box, text, fn, cls = '') => {
      const b = el('button', `lab-btn ${cls}`, text);
      b.onclick = () => {
        if (lab() && lab().title === '測試場') fn(lab());
        this.syncLab();
      };
      box.appendChild(b);
      return b;
    };
    tools.appendChild(el('div', 'lab-title', '<b>測試場</b><span>F 凍結・N 下一格・T 時間・R 重置・H 隱藏面板</span>'));
    const spawn = section('生成（在你面前 3 m）');
    for (const [t, n] of [['dummy', '木樁'], ['minion', '小兵'], ['heavy', '胖墩'], ['thrower', '投擲兵'], ['gold', '金色小兵'], ['crate', '道具箱'], ['ball', '足球'], ['puck', '冰球'], ['golfball', '高爾夫球'], ['cueball', '母球'], ['cart', '購物車'], ['boss', '胖墩王']]) {
      add(spawn, n, (l) => l.spawn(t));
    }
    const rival = section('AI 對手');
    add(rival, '＋ 加一個', (l) => l.addRival());
    add(rival, '全部移除', (l) => l.removeRivals());
    this.sandbagBtn = add(rival, '沙包模式', (l) => {
      l.sandbag = !l.sandbag;
    }, 'toggle');
    const items = section('道具（直接拿到）');
    for (const it of ITEMS) {
      const b = add(items, it.name, (l) => l.giveItem(it.id));
      b.style.setProperty('--c', it.color);
      b.classList.add('item');
      b.title = it.desc;
    }
    const time = section('時間');
    this.timeBtns = [];
    for (const s of [0.1, 0.25, 0.5, 1]) {
      const b = add(time, `${s}×`, () => {
        this.game.labScale = s;
      }, 'toggle');
      b.dataset.scale = s;
      this.timeBtns.push(b);
    }
    this.freezeBtn = add(time, '凍結', () => {
      this.game.labFrozen = !this.game.labFrozen;
    }, 'toggle');
    add(time, '下一格', () => {
      this.game.labFrozen = true;
      this.game.labStep = true;
    });
    const show = section('顯示');
    this.hitboxBtn = add(show, '判定範圍', (l) => {
      l.showHitbox = !l.showHitbox;
      this.game.showHitbox = l.showHitbox;
    }, 'toggle');
    this.indBtn = add(show, '地面指示器', () => {
      P.indicatorOn = !P.indicatorOn;
      saveParams();
    }, 'toggle');
    this.koBtn = add(show, 'K.O. 特寫', () => {
      P.koOn = !P.koOn;
      saveParams();
    }, 'toggle');
    this.eventBtn = add(show, '地圖機關', () => {
      P.mapEvents = !P.mapEvents;
      saveParams();
    }, 'toggle');
    const field = section('場地（切換會重新開始）');
    for (const [v, n] of OPT.labMap.vals) {
      const b = el('button', 'lab-btn toggle', n);
      b.dataset.map = v;
      b.onclick = () => {
        this.set('labMap', v);
        this.h.onRestart();
      };
      field.appendChild(b);
    }
    const act = section('動作');
    add(act, '重置木樁（R）', (l) => l.resetField());
    add(act, '清空全部', (l) => l.clearAll());

    this.tuner = this.buildTuner(document.getElementById('lab-tuner'));
    this.readout = document.getElementById('lab-readout');
  }

  // 工具列上的開關狀態
  syncLab() {
    const g = this.game;
    const l = g.mini;
    if (!l || l.title !== '測試場') return;
    this.sandbagBtn.classList.toggle('on', l.sandbag);
    for (const b of this.timeBtns) b.classList.toggle('on', Number(b.dataset.scale) === g.labScale);
    this.freezeBtn.classList.toggle('on', !!g.labFrozen);
    this.hitboxBtn.classList.toggle('on', !!l.showHitbox);
    this.indBtn.classList.toggle('on', P.indicatorOn);
    this.koBtn.classList.toggle('on', P.koOn);
    this.eventBtn.classList.toggle('on', P.mapEvents);
    for (const b of document.querySelectorAll('#lab-tools [data-map]')) b.classList.toggle('on', b.dataset.map === (P.labMap || 'lab'));
    if (this.tuner) this.tuner.refresh();
  }

  showLab(on) {
    document.body.classList.toggle('lab-mode', on);
    if (on) this.syncLab();
    this.layoutStage();
  }

  // 每幀更新測試場的量測面板
  tick(fps) {
    const l = this.game.mini;
    if (!l || l.title !== '測試場' || !this.readout) return;
    const n = (v, d = 1) => (v === null || v === undefined ? '…' : v.toFixed(d));
    const hist = l.history.map((r, i) => `<div class="rec${i === 0 ? ' last' : ''}"><b>${r.tier}</b> ${r.by} → ${r.name}
      <span>初速 ${n(r.speed)} m/s</span><span>預計 ${n(r.expect)} m</span><span>實際 ${n(r.actual)} m${r.end ? `（${r.end}）` : ''}</span>
      <span>撞牆 ${r.walls} 次${r.walls ? `・最大 ${n(r.impact)} m/s` : ''}</span><span>停頓 ${r.hitstop} 幀</span></div>`).join('');
    const html = `<div class="ro-head"><b>擊退量測</b><span>${fps} fps・時間 ${this.game.labScale}×${this.game.labFrozen ? '・凍結中' : ''}</span></div>${hist || '<div class="rec">打一下木樁，這裡會顯示初速、滑行距離、撞牆速度。</div>'}`;
    if (html !== this.lastReadout) {
      this.lastReadout = html;
      this.readout.innerHTML = html;
    }
  }
}
