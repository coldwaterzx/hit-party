// 遊戲邏輯：角色（玩家＋AI 對手）、揮錘判定、撞球物理（滑行／反彈／互撞／袋口）、出界、
// 小怪 AI、投射物反彈、得分、打擊停頓與 K.O. 特寫。
//
// 「身體」（body）＝會被打飛的東西：小怪（this.units）和角色（this.fighters）共用同一套物理欄位
// （x, z, y, vx, vz, vy, r, mass, state, lastHitBy…），所以撞球連鎖可以在任何兩者之間發生。
import * as THREE from 'three';
import { P, ENEMY_TYPES, FIGHTERS, FIGHTER_MASS, TEAMS, SOCCER_LINEUP, SOCCER_LINEUP_3, PLAYER2, TIER_COLORS, TIER_CSS } from './config.js';
import { sfx, chargeStart, chargeUpdate, chargeStop } from './audio.js';
import { ARENA, MAP, POCKETS, POCKET_R, OBSTACLES, wallHit, offPlatform, clampWalk, groundY } from './world.js';
import { Items } from './items.js';
import { Hazards } from './hazards.js';
import { Bowling, Curling } from './minigames.js';
import { PartyGolf } from './golf.js';
import { COOP_CLASSES, COOP_MAPS } from './coop.js';
import { Lab } from './lab.js';
import { Match } from './match.js';
import {
  makePlayerMesh, makeEnemyMesh, makeBallMesh, makeShadow, makeStars, makeTelegraphLine, makeIndicator,
} from './units.js';

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const GRAVITY = 28;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const yawOf = (x, z) => Math.atan2(x, z);
const angDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const turnTo = (cur, target, maxStep) => cur + clamp(angDiff(target, cur), -maxStep, maxStep);

// 釋放物件樹底下的幾何與材質；標記 userData.shared 的共用資源略過
function disposeTree(root) {
  if (!root) return;
  root.traverse((c) => {
    if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose();
    const mats = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
    for (const m of mats) if (!m.userData.shared) m.dispose();
  });
}

// 不在場上（不能被打、不參與碰撞）的狀態
const GONE = new Set(['falling', 'sinking', 'out', 'spawning', 'carried']);
// 站在地上、會互相推擠的狀態
const UNIT_GROUNDED = new Set(['idle', 'windup', 'recover', 'down', 'stunned']);
const FIGHTER_GROUNDED = new Set(['normal', 'stunned']);
// 角色被打飛時的擊退倍率（小怪看 weight）
const FIGHTER_WEIGHT = 0.85;
// 特殊物件的擊退倍率（保齡球比較重但要滾得到球瓶、冰壺要剛好滑到大本營）
const TYPE_WEIGHT = { bowlball: 1.9, stone: 0.92, crate: 0, egg: 1, cueball: 1, steel: 1, pin: 1, golfball: 1, puck: 1 };
const MINI_MODES = new Set(['bowling', 'curling']);
// 由模式控制器（minigames.js、coop.js）負責生東西和計分的模式
const CTRL_MODES = new Set(['bowling', 'curling', 'golf', 'defense', 'boss', 'escort', 'relay', 'hockey', 'lab']);
// 合作模式：玩家（和 2P）跟 AI 隊友同一隊
const COOP_MODES = new Set(['defense', 'boss', 'escort', 'relay']);
// 小怪死了會自動重生的模式
const RESPAWN_MODES = new Set(['match', 'practice', 'egg', 'survival']);
// 合作模式的 AI 隊友（阿藍、阿青、阿紫、阿粉）
const ALLY_DEFS = [2, 5, 3, 4];
// 角色開場位置（第 0 個是玩家）
const SPAWNS = [
  { x: 0, z: 1.5 }, { x: -10, z: 0.6 }, { x: 10, z: 0.6 },
  { x: 0, z: -4.6 }, { x: -3.5, z: 5.0 }, { x: 7, z: 5.2 },
];

const SWING_TIME = 0.12;
const SWING_HIT_AT = 0.03; // 錘子掃到正前方的時間點
const TAP_HIT_AT = 0.085;

export class Game {
  constructor(world, fx, input) {
    this.world = world;
    this.scene = world.scene;
    this.camera = world.camera;
    this.fx = fx;
    this.input = input;
    this.units = [];
    this.fighters = [];
    this.balls = [];
    this.respawns = [];
    this.hitstopT = 0;
    this.timeScale = 1;
    this.koT = 0;
    this.koTarget = null;
    this.shakeAmp = 0;
    this.fovKick = 0;
    this.vignetteT = 0;
    this.time = 0;
    this.goldT = 0;
    this.mode = 'practice';
    this.autoPlayer = false; // 除錯用：玩家也交給 AI 操作（測平衡）
    this.cam = { x: world.camBase.x, z: world.camBase.z, zoom: 0 };
    this.stats = { hits: 0, wall: 0, ringout: 0, pocket: 0, bowl: 0, reflect: 0, ko: 0 };
    this.match = new Match();
    this.match.game = this;
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.ndc = new THREE.Vector2();
    this.tmp = new THREE.Vector3();
    this.proj = new THREE.Vector3();
    const $ = (id) => document.getElementById(id);
    this.dom = {
      canvas: $('c'),
      chargeFill: $('charge-fill'),
      chargeLabel: $('charge-label'),
      marks: [$('mark1'), $('mark2')],
      stats: $('stats'),
      vignette: $('hurt-vignette'),
      ko: $('ko-overlay'),
      koText: $('ko-text'),
      tags: $('tags'),
    };
    this.statsText = '';
    this.indArc = P.swingArcDeg;
    this.items = new Items(this);
    this.hazards = new Hazards(this);
    this.mini = null; // 模式控制器（小遊戲、合作、曲棍球、高爾夫、測試場）
    this.camZoom = 1; // 跟隨鏡頭的遠近（滾輪調）
    this.labScale = 1; // 測試場的時間倍率
    this.labFrozen = false; // 測試場凍結
    this.labStep = false; // 測試場：凍結中往前一格
    this.showHitbox = false; // 測試場：顯示判定範圍
    this.lastHitstop = 0; // 最近一次打擊停頓（幀），測試場量測用
    this.egg = null; // 搶寶模式的金蛋
    this.ball = null; // 足球
    this.setupFighters(0);
    this.resetRoster();
  }

  get player() {
    return this.fighters[0];
  }

  // ───────────────────────── 模式與場地 ─────────────────────────

  // mode：'match'＝對戰、'survival'＝最後存活、'egg'＝搶寶、'soccer'＝足球、'practice'＝練習、
  // 'bowling'／'curling'＝小遊戲（見 match.js、minigames.js）
  startMode(mode) {
    this.mode = mode;
    this.endKO();
    this.camZoom = mode === 'golf' ? 1.45 : 1; // 高爾夫鏡頭預設拉遠一點，看得到路線
    this.goalT = 0;
    if (this.mini && this.mini.stop) this.mini.stop();
    this.mini = null;
    this.input.twoPlayers = P.twoPlayers;
    const two = P.twoPlayers;
    if (mode === 'soccer') {
      this.world.setMap('soccer');
      let lineup = Number(P.soccerSize) === 3 ? SOCCER_LINEUP_3 : SOCCER_LINEUP;
      // 2P 當藍隊的隊友
      if (two) lineup = lineup.map((l, i) => (i === 1 ? { ...l, def: PLAYER2, pad: 1 } : l));
      this.setupFighters(0, lineup);
    } else if (COOP_MODES.has(mode) || mode === 'hockey') {
      this.world.setMap(COOP_MAPS[mode] || P.map);
      this.setupFighters(0, mode === 'hockey' ? this.hockeyLineup() : this.coopLineup());
    } else if (mode === 'lab') {
      this.world.setMap(P.labMap || 'lab');
      this.setupFighters(0);
    } else if (MINI_MODES.has(mode)) {
      this.world.setMap(mode === 'bowling' ? 'lane' : 'ice');
      this.setupFighters(0);
    } else if (mode === 'golf') {
      // 高爾夫：每個人各打各的球，球場由 golf.js 換洞時載入
      this.setupFighters(0, this.golfLineup());
    } else {
      this.world.setMap(P.map);
      const versus = mode === 'match' || mode === 'survival' || mode === 'egg';
      this.setupFighters(versus ? clamp(Math.round(P.rivalCount), 1, FIGHTERS.length - 1) : 0);
    }
    this.items.reset();
    this.hazards.reset();
    this.resetRoster();
    this.match.start(mode);
    if (mode === 'soccer') this.kickoff();
    if (mode === 'bowling') this.mini = new Bowling(this);
    if (mode === 'curling') this.mini = new Curling(this);
    if (mode === 'golf') this.mini = new PartyGolf(this);
    if (COOP_CLASSES[mode]) this.mini = new COOP_CLASSES[mode](this);
    if (mode === 'lab') this.mini = new Lab(this);
    this.labScale = 1;
    this.labFrozen = false;
    if (this.mini) this.mini.start();
    this.stats = { hits: 0, wall: 0, ringout: 0, pocket: 0, bowl: 0, reflect: 0, ko: 0 };
  }

  resetRoster() {
    for (const u of [...this.units]) this.removeUnit(u, false);
    for (const b of [...this.balls]) this.removeBall(b);
    this.respawns = [];
    this.ball = null;
    this.egg = null;
    if (CTRL_MODES.has(this.mode)) return;
    if (this.mode === 'soccer') {
      this.spawnUnit('ball', { x: 0, z: 0 }, true);
      // 地圖機關：兩邊各一個守門員
      if (P.mapEvents) for (const sx of [-1, 1]) this.spawnUnit('keeper', { x: sx * 11.9, z: 0 }, true);
      return;
    }
    if (this.mode === 'egg') this.spawnUnit('egg', { x: 0, z: 0 }, true);
    if (P.mapEvents && MAP.id === 'table') this.spawnUnit('cueball', this.safePoint(0.7, 2), true);
    if (this.mode === 'practice') {
      this.spawnUnit('dummy', { x: -7, z: 0.5 }, true);
      this.spawnUnit('dummy', { x: 7.5, z: -0.6 }, true);
    }
    const list = [];
    if (!P.spawnMinions) return;
    for (let i = 0; i < Math.round(P.minionCount); i++) list.push('minion');
    for (let i = 0; i < Math.round(P.heavyCount); i++) list.push('heavy');
    for (let i = 0; i < Math.round(P.throwerCount); i++) list.push('thrower');
    list.forEach((type, i) => this.respawns.push({ type, t: 0.3 + i * 0.2 }));
    this.goldT = P.goldEvery * 0.5;
  }

  clearEnemies() {
    for (const u of [...this.units]) if (u.type !== 'dummy') this.removeUnit(u, false);
    for (const b of [...this.balls]) this.removeBall(b);
    this.respawns = this.respawns.filter((r) => r.type === 'dummy');
  }

  // ───────────────────────── 角色 ─────────────────────────

  // lineup：足球模式的隊伍編排（見 config.js 的 SOCCER_LINEUP）；沒給就是玩家＋rivals 個 AI
  setupFighters(rivals, lineup = null) {
    for (const f of this.fighters) {
      this.scene.remove(f.mesh.group, f.shadow, f.ind.group, f.stars, f.bubble, f.hitbox);
      for (const o of [f.mesh.group, f.shadow, f.ind.group, f.stars, f.bubble, f.hitbox]) disposeTree(o);
      f.tag.remove();
    }
    this.fighters = [];
    if (lineup) {
      lineup.forEach((l, i) => this.fighters.push(this.createFighter(i, l.def || FIGHTERS[l.fighter], l.team, l.kickoff, l.pad ?? (i === 0 ? 0 : -1))));
    } else {
      // 2P 在對戰類模式是第一個對手
      for (let i = 0; i <= rivals; i++) {
        this.fighters.push(i === 1 && P.twoPlayers ? this.createFighter(1, PLAYER2, null, SPAWNS[1], 1) : this.createFighter(i));
      }
      if (rivals === 0 && P.twoPlayers && (this.mode === 'practice' || this.mode === 'lab')) this.fighters.push(this.createFighter(1, PLAYER2, null, SPAWNS[1], 1));
    }
  }

  // 合作模式：玩家、2P、AI 隊友都是藍隊（team 0）
  coopLineup() {
    const out = [{ def: FIGHTERS[0], team: 0, kickoff: { x: 0, z: 2 }, pad: 0 }];
    if (P.twoPlayers) out.push({ def: PLAYER2, team: 0, kickoff: { x: 1.5, z: 2 }, pad: 1 });
    for (let i = 0; i < clamp(Math.round(P.coopAllies), 0, 4); i++) {
      out.push({ def: FIGHTERS[ALLY_DEFS[i]], team: 0, kickoff: { x: -2 - i * 1.5, z: 3 }, pad: -1 });
    }
    return out;
  }

  // 桌上曲棍球：左邊藍隊（玩家＋2P 或 AI），右邊紅隊（AI）
  hockeyLineup() {
    const two = Number(P.hockeySize) === 2;
    const out = [{ def: FIGHTERS[0], team: 0, kickoff: { x: -7.5, z: two ? -2.5 : 0 }, pad: 0 }];
    if (two) out.push(P.twoPlayers ? { def: PLAYER2, team: 0, kickoff: { x: -9.5, z: 2.5 }, pad: 1 } : { def: FIGHTERS[2], team: 0, kickoff: { x: -9.5, z: 2.5 }, pad: -1 });
    out.push({ def: FIGHTERS[1], team: 1, kickoff: { x: 7.5, z: two ? 2.5 : 0 }, pad: -1 });
    if (two) out.push({ def: FIGHTERS[4], team: 1, kickoff: { x: 9.5, z: -2.5 }, pad: -1 });
    return out;
  }

  // 高爾夫：玩家（＋2P）＋AI 對手，大家各自一組（沒有隊伍）
  golfLineup() {
    const out = [{ def: FIGHTERS[0], team: null, kickoff: { x: 0, z: 0 }, pad: 0 }];
    if (P.twoPlayers) out.push({ def: PLAYER2, team: null, kickoff: { x: 0, z: 0 }, pad: 1 });
    for (let i = 0; i < clamp(Math.round(P.golfRivals), 0, 4); i++) out.push({ def: FIGHTERS[1 + i], team: null, kickoff: { x: 0, z: 0 }, pad: -1 });
    return out;
  }

  // 守超市的「援軍」強化：多一個 AI 隊友
  addAlly() {
    const n = this.fighters.filter((f) => !f.isHuman).length;
    if (n >= ALLY_DEFS.length) return;
    const f = this.createFighter(this.fighters.length, FIGHTERS[ALLY_DEFS[n]], 0, { x: 0, z: 2 }, -1);
    this.fighters.push(f);
    this.label(f.x, 2.5, f.z, `${f.name} 來幫忙了！`, f.css, 30);
  }

  // 站在地上（可以當目標）的東西
  solidGround(b) {
    return b.isFighter ? b.state === 'normal' || b.state === 'stunned' : UNIT_GROUNDED.has(b.state);
  }

  // pad：誰在操作（0＝1P、1＝2P、-1＝AI）
  createFighter(i, def = FIGHTERS[i], team = null, spawn = SPAWNS[i], pad = i === 0 ? 0 : -1) {
    const mesh = makePlayerMesh(def.color, team === null ? def.color : TEAMS[team].color);
    const shadow = makeShadow(0.4);
    const ind = makeIndicator();
    ind.group.visible = false;
    const stars = makeStars();
    stars.visible = false;
    // 護盾道具的泡泡
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 14), new THREE.MeshBasicMaterial({ color: 0x6aa2ff, transparent: true, opacity: 0.25, depthWrite: false }));
    bubble.visible = false;
    this.scene.add(mesh.group, shadow, ind.group, stars, bubble);
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = def.name;
    tag.style.color = def.css;
    this.dom.tags.appendChild(tag);
    const s = spawn;
    const face = yawOf(-s.x, -s.z) || Math.PI;
    return {
      isFighter: true, isHuman: pad >= 0, pad, id: i, name: def.name, color: def.color, css: def.css, team, home: { ...s },
      x: s.x, z: s.z, y: 0, vx: 0, vz: 0, vy: 0, r: 0.4, mass: FIGHTER_MASS,
      facing: face, visYaw: face, state: 'normal', t: 0,
      holding: false, charging: false, holdT: 0, tier: 0, bufferT: 0,
      tapCd: 0, swingCd: 0, rollCd: 0, rollT: 0, rollYaw: 0, iframe: 0, shieldT: 0, flashT: 0,
      anim: { kind: 'rest', t: 0 }, pop: null, sink: null, tumble: 0, cushions: 0, slideAge: 0,
      lastHitBy: null, lastHitT: -99, wallStun: false, bowled: false,
      score: 0, kos: 0, falls: 0, stocks: P.stocks, eliminated: false, outAt: 0, eggT: 0, tagText: '',
      fx: { big: 0, rapid: 0, magnet: 0, bouncy: 0, heavy: 0, shield: 0, anchor: 0 },
      ai: { plan: null, thinkT: rand(0, 0.3), dodgeCd: 0, prevHammer: false, tapLock: 0, side: Math.random() < 0.5 ? 1 : -1, bestDc: Infinity, stuckT: 0, ban: null },
      mesh, shadow, ind, stars, tag, bubble,
    };
  }

  respawnFighter(f) {
    const p = (this.mini && this.mini.respawnPoint && this.mini.respawnPoint(f)) || this.safePoint(0.4, 2);
    Object.assign(f, {
      x: p.x, z: p.z, y: 0, vx: 0, vz: 0, vy: 0, state: 'normal', t: 0,
      shieldT: P.respawnShield, iframe: P.respawnShield, lastHitBy: null, anim: { kind: 'rest', t: 0 },
    });
    f.ai.plan = null;
    f.mesh.group.scale.setScalar(1);
    this.fx.ring(f.x, f.z, 1.6, f.color, 0.35, 0.12);
    this.fx.dust(f.x, f.z, 10);
    sfx.spawn();
  }

  // 找一個離角色和小怪都有點距離、不在障礙物裡的點
  safePoint(r, keep) {
    for (let i = 0; i < 50; i++) {
      const x = rand(-10.5, 10.5);
      const z = rand(-5.5, 5.5);
      if (wallHit(x, z, r + 0.5)) continue;
      if (POCKETS.some((p) => Math.hypot(p.x - x, p.z - z) < POCKET_R + 0.8)) continue;
      if (this.bodies().some((b) => Math.hypot(b.x - x, b.z - z) < keep + b.r)) continue;
      return { x, z };
    }
    return { x: rand(-8, 8), z: rand(-4, 4) };
  }

  // ───────────────────────── 小怪 ─────────────────────────

  spawnUnit(type, at = null, instant = false) {
    const def = ENEMY_TYPES[type];
    const p = at ? { ...at } : this.safePoint(def.radius, 3);
    const mesh = makeEnemyMesh(type, def);
    const shadow = makeShadow(def.radius);
    const stars = makeStars();
    stars.visible = false;
    this.scene.add(mesh.group, shadow, stars);
    const face = Math.random() * TAU;
    const u = {
      isFighter: false, isBall: type === 'ball' || type === 'puck', type, def, x: p.x, z: p.z, y: instant ? 0 : 9, vx: 0, vz: 0, vy: 0,
      r: def.radius, mass: def.mass, state: instant ? 'idle' : 'spawning', t: 0,
      facing: face, visYaw: face, cd: rand(1.5, 3), flashT: 0, jitter: 0,
      home: type === 'dummy' || type === 'keeper' ? { x: p.x, z: p.z } : null, idleT: 0, knocked: false, carrier: null, strafe: Math.random() < 0.5 ? 1 : -1,
      wander: null, wanderT: 0, pop: null, sink: null, tumble: 0, cushions: 0, slideAge: 0,
      lastHitBy: null, lastHitT: -99, wallStun: false, bowled: false, atkYaw: 0, atkTarget: null,
      mesh, shadow, stars, teleLine: null,
    };
    this.units.push(u);
    if (type === 'ball') this.ball = u;
    if (type === 'egg') this.egg = u;
    if (!instant) sfx.spawn();
    return u;
  }

  removeUnit(u, respawn) {
    this.scene.remove(u.mesh.group, u.shadow, u.stars);
    if (u.teleLine) this.scene.remove(u.teleLine);
    if (u.tele) this.scene.remove(u.tele);
    // 釋放這個單位自己的幾何與材質（共用的眼睛資源不釋放），避免長時間遊玩記憶體一直漲
    for (const o of [u.mesh.group, u.shadow, u.stars, u.teleLine, u.tele]) disposeTree(o);
    const i = this.units.indexOf(u);
    if (i >= 0) this.units.splice(i, 1);
    if (u === this.koTarget) this.koTarget = null;
    for (const f of this.fighters) if (f.ai.plan && f.ai.plan.target === u) f.ai.plan = null;
    if (respawn) {
      if (u.type === 'dummy' || u.type === 'keeper') this.respawns.push({ type: u.type, t: 1.2, at: u.home });
      else if (u.type === 'egg') this.respawns.push({ type: 'egg', t: 2, at: { x: 0, z: 0 } });
      else if (u.type === 'cueball' && P.mapEvents) this.respawns.push({ type: 'cueball', t: 3 });
      else if (['minion', 'heavy', 'thrower'].includes(u.type) && P.spawnMinions && RESPAWN_MODES.has(this.mode)) this.respawns.push({ type: u.type, t: 1.5 });
    }
  }

  updateRespawns(dt) {
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      const r = this.respawns[i];
      r.t -= dt;
      if (r.t <= 0) {
        this.respawns.splice(i, 1);
        this.spawnUnit(r.type, r.at || null);
      }
    }
    // 金色小兵：場上沒有時，每隔一段時間出現一隻
    if (P.spawnMinions && P.goldEvery > 0 && RESPAWN_MODES.has(this.mode) && !this.units.some((u) => u.type === 'gold')) {
      this.goldT -= dt;
      if (this.goldT <= 0) {
        this.goldT = P.goldEvery;
        const g = this.spawnUnit('gold');
        this.label(g.x, 3, g.z, '金色小兵出現！', '#ffd23f', 26);
      }
    }
  }

  // ───────────────────────── 共用工具 ─────────────────────────

  bodies() {
    return [...this.units, ...this.fighters.filter((f) => f.state !== 'out')];
  }

  // 可以被錘子打到、會參與碰撞的身體
  solid(b) {
    return !GONE.has(b.state) && b.y < 1.2;
  }

  weightMult(b) {
    if (this.mini && this.mini.weight) {
      const w = this.mini.weight(b);
      if (w !== undefined) return w;
    }
    if (b.isFighter) return FIGHTER_WEIGHT * (b.fx.anchor > 0 ? 0.15 : b.fx.heavy > 0 ? 0.35 : 1);
    if (b.isBall) return P.ballKick;
    if (b.type in TYPE_WEIGHT) return TYPE_WEIGHT[b.type];
    if (b.def.weight === 'heavy') return P.weightHeavy;
    if (b.def.weight === 'medium') return P.weightMedium;
    return 1;
  }

  // 打擊停頓／震動：跟玩家有關的事件照原本強度，AI 之間的事件減弱，免得畫面一直卡
  hitstop(frames, full = true) {
    if (!P.hitstopOn || frames <= 0) return;
    const f = full ? frames : Math.round(frames * 0.35);
    if (f > 0) this.hitstopT = Math.max(this.hitstopT, f / 60);
    if (full) {
      this.lastHitstop = f;
      if (this.mini && this.mini.onHitstop) this.mini.onHitstop(f);
    }
  }

  shake(amount, full = true) {
    if (!P.shakeOn) return;
    this.shakeAmp = Math.max(this.shakeAmp, full ? amount : amount * 0.3);
  }

  // 蓄力門檻（秒）；f 有「連發錘」時減半
  lv(n, f = null) {
    return P[`chargeLv${n}`] * (f && f.fx.rapid > 0 ? 0.45 : 1) * (f ? this.buff(f, 'charge') : 1);
  }

  tierOf(t, f = null) {
    if (t >= this.lv(3, f)) return 3;
    if (t >= this.lv(2, f)) return 2;
    if (t >= this.lv(1, f)) return 1;
    return 0;
  }

  // 巨錘：判定範圍、擊退距離
  reachMult(f) {
    return (f.fx.big > 0 ? 1.4 : 1) * this.buff(f, 'reach');
  }

  // 模式給的全隊強化（守超市）
  buff(f, key) {
    return this.mini && this.mini.buff ? this.mini.buff(f, key) : 1;
  }

  // 滑行減速倍率：地圖（冰湖）× 冰面道具 × 彈力球化
  frictionMult(b) {
    const zone = (this.mini && this.mini.frictionAt ? this.mini.frictionAt(b) : 1) * (MAP.grid ? MAP.grid.friction(b.x, b.z) : 1); // 沙坑、長草、冰面
    return MAP.friction * this.items.frictionMult() * (b.bouncy ? 0.35 : 1) * (b.type === 'puck' ? 0.06 : 1) * zone;
  }

  label(x, y, z, text, color = '#fff', size = 26) {
    this.fx.text(x, y, z, text, { color, size, cls: 'label', life: 1.0 });
  }

  flash(b, tier = 0) {
    if (P.flashOn) b.flashT = 0.07;
    b.jitter = 0.05 + 0.03 * tier;
  }

  // 最近打過它、而且還在得分時限內的角色
  credit(b) {
    return b.lastHitBy && this.time - b.lastHitT < P.creditTime ? b.lastHitBy : null;
  }

  // 被打斷時收起攻擊預警、蓄力
  interrupt(b) {
    if (b.isFighter) {
      this.cancelCharge(b);
      b.anim = { kind: 'rest', t: 0 };
      b.rollT = 0;
    } else if (b.teleLine) {
      b.teleLine.visible = false;
    }
  }

  // ───────────────────────── 主更新 ─────────────────────────

  update(realDt) {
    const inp = this.input.poll(0);
    const inp2 = P.twoPlayers ? this.input.poll(1) : null;
    if (inp.startPressed && this.mode === 'practice') this.resetRoster();
    // 對戰時間到：收掉蓄力和 K.O. 特寫，main.js 會停住遊戲直到玩家選擇
    if (this.match.update(realDt, this.fighters)) {
      for (const f of this.fighters) this.cancelCharge(f);
      if (this.koT > 0) this.endKO();
      return;
    }

    if (this.koT > 0) {
      this.koT -= realDt;
      this.timeScale = P.koSlowmo;
      if (this.koT <= 0) this.endKO();
    }
    let dt;
    if (this.hitstopT > 0) {
      this.hitstopT -= realDt;
      dt = 0;
    } else {
      dt = realDt * this.timeScale * this.labScale;
    }
    this.time += dt;
    // 進球後慶祝一下再開球（用真實時間）
    if (this.goalT > 0) {
      this.goalT -= realDt;
      if (this.goalT <= 0) this.kickoff();
    }

    for (const f of this.fighters) {
      const ctrl = f.isHuman && !this.autoPlayer ? this.humanCtrl(f, f.pad === 1 && inp2 ? inp2 : inp) : this.aiCtrl(f, dt);
      this.updateFighter(f, dt, ctrl);
      // 這一幀剛打中：其他東西立刻凍結，不要先多動一步
      if (this.hitstopT > 0) dt = 0;
    }
    for (const u of [...this.units]) this.updateUnit(u, dt);
    this.items.update(dt);
    this.hazards.update(dt, realDt);
    this.updateEgg(dt);
    if (this.mini && this.mini.update) this.mini.update(dt);
    this.separate();
    this.checkSurvival();
    for (const b of [...this.balls]) this.updateBall(b, dt);
    this.updateRespawns(dt);
    this.fx.update(dt, realDt);
    this.syncVisuals(dt, realDt);
    this.updateCamera(realDt);
    this.updateHud(realDt);
  }

  // ───────────────────────── 角色操作 ─────────────────────────

  mouseGround() {
    // 畫面可能被縮放、平移（測試場），用畫布實際在螢幕上的位置換算
    const r = this.dom.canvas.getBoundingClientRect();
    this.ndc.set(((this.input.mouse.x - r.left) / r.width) * 2 - 1, -((this.input.mouse.y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.groundPlane.constant = -groundY(this.player.x, this.player.z); // 高爾夫球場有起伏
    return this.raycaster.ray.intersectPlane(this.groundPlane, this.tmp);
  }

  // 玩家的輸入換成跟 AI 一樣格式的指令
  humanCtrl(p, inp) {
    let aim = null;
    if (inp.padAim) aim = yawOf(inp.padAim.x, inp.padAim.z);
    else if (inp.usingMouse && p.pad === 0) {
      const g = this.mouseGround();
      if (g && Math.hypot(g.x - p.x, g.z - p.z) > 0.3) aim = yawOf(g.x - p.x, g.z - p.z);
    }
    return { move: inp.move, aim, hammer: inp.hammer, hammerPressed: inp.hammerPressed, rollPressed: inp.rollPressed };
  }

  updateFighter(f, dt, ctrl) {
    f.tapCd = Math.max(0, f.tapCd - dt);
    f.swingCd = Math.max(0, f.swingCd - dt);
    f.rollCd = Math.max(0, f.rollCd - dt);
    f.iframe = Math.max(0, f.iframe - dt);
    f.shieldT = Math.max(0, f.shieldT - dt);
    f.flashT = Math.max(0, f.flashT - dt);

    switch (f.state) {
      case 'out':
        f.t -= dt;
        if (f.t <= 0) this.respawnFighter(f);
        return;
      case 'popped':
        this.stepPop(f, dt);
        return;
      case 'sliding':
        this.stepSlide(f, dt);
        return;
      case 'falling':
        this.stepFall(f, dt);
        return;
      case 'sinking':
        this.stepSink(f, dt);
        return;
      case 'stunned':
        f.t -= dt;
        if (f.t <= 0) f.state = 'normal';
        return;
      default:
        break;
    }

    const moving = Math.hypot(ctrl.move.x, ctrl.move.z) > 0.05;
    const moveYaw = moving ? yawOf(ctrl.move.x, ctrl.move.z) : null;

    if (f.rollT > 0) {
      f.rollT -= dt;
      const sp = P.rollDistance / P.rollTime;
      f.x += Math.sin(f.rollYaw) * sp * dt;
      f.z += Math.cos(f.rollYaw) * sp * dt;
      if (dt > 0 && Math.random() < 0.4) this.fx.dust(f.x, f.z, 1, 0xd8c9a8, 0.4);
    } else {
      const a = f.anim;
      const busy = (a.kind === 'swing' && a.t < 0.14) || (a.kind === 'tap' && a.t < 0.12);
      const carrying = this.egg && this.egg.carrier === f;
      const modeMove = this.mini && this.mini.moveMult ? this.mini.moveMult(f) : 1; // 曲棍球移動比較快
      const speed = P.moveSpeed * (f.charging ? P.chargeMoveMult : 1) * (busy ? 0.35 : 1) * (carrying ? P.eggSlow : 1) * modeMove;
      f.x += ctrl.move.x * speed * dt;
      f.z += ctrl.move.z * speed * dt;

      // 面向：有瞄準輸入（滑鼠／右搖桿／AI 瞄準）就看瞄準方向，否則看移動方向
      if (f.charging || !busy) {
        const y = ctrl.aim ?? moveYaw;
        if (y !== null) f.facing = y;
      }

      if (ctrl.rollPressed && f.rollCd <= 0) {
        this.cancelCharge(f);
        f.rollT = P.rollTime;
        f.rollYaw = moveYaw ?? f.facing;
        f.iframe = Math.max(f.iframe, P.rollIframe);
        f.rollCd = P.rollCooldown;
        if (f.isHuman) sfx.roll();
      } else {
        // 預先輸入：冷卻中按下的揮錘先記住，冷卻一結束就開始（還按著就蓄力，已經放開就直接秒揮）
        if (ctrl.hammerPressed) f.bufferT = P.hammerBuffer;
        // 還按著就一直記住（硬直 0.32 秒比緩衝 0.25 秒長，以前按太早又按住會被吃掉）
        else if (!ctrl.hammer) f.bufferT = Math.max(0, f.bufferT - dt);
        if (f.bufferT > 0 && !busy && f.swingCd <= 0 && !f.holding) {
          if (ctrl.hammer) {
            f.bufferT = 0;
            f.holding = true;
            f.holdT = 0;
            f.tier = 0;
          } else if (f.tapCd <= 0) {
            f.bufferT = 0;
            this.startTap(f);
          }
        }
        if (f.holding) {
          if (ctrl.hammer) {
            f.holdT += dt;
            if (!f.charging && f.holdT >= this.lv(1, f)) {
              f.charging = true;
              if (f === this.player) chargeStart();
            }
            if (f.charging) {
              const tier = this.tierOf(f.holdT, f);
              if (tier > f.tier) {
                f.tier = tier;
                if (f.isHuman) sfx.tierUp(tier);
                this.fx.ring(f.x, f.z, 1.1, TIER_COLORS[tier], 0.25, 0.1);
              }
              if (f === this.player) chargeUpdate(f.holdT, f.tier);
              if (f.holdT >= P.chargeMax) this.releaseHammer(f);
            }
          } else {
            this.releaseHammer(f);
          }
        }
      }
    }

    clampWalk(f, f.r);
    // 模式限制能走的範圍（小遊戲的投擲線、乒乓的半場）
    const L = this.mini && this.mini.walkLimit ? this.mini.walkLimit(f) : null;
    if (L) {
      f.x = clamp(f.x, L.minX ?? -Infinity, L.maxX ?? Infinity);
      f.z = clamp(f.z, L.minZ ?? -Infinity, L.maxZ ?? Infinity);
    }
    this.bumperTouch(f);
    this.updateHammerAnim(f, dt);
  }

  cancelCharge(f) {
    if (f.charging && f === this.player) chargeStop();
    f.holding = false;
    f.charging = false;
    f.holdT = 0;
    f.tier = 0;
  }

  releaseHammer(f) {
    const wasCharging = f.charging;
    const holdT = f.holdT;
    const tier = Math.max(1, f.tier);
    this.cancelCharge(f);
    if (!wasCharging) {
      if (f.tapCd > 0) {
        f.bufferT = P.hammerBuffer; // 秒揮還在冷卻：記住，冷卻結束就出手
        return;
      }
      this.startTap(f);
    } else {
      f.swingCd = P.swingRecovery;
      f.anim = { kind: 'swing', t: 0, hit: false, yaw: f.facing, tier, holdT };
      sfx.whiff(tier);
    }
  }

  startTap(f) {
    f.tapCd = P.tapCooldown;
    f.anim = { kind: 'tap', t: 0, hit: false, yaw: f.facing };
  }

  updateHammerAnim(f, dt) {
    const a = f.anim;
    if (a.kind === 'rest') return;
    a.t += dt;
    if (a.kind === 'tap') {
      if (!a.hit && a.t >= TAP_HIT_AT) {
        a.hit = true;
        this.doTap(f, a.yaw);
      }
      if (a.t >= 0.36) f.anim = { kind: 'rest', t: 0 };
    } else if (a.kind === 'swing') {
      if (!a.hit && a.t >= SWING_HIT_AT) {
        a.hit = true;
        this.doSwing(f, a.tier, a.yaw, a.holdT);
      }
      if (a.t >= 0.42) f.anim = { kind: 'rest', t: 0 };
    }
  }

  // 錘子掃得到的身體。正在無敵（翻滾、剛重生）的角色會跳「閃避！」
  targetsInArc(f, yaw, radius, half) {
    const out = [];
    for (const b of this.bodies()) {
      if (b === f || !this.solid(b) && b.state !== 'popped') continue;
      if (b.isFighter && f.team !== null && b.team === f.team) continue; // 足球：不打自己隊友
      if (GONE.has(b.state)) continue;
      const dx = b.x - f.x;
      const dz = b.z - f.z;
      const d = Math.hypot(dx, dz);
      if (d > radius + b.r) continue;
      if (d > 0.35 && Math.abs(angDiff(yawOf(dx, dz), yaw)) > half + Math.atan2(b.r, d)) continue;
      if (b.isFighter && b.iframe > 0) {
        this.label(b.x, 1.8, b.z, '閃避！', '#7fe0ff', 22);
        continue;
      }
      if (b.isFighter && b.fx.shield > 0) {
        this.shieldBlock(b, f);
        continue;
      }
      out.push(b);
    }
    return out;
  }

  ballsInArc(f, yaw, radius, half) {
    return this.balls.filter((b) => {
      if (!['thrown', 'popped', 'ground'].includes(b.state)) return false;
      const dx = b.x - f.x;
      const dz = b.z - f.z;
      const d = Math.hypot(dx, dz);
      if (d > radius + b.r + 0.2) return false;
      return d < 0.4 || Math.abs(angDiff(yawOf(dx, dz), yaw)) <= half + 0.3;
    });
  }

  // 秒揮：前方半圓，往上擊飛
  doTap(f, yaw) {
    const half = (P.tapArcDeg / 2) * D2R;
    const radius = P.tapRadius * this.reachMult(f);
    const targets = this.targetsInArc(f, yaw, radius, half);
    const balls = this.ballsInArc(f, yaw, radius, half);
    const fx = f.x + Math.sin(yaw) * 0.9;
    const fz = f.z + Math.cos(yaw) * 0.9;
    const full = f.isHuman || targets.some((t) => t.isHuman);

    if (P.indicatorOn && f.isHuman) this.fx.sector(f.x, 0.05, f.z, yaw - half, yaw + half, 0.3, radius, 0xffffff, 0.16, 0.35);
    this.fx.ring(fx, fz, 1.4, f.isHuman ? 0xfff2c0 : f.color, 0.22, 0.12);
    this.fx.dust(fx, fz, 8);

    for (const t of targets) {
      if (t.type === 'crate') {
        this.items.breakCrate(t, f);
        continue;
      }
      this.flash(t, 0);
      this.popUp(t, yawOf(t.x - f.x, t.z - f.z), f);
      this.fx.spark(t.x, 0.6, t.z, 0, 0, 6, 0xffffff, 5);
    }
    for (const b of balls) this.popBall(b);

    if (targets.length || balls.length) {
      sfx.tap();
      this.hitstop(P.hitstopTap, full);
      this.shake(0.05, full);
      this.stats.hits += targets.length;
    } else if (f.isHuman) {
      sfx.tapGround();
      this.shake(0.025);
    }
  }

  // 蓄力揮：前方扇形，水平擊退（滑行）
  doSwing(f, tier, yaw, holdT = 0) {
    const half = (P.swingArcDeg / 2) * D2R;
    const radius = P.swingRadius * this.reachMult(f);
    const targets = this.targetsInArc(f, yaw, radius, half);
    const balls = this.ballsInArc(f, yaw, radius, half);
    // 高爾夫：距離照按住的時間連續變化（swingDist）
    const base = this.mini && this.mini.swingDist ? this.mini.swingDist(f, tier, holdT) : P[`dist${tier}`];
    const dist = base * (f.fx.big > 0 ? 1.5 : 1) * this.buff(f, 'dist');
    const peak = P[`arc${tier}`];
    const color = TIER_COLORS[tier];
    const full = f.isHuman || targets.some((t) => t.isHuman);

    // 揮擊殘影
    this.fx.sector(f.x, 0.85, f.z, yaw - 1.35, yaw + 1.35, 0.7, 1.75, color, 0.13, 0.5 + 0.12 * tier);

    for (const t of targets) {
      if (t.type === 'crate') {
        this.items.breakCrate(t, f);
        continue;
      }
      let distMul = 1;
      let tag = null;
      if (t.state === 'popped' || t.state === 'sliding') {
        distMul = P.floatBonus;
        tag = t.state === 'popped' ? '浮空追擊！' : '追擊！';
      }
      this.flash(t, tier);
      const toT = yawOf(t.x - f.x, t.z - f.z);
      const launchYaw = yaw + clamp(angDiff(toT, yaw), -0.3, 0.3) * 0.5;
      this.launch(t, launchYaw, dist * this.weightMult(t) * distMul, peak, tier, f);
      if (tag && full) this.label(t.x, t.y + 2.0, t.z, tag, '#7fe0ff', 24);
      this.fx.spark(t.x, 0.7, t.z, Math.sin(launchYaw), Math.cos(launchYaw), 6 + tier * 6, color, 8 + tier * 3);
      this.fx.spark(t.x, 0.7, t.z, Math.sin(launchYaw), Math.cos(launchYaw), 3 + tier * 2, 0xffffff, 10 + tier * 3);
      if (tier === 3) this.fx.star(t.x, 0.9, t.z, 0xffe14d, 3.2);
      else if (tier === 2) this.fx.star(t.x, 0.9, t.z, 0xffffff, 1.8);
    }
    for (const b of balls) this.reflectBall(b, yaw, tier, f);

    const n = targets.length + balls.length;
    if (n > 0) {
      sfx.clang(tier);
      this.hitstop(P[`hitstop${tier}`], full);
      this.shake(P[`shake${tier}`], full);
      if (tier === 3 && full) this.fovKick = Math.max(this.fovKick, P.zoomPunch);
      const cx = f.x + Math.sin(yaw) * 1.4;
      const cz = f.z + Math.cos(yaw) * 1.4;
      this.fx.ring(cx, cz, 1.2 + tier * 0.8, color, 0.3, 0.1);
      this.stats.hits += targets.length;
    } else if (f.isHuman) {
      this.shake(P[`shake${tier}`] * 0.15);
    }
  }

  // ───────────────────────── 撞球物理 ─────────────────────────

  // 秒揮：垂直擊飛（浮空），落地後可以追擊
  popUp(b, yaw, by) {
    // 冰球：秒揮是輕推；高爾夫球：秒揮是短推桿
    if (b.type === 'puck' || b.type === 'golfball') {
      this.launch(b, yaw, b.type === 'golfball' ? P.golfTap : 1, b.type === 'golfball' ? 0 : 0.2, 0, by);
      return;
    }
    this.chainHit(b, by);
    this.interrupt(b);
    if (b.type === 'pin') b.knocked = true;
    if (b.isFighter && b.fx.anchor > 0) {
      // 錨：挑不起來，只會頓一下
      b.state = 'stunned';
      b.t = 0.15;
      this.label(b.x, 1.9, b.z, '錨！', '#7be07b', 22);
      return;
    }
    const heavy = !b.isFighter && b.def.weight === 'heavy';
    const w = this.weightMult(b);
    b.state = 'popped';
    b.vx = 0;
    b.vz = 0;
    b.pop = {
      t: 0,
      T: heavy ? 0.4 : P.tapAirtime * (w < 1 ? 0.85 : 1),
      h: heavy ? 0.35 : P.tapHeight * (w < 1 ? 0.75 : 1),
      base: b.y,
      dx: Math.sin(yaw),
      dz: Math.cos(yaw),
      drift: P.tapDrift * w,
    };
    if (by) {
      b.lastHitBy = by;
      b.lastHitT = this.time;
    }
  }

  stepPop(b, dt) {
    const q = b.pop;
    q.t += dt;
    const k = clamp(q.t / q.T, 0, 1);
    b.y = q.base * (1 - k) + q.h * Math.sin(Math.PI * k);
    b.x += (q.dx * q.drift * dt) / q.T;
    b.z += (q.dz * q.drift * dt) / q.T;
    clampWalk(b, b.r);
    if (k >= 1) {
      b.y = 0;
      b.pop = null;
      b.state = b.isFighter ? 'stunned' : 'down';
      b.t = b.isFighter ? 0.25 : 0.35;
      this.fx.dust(b.x, b.z, 5);
      sfx.land();
    }
  }

  // 擊退：給一個初速在地上滑行，滑行距離剛好是 dist（初速 √(2 × 減速 × 距離)）
  launch(b, yaw, dist, peak, tier, by) {
    if (b.type === 'crate') return;
    if (this.mini && this.mini.adjustLaunch) yaw = this.mini.adjustLaunch(b, yaw, by); // 曲棍球的瞄準修正
    this.chainHit(b, by);
    this.interrupt(b);
    if (b.type === 'pin') b.knocked = true;
    // 彈力球化：被這個人打到的東西撞牆不減速、滑很遠
    b.bouncy = !!(by && by.isFighter && by.fx.bouncy > 0);
    let sp = Math.sqrt(2 * P.friction * Math.max(0.3, dist));
    // 冰球：速度看段數（幾乎不減速，所以不用距離換算）
    if (b.type === 'puck') sp = P.hockeySpeed * (0.65 + 0.2 * tier);
    b.state = 'sliding';
    b.pop = null;
    b.vx = Math.sin(yaw) * sp;
    b.vz = Math.cos(yaw) * sp;
    b.vy = peak > 0 ? Math.sqrt(2 * GRAVITY * peak) * 0.6 : 0;
    b.tier = tier;
    b.cushions = 0;
    b.slideAge = 0;
    b.bowled = false;
    b.wallStun = false;
    b.trailT = 0;
    b.lastHitBy = by;
    b.lastHitT = this.time;
    b.tumble = (Math.random() < 0.5 ? -1 : 1) * (6 + tier * 5);
    if (this.mini && this.mini.onLaunch) this.mini.onLaunch(b, { tier, sp, dist, by });
  }

  stepSlide(b, dt) {
    if (dt <= 0) return;
    b.slideAge += dt;
    if (b.y > 0 || b.vy > 0) {
      b.vy -= GRAVITY * dt;
      b.y = Math.max(0, b.y + b.vy * dt);
      if (b.y === 0) b.vy = 0;
    }
    let sp = Math.hypot(b.vx, b.vz);
    b.trailT -= dt;
    if (b.trailT <= 0 && sp > 4) {
      b.trailT = 0.03;
      this.fx.puff(b.x, b.y + 0.5, b.z, b.isFighter ? b.color : TIER_COLORS[b.tier || 1], 0.14 + 0.05 * (b.tier || 1));
    }

    let remain = sp * dt;
    let guard = 0;
    while (remain > 1e-6 && sp > 1e-3 && guard++ < 60) {
      const step = Math.min(remain, 0.12);
      remain -= step;
      const nx = b.x + (b.vx / sp) * step;
      const nz = b.z + (b.vz / sp) * step;
      const wall = wallHit(nx, nz, b.r, b.isBall);
      if (wall) {
        const before = sp;
        this.cushion(b, wall);
        sp = Math.hypot(b.vx, b.vz);
        remain *= sp / before;
        continue;
      }
      b.x = nx;
      b.z = nz;
      if (offPlatform(b.x, b.z)) {
        this.ringOut(b);
        return;
      }
      // 高爾夫球場的水池（飛在空中時不算）
      if (MAP.grid && b.y < 0.3 && MAP.grid.isWater(b.x, b.z)) {
        this.water(b);
        return;
      }
      // 保齡球道：球或球瓶滑進兩邊溝槽
      if (MAP.laneHalf && !b.isFighter && Math.abs(b.z) > MAP.laneHalf + 0.15) {
        this.gutter(b);
        return;
      }
      for (const p of POCKETS) {
        if (Math.hypot(p.x - b.x, p.z - b.z) < (p.r || POCKET_R) + (b.type === 'boss' ? 0.8 : 0)) {
          if (this.mini && this.mini.canSink && !this.mini.canSink(b, p)) continue; // 高爾夫：太快會滑過洞口
          this.sink(b, p);
          return;
        }
      }
      for (const o of this.bodies()) {
        if (o === b || !this.solid(o)) continue;
        if (Math.hypot(o.x - b.x, o.z - b.z) < o.r + b.r) {
          const before = sp;
          this.collide(b, o);
          sp = Math.hypot(b.vx, b.vz);
          remain *= before > 0 ? sp / before : 0;
        }
      }
    }

    // 坡度：球往低處滾（角色不受影響）
    const slope = MAP.grid && !b.isFighter && b.y < 0.3 ? MAP.grid.slopeAccel(b.x, b.z) : null;
    if (slope) {
      b.vx += slope.x * dt;
      b.vz += slope.z * dt;
    }
    // 摩擦力：線性減速
    sp = Math.hypot(b.vx, b.vz);
    const fr = P.friction * this.frictionMult(b);
    let ns = Math.max(0, sp - fr * dt);
    if (sp > 0) {
      b.vx *= ns / sp;
      b.vz *= ns / sp;
    }
    // 坡太陡（往下的力比摩擦力大）就不會停
    const steep = slope && slope.mag > fr * 0.6;
    if ((ns < P.slideStop && !steep) || b.slideAge > (P.flightMaxTime * 2) / this.frictionMult(b) + (slope ? 8 : 0)) this.stopSlide(b);
  }

  // 撞牆、撞柱、撞車：照角度反彈（撞球的庫邊）。撞得夠用力就是壁咚，停下來後會暈眩
  cushion(b, n) {
    const vn = b.vx * n.nx + b.vz * n.nz;
    // 推出牆外
    b.x = n.cx + n.nx * (b.r + 0.01);
    b.z = n.cz + n.nz * (b.r + 0.01);
    if (vn >= 0) return;
    const e = b.bouncy ? 1 : b.type === 'puck' ? 0.92 : P.wallRestitution;
    b.vx -= (1 + e) * vn * n.nx;
    b.vz -= (1 + e) * vn * n.nz;
    b.cushions++;
    if (this.mini && this.mini.onImpact) this.mini.onImpact(b, -vn);
    if (n.obstacle && n.obstacle.bumper) {
      this.bumperKick(b, n.obstacle);
      return;
    }
    const impact = -vn;
    const full = b.isHuman || (b.lastHitBy && b.lastHitBy.isHuman);
    if (b.isBall) {
      if (impact > 4) sfx.land();
      this.fx.dust(n.cx, n.cz, 3);
    } else if (impact >= P.wallSplatSpeed) {
      b.wallStun = true;
      this.flash(b, 2);
      this.label(b.x, (b.isFighter ? 1.3 : b.def.height) + 1.1, b.z, '壁咚！', '#ffb03a', 30);
      this.fx.debris(n.cx, 0.7, n.cz, n.nx, n.nz, 12);
      this.fx.star(n.cx, 0.8, n.cz, 0xffb03a, 2);
      sfx.wall();
      this.hitstop(P.hitstopWall, full);
      this.shake(P.shakeWall, full);
      this.stats.wall++;
    } else {
      this.fx.dust(n.cx, n.cz, 4);
      if (impact > 4) sfx.land();
    }
  }

  // 兩個身體互撞：沿著連心線交換動量（質量越大越難推）
  collide(a, o) {
    if (a.type === 'puck' && o.isFighter) return; // 曲棍球：冰球碰到人由 coop.js 的球拍效果處理
    if (o.isFighter && o.iframe > 0) return; // 翻滾中穿過去
    if (o.type === 'crate') {
      // 撞破道具箱：道具給打出這顆球的人
      this.items.breakCrate(o, a.isFighter ? null : a.lastHitBy);
      a.vx *= 0.6;
      a.vz *= 0.6;
      return;
    }
    if (o.type === 'pin') o.knocked = true;
    const dx = o.x - a.x;
    const dz = o.z - a.z;
    const d = Math.hypot(dx, dz) || 1e-4;
    const nx = dx / d;
    const nz = dz / d;
    // 先把 o 推開，避免卡在一起
    const ov = a.r + o.r - d;
    if (ov > 0) {
      o.x += nx * ov;
      o.z += nz * ov;
      clampWalk(o, o.r);
    }
    const rel = (a.vx - o.vx) * nx + (a.vz - o.vz) * nz;
    if (rel <= 0) return;
    const j = ((1 + P.bodyRestitution) * rel) / (1 / a.mass + 1 / o.mass);
    a.vx -= (j / a.mass) * nx;
    a.vz -= (j / a.mass) * nz;
    o.vx += (j / o.mass) * nx;
    o.vz += (j / o.mass) * nz;
    const osp = Math.hypot(o.vx, o.vz);
    if (o.state !== 'sliding') {
      if (osp > P.slideStop * 1.5) {
        this.interrupt(o);
        o.state = 'sliding';
        o.pop = null;
        o.vy = Math.min(4, osp * 0.25);
        o.tier = Math.max(1, (a.tier || 1) - 1);
        o.cushions = 0;
        o.slideAge = 0;
        o.bowled = false;
        o.wallStun = false;
        o.trailT = 0;
        o.tumble = (Math.random() < 0.5 ? -1 : 1) * 8;
      } else {
        o.vx = 0;
        o.vz = 0;
      }
    }
    // 得分算給打出第一顆球的人
    if (a.lastHitBy) {
      o.chain = a.chain || 1;
      o.lastHitBy = a.lastHitBy;
      o.lastHitT = this.time;
    }
    this.flash(o, 1);
    const full = a.isHuman || o.isHuman || (a.lastHitBy && a.lastHitBy.isHuman);
    if (!a.bowled && rel > 4) {
      a.bowled = true;
      if (full) this.label(o.x, 2.0, o.z, '撞球！', '#c6ff7a', 26);
      this.stats.bowl++;
    }
    this.fx.spark((a.x + o.x) / 2, 0.7, (a.z + o.z) / 2, nx, nz, 8, 0xffffff, 7);
    if (rel > 3) sfx.bowl();
    this.hitstop(2, full);
    this.shake(Math.min(0.15, 0.01 * rel), full);
  }

  stopSlide(b) {
    if (this.mini && this.mini.onStop) this.mini.onStop(b);
    b.bouncy = false;
    b.vx = 0;
    b.vz = 0;
    b.vy = 0;
    b.y = 0;
    if (b.isFighter) {
      b.state = 'stunned';
      b.t = b.wallStun ? P.wallStun * 0.5 : 0.25;
    } else if (b.isBall || b.def.ai === 'ball' || b.def.ai === 'egg') {
      b.state = 'idle';
    } else {
      b.state = b.wallStun ? 'stunned' : 'down';
      if (b.type === 'boss' && b.wallStun) {
        b.t = 3.5;
        this.label(b.x, 3.4, b.z, '暈了！快推進袋口！', '#ffd23f', 34);
        return;
      }
      b.t = b.wallStun ? P.wallStun : 0.35;
    }
    b.wallStun = false;
    this.fx.dust(b.x, b.z, 6);
  }

  // 出界：掉下停車場平台
  ringOut(b) {
    if (this.mini && this.mini.onGone) this.mini.onGone(b, 'ringout');
    b.state = 'falling';
    b.vx *= 0.55;
    b.vz *= 0.55;
    b.vy = 4;
    this.label(b.x, 1.8, b.z, '出界！', '#ff6b3a', 34);
    sfx.ringOut();
    this.stats.ringout++;
    this.score(b, 'ringout');
  }

  // 進袋：滑過袋口就掉進去
  sink(b, p) {
    if (this.mini && this.mini.onGone) this.mini.onGone(b, 'pocket');
    b.state = 'sinking';
    b.sink = { x0: b.x, z0: b.z, x: p.x, z: p.z, t: 0 };
    this.label(p.x, 1.6, p.z, b.cushions > 0 ? '庫邊進袋！' : '進袋！', '#7fe0ff', 34);
    this.fx.ring(p.x, p.z, 1.8, 0x7fe0ff, 0.35, 0.14);
    sfx.ringOut();
    this.stats.pocket++;
    this.score(b, 'pocket');
  }

  stepFall(b, dt) {
    b.vy -= GRAVITY * dt;
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    b.y += b.vy * dt;
    if (b.y < MAP.fallY) {
      this.fx.splash(b.x, MAP.fallY, b.z);
      this.gone(b);
    }
  }

  stepSink(b, dt) {
    const s = b.sink;
    s.t += dt;
    const k = clamp(s.t / 0.35, 0, 1);
    b.x = lerp(s.x0, s.x, k);
    b.z = lerp(s.z0, s.z, k);
    b.y = -1.4 * k * k;
    if (k >= 1) this.gone(b);
  }

  // 掉進高爾夫球場的水池：交給模式處理（球回到上一桿的位置），角色等一下重生
  water(b) {
    this.fx.splash(b.x, groundY(b.x, b.z) + 0.1, b.z);
    sfx.ringOut();
    if (this.mini && this.mini.onWater && this.mini.onWater(b)) return;
    if (b.isFighter) {
      this.label(b.x, 2, b.z, '落水！', '#7fd0ff', 26);
      this.gone(b);
    } else {
      this.removeUnit(b, true);
    }
  }

  // 保齡球道的溝槽：滑進去就沒了
  gutter(b) {
    b.state = 'sinking';
    const side = Math.sign(b.z) || 1;
    b.sink = { x0: b.x, z0: b.z, x: b.x + b.vx * 0.05, z: side * (MAP.laneHalf + 0.35), t: 0 };
    if (b.type === 'bowlball') this.label(b.x, 1.6, b.z, '洗溝！', '#c0c0c0', 30);
  }

  // 掉出場外：小怪移除後重生；角色等幾秒重生
  gone(b) {
    if (b.isFighter) {
      b.state = 'out';
      b.t = P.respawnTime;
      this.cancelCharge(b);
      // 最後存活：命用完就淘汰，不再重生
      if (this.mode === 'survival' && b.stocks <= 0) {
        b.eliminated = true;
        b.outAt = this.time;
        b.t = Infinity;
        this.label(0, 3, 0, `${b.name} 淘汰！`, b.css, 40);
      }
    } else {
      this.removeUnit(b, true);
    }
  }

  // 得分：出界＝基本分；進袋 × pocketMult；庫邊進袋再加分。角色被打出場：打的人加分、自己扣分
  score(b, how) {
    const pocket = how === 'pocket';
    const atk = this.credit(b);
    const human = this.player;
    if (this.mini && this.mini.onScore && this.mini.onScore(b, how, atk)) return;
    if (MINI_MODES.has(this.mode)) return;
    if (b.isFighter) {
      b.falls++;
      if (this.mode === 'survival' || this.mode === 'egg' || this.mode === 'soccer') {
        // 這幾個模式被打出場不扣分：最後存活扣命、搶寶掉蛋
        if (this.mode === 'survival') {
          b.stocks = Math.max(0, b.stocks - 1);
          if (b.stocks > 0) this.fx.text(b.x, 2.4, b.z, `${b.name} 剩 ${b.stocks} 條命`, { color: '#ff6b6b', size: 24, life: 1.2 });
        }
        if (atk && atk !== b) {
          atk.kos++;
          this.stats.ko++;
          if (this.mode === 'survival') atk.score++;
        }
        if (P.koOn && (b === human || atk === human)) this.startKO(b, b === human ? '被擊落…' : '擊落！');
        else this.hitstop(6, false);
        return;
      }
      const lost = Math.min(b.score, P.koPenalty);
      b.score -= lost;
      if (lost > 0) this.fx.text(b.x, 2.4, b.z, `${b.name} -${lost}`, { color: '#ff6b6b', size: 24, life: 1.2 });
      if (atk && atk !== b) {
        atk.score += P.koPts;
        atk.kos++;
        this.stats.ko++;
        this.fx.text(b.x, 3.0, b.z, `${atk.name} +${P.koPts}`, { color: atk.css, size: atk.isHuman ? 42 : 30, cls: 'big', life: 1.3 });
        if (atk.isHuman) sfx.coin(true);
      }
      if (P.koOn && (b === human || atk === human)) this.startKO(b, b === human ? '被擊落…' : '擊落！');
      else this.hitstop(6, false);
      return;
    }
    if (this.mode !== 'match' && this.mode !== 'practice') return;
    const base = P[`${b.type}Pts`] || 0;
    const tier = b.tier || 1;
    if (base > 0 && atk) {
      const bank = pocket && b.cushions > 0 ? P.cushionBonus : 0;
      const pts = base * (pocket ? P.pocketMult : 1) + bank;
      atk.score += pts;
      this.fx.text(b.x, 2.6, b.z, `${atk.isHuman ? '' : `${atk.name} `}+${pts}`, { color: atk.css, size: atk.isHuman ? (pts >= 5 ? 50 : 36) : 26, cls: 'big', life: 1.3 });
      if (atk.isHuman) sfx.coin(pts >= 5);
    }
    if (P.koOn && atk === human && !pocket && tier >= 3) this.startKO(b, '全壘打！');
    else if (atk === human) {
      this.hitstop(6);
      this.shake(0.2);
    }
  }

  // 站著的東西互相推開（重的推不太動）
  separate() {
    const list = [
      ...this.units.filter((u) => UNIT_GROUNDED.has(u.state)),
      ...this.fighters.filter((f) => FIGHTER_GROUNDED.has(f.state)),
    ];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const ov = a.r + b.r - d;
        if (ov > 0 && d > 1e-4) {
          // 高爾夫球不能用走路推（只會把人推開）
          const ka = a.type === 'golfball' ? 0 : b.type === 'golfball' ? 1 : b.mass / (a.mass + b.mass);
          a.x -= (dx / d) * ov * ka;
          a.z -= (dz / d) * ov * ka;
          b.x += (dx / d) * ov * (1 - ka);
          b.z += (dz / d) * ov * (1 - ka);
          this.heavyShove(a, b, dx / d, dz / d);
          this.heavyShove(b, a, -dx / d, -dz / d);
        }
      }
    }
    for (const b of list) clampWalk(b, b.r);
  }

  // ───────────────────────── 小怪 AI ─────────────────────────

  updateUnit(u, dt) {
    u.flashT = Math.max(0, u.flashT - dt);
    if (u.isBall) this.checkGoal(u);
    switch (u.state) {
      case 'spawning':
        u.vy -= 30 * dt;
        u.y += u.vy * dt;
        if (u.y <= 0) {
          u.y = 0;
          u.vy = 0;
          u.state = 'idle';
          this.fx.ring(u.x, u.z, 1.3, 0xffffff, 0.25, 0.1);
          this.fx.dust(u.x, u.z, 10);
          sfx.land();
        }
        break;
      case 'idle':
        // 停在陡坡上的球會自己滾下去
        if (MAP.grid && dt > 0 && u.def.ai === 'ball') {
          const s = MAP.grid.slopeAccel(u.x, u.z);
          if (s && s.mag > P.friction * this.frictionMult(u) * 0.6) {
            this.slideBody(u, s.x * 0.05, s.z * 0.05, u.lastHitBy);
            break;
          }
        }
        this.unitAi(u, dt);
        break;
      case 'windup':
        u.t -= dt;
        this.updateTelegraph(u);
        if (u.t <= 0) this.resolveAttack(u);
        break;
      case 'recover':
      case 'down':
      case 'stunned':
        u.t -= dt;
        if (u.t <= 0) {
          u.state = 'idle';
          u.idleT = 0;
        }
        break;
      case 'popped':
        this.stepPop(u, dt);
        break;
      case 'sliding':
        this.stepSlide(u, dt);
        break;
      case 'falling':
        this.stepFall(u, dt);
        break;
      case 'sinking':
        this.stepSink(u, dt);
        break;
      default:
        break;
    }
  }

  nearestFighter(x, z, maxD = Infinity) {
    let best = null;
    let bd = maxD;
    for (const f of this.fighters) {
      if (!FIGHTER_GROUNDED.has(f.state)) continue;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  walk(u, mx, mz, speed, dt) {
    const len = Math.hypot(mx, mz);
    if (len < 1e-4) return;
    u.x += (mx / len) * speed * dt;
    u.z += (mz / len) * speed * dt;
    u.facing = turnTo(u.facing, yawOf(mx, mz), 8 * dt);
    clampWalk(u, u.r);
  }

  wanderStep(u, dt, speed) {
    u.wanderT -= dt;
    if (!u.wander || u.wanderT <= 0 || Math.hypot(u.wander.x - u.x, u.wander.z - u.z) < 0.4) {
      u.wander = { x: rand(-10.5, 10.5), z: rand(-5.5, 5.5) };
      u.wanderT = rand(2, 4);
      // 偶爾停一下
      if (Math.random() < 0.3) u.wanderT = -rand(0.5, 1.5);
    }
    if (u.wanderT < 0) return;
    this.walk(u, u.wander.x - u.x, u.wander.z - u.z, speed, dt);
  }

  unitAi(u, dt) {
    const d = u.def;
    if (this.mini && this.mini.unitAi && this.mini.unitAi(u, dt)) return;
    if (d.ai === 'ball' || d.ai === 'crate' || d.ai === 'egg' || d.ai === 'coop') return;
    if (d.ai === 'keeper') {
      this.keeperAi(u, dt);
      return;
    }
    u.cd = Math.max(0, u.cd - dt);
    u.idleT += dt;

    if (d.ai === 'none') {
      // 木樁：被打離原位一陣子後慢慢走回去
      const hx = u.home.x - u.x;
      const hz = u.home.z - u.z;
      const hd = Math.hypot(hx, hz);
      if (hd > 0.2 && u.idleT > 2.0) {
        const s = Math.min(hd, 2.2 * dt);
        u.x += (hx / hd) * s;
        u.z += (hz / hd) * s;
      }
      return;
    }

    if (d.ai === 'wander') {
      this.wanderStep(u, dt, d.speed * 0.45);
      return;
    }

    if (d.ai === 'flee') {
      // 金色小兵：有人靠近就逃
      const f = this.nearestFighter(u.x, u.z, 5.5);
      if (f) this.walk(u, u.x - f.x + rand(-0.3, 0.3), u.z - f.z + rand(-0.3, 0.3), d.speed, dt);
      else this.wanderStep(u, dt, d.speed * 0.5);
      return;
    }

    // 投擲兵：跟最近的角色保持距離，朝牠丟球
    const f = this.nearestFighter(u.x, u.z);
    if (!f) {
      this.wanderStep(u, dt, d.speed * 0.5);
      return;
    }
    const dx = f.x - u.x;
    const dz = f.z - u.z;
    const dist = Math.hypot(dx, dz) || 1e-4;
    let mx = 0;
    let mz = 0;
    if (dist < d.keepDist - 1.5) {
      mx = -dx;
      mz = -dz;
    } else if (dist > d.keepDist + 1.5) {
      mx = dx;
      mz = dz;
    } else {
      mx = -dz * u.strafe;
      mz = dx * u.strafe;
      if (Math.random() < dt * 0.3) u.strafe *= -1;
    }
    this.walk(u, mx, mz, d.speed * (dist > d.keepDist - 1.5 && dist < d.keepDist + 1.5 ? 0.5 : 1), dt);
    u.facing = turnTo(u.facing, yawOf(dx, dz), 8 * dt);
    if (u.cd <= 0 && P.enemiesAttack && dist < 14) {
      u.state = 'windup';
      u.t = d.atkWindup;
      u.atkTarget = f;
      u.atkYaw = yawOf(dx, dz);
      if (!u.teleLine) {
        u.teleLine = makeTelegraphLine(11);
        this.scene.add(u.teleLine);
      }
      u.teleLine.visible = true;
    }
  }

  updateTelegraph(u) {
    const k = 1 - clamp(u.t / u.def.atkWindup, 0, 1);
    const f = u.atkTarget;
    if (k < 0.7 && f && f.state !== 'out') u.atkYaw = yawOf(f.x - u.x, f.z - u.z);
    u.facing = u.atkYaw;
    u.teleLine.position.set(u.x, 0.035, u.z);
    u.teleLine.rotation.y = u.atkYaw;
    u.teleLine.material.opacity = 0.25 + 0.4 * k;
  }

  resolveAttack(u) {
    if (u.teleLine) u.teleLine.visible = false;
    this.spawnBall(u);
    u.state = 'recover';
    u.t = 0.35;
    u.cd = u.def.atkCooldown * rand(0.8, 1.2);
  }

  // ───────────────────────── 道具、機關、模式 ─────────────────────────

  // 主選單背景：換地圖、擺幾隻小怪
  preview(map, minions) {
    this.endKO();
    if (this.mini && this.mini.stop) this.mini.stop();
    this.mini = null;
    this.mode = 'practice';
    this.world.setMap(map);
    if (this.fighters.length !== 1 || this.fighters[0].team !== null) this.setupFighters(0);
    for (const u of [...this.units]) this.removeUnit(u, false);
    for (const b of [...this.balls]) this.removeBall(b);
    this.respawns = [];
    this.items.reset();
    this.hazards.reset();
    const p = this.player;
    const s = this.safePoint(0.4, 1);
    Object.assign(p, { x: s.x, z: s.z, y: 0, vx: 0, vz: 0, state: 'normal' });
    if (minions) for (let i = 0; i < 4; i++) this.spawnUnit('minion', null, true);
  }

  // 測試場：秒揮（白）和蓄力揮（黃）的判定範圍
  syncHitbox(f) {
    const on = this.showHitbox && f.state !== 'out';
    if (!on) {
      if (f.hitbox) f.hitbox.visible = false;
      return;
    }
    if (!f.hitbox) {
      const g = new THREE.Group();
      const mat = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
      g.userData.tap = new THREE.Mesh(new THREE.BufferGeometry(), mat(0xffffff));
      g.userData.swing = new THREE.Mesh(new THREE.BufferGeometry(), mat(0xffd23f));
      g.add(g.userData.tap, g.userData.swing);
      this.scene.add(g);
      f.hitbox = g;
    }
    const g = f.hitbox;
    const sector = (mesh, deg, r, y) => {
      const key = `${deg}|${r.toFixed(2)}`;
      if (mesh.userData.key === key) return;
      mesh.userData.key = key;
      const half = (deg / 2) * D2R;
      const geo = new THREE.CircleGeometry(r, 40, -Math.PI / 2 - half, half * 2);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, y, 0);
      mesh.geometry.dispose();
      mesh.geometry = geo;
    };
    sector(g.userData.tap, Math.min(359, P.tapArcDeg), P.tapRadius * this.reachMult(f), 0.05);
    sector(g.userData.swing, P.swingArcDeg, P.swingRadius * this.reachMult(f), 0.06);
    g.visible = true;
    g.position.set(f.x, groundY(f.x, f.z), f.z);
    g.rotation.y = f.facing;
  }

  // 直接給一個速度讓它滑（曲棍球的球拍效果用）
  slideBody(b, vx, vz, by) {
    this.interrupt(b);
    Object.assign(b, {
      state: 'sliding', pop: null, vx, vz, vy: 0, tier: 1, cushions: 0, slideAge: 0,
      bowled: false, wallStun: false, trailT: 0, lastHitBy: by, lastHitT: this.time,
    });
  }

  // 接力：還在飛的東西被「另一個隊友」接著打，接力數 +1；不然從 1 開始算
  chainHit(b, by) {
    const flying = b.state === 'sliding' || b.state === 'popped';
    const prev = b.lastHitBy;
    const relay = flying && by && by.isFighter && prev && prev.isFighter && prev !== by && by.team !== null && prev.team === by.team;
    b.chain = relay ? (b.chain || 1) + 1 : 1;
    if (relay && this.mode === 'relay') this.label(b.x, 2.4, b.z, `接力 ×${b.chain}`, '#7fe0ff', 24);
  }

  // 護盾：擋掉這一下，打的人反被彈開
  shieldBlock(b, attacker) {
    b.fx.shield = 0;
    this.label(b.x, 2, b.z, '護盾！', '#6aa2ff', 30);
    this.fx.ring(b.x, b.z, 1.6, 0x6aa2ff, 0.3, 0.15);
    sfx.clang(2);
    if (attacker.state === 'normal' && attacker.iframe <= 0) {
      this.launch(attacker, yawOf(attacker.x - b.x, attacker.z - b.z), 3.5 * this.weightMult(attacker), 0.5, 1, b);
    }
  }

  // 重量化：走路撞到別人，把對方撞飛
  heavyShove(a, b, nx, nz) {
    if (!a.isFighter || !(a.fx.heavy > 0) || b.type === 'crate' || (b.isFighter && b.fx.heavy > 0)) return;
    if ((b.shoveT || 0) > this.time || (b.isFighter && b.iframe > 0)) return;
    if (a.team !== null && b.isFighter && b.team === a.team) return;
    b.shoveT = this.time + 0.6;
    this.flash(b, 1);
    this.launch(b, yawOf(nx, nz), 4.5 * this.weightMult(b), 0.5, 1, a);
    sfx.bowl();
  }

  // 彈珠台：撞到彈跳柱就被大力彈開
  bumperKick(b, o) {
    const sp = Math.hypot(b.vx, b.vz) || 1;
    const k = Math.max(sp, P.bumperKick) / sp;
    b.vx *= k;
    b.vz *= k;
    b.slideAge = 0;
    o.flashUntil = performance.now() + 160;
    this.fx.ring(o.x, o.z, o.rad + 0.8, o.color || 0xffffff, 0.25, 0.15);
    this.label(o.x, 1.6, o.z, '叮！', '#ffffff', 22);
    sfx.pop();
    this.hitstop(2, b.isHuman || (b.lastHitBy && b.lastHitBy.isHuman));
  }

  // 走路碰到彈跳柱也會被彈開
  bumperTouch(f) {
    if (f.state !== 'normal' || (f.bumpT || 0) > this.time) return;
    for (const o of OBSTACLES) {
      if (!o.bumper) continue;
      const d = Math.hypot(f.x - o.x, f.z - o.z);
      if (d > o.rad + f.r + 0.06) continue;
      f.bumpT = this.time + 0.5;
      o.flashUntil = performance.now() + 160;
      this.launch(f, yawOf(f.x - o.x, f.z - o.z), 3 * this.weightMult(f), 0.5, 1, f.lastHitBy);
      sfx.pop();
      return;
    }
  }

  // 守門員：在自己球門前左右移動擋球
  keeperAi(u, dt) {
    const tz = this.ball ? clamp(this.ball.z, -MAP.goalHalf + 0.6, MAP.goalHalf - 0.6) : 0;
    const dx = u.home.x - u.x;
    const dz = tz - u.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.1) this.walk(u, dx, dz, u.def.speed * Math.min(1, d), dt);
    u.facing = u.home.x < 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  // 搶寶：拿著金蛋的人每秒得分，被打到就掉蛋
  updateEgg(dt) {
    const e = this.egg;
    if (this.mode !== 'egg' || !e || !this.units.includes(e)) return;
    const c = e.carrier;
    if (c) {
      if (c.state !== 'normal') {
        this.dropEgg(c);
      } else {
        e.x = c.x;
        e.z = c.z;
        e.y = 1.9;
        c.eggT += dt * P.eggRate;
        while (c.eggT >= 1) {
          c.eggT -= 1;
          c.score++;
        }
        return;
      }
    }
    if (!UNIT_GROUNDED.has(e.state)) return;
    for (const f of this.fighters) {
      if (f.state !== 'normal' || (f.eggCd || 0) > this.time) continue;
      if (Math.hypot(f.x - e.x, f.z - e.z) > f.r + e.r + 0.25) continue;
      e.carrier = f;
      e.state = 'carried';
      this.label(f.x, 2.6, f.z, `${f.name} 拿到金蛋！`, f.css, 28);
      if (f.isHuman) sfx.coin(true);
      break;
    }
  }

  dropEgg(c) {
    const e = this.egg;
    e.carrier = null;
    c.eggCd = this.time + 0.8;
    Object.assign(e, { state: 'idle', x: c.x, z: c.z, y: 0 });
    const sp = Math.hypot(c.vx, c.vz);
    this.launch(e, sp > 0.5 ? yawOf(c.vx, c.vz) : Math.random() * TAU, 3, 0.8, 1, null);
    this.label(c.x, 2.4, c.z, '金蛋掉了！', '#ffd23f', 26);
  }

  // 搶寶 AI：拿著蛋就逃，蛋在地上就去撿，被別人拿走就去打他
  eggPlan(f) {
    const e = this.egg;
    if (!e || !this.units.includes(e)) return { target: null, goal: { x: 0, z: 0 } };
    if (e.carrier === f) {
      const o = this.fighters.filter((x) => x !== f && x.state === 'normal')
        .sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0];
      let gx = 0;
      let gz = 0;
      if (o) {
        const dx = f.x - o.x;
        const dz = f.z - o.z;
        const d = Math.hypot(dx, dz) || 1;
        gx = f.x + (dx / d) * 4;
        gz = f.z + (dz / d) * 4;
      }
      // 別逃到平台邊緣旁邊
      const S = MAP.sides;
      gx = clamp(gx, ARENA.minX + (S.l ? 3 : 1.2), ARENA.maxX - (S.r ? 3 : 1.2));
      gz = clamp(gz, ARENA.minZ + (S.t ? 3 : 1.2), ARENA.maxZ - (S.b ? 3 : 1.2));
      return { target: null, goal: { x: gx, z: gz } };
    }
    if (e.carrier) {
      const plan = this.makePlan(f, [e.carrier]);
      if (plan.target) return plan;
      return { target: null, goal: { x: e.carrier.x, z: e.carrier.z } };
    }
    return { target: null, goal: { x: e.x, z: e.z } };
  }

  // 最後存活：只剩一個人（或玩家被淘汰）就結束
  checkSurvival() {
    if (this.mode !== 'survival' || this.match.overlay) return;
    const alive = this.fighters.filter((f) => !f.eliminated);
    if (alive.length <= 1 || this.player.eliminated) this.match.finish(this.fighters);
  }

  // ───────────────────────── 足球 ─────────────────────────

  // 開球：球回中圈，所有人回到自己的位置
  kickoff() {
    this.goalT = 0;
    this.endKO();
    // 先進 N 球就贏
    if (P.soccerWinGoals > 0 && Math.max(...this.match.goals) >= P.soccerWinGoals) {
      this.match.finish(this.fighters);
      return;
    }
    for (const u of this.units) {
      if (u.type !== 'keeper') continue;
      Object.assign(u, { x: u.home.x, z: u.home.z, y: 0, vx: 0, vz: 0, state: 'idle', pop: null });
    }
    const b = this.ball;
    if (b) {
      Object.assign(b, { x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, state: 'idle', pop: null, lastHitBy: null });
      b.lastX = 0;
      b.lastZ = 0;
    }
    for (const f of this.fighters) {
      this.cancelCharge(f);
      Object.assign(f, {
        x: f.home.x, z: f.home.z, y: 0, vx: 0, vz: 0, vy: 0, state: 'normal', t: 0, rollT: 0,
        facing: f.team === 0 ? Math.PI / 2 : -Math.PI / 2, anim: { kind: 'rest', t: 0 }, pop: null,
      });
      f.ai.plan = null;
    }
    for (const bl of [...this.balls]) this.removeBall(bl);
    this.label(0, 2.5, 0, '開球！', '#ffffff', 34);
    sfx.spawn();
  }

  // 球整顆越過球門線就算進球。左邊球門是藍隊（team 0）守的
  checkGoal(u) {
    if (this.mode !== 'soccer' || this.goalT > 0 || !MAP.goalHalf) return;
    if (Math.abs(u.x) - u.r * 0.5 <= ARENA.maxX) return;
    const team = u.x < 0 ? 1 : 0;
    this.match.goals[team]++;
    this.goalT = 2.5;
    const by = this.credit(u);
    const own = by && by.team !== team;
    const who = by ? `${by.name}${own ? '（烏龍球）' : ''}` : TEAMS[team].name;
    this.fx.text(u.x, 3.2, u.z, `${TEAMS[team].name} 進球！`, { color: TEAMS[team].css, size: 48, cls: 'big', life: 2 });
    this.fx.text(u.x, 2.2, u.z, who, { color: by ? by.css : '#fff', size: 28, life: 2 });
    this.fx.ring(u.x, u.z, 3, TEAMS[team].color, 0.5, 0.2);
    this.fx.spark(u.x, 1, u.z, -Math.sign(u.x), 0, 30, TEAMS[team].color, 10);
    if (by && !own) by.score++;
    sfx.stageClear();
    if (P.koOn) this.startKO(u, own ? '烏龍球！' : '進球！');
  }

  // 足球 AI：同隊離球比較近的去搶球、往對方球門打；另一個看球在哪半場，回防或往前接應
  soccerPlan(f) {
    const ball = this.ball;
    const dir = f.team === 0 ? 1 : -1; // 進攻方向
    if (!ball || GONE.has(ball.state)) return { target: null, goal: { ...f.home } };
    const err = (Math.random() * 2 - 1) * P.aiAimError * D2R;
    const dBall = (o) => Math.hypot(o.x - ball.x, o.z - ball.z);
    const mate = this.fighters.find((o) => o !== f && o.team === f.team);
    const myD = dBall(f);
    const mateD = mate && FIGHTER_GROUNDED.has(mate.state) ? dBall(mate) : Infinity;
    const wasAttacker = f.ai.plan && f.ai.plan.target === ball;
    // 隊友是玩家時比較積極：玩家不一定會去搶球
    const margin = mate && mate.isHuman && !this.autoPlayer ? 2.0 : 0;
    const attack = myD < mateD - 0.8 + margin || (wasAttacker && myD < mateD + 0.8 + margin);
    if (attack) {
      const goal = { x: dir * (ARENA.maxX + 0.8), z: clamp(ball.z * 0.4, -MAP.goalHalf + 0.8, MAP.goalHalf - 0.8) };
      const L = Math.hypot(goal.x - ball.x, goal.z - ball.z);
      let tier = 3;
      for (let t = 1; t <= 3; t++) {
        if (P[`dist${t}`] * P.ballKick >= L + 1) {
          tier = t;
          break;
        }
      }
      return { target: ball, goal, tier, err };
    }
    // 對手快搶到球了：去把他撞開
    const opp = this.fighters
      .filter((o) => o.team !== f.team && o.state === 'normal' && o.iframe <= 0 && dBall(o) < 2.5)
      .sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0];
    if (opp && Math.hypot(opp.x - f.x, opp.z - f.z) < 4 && Math.random() < 0.3 + P.aiAggro) {
      const ax = opp.x - ball.x;
      const az = opp.z - ball.z;
      const al = Math.hypot(ax, az) || 1;
      return { target: opp, goal: { x: opp.x + (ax / al) * 6, z: opp.z + (az / al) * 6 }, tier: 2, err };
    }
    const ownX = -dir * ARENA.maxX;
    if (ball.x * dir < 1) {
      // 球在自己半場：站在球和自己球門之間
      return { target: null, goal: { x: lerp(ownX, ball.x, 0.45), z: ball.z * 0.6 } };
    }
    // 球在對方半場：往前、站到另一側接應
    return { target: null, goal: { x: clamp(ball.x + dir * 2.5, -11, 11), z: ball.z > 0 ? -3 : 3 } };
  }

  // ───────────────────────── AI 對手 ─────────────────────────
  // 跟玩家用同一套操作（移動、秒揮、蓄力、翻滾），只是指令由這裡產生。
  // 每隔 aiThink 秒評估一次：把哪個目標往哪個袋口／平台邊緣打最划算，然後走到「母球位置」蓄力出手。

  aiCtrl(f, dt) {
    const ai = f.ai;
    const ctrl = { move: { x: 0, z: 0 }, aim: null, hammer: false, hammerPressed: false, rollPressed: false };
    ai.dodgeCd = Math.max(0, ai.dodgeCd - dt);
    ai.tapLock = Math.max(0, ai.tapLock - dt);
    if (f.state !== 'normal' || f.rollT > 0 || this.goalT > 0) {
      ai.prevHammer = false;
      if (f.state !== 'normal') ai.plan = null;
      return ctrl;
    }
    if (this.mini && this.mini.aiCtrl) {
      const c = this.mini.aiCtrl(f, dt);
      if (c) return c;
    }

    // 閃避：看到有東西快撞上來、或有人對著自己蓄力，就翻滾
    if (ai.dodgeCd <= 0 && f.rollCd <= 0) {
      const threat = this.threatTo(f);
      if (threat) {
        ai.dodgeCd = 0.8;
        if (Math.random() < P.aiDodge) {
          // 往威脅方向的側邊滾，挑靠場地中央的那一側
          let px = threat.z;
          let pz = -threat.x;
          if (px * -f.x + pz * -f.z < 0) {
            px = -px;
            pz = -pz;
          }
          ctrl.move = { x: px, z: pz };
          ctrl.rollPressed = true;
          ai.prevHammer = false;
          return ctrl;
        }
      }
    }

    // 打斷：旁邊有人正在蓄力，就先秒揮把牠挑起來
    if (!f.holding && f.tapCd <= 0 && ai.tapLock <= 0) {
      for (const o of this.fighters) {
        if (o === f || o.state !== 'normal' || !o.charging || o.iframe > 0) continue;
        if (f.team !== null && o.team === f.team) continue;
        const d = Math.hypot(o.x - f.x, o.z - f.z);
        if (d > P.tapRadius + o.r - 0.1) continue;
        if (Math.random() < P.aiAggro * dt * 10) {
          ctrl.aim = yawOf(o.x - f.x, o.z - f.z);
          ctrl.hammer = true;
          ctrl.hammerPressed = true;
          ai.tapLock = 0.2; // 下一幀放開，才會是秒揮而不是蓄力
          ai.prevHammer = true;
          return ctrl;
        }
      }
    }

    ai.thinkT -= dt;
    if (!this.planValid(ai.plan) || (ai.thinkT <= 0 && !f.holding)) {
      const old = ai.plan;
      ai.plan = this.mode === 'soccer' ? this.soccerPlan(f) : (this.mini && this.mini.aiPlan && this.mini.aiPlan(f)) || this.makePlan(f);
      ai.thinkT = P.aiThink * rand(0.7, 1.3);
      if (!old || !ai.plan || old.target !== ai.plan.target) {
        ai.bestDc = Infinity;
        ai.stuckT = 0;
      }
    }
    const plan = ai.plan;

    if (!plan || !plan.target) {
      // 沒有好目標：往場中央晃
      const goal = plan ? plan.goal : { x: 0, z: 0 };
      const dx = goal.x - f.x;
      const dz = goal.z - f.z;
      if (Math.hypot(dx, dz) > 0.6) ctrl.move = this.steer(f, dx, dz);
      // 蓄到一半沒目標了：放掉
      ai.prevHammer = false;
      return ctrl;
    }

    const T = plan.target;
    // 秒揮計畫：走到旁邊挑一下（接力挑戰的 AI 把東西挑起來給隊友接）
    if (plan.tap) {
      const dT0 = Math.hypot(T.x - f.x, T.z - f.z);
      if (dT0 < P.tapRadius + T.r - 0.2 && f.tapCd <= 0 && !f.holding && ai.tapLock <= 0) {
        ctrl.aim = yawOf(T.x - f.x, T.z - f.z);
        ctrl.hammer = true;
        ctrl.hammerPressed = true;
        ai.tapLock = 0.2;
        ai.prevHammer = true;
        ai.plan = null;
        return ctrl;
      }
      ctrl.move = this.steer(f, T.x - f.x, T.z - f.z);
      ai.prevHammer = false;
      return ctrl;
    }
    const gx = plan.goal.x - T.x;
    const gz = plan.goal.z - T.z;
    const gl = Math.hypot(gx, gz) || 1e-4;
    const dnx = gx / gl;
    const dnz = gz / gl;
    const cue = { x: T.x - dnx * (T.r + 1.0), z: T.z - dnz * (T.r + 1.0) };
    // 目標貼著牆、母球位置站不進去：站在場內最近的地方，從那裡往目標打
    cue.x = clamp(cue.x, ARENA.minX + f.r + 0.05, ARENA.maxX - f.r - 0.05);
    cue.z = clamp(cue.z, ARENA.minZ + f.r + 0.05, ARENA.maxZ - f.r - 0.05);
    const cx = cue.x - f.x;
    const cz = cue.z - f.z;
    const dc = Math.hypot(cx, cz);
    const dT = Math.hypot(T.x - f.x, T.z - f.z);
    const tl = Math.hypot(T.x - cue.x, T.z - cue.z) || 1e-4;
    const shotYaw = yawOf((T.x - cue.x) / tl, (T.z - cue.z) / tl) + plan.err;

    // 卡住了（一直沒有更接近母球位置）：換目標
    if (dc < ai.bestDc - 0.25) {
      ai.bestDc = dc;
      ai.stuckT = 0;
    } else {
      ai.stuckT += dt;
      if (ai.stuckT > 1.6) {
        ai.ban = { target: T, until: this.time + 2.5 };
        ai.plan = null;
        ai.stuckT = 0;
      }
    }

    // 母球位置在目標另一邊：直直走過去會先撞到目標，先從側邊繞過去
    let wx = cx;
    let wz = cz;
    if (dT < dc && dT > 0.1) {
      const along = ((T.x - f.x) * cx + (T.z - f.z) * cz) / dc;
      const lat = Math.abs((T.x - f.x) * cz - (T.z - f.z) * cx) / dc;
      if (along > 0 && lat < T.r + f.r + 0.4) {
        const side = (f.x - T.x) * -dnz + (f.z - T.z) * dnx >= 0 ? 1 : -1;
        wx = T.x - dnz * side * (T.r + f.r + 0.9) - dnx * 0.4 - f.x;
        wz = T.z + dnx * side * (T.r + f.r + 0.9) - dnz * 0.4 - f.z;
      }
    }
    if (dc > 0.3) {
      const m = this.steer(f, wx, wz);
      const s = Math.min(1, dc / 0.8);
      ctrl.move = { x: m.x * s, z: m.z * s };
    }
    if (dT < 4) ctrl.aim = shotYaw;

    // 靠近了就開始蓄力（邊走邊蓄）
    let hammer = ai.tapLock <= 0 && (f.holding || (dc < 2.4 && f.swingCd <= 0));
    // 蓄好了、站好位置、目標在範圍內：放開
    if (f.charging && f.tier >= plan.tier) {
      const toT = yawOf(T.x - f.x, T.z - f.z);
      const inArc = Math.abs(angDiff(toT, f.facing)) < (P.swingArcDeg / 2) * D2R;
      const inReach = dT < P.swingRadius + T.r - 0.15;
      const aimed = Math.abs(angDiff(f.facing, shotYaw)) < 0.12;
      const waited = f.holdT > this.lv(plan.tier, f) + 0.9;
      if (inArc && inReach && ((dc < 0.55 && aimed) || waited || plan.quick)) hammer = false;
    }
    // 蓄著力卻離目標太遠：先放掉，免得一直慢慢走
    if (f.holding && dc > 4) hammer = false;
    ctrl.hammer = hammer;
    ctrl.hammerPressed = hammer && !ai.prevHammer;
    ai.prevHammer = hammer;
    return ctrl;
  }

  planValid(plan) {
    if (!plan) return false;
    const T = plan.target;
    if (!T) return true;
    if (plan.quick) return this.units.includes(T) && (T.state === 'popped' || T.state === 'sliding' || UNIT_GROUNDED.has(T.state));
    if (T.isBall) return this.units.includes(T) && !GONE.has(T.state);
    if (T.isFighter) return T.state === 'normal' || T.state === 'stunned';
    return this.units.includes(T) && UNIT_GROUNDED.has(T.state);
  }

  // 威脅方向（單位向量），沒有威脅回傳 null
  threatTo(f) {
    for (const b of this.bodies()) {
      if (b === f || b.isBall) continue;
      if (b.isFighter && f.team !== null && b.team === f.team) continue;
      if (b.state === 'sliding') {
        const sp = Math.hypot(b.vx, b.vz);
        if (sp < 3) continue;
        const rx = f.x - b.x;
        const rz = f.z - b.z;
        const along = (rx * b.vx + rz * b.vz) / sp;
        if (along <= 0 || along / sp > 0.4) continue;
        const lat = Math.abs(rx * b.vz - rz * b.vx) / sp;
        if (lat < b.r + f.r + 0.25) return { x: b.vx / sp, z: b.vz / sp };
      } else if (b.isFighter && b.charging && b.tier >= 2 && b.state === 'normal') {
        const dx = f.x - b.x;
        const dz = f.z - b.z;
        const d = Math.hypot(dx, dz);
        if (d > P.swingRadius + f.r + 0.4) continue;
        if (Math.abs(angDiff(yawOf(dx, dz), b.facing)) > (P.swingArcDeg / 2) * D2R + 0.25) continue;
        return { x: dx / d, z: dz / d };
      }
    }
    return null;
  }

  // 目標可以打去的地方：袋口，以及右側／下方平台邊緣外（撞球桌四面是牆，只有袋口）
  goalsFor(T) {
    const goals = POCKETS.map((p) => ({ x: p.x, z: p.z, pocket: true }));
    const S = MAP.sides;
    const cl = (v, a, b) => clamp(v, a, b);
    for (const d of [0, 2.5, -2.5]) {
      const z = cl(T.z + d, ARENA.minZ + 0.5, ARENA.maxZ - 0.5);
      const x = cl(T.x + d, ARENA.minX + 0.5, ARENA.maxX - 0.5);
      if (S.r) goals.push({ x: ARENA.maxX + 0.6, z, pocket: false });
      if (S.l) goals.push({ x: ARENA.minX - 0.6, z, pocket: false });
      if (S.b) goals.push({ x, z: ARENA.maxZ + 0.6, pocket: false });
      if (S.t) goals.push({ x, z: ARENA.minZ - 0.6, pocket: false });
    }
    return goals;
  }

  // only：只考慮這幾個目標（搶寶模式追拿蛋的人）
  // only：只考慮這幾個目標；valueFn(T)：目標值幾分；goalsFn(T)：要打去哪（預設是袋口和平台邊緣）
  makePlan(f, only = null, valueFn = null, goalsFn = null) {
    if (this.mode === 'egg' && !only) return this.eggPlan(f);
    const ai = f.ai;
    let best = null;
    let bestU = 0;
    const consider = (T, value, weight) => {
      if (ai.ban && ai.ban.target === T && this.time < ai.ban.until) return;
      const w = this.weightMult(T);
      for (const G of goalsFn ? goalsFn(T) : this.goalsFor(T)) {
        const gx = G.x - T.x;
        const gz = G.z - T.z;
        const L = Math.hypot(gx, gz);
        if (L < 0.5) continue;
        const dnx = gx / L;
        const dnz = gz / L;
        const need = G.pocket ? L - POCKET_R * 0.5 : L;
        let tier = 0;
        for (let t = 1; t <= 3; t++) {
          if (P[`dist${t}`] * w >= need) {
            tier = t;
            break;
          }
        }
        if (!tier) continue;
        // 路線上不能有牆、柱子或車擋住
        let clear = true;
        for (let s = T.r + 0.3; s < need - 0.3; s += 0.45) {
          if (wallHit(T.x + dnx * s, T.z + dnz * s, T.r * 0.85)) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        // 母球位置要站得到
        const cue = { x: T.x - dnx * (T.r + 1.0), z: T.z - dnz * (T.r + 1.0) };
        if (cue.x < ARENA.minX + 0.45 || cue.x > ARENA.maxX - 0.45 || cue.z < ARENA.minZ + 0.45 || cue.z > ARENA.maxZ - 0.45) continue;
        if (wallHit(cue.x, cue.z, 0.45)) continue;
        const travel = Math.hypot(cue.x - f.x, cue.z - f.z);
        let pts = value * (G.pocket ? P.pocketMult : 1);
        // 別人比較近的目標，搶不太到
        for (const o of this.fighters) {
          if (o !== f && o.state === 'normal' && Math.hypot(o.x - T.x, o.z - T.z) < Math.hypot(f.x - T.x, f.z - T.z) - 1.5) pts *= 0.7;
        }
        let u = (pts * weight) / (travel / P.moveSpeed + this.lv(tier, f) + 0.6);
        if (ai.plan && ai.plan.target === T) u *= 1.3; // 不要一直換目標
        u *= rand(0.85, 1.15);
        if (u > bestU) {
          bestU = u;
          best = { target: T, goal: G, tier, err: (Math.random() * 2 - 1) * P.aiAimError * D2R };
        }
      }
    };
    const scoring = this.mode === 'match' || this.mode === 'practice';
    if (!only && scoring) {
      for (const u of this.units) {
        if (!UNIT_GROUNDED.has(u.state)) continue;
        const v = P[`${u.type}Pts`] || 0;
        if (v > 0) consider(u, v, 1);
      }
    }
    // 道具箱：走過去敲一下就好
    if (!only && this.items.enabled) {
      for (const c of this.units) {
        if (c.type !== 'crate') continue;
        const dx = c.x - f.x;
        const dz = c.z - f.z;
        const d = Math.hypot(dx, dz) || 1e-4;
        const u = P.itemValue / (d / P.moveSpeed + 0.8);
        if (u > bestU) {
          bestU = u;
          best = { target: c, goal: { x: c.x + (dx / d) * 3, z: c.z + (dz / d) * 3 }, tier: 1, err: 0 };
        }
      }
    }
    // 沒有小怪（或最後存活）時只剩對手可以打
    const aggro = only ? 1 : this.mode === 'survival' ? 1.5 : P.spawnMinions && scoring ? P.aiAggro * 1.6 : 1;
    if (aggro > 0) {
      for (const o of only || this.fighters) {
        if (o === f || !this.solidGround(o) || (o.isFighter && (o.state !== 'normal' || o.shieldT > 0))) continue;
        if (o.isFighter && f.team !== null && o.team === f.team) continue;
        consider(o, valueFn ? valueFn(o) : P.koPts, aggro);
      }
    }
    return best || { target: null, goal: { x: rand(-5, 5), z: rand(-3, 3) } };
  }

  // 避開障礙物的移動方向：前方被擋住就試著往左右偏
  steer(f, dx, dz) {
    const base = yawOf(dx, dz);
    const side = f.ai.side;
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
      const y = base + off * side;
      const px = f.x + Math.sin(y) * 0.9;
      const pz = f.z + Math.cos(y) * 0.9;
      if (wallHit(px, pz, f.r + 0.05)) continue;
      if (px > ARENA.maxX - 0.3 || pz > ARENA.maxZ - 0.3) continue;
      return { x: Math.sin(y), z: Math.cos(y) };
    }
    return { x: Math.sin(base), z: Math.cos(base) };
  }

  // ───────────────────────── 投射物 ─────────────────────────

  spawnBall(u) {
    const yaw = u.atkYaw;
    const { mesh, mat } = makeBallMesh();
    const shadow = makeShadow(0.25);
    this.scene.add(mesh, shadow);
    const sp = u.def.ballSpeed;
    this.balls.push({
      x: u.x + Math.sin(yaw) * 0.6, z: u.z + Math.cos(yaw) * 0.6, y: 0.9, r: 0.25,
      vx: Math.sin(yaw) * sp, vz: Math.cos(yaw) * sp, vy: 0,
      state: 'thrown', life: 3, tier: 0, pop: null, trailT: 0, by: null,
      mesh, mat, shadow,
    });
    sfx.throwBall();
  }

  removeBall(b) {
    this.scene.remove(b.mesh, b.shadow);
    disposeTree(b.mesh);
    disposeTree(b.shadow);
    const i = this.balls.indexOf(b);
    if (i >= 0) this.balls.splice(i, 1);
  }

  burstBall(b, color = 0xf5f0e6) {
    this.fx.spark(b.x, b.y, b.z, b.vx, b.vz, 8, color, 5);
    this.removeBall(b);
  }

  popBall(b) {
    b.state = 'popped';
    b.vx = 0;
    b.vz = 0;
    b.pop = { t: 0, T: 0.9, h: 1.6, base: b.y };
    sfx.pop();
  }

  reflectBall(b, yaw, tier, f) {
    // 輕微自動瞄準：25° 內最近的目標
    let ry = yaw;
    let best = 25 * D2R;
    for (const u of this.bodies()) {
      if (u === f || !this.solid(u)) continue;
      const d = Math.hypot(u.x - b.x, u.z - b.z);
      if (d > 20) continue;
      const a = Math.abs(angDiff(yawOf(u.x - b.x, u.z - b.z), yaw));
      if (a < best) {
        best = a;
        ry = yawOf(u.x - b.x, u.z - b.z);
      }
    }
    const bonus = b.state === 'popped' ? 1.25 : 1;
    const sp = P[`reflect${tier}`] * bonus;
    b.state = 'reflected';
    b.tier = tier;
    b.by = f;
    b.vx = Math.sin(ry) * sp;
    b.vz = Math.cos(ry) * sp;
    b.y = 0.9;
    b.life = 3;
    b.bonus = bonus;
    b.mat.emissive.setHex(TIER_COLORS[tier]);
    b.mat.emissiveIntensity = 0.6;
    if (f.isHuman) this.label(b.x, 1.8, b.z, bonus > 1 ? '浮空反彈！' : '反彈！', TIER_CSS[tier], 26);
    this.stats.reflect++;
  }

  updateBall(b, dt) {
    if (b.state === 'thrown' || b.state === 'reflected') {
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.life -= dt;
      if (b.state === 'reflected') {
        b.trailT -= dt;
        if (b.trailT <= 0) {
          b.trailT = 0.02;
          this.fx.puff(b.x, b.y, b.z, TIER_COLORS[b.tier], 0.14);
        }
      }
      if (wallHit(b.x, b.z, b.r)) {
        this.burstBall(b);
        return;
      }
      if (offPlatform(b.x, b.z)) {
        b.state = 'dropping';
        return;
      }
      const yaw = yawOf(b.vx, b.vz);
      if (b.state === 'thrown') {
        // 丟出去的球只打角色：把人撞開一小段
        for (const f of this.fighters) {
          if (!FIGHTER_GROUNDED.has(f.state) || Math.hypot(f.x - b.x, f.z - b.z) > f.r + b.r) continue;
          if (f.iframe > 0) continue;
          this.flash(f, 1);
          f.flashT = 0.12;
          this.launch(f, yaw, 2.2, 0.3, 1, null);
          if (f.isHuman) {
            sfx.hurt();
            this.shake(0.1);
            this.vignetteT = 0.25;
          }
          this.burstBall(b);
          return;
        }
      } else {
        for (const u of this.bodies()) {
          if (u === b.by || !this.solid(u)) continue;
          if (Math.hypot(u.x - b.x, u.z - b.z) > u.r + b.r + 0.1) continue;
          if (u.isFighter && u.iframe > 0) continue;
          const full = (b.by && b.by.isHuman) || u.isHuman;
          this.flash(u, b.tier);
          this.launch(u, yaw, P[`dist${b.tier}`] * 0.8 * b.bonus * this.weightMult(u), P[`arc${b.tier}`], b.tier, b.by);
          sfx.clang(b.tier);
          this.hitstop(P[`hitstop${b.tier}`], full);
          this.shake(P[`shake${b.tier}`], full);
          if (full) this.label(u.x, 2.2, u.z, '反彈命中！', TIER_CSS[b.tier], 28);
          this.burstBall(b, TIER_COLORS[b.tier]);
          return;
        }
      }
      if (b.life <= 0) this.burstBall(b);
    } else if (b.state === 'popped') {
      const q = b.pop;
      q.t += dt;
      const k = clamp(q.t / q.T, 0, 1);
      b.y = q.base * (1 - k) + 0.25 * k + q.h * Math.sin(Math.PI * k);
      if (k >= 1) {
        b.state = 'ground';
        b.y = 0.25;
        b.life = 1.2;
      }
    } else if (b.state === 'ground') {
      b.life -= dt;
      if (b.life <= 0) this.burstBall(b);
    } else if (b.state === 'dropping') {
      b.vy -= 25 * dt;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.y += b.vy * dt;
      if (b.y < MAP.fallY) this.removeBall(b);
    }
  }

  // ───────────────────────── K.O. 特寫 ─────────────────────────

  startKO(b, text) {
    this.koT = P.koDuration;
    this.koTarget = b;
    this.timeScale = P.koSlowmo;
    this.dom.canvas.classList.add('ko');
    this.dom.koText.textContent = text;
    this.dom.ko.classList.remove('on');
    void this.dom.ko.offsetWidth; // 重新觸發 CSS 動畫
    this.dom.ko.classList.add('on');
    this.shake(0.3);
    sfx.ko();
  }

  endKO() {
    this.koT = 0;
    this.timeScale = 1;
    this.koTarget = null;
    this.dom.canvas.classList.remove('ko');
    this.dom.ko.classList.remove('on');
  }

  // ───────────────────────── 畫面同步 ─────────────────────────

  poseHammer(f) {
    const a = f.anim;
    let yaw = 0;
    let pitch = -0.6;
    if (f.charging) {
      const k = easeOutCubic(clamp(f.holdT / this.lv(3, f), 0, 1));
      yaw = lerp(0.5, 2.5, k);
      pitch = lerp(0.2, 1.35, k);
      if (f.tier === 3) yaw += Math.sin(performance.now() * 0.07) * 0.05;
    } else if (f.holding) {
      const k = clamp(f.holdT / this.lv(1, f), 0, 1);
      yaw = lerp(0, 0.5, k);
      pitch = lerp(-0.6, 0.2, k);
    } else if (a.kind === 'swing') {
      if (a.t < SWING_TIME) {
        yaw = 2.5 - 4.2 * easeOutCubic(a.t / SWING_TIME);
        pitch = 1.45;
      } else {
        const r = easeInOut(clamp((a.t - SWING_TIME) / 0.3, 0, 1));
        yaw = lerp(-1.7, 0, r);
        pitch = lerp(1.45, -0.6, r);
      }
    } else if (a.kind === 'tap') {
      if (a.t < 0.05) pitch = lerp(-0.6, -1.5, a.t / 0.05);
      else if (a.t < 0.11) pitch = lerp(-1.5, 1.95, ((a.t - 0.05) / 0.06) ** 2);
      else if (a.t < 0.2) pitch = 1.95;
      else pitch = lerp(1.95, -0.6, easeInOut(clamp((a.t - 0.2) / 0.16, 0, 1)));
    }
    f.mesh.pivot.rotation.set(pitch, yaw, 0);
  }

  syncFighter(f, dt, realDt) {
    this.syncHitbox(f);
    const m = f.mesh;
    const shown = f.state !== 'out';
    m.group.visible = shown && !(f.shieldT > 0 && Math.floor(performance.now() / 70) % 2 === 0);
    f.tag.style.display = shown && (this.mode !== 'practice' || P.twoPlayers) && !MINI_MODES.has(this.mode) ? '' : 'none';
    // 名牌：名字＋最後存活的命＋身上的道具效果＋拿著金蛋
    const fxText = this.items.tagText(f);
    const tagText = `${f.name}${this.mode === 'survival' ? ` ${'♥'.repeat(f.stocks)}` : ''}${this.egg && this.egg.carrier === f ? ' ★' : ''}${fxText ? `［${fxText}］` : ''}`;
    if (tagText !== f.tagText) {
      f.tagText = tagText;
      f.tag.textContent = tagText;
    }
    f.bubble.visible = shown && f.fx.shield > 0;
    const gy = groundY(f.x, f.z); // 高爾夫球場有起伏
    if (f.bubble.visible) f.bubble.position.set(f.x, f.y + gy + 0.7, f.z);
    f.shadow.visible = shown && f.state !== 'falling' && f.state !== 'sinking' && !offPlatform(f.x, f.z);
    f.stars.visible = f.state === 'stunned' && f.t > 0.3;
    f.ind.group.visible = false;
    if (!shown) return;

    m.group.position.set(f.x, f.y + gy, f.z);
    f.visYaw += angDiff(f.facing, f.visYaw) * (1 - Math.exp(-30 * realDt));
    m.group.rotation.y = f.visYaw;
    m.group.scale.setScalar((f.state === 'sinking' ? 1 - 0.6 * clamp(f.sink.t / 0.35, 0, 1) : 1) * (f.fx.big > 0 ? 1.3 : 1));
    this.poseHammer(f);

    const tier = f.charging ? f.tier : 0;
    if (tier > 0) {
      m.headMat.emissive.setHex(TIER_COLORS[tier]);
      m.headMat.emissiveIntensity = tier === 3 ? 0.65 + 0.35 * Math.sin(performance.now() * 0.04) : 0.3 + 0.15 * tier;
    } else {
      m.headMat.emissive.setHex(0x000000);
    }
    let sx = 1;
    let sy = 1;
    if (f.holding) {
      const k = clamp(f.holdT / this.lv(3, f), 0, 1);
      sx = 1 + 0.1 * k;
      sy = 1 - 0.14 * k;
    } else if (f.anim.kind === 'swing' && f.anim.t < 0.12) {
      sx = 0.9;
      sy = 1.15;
    }
    const sk = 1 - Math.exp(-25 * realDt);
    m.bodyRoot.scale.x += (sx - m.bodyRoot.scale.x) * sk;
    m.bodyRoot.scale.z += (sx - m.bodyRoot.scale.z) * sk;
    m.bodyRoot.scale.y += (sy - m.bodyRoot.scale.y) * sk;
    if (f.rollT > 0) m.bodyRoot.rotation.x = (1 - f.rollT / P.rollTime) * TAU;
    else if (f.state === 'sliding' || f.state === 'falling') m.bodyRoot.rotation.x += f.tumble * dt;
    else if (f.state === 'popped') m.bodyRoot.rotation.x += 9 * dt;
    else m.bodyRoot.rotation.x = angDiff(m.bodyRoot.rotation.x, 0) * Math.exp(-14 * realDt);
    m.mats[0].emissive.setHex(f.flashT > 0 ? 0xff2222 : 0x000000);
    if (f.shadow.visible) f.shadow.position.set(f.x, gy + 0.02, f.z);
    if (f.stars.visible) {
      f.stars.position.set(f.x, f.y + gy + 1.55, f.z);
      f.stars.rotation.y += 7 * realDt;
    }

    // 蓄力指示器：AI 對手的也看得到，才讀得出對方要打哪裡
    const ind = f.ind;
    const show = P.indicatorOn && f.charging;
    ind.group.visible = show;
    if (show) {
      if (ind.arc !== P.swingArcDeg) {
        ind.arc = P.swingArcDeg;
        const half = (P.swingArcDeg / 2) * D2R;
        const geo = new THREE.CircleGeometry(1, 32, -Math.PI / 2 - half, half * 2);
        geo.rotateX(-Math.PI / 2);
        ind.cone.geometry.dispose();
        ind.cone.geometry = geo;
      }
      ind.group.position.set(f.x, gy + 0.04, f.z);
      ind.group.rotation.y = f.facing;
      ind.cone.scale.setScalar(P.swingRadius);
      const len = this.mini && this.mini.indicatorLen ? this.mini.indicatorLen(f) : P[`dist${Math.max(1, f.tier)}`];
      ind.shaft.scale.z = Math.max(0.1, len - 0.8);
      ind.head.position.z = Math.max(0.1, len - 0.8);
      const col = f.isHuman ? TIER_COLORS[f.tier] : f.color;
      ind.arrowMat.color.setHex(col);
      ind.cone.material.color.setHex(col);
      const base = f.isHuman ? 0.45 : 0.3;
      ind.arrowMat.opacity = f.tier === 3 ? base + 0.25 * Math.sin(performance.now() * 0.03) : base;
    }

    // 名牌
    if (f.tag.style.display !== 'none') {
      this.proj.set(f.x, f.y + gy + 2.0, f.z).project(this.camera);
      f.tag.style.transform = `translate(${((this.proj.x + 1) / 2) * window.innerWidth}px, ${((1 - this.proj.y) / 2) * window.innerHeight}px) translate(-50%, -100%)`;
    }
  }

  syncVisuals(dt, realDt) {
    for (const f of this.fighters) this.syncFighter(f, dt, realDt);
    // 彈珠台的彈跳柱：被撞到時亮一下
    const now = performance.now();
    for (const o of OBSTACLES) if (o.capMat) o.capMat.emissiveIntensity = (o.flashUntil || 0) > now ? 1.2 : 0.25;

    for (const u of this.units) {
      const g = u.mesh.group;
      if (this.hitstopT <= 0) u.jitter = 0;
      const j = u.jitter;
      const uy = groundY(u.x, u.z);
      g.position.set(u.x + (Math.random() - 0.5) * 2 * j, u.y + uy, u.z + (Math.random() - 0.5) * 2 * j);
      if (u.mesh.bodyRoot.userData.spin) {
        // 球：照移動方向滾動
        const sp = Math.hypot(u.vx, u.vz);
        const moved = u.state === 'sliding' ? sp * dt : Math.hypot(u.x - (u.lastX ?? u.x), u.z - (u.lastZ ?? u.z));
        if (moved > 1e-4) {
          const dx = u.state === 'sliding' ? u.vx / sp : (u.x - u.lastX) / moved;
          const dz = u.state === 'sliding' ? u.vz / sp : (u.z - u.lastZ) / moved;
          this.tmp.set(dz, 0, -dx);
          u.mesh.bodyRoot.userData.spin.rotateOnWorldAxis(this.tmp, moved / u.r);
        }
        u.lastX = u.x;
        u.lastZ = u.z;
      }
      u.visYaw += angDiff(u.facing, u.visYaw) * (1 - Math.exp(-14 * realDt));
      g.rotation.y = u.mesh.bodyRoot.userData.spin ? 0 : u.visYaw;
      g.scale.setScalar(u.state === 'sinking' ? 1 - 0.6 * clamp(u.sink.t / 0.35, 0, 1) : 1);
      const body = u.mesh.bodyRoot;
      if (u.mesh.bodyRoot.userData.spin) {
        // 滾動在上面處理
      } else if (u.type === 'pin' && u.knocked) {
        body.rotation.x = Math.PI / 2; // 被撞倒的球瓶躺著
      } else if (u.type === 'crate') {
        body.position.y = 0.08 * Math.sin(performance.now() * 0.004);
        body.rotation.y += realDt;
      } else if (u.state === 'sliding' || u.state === 'falling') {
        body.rotation.x += u.tumble * dt;
      } else if (u.state === 'popped') {
        body.rotation.x += 9 * dt;
      } else {
        body.rotation.x = angDiff(body.rotation.x, 0) * Math.exp(-14 * realDt);
      }
      if (u.state === 'windup') {
        const k = 1 - clamp(u.t / u.def.atkWindup, 0, 1);
        body.scale.set(1 + 0.12 * k, 1 - 0.15 * k, 1 + 0.12 * k);
      } else if (u.state === 'stunned') {
        const w = Math.sin(performance.now() * 0.02) * 0.06;
        body.scale.set(1 + w, 1 - w, 1 + w);
      } else {
        body.scale.set(1, 1, 1);
      }
      const flash = u.flashT > 0;
      for (const mat of u.mesh.mats) mat.emissive.setHex(flash ? 0xffffff : u.type === 'gold' ? 0x553300 : 0x000000);

      const onGround = u.state !== 'falling' && u.state !== 'sinking' && !offPlatform(u.x, u.z);
      u.shadow.visible = onGround;
      if (onGround) {
        u.shadow.position.set(u.x, uy + 0.02, u.z);
        const s = clamp(1 - u.y * 0.13, 0.35, 1);
        u.shadow.scale.setScalar(s);
        u.shadow.material.opacity = 0.35 * s;
      }
      u.stars.visible = u.state === 'stunned';
      if (u.stars.visible) {
        u.stars.position.set(u.x, u.y + uy + u.def.height + 0.25, u.z);
        u.stars.rotation.y += 7 * realDt;
      }
    }

    for (const b of this.balls) {
      b.mesh.position.set(b.x, b.y + groundY(b.x, b.z), b.z);
      b.mesh.rotation.x += 12 * dt;
      const on = !offPlatform(b.x, b.z) && b.state !== 'dropping';
      b.shadow.visible = on;
      if (on) b.shadow.position.set(b.x, groundY(b.x, b.z) + 0.02, b.z);
    }
  }

  updateCamera(realDt) {
    const b = this.world.camBase;
    let tx = b.x;
    let tz = b.z;
    let zoom = 0;
    let dist = b.dist;
    let ty = 0;
    // 場地比畫面大（高爾夫球場）：鏡頭跟著玩家；滾輪可以拉遠拉近
    if (MAP.follow) {
      const focus = (this.mini && this.mini.cameraFocus && this.mini.cameraFocus()) || { x: this.player.x, z: this.player.z, spread: 0 };
      tx = focus.x;
      tz = focus.z + 0.4;
      ty = groundY(focus.x, focus.z);
      dist *= this.camZoom * Math.min(1.8, 1 + (focus.spread || 0) / 28);
    }
    if (this.koT > 0 && this.koTarget) {
      tx = lerp(b.x, this.koTarget.x, 0.35);
      tz = lerp(b.z, this.koTarget.z, 0.35);
      zoom = 0.12;
    }
    const k = 1 - Math.exp(-8 * realDt);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.z += (tz - this.cam.z) * k;
    this.cam.zoom += (zoom - this.cam.zoom) * k;
    this.shakeAmp *= Math.exp(-10 * realDt);
    this.fovKick *= Math.exp(-9 * realDt);
    const s = this.shakeAmp;
    const ox = (Math.random() - 0.5) * 2 * s;
    const oy = (Math.random() - 0.5) * 2 * s;
    const oz = (Math.random() - 0.5) * 2 * s;
    this.cam.y = (this.cam.y ?? 0) + (ty - (this.cam.y ?? 0)) * k;
    this.cam.dist = (this.cam.dist ?? dist) + (dist - (this.cam.dist ?? dist)) * k;
    this.camera.position.set(
      this.cam.x + ox,
      this.cam.y + Math.sin(b.pitch) * this.cam.dist + oy,
      this.cam.z + Math.cos(b.pitch) * this.cam.dist + oz,
    );
    this.camera.lookAt(this.cam.x + ox * 0.5, this.cam.y, this.cam.z + oz * 0.5);
    this.camera.fov = P.camFov * (1 - this.fovKick - this.cam.zoom);
    this.camera.updateProjectionMatrix();
  }

  updateHud(realDt) {
    const p = this.player;
    const d = this.dom;
    const k = p.holding ? clamp(p.holdT / this.lv(3, p), 0, 1) : 0;
    d.chargeFill.style.width = `${k * 100}%`;
    d.chargeFill.style.background = TIER_CSS[p.charging ? p.tier : 0];
    d.chargeLabel.textContent = p.charging ? `Lv${p.tier}` : '';
    d.chargeLabel.style.color = TIER_CSS[p.tier];
    d.marks[0].style.left = `${(this.lv(1, p) / this.lv(3, p)) * 100}%`;
    d.marks[1].style.left = `${(this.lv(2, p) / this.lv(3, p)) * 100}%`;
    const s = this.stats;
    const text = `命中 ${s.hits}｜進袋 ${s.pocket}｜出界 ${s.ringout}｜撞球 ${s.bowl}｜壁咚 ${s.wall}｜擊落 ${s.ko}｜反彈 ${s.reflect}`;
    if (text !== this.statsText) {
      this.statsText = text;
      d.stats.textContent = text;
    }
    this.vignetteT = Math.max(0, this.vignetteT - realDt);
    d.vignette.style.opacity = String(Math.min(1, this.vignetteT * 4));
  }

  // ───────────────────────── 除錯用（自動測試） ─────────────────────────

  debugSwing(tier, yaw = this.player.facing) {
    this.player.facing = yaw;
    this.player.anim = { kind: 'swing', t: 0, hit: false, yaw, tier };
  }

  debugTap(yaw = this.player.facing) {
    this.player.facing = yaw;
    this.player.anim = { kind: 'tap', t: 0, hit: false, yaw };
  }
}
