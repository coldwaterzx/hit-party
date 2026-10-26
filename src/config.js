// 所有可調參數。調整面板會直接改這個物件，並存進 localStorage，重新整理後保留。
// 數值對應《遊戲發想書 v0.2》§3。

export const DEFAULTS = {
  // ── 效果開關（A/B 比較用） ──
  hitstopOn: true,
  shakeOn: true,
  soundOn: true,
  koOn: true,
  flashOn: true,
  particlesOn: true,
  indicatorOn: true,
  enemiesAttack: true, // 投擲兵會丟球
  volume: 0.7,

  // ── 玩家 ──
  moveSpeed: 6.0,
  chargeMoveMult: 0.4,
  rollDistance: 3.2,
  rollTime: 0.3,
  rollIframe: 0.15,
  rollCooldown: 1.0,

  // ── 秒揮（點擊） ──
  tapRadius: 1.8,
  tapArcDeg: 180,
  tapDamage: 8,
  tapCooldown: 0.25, // 0.45 → 0.25（打擊遊戲試玩回報打擊間隔太久）
  hammerBuffer: 0.25, // 預先輸入：冷卻中按下的揮錘記住這麼久，冷卻一結束就出手
  tapAirtime: 0.95,
  tapHeight: 1.9,
  tapDrift: 0.6,

  // ── 蓄力揮（長按） ──
  chargeLv1: 0.25, // 按住超過這個時間才算蓄力，否則是秒揮
  chargeLv2: 0.55, // 0.7 → 0.55
  chargeLv3: 1.0, // 1.3 → 1.0
  chargeMax: 3.0, // 超過自動以 Lv3 揮出
  swingRadius: 2.4,
  swingArcDeg: 70,
  swingRecovery: 0.32, // 0.6 → 0.32
  flightMaxTime: 1.4, // 單次飛行最長秒數（安全上限）
  dmg1: 15,
  dmg2: 25,
  dmg3: 40,
  dist1: 4,
  dist2: 8,
  dist3: 14,
  arc1: 0.5,
  arc2: 0.9,
  arc3: 1.4,
  floatBonus: 1.3,

  // ── 重量 ──
  weightMedium: 0.7,
  weightHeavy: 0.4,

  // ── 撞擊 ──
  wallBonus: 0.5,
  wallStun: 1.5,
  bowlDamage: 8,

  // ── 打擊停頓（以 60fps 的幀數計） ──
  hitstopTap: 2,
  hitstop1: 3,
  hitstop2: 6,
  hitstop3: 10,
  hitstopWall: 5,

  // ── 鏡頭 ──
  camPitch: 56,
  camFov: 32,
  shake1: 0.06,
  shake2: 0.16,
  shake3: 0.32,
  shakeWall: 0.2,
  zoomPunch: 0.12,
  koSlowmo: 0.12,
  koDuration: 0.55,

  // ── 反彈投射物速度 ──
  reflect1: 14,
  reflect2: 20,
  reflect3: 28,

  // ── 撞球物理：被打飛的東西在地上滑行，撞牆照角度反彈，撞到別人把動量傳過去 ──
  friction: 20, // 滑行減速（m/s²）。擊退距離 distN 會換算成初速 √(2 × 減速 × 距離)
  wallRestitution: 0.75, // 撞牆反彈保留的速度比例（撞球的「庫邊」）
  bodyRestitution: 0.9, // 互撞時的彈性（1＝完全彈性）
  wallSplatSpeed: 11, // 撞牆時垂直牆面的速度超過這個值才算壁咚（停下來後會暈眩）
  slideStop: 0.8, // 滑行速度低於這個值就停下

  // ── 對戰 ──
  labMap: 'lab', // 測試場用哪張地圖
  map: 'city', // 'city' 超市停車場、'table' 巨大撞球桌、'ice' 冰湖、'pinball' 彈珠台、'rooftop' 頂樓
  spawnMinions: true, // 關掉的話場上只有玩家和 AI 對手
  items: true, // 道具賽：場上會掉道具箱
  mapEvents: true, // 地圖機關（停車場的車、撞球桌的母球、足球守門員…）
  itemEvery: 8, // 道具箱幾秒掉一個
  itemMax: 2, // 場上最多幾個道具箱
  itemTime: 8, // 道具效果幾秒
  itemValue: 2, // AI 覺得道具箱值幾分（越高越愛搶道具）
  bumperKick: 16, // 彈珠台彈跳柱把東西彈開的速度（m/s）
  stocks: 3, // 最後存活：每人幾條命
  eggRate: 1, // 搶寶：拿著金蛋每秒幾分
  eggSlow: 0.75, // 搶寶：拿著金蛋的移動速度倍率
  rivalCount: 3, // AI 對手人數（下一場生效）
  matchTime: 180, // 一場幾秒
  respawnTime: 3, // 被打出場後幾秒重生
  respawnShield: 1.5, // 重生後的無敵秒數
  creditTime: 8, // 打出去的東西在這幾秒內得分，都算最後打它的人
  minionCount: 5,
  heavyCount: 1,
  throwerCount: 1,
  goldEvery: 25, // 每隔幾秒出現一隻金色小兵（場上只會有一隻）
  // 得分：打出平台＝基本分；打進袋口再 × pocketMult；撞過牆再進袋（庫邊球）多加 cushionBonus
  minionPts: 1,
  throwerPts: 2,
  heavyPts: 3,
  goldPts: 5,
  pocketMult: 2,
  cushionBonus: 1,
  koPts: 3, // 把對手打出場（出界或進袋）
  koPenalty: 2, // 自己被打出場扣分（不會扣到負的）

  // ── 足球 ──
  soccerTime: 180, // 一場幾秒
  soccerSize: 2, // 每隊幾人（2 或 3）
  soccerWinGoals: 0, // 先進幾球就贏（0＝只看時間）
  ballKick: 1.5, // 足球的擊退距離倍率（比人飛得遠）

  // ── 本機雙人與合作 ──
  twoPlayers: false, // 2P 加入：對戰類是對手，合作、足球、曲棍球 2 打 2 是隊友
  coopAllies: 2, // 合作模式的 AI 隊友人數
  doorHP: 20, // 守超市：門的耐久
  coopLives: 10, // Boss 戰：全隊共用幾條命
  bossLives: 3, // Boss 戰：要把 Boss 打進袋口幾次
  escortGoal: 3, // 護送：送到幾台購物車就贏
  escortFail: 3, // 護送：弄丟幾台就輸
  relayTime: 90, // 接力挑戰：幾秒

  // ── 桌上曲棍球 ──
  hockeySize: 1, // 每邊幾人（1 或 2）
  hockeyPoints: 7, // 先得幾分就贏
  hockeySpeed: 16, // 揮錘打冰球的基本速度（m/s）
  hockeyMove: 1.35, // 移動速度倍率

  // ── 高爾夫 ──
  golfCourse: 'party', // 'party' 派對球場、'classic' 入門球場、'custom' 匯入的球場
  golfHoles: 9, // 打幾洞（3＝只打前 3 洞）
  golfRivals: 2, // AI 對手人數
  golfScoring: 'strokes', // 'strokes' 比總桿數、'order' 比完成順序
  golfHoleTime: 150, // 一洞最多幾秒
  golfAfterFirst: 30, // 第一個人進洞後，其他人還剩幾秒
  golfMaxOver: 6, // 一洞最多打到「標準桿＋這麼多桿」，超過就自動結束這一洞
  golfCupSpeed: 9, // 球比這個速度快就會滑過洞口（m/s）
  golfTap: 1.2, // 點一下（短推桿）的距離（m）
  golfDrive: 22, // 按滿（Lv3 門檻）最遠打幾公尺

  // ── AI 對手 ──
  aiAimError: 6, // 瞄準誤差（°）
  aiDodge: 0.5, // 看到威脅時翻滾閃避的機率
  aiAggro: 0.35, // 0＝只搶小怪，1＝很愛打對手
  aiThink: 0.4, // 多久重新評估一次目標（秒）
};

const STORAGE_KEY = 'hit-base-params-v1';

export const P = { ...DEFAULTS };

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  for (const k of Object.keys(DEFAULTS)) {
    if (typeof saved[k] === typeof DEFAULTS[k]) P[k] = saved[k];
  }
} catch {
  // localStorage 不可用時就用預設值
}

export function saveParams() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(P));
  } catch {
    // 忽略
  }
}

export function resetParams() {
  Object.assign(P, DEFAULTS);
  saveParams();
}

export function exportParams() {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = P[k];
  return JSON.stringify(out, null, 2);
}

// 段數顏色：0＝還沒到 Lv1
export const TIER_COLORS = [0x9a9a9a, 0xffffff, 0xffd23f, 0xff3b2f];
export const TIER_CSS = ['#bbbbbb', '#ffffff', '#ffd23f', '#ff4b3a'];

// 場上的小怪＝大家搶的「球」。mass：互撞時的質量（玩家 1.5）
export const FIGHTER_MASS = 1.5;
export const ENEMY_TYPES = {
  dummy: {
    name: '木樁', weight: 'medium', mass: 2, radius: 0.45, height: 1.3,
    color: 0xc8a26b, speed: 0, ai: 'none',
  },
  minion: {
    name: '小兵', weight: 'light', mass: 1, radius: 0.4, height: 0.9,
    color: 0x7bc96f, speed: 2.8, ai: 'wander',
  },
  gold: {
    name: '金色小兵', weight: 'light', mass: 1, radius: 0.38, height: 0.9,
    color: 0xffc928, speed: 3.4, ai: 'flee',
  },
  heavy: {
    name: '胖墩', weight: 'heavy', mass: 3, radius: 0.75, height: 1.5,
    color: 0xd9735b, speed: 1.6, ai: 'wander',
  },
  ball: {
    name: '足球', weight: 'light', mass: 0.8, radius: 0.55, height: 1.1,
    color: 0xffffff, speed: 0, ai: 'ball',
  },
  // 以下是模式、道具、機關、小遊戲用的物件（ai 'ball'＝自己不會動）
  crate: {
    name: '道具箱', weight: 'heavy', mass: 50, radius: 0.5, height: 1.1,
    color: 0xc98a3c, speed: 0, ai: 'crate',
  },
  egg: {
    name: '金蛋', weight: 'light', mass: 0.7, radius: 0.45, height: 1.0,
    color: 0xffc928, speed: 0, ai: 'egg',
  },
  keeper: {
    name: '守門員', weight: 'medium', mass: 3, radius: 0.6, height: 1.5,
    color: 0xf08a3c, speed: 3.2, ai: 'keeper',
  },
  cueball: {
    name: '母球', weight: 'medium', mass: 2.5, radius: 0.7, height: 1.4,
    color: 0xf7f4ea, speed: 0, ai: 'ball',
  },
  steel: {
    name: '鋼珠', weight: 'medium', mass: 2, radius: 0.5, height: 1.0,
    color: 0xc9d1db, speed: 0, ai: 'ball',
  },
  pin: {
    name: '球瓶', weight: 'light', mass: 0.6, radius: 0.3, height: 1.1,
    color: 0xf7f4ea, speed: 0, ai: 'ball',
  },
  bowlball: {
    name: '保齡球', weight: 'heavy', mass: 3.5, radius: 0.55, height: 1.1,
    color: 0x2f3f8f, speed: 0, ai: 'ball',
  },
  stone: {
    name: '冰壺', weight: 'heavy', mass: 2, radius: 0.5, height: 0.6,
    color: 0x8a8f96, speed: 0, ai: 'ball',
  },
  boss: {
    name: '胖墩王', weight: 'heavy', mass: 10, radius: 1.3, height: 2.6,
    color: 0x8a3fc4, speed: 2.2, ai: 'coop',
  },
  cart: {
    name: '購物車', weight: 'heavy', mass: 5, radius: 0.8, height: 1.3,
    color: 0xb8c0c8, speed: 0, ai: 'ball',
  },
  puck: {
    name: '冰球', weight: 'light', mass: 0.6, radius: 0.55, height: 0.3,
    color: 0x222222, speed: 0, ai: 'ball',
  },
  golfball: {
    name: '高爾夫球', weight: 'light', mass: 0.45, radius: 0.3, height: 0.6,
    color: 0xf7f7f7, speed: 0, ai: 'ball',
  },
  thrower: {
    name: '投擲兵', weight: 'light', mass: 1, radius: 0.4, height: 1.05,
    color: 0x6aa6e0, speed: 2.4, ai: 'ranged',
    keepDist: 7.5, atkWindup: 0.6, atkCooldown: 3.2, ballSpeed: 9,
  },
};

// AI 對手（第 0 個是玩家）
export const FIGHTERS = [
  { name: '你', color: 0xf2c14e, css: '#ffd23f' },
  { name: '阿紅', color: 0xe8505b, css: '#ff6b74' },
  { name: '阿藍', color: 0x3f7fe8, css: '#6aa2ff' },
  { name: '阿紫', color: 0xa45de0, css: '#c48bff' },
  { name: '阿粉', color: 0xff7fbf, css: '#ff9fd0' },
  { name: '阿青', color: 0x35c9c9, css: '#5fe3e3' },
];

// 2P 的樣子
export const PLAYER2 = { name: '2P', color: 0x7be07b, css: '#8dff6a' };

// 足球 2 打 2：藍隊（你＋阿藍）往右攻，紅隊（阿紅＋阿粉）往左攻
export const TEAMS = [
  { name: '藍隊', color: 0x3f7fe8, css: '#6aa2ff' },
  { name: '紅隊', color: 0xe8505b, css: '#ff6b74' },
];
export const SOCCER_LINEUP = [
  { fighter: 0, team: 0, kickoff: { x: -2.2, z: 0 } },
  { fighter: 2, team: 0, kickoff: { x: -7.5, z: 2.5 } },
  { fighter: 1, team: 1, kickoff: { x: 2.2, z: 0 } },
  { fighter: 4, team: 1, kickoff: { x: 7.5, z: -2.5 } },
];
// 3 打 3：藍隊多阿青，紅隊多阿紫
export const SOCCER_LINEUP_3 = [
  { fighter: 0, team: 0, kickoff: { x: -2.2, z: 0 } },
  { fighter: 2, team: 0, kickoff: { x: -7.5, z: 3 } },
  { fighter: 5, team: 0, kickoff: { x: -7.5, z: -3 } },
  { fighter: 1, team: 1, kickoff: { x: 2.2, z: 0 } },
  { fighter: 4, team: 1, kickoff: { x: 7.5, z: -3 } },
  { fighter: 3, team: 1, kickoff: { x: 7.5, z: 3 } },
];
