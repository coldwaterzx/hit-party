// 合作模式（你＋2P／AI 隊友一起）與桌上曲棍球。
// 每個模式是一個「模式控制器」，game.js 會在這些時機呼叫它（都可以不寫）：
//   start()                開始
//   update(dt)             每幀
//   hudCells()             上方記分板的格子 [{ k, v }]
//   walkLimit(f)           角色能走的範圍 { minX, maxX, minZ, maxZ }，null＝不限制
//   aiCtrl(f, dt)          完全接管 AI 的操作（回傳指令；null＝照一般 AI）
//   aiPlan(f)              只換 AI 的目標（回傳計畫；null＝照一般 AI）
//   unitAi(u, dt)          接管小怪的行為（回傳 true＝已處理）
//   onScore(b, how, atk)   東西出界或進袋（回傳 true＝已處理，不走一般得分）
//   buff(f, key)           全隊強化的倍率：'reach' 判定範圍、'charge' 蓄力時間、'dist' 擊退距離
//   weight(b)              擊退倍率（回傳 undefined＝照一般規則）
import * as THREE from 'three';
import { P } from './config.js';
import { sfx } from './audio.js';
import { ARENA, wallHit } from './world.js';
import { makeTelegraphCircle, makeTelegraphLine } from './units.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const yawOf = (x, z) => Math.atan2(x, z);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);

// 地上的圓形區域標記（門口、收銀台）
function zoneMesh(scene, x, z, r, color) {
  const g = new THREE.Group();
  const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2;
  g.add(fill);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  g.position.set(x, 0.045, z);
  scene.add(g);
  return g;
}

// 小怪走路時避開障礙物
function steerUnit(u, tx, tz) {
  const base = yawOf(tx - u.x, tz - u.z);
  u.side = u.side || (Math.random() < 0.5 ? 1 : -1);
  for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
    const y = base + off * u.side;
    if (!wallHit(u.x + Math.sin(y) * 1.0, u.z + Math.cos(y) * 1.0, u.r + 0.05)) return { x: Math.sin(y), z: Math.cos(y) };
  }
  return { x: Math.sin(base), z: Math.cos(base) };
}

// 從開放的平台邊緣（右、下）爬上來的位置
function edgeSpawn(r) {
  for (let i = 0; i < 30; i++) {
    const p = Math.random() < 0.5 ? { x: ARENA.maxX - 0.8, z: rand(-6, 6.5) } : { x: rand(-11, 12), z: ARENA.maxZ - 0.8 };
    if (!wallHit(p.x, p.z, r + 0.2)) return p;
  }
  return { x: 11, z: 6 };
}

// ───────────────────────── 守超市 ─────────────────────────
// 小怪一波一波從平台邊緣爬上來，往超市自動門衝。摸到門就扣門的耐久，歸零就輸。
// 每清完一波可以選一個全隊強化；每 5 波來一隻胖墩王。
const DOOR = { x: -0.4, z: -6.9 };
const RAIDER_DMG = { minion: 1, heavy: 3, thrower: 1, boss: 6 };
const UPGRADES = [
  { id: 'reach', name: '全隊巨錘', desc: '判定範圍 +15%' },
  { id: 'charge', name: '全隊快速蓄力', desc: '蓄力時間 −15%' },
  { id: 'dist', name: '全隊強力擊退', desc: '擊退距離 +15%' },
  { id: 'repair', name: '修門', desc: '門的耐久 +8' },
  { id: 'ally', name: '援軍', desc: '多一個 AI 隊友（最多 4 個）' },
  { id: 'items', name: '道具雨', desc: '馬上掉 3 個道具箱' },
];

export class Defense {
  constructor(game) {
    this.game = game;
    this.title = '守超市';
  }

  start() {
    this.wave = 0;
    this.door = P.doorHP;
    this.queue = [];
    this.spawnT = 0;
    this.breakT = 3;
    this.kills = 0;
    this.state = 'break';
    this.buffs = { reach: 1, charge: 1, dist: 1 };
    this.zone = zoneMesh(this.game.scene, DOOR.x, DOOR.z + 0.4, 1.6, 0xff3b2f);
    this.game.label(DOOR.x, 3, DOOR.z + 2, '守住超市的門！', '#ff6b3a', 36);
  }

  stop() {
    this.game.scene.remove(this.zone);
  }

  buff(f, key) {
    return f.team === 0 ? this.buffs[key] : 1;
  }

  raiders() {
    return this.game.units.filter((u) => u.raider);
  }

  update(dt) {
    const g = this.game;
    this.zone.children[0].material.opacity = 0.18 + 0.1 * Math.sin(performance.now() * 0.006);
    if (this.state === 'break') {
      this.breakT -= dt;
      if (this.breakT <= 0) this.startWave();
      return;
    }
    if (this.state !== 'wave') return;
    this.spawnT -= dt;
    if (this.queue.length && this.spawnT <= 0) {
      this.spawnT = Math.max(0.45, 1.5 - this.wave * 0.08);
      const type = this.queue.shift();
      const u = g.spawnUnit(type, edgeSpawn(ENEMY_R[type]));
      u.raider = true;
      u.dmg = RAIDER_DMG[type];
      u.stompT = 3;
      if (type === 'boss') g.label(u.x, 4, u.z, '胖墩王來了！', '#c48bff', 40);
    }
    if (!this.queue.length && !this.raiders().length) this.waveClear();
  }

  startWave() {
    this.wave++;
    const w = this.wave;
    const q = [];
    for (let i = 0; i < 3 + w * 2; i++) q.push('minion');
    for (let i = 0; i < Math.floor(w / 2); i++) q.push('heavy');
    for (let i = 0; i < Math.floor(w / 3); i++) q.push('thrower');
    this.queue = shuffle(q);
    if (w % 5 === 0) this.queue.push('boss');
    this.state = 'wave';
    this.spawnT = 0.5;
    this.game.label(0, 3.5, 0, `第 ${w} 波`, '#ffd23f', 50);
    sfx.spawn();
  }

  waveClear() {
    const g = this.game;
    this.state = 'pick';
    sfx.stageClear();
    const choices = shuffle(UPGRADES.filter((u) => u.id !== 'ally' || g.fighters.length < 5)).slice(0, 3);
    g.match.showUpgrade(`第 ${this.wave} 波守住了！選一個強化`, choices, (id) => {
      this.apply(id);
      this.state = 'break';
      this.breakT = 3;
    });
  }

  apply(id) {
    const g = this.game;
    if (id === 'reach' || id === 'charge' || id === 'dist') this.buffs[id] *= id === 'charge' ? 0.85 : 1.15;
    else if (id === 'repair') this.door = Math.min(P.doorHP * 1.5, this.door + 8);
    else if (id === 'ally') g.addAlly();
    else if (id === 'items') for (let i = 0; i < 3; i++) g.spawnUnit('crate');
  }

  unitAi(u, dt) {
    if (!u.raider || u.type === 'thrower') return false;
    const g = this.game;
    if (u.type === 'boss') stomp(g, u, dt, 4);
    const d = dist(u, DOOR);
    if (d < 1.4) {
      this.door -= u.dmg;
      g.label(DOOR.x, 2.5, DOOR.z + 1, `門 -${u.dmg}`, '#ff6b6b', 32);
      g.fx.debris(u.x, 0.6, u.z, 0, -1, 12);
      sfx.hurt();
      g.shake(0.2);
      g.vignetteT = 0.2;
      g.removeUnit(u, false);
      if (this.door <= 0) {
        this.door = 0;
        this.state = 'done';
        sfx.fail();
        g.match.finishMini('門被攻破了…', `守住了 ${this.wave - 1} 波，打下 ${this.kills} 隻敵人`, []);
      }
      return true;
    }
    const m = steerUnit(u, DOOR.x, DOOR.z);
    g.walk(u, m.x, m.z, u.def.speed * (u.type === 'boss' ? 0.7 : 0.75), dt);
    return true;
  }

  onScore(b) {
    if (b.raider) {
      this.kills++;
      const atk = this.game.credit(b);
      if (atk) this.game.fx.text(b.x, 2.4, b.z, b.type === 'boss' ? '打倒胖墩王！' : '擊退！', { color: atk.css, size: 26, life: 1 });
    }
    return true;
  }

  // AI 隊友：離門越近的敵人越優先
  aiPlan(f) {
    const g = this.game;
    const rs = this.raiders().filter((u) => g.solidGround(u));
    if (!rs.length) return { target: null, goal: { x: DOOR.x + rand(-3, 3), z: DOOR.z + 3 } };
    const plan = g.makePlan(f, rs, (u) => 1 + Math.max(0, 14 - dist(u, DOOR)) / 2);
    return plan.target ? plan : { target: null, goal: { x: rs[0].x, z: rs[0].z } };
  }

  hudCells() {
    return [
      { k: '波數', v: String(Math.max(1, this.wave)) },
      { k: '門的耐久', v: String(this.door) },
      { k: '剩下敵人', v: String(this.queue.length + this.raiders().length) },
    ];
  }
}
const ENEMY_R = { minion: 0.4, heavy: 0.75, thrower: 0.4, boss: 1.3 };

// 胖墩王的震地：附近的人被震飛（先出現紅圈預警）
function stomp(g, u, dt, every) {
  u.stompT = (u.stompT ?? every) - dt;
  if (u.stompT > 0.9) return;
  if (!u.tele) {
    u.tele = makeTelegraphCircle(3.3);
    g.scene.add(u.tele);
  }
  u.tele.visible = true;
  u.tele.position.set(u.x, 0.035, u.z);
  u.tele.userData.fill.scale.setScalar(Math.max(0.01, 1 - u.stompT / 0.9));
  if (u.stompT > 0) return;
  u.stompT = every * rand(0.8, 1.2);
  u.tele.visible = false;
  for (const f of g.fighters) {
    if (f.state !== 'normal' || f.iframe > 0 || dist(f, u) > 3.3 + f.r) continue;
    g.launch(f, yawOf(f.x - u.x, f.z - u.z), 6 * g.weightMult(f), 1.2, 2, null);
  }
  g.fx.ring(u.x, u.z, 3.3, 0xc48bff, 0.4, 0.2);
  g.fx.dust(u.x, u.z, 20);
  g.label(u.x, 3.2, u.z, '震地！', '#c48bff', 32);
  sfx.wall();
  g.shake(0.3);
}

// ───────────────────────── Boss 戰 ─────────────────────────
// 撞球桌上的胖墩王：平常幾乎打不動。它會震地、會朝人衝刺；
// 衝刺撞到庫邊會暈 3.5 秒，這時候大家一起把它打進袋口。要打進去 3 次才贏；全隊共用命。
export class BossFight {
  constructor(game) {
    this.game = game;
    this.title = 'Boss 戰';
  }

  start() {
    this.lives = P.bossLives;
    this.team = P.coopLives;
    this.rage = 1;
    this.respawnT = 0;
    this.spawnBoss({ x: 7, z: 0 });
    this.line = makeTelegraphLine(1);
    this.line.visible = false;
    this.game.scene.add(this.line);
  }

  stop() {
    this.game.scene.remove(this.line);
  }

  boss() {
    return this.game.units.find((u) => u.type === 'boss');
  }

  spawnBoss(at) {
    const g = this.game;
    const b = g.spawnUnit('boss', at);
    b.atkT = 2.5;
    b.bp = 'chase';
    g.label(b.x, 4, b.z, this.lives < P.bossLives ? '胖墩王回來了，更生氣了！' : '胖墩王！', '#c48bff', 36);
  }

  weight(b) {
    if (b.type === 'boss') return b.state === 'stunned' ? 0.75 : 0.06;
    return undefined;
  }

  update(dt) {
    if (this.done) return;
    if (!this.boss()) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.spawnBoss(this.game.safePoint(1.3, 3));
    }
  }

  unitAi(u, dt) {
    if (u.type !== 'boss') return false;
    const g = this.game;
    const alive = g.fighters.filter((f) => f.state === 'normal');
    const tgt = alive.sort((a, b) => dist(a, u) - dist(b, u))[0];
    u.atkT -= dt * this.rage;
    if (u.bp === 'chase') {
      if (tgt) g.walk(u, tgt.x - u.x, tgt.z - u.z, u.def.speed * this.rage, dt);
      if (u.atkT <= 0 && tgt) {
        if (dist(tgt, u) < 4) {
          u.bp = 'slam';
          u.stompT = 0.9;
        } else {
          u.bp = 'dash';
          u.t = 0.85;
          u.dashTarget = tgt;
          this.line.visible = true;
          g.label(u.x, 3.5, u.z, '衝刺！', '#ff6b3a', 30);
        }
      }
    } else if (u.bp === 'slam') {
      stomp(g, u, dt * this.rage, 3);
      if (!u.tele || !u.tele.visible) {
        u.bp = 'chase';
        u.atkT = rand(2.5, 3.5);
      }
    } else if (u.bp === 'dash') {
      u.t -= dt * this.rage;
      const t = u.dashTarget;
      if (u.t > 0.25 && t) u.dashYaw = yawOf(t.x - u.x, t.z - u.z);
      this.line.position.set(u.x, 0.04, u.z);
      this.line.rotation.y = u.dashYaw;
      this.line.scale.z = 14;
      if (u.t <= 0) {
        this.line.visible = false;
        u.bp = 'chase';
        u.atkT = rand(2.2, 3.2);
        g.launch(u, u.dashYaw, 18, 0.2, 3, null);
        sfx.whiff(3);
      }
    }
    return true;
  }

  onScore(b) {
    const g = this.game;
    if (b.type === 'boss') {
      this.lives--;
      this.rage += 0.2;
      this.line.visible = false;
      if (this.lives <= 0) {
        this.done = true;
        sfx.stageClear();
        g.match.finishMini('打倒胖墩王了！', `全隊還剩 ${this.team} 條命`, []);
      } else {
        g.label(0, 3.5, 0, `進袋！胖墩王還剩 ${this.lives} 次`, '#7fe0ff', 40);
        this.respawnT = 2.5;
      }
    } else if (b.isFighter && b.team === 0) {
      this.team--;
      g.fx.text(b.x, 2.4, b.z, `全隊剩 ${this.team} 條命`, { color: '#ff6b6b', size: 24, life: 1.2 });
      if (this.team <= 0 && !this.done) {
        this.done = true;
        sfx.fail();
        g.match.finishMini('全隊陣亡…', `胖墩王還剩 ${this.lives} 次`, []);
      }
    }
    return true;
  }

  // AI 隊友：Boss 暈了就去推它進袋；平常站在庫邊附近引它衝過來撞牆
  aiPlan(f) {
    const g = this.game;
    const B = this.boss();
    if (!B) return { target: null, goal: { x: 0, z: 0 } };
    if (B.state === 'stunned') {
      const plan = g.makePlan(f, [B]);
      if (plan.target) return plan;
      return { target: null, goal: { x: B.x, z: B.z } };
    }
    const spots = [];
    for (const x of [-11.6, -6, 0, 6, 11.6]) for (const z of [-6.2, 6.2]) spots.push({ x, z });
    for (const z of [-3, 3]) for (const x of [-11.8, 11.8]) spots.push({ x, z });
    const ok = spots.filter((s) => dist(s, B) > 5.5);
    const s = (ok.length ? ok : spots).sort((a, b) => dist(a, f) - dist(b, f))[0];
    return { target: null, goal: s };
  }

  hudCells() {
    return [
      { k: '胖墩王還要進袋', v: `${this.lives} 次` },
      { k: '全隊剩下的命', v: String(this.team) },
    ];
  }
}

// ───────────────────────── 護送購物車 ─────────────────────────
// 把很重的購物車推到收銀台（綠圈）。小怪會一直來把車往外推；車掉出平台或進袋口就弄丟了。
const CASHIER = { x: 4.2, z: -6.0, r: 1.7 };
const CART_STARTS = [{ x: 10.5, z: 5.5 }, { x: 10.5, z: -1 }, { x: -9.5, z: 5.8 }, { x: -2.5, z: 6.2 }];

export class Escort {
  constructor(game) {
    this.game = game;
    this.title = '護送購物車';
  }

  start() {
    this.delivered = 0;
    this.lost = 0;
    this.cartT = 0.5;
    this.raiderT = 3;
    this.kills = 0;
    this.zone = zoneMesh(this.game.scene, CASHIER.x, CASHIER.z, CASHIER.r, 0x4fe07b);
    this.game.label(CASHIER.x, 2.5, CASHIER.z + 1, '收銀台', '#7be07b', 30);
  }

  stop() {
    this.game.scene.remove(this.zone);
  }

  cart() {
    return this.game.units.find((u) => u.type === 'cart');
  }

  raiders() {
    return this.game.units.filter((u) => u.raider);
  }

  weight(b) {
    return b.type === 'cart' ? 0.45 : undefined;
  }

  update(dt) {
    const g = this.game;
    if (this.done) return;
    const c = this.cart();
    if (!c) {
      this.cartT -= dt;
      if (this.cartT <= 0) {
        const p = CART_STARTS[Math.floor(Math.random() * CART_STARTS.length)];
        g.spawnUnit('cart', p);
        g.label(p.x, 2.5, p.z, '新的購物車！', '#ffffff', 26);
      }
    } else if (dist(c, CASHIER) < CASHIER.r && c.state !== 'falling' && c.state !== 'sinking') {
      this.delivered++;
      g.fx.ring(c.x, c.z, 2.5, 0x4fe07b, 0.4, 0.2);
      g.label(c.x, 3, c.z, `送達！${this.delivered}／${P.escortGoal}`, '#7be07b', 40);
      sfx.coin(true);
      g.removeUnit(c, false);
      this.cartT = 1.5;
      if (this.delivered >= P.escortGoal) {
        this.done = true;
        sfx.stageClear();
        g.match.finishMini('全部送到了！', `送達 ${this.delivered} 台，弄丟 ${this.lost} 台，打下 ${this.kills} 隻小怪`, []);
        return;
      }
    }
    this.raiderT -= dt;
    if (this.raiderT <= 0) {
      this.raiderT = rand(2.5, 4);
      if (this.raiders().length < 3 + this.delivered) {
        const type = Math.random() < 0.2 ? 'heavy' : 'minion';
        const u = g.spawnUnit(type, edgeSpawn(ENEMY_R[type]));
        u.raider = true;
      }
    }
  }

  // 小怪：繞到車和收銀台之間，把車往外推
  unitAi(u, dt) {
    if (!u.raider) return false;
    const g = this.game;
    const c = this.cart();
    if (!c || !g.solidGround(c)) {
      g.wanderStep(u, dt, u.def.speed * 0.4);
      return true;
    }
    const gx = CASHIER.x - c.x;
    const gz = CASHIER.z - c.z;
    const gl = Math.hypot(gx, gz) || 1;
    const spot = { x: c.x + (gx / gl) * (c.r + u.r + 0.1), z: c.z + (gz / gl) * (c.r + u.r + 0.1) };
    if (dist(u, c) < c.r + u.r + 0.25 && (u.shoveT || 0) < g.time) {
      u.shoveT = g.time + 1.8;
      g.launch(c, yawOf(c.x - u.x, c.z - u.z), 2.4, 0.2, 1, null);
      g.label(c.x, 2, c.z, '推！', '#ff6b3a', 20);
      sfx.bowl();
      return true;
    }
    const m = steerUnit(u, spot.x, spot.z);
    g.walk(u, m.x, m.z, u.def.speed * 0.7, dt);
    return true;
  }

  onScore(b) {
    const g = this.game;
    if (b.type === 'cart') {
      this.lost++;
      g.label(b.x, 3, b.z, `購物車掉了！${this.lost}／${P.escortFail}`, '#ff6b6b', 34);
      sfx.fail();
      this.cartT = 2;
      if (this.lost >= P.escortFail && !this.done) {
        this.done = true;
        g.match.finishMini('購物車都弄丟了…', `送達 ${this.delivered} 台，弄丟 ${this.lost} 台`, []);
      }
    } else if (b.raider) {
      this.kills++;
    }
    return true;
  }

  // AI 隊友：一個負責推車（每次往收銀台方向打一段），其他人清掉車旁邊的小怪
  aiPlan(f) {
    const g = this.game;
    const c = this.cart();
    if (!c) return { target: null, goal: { x: CASHIER.x, z: CASHIER.z + 3 } };
    const allies = g.fighters.filter((o) => !o.isHuman && o.team === 0);
    const near = this.raiders().filter((u) => g.solidGround(u) && dist(u, c) < 7);
    if (allies.indexOf(f) !== 0 && near.length) {
      const plan = g.makePlan(f, near);
      if (plan.target) return plan;
    }
    if (!g.solidGround(c)) return { target: null, goal: { x: c.x, z: c.z } };
    const plan = g.makePlan(f, [c], null, () => {
      const gx = CASHIER.x - c.x;
      const gz = CASHIER.z - c.z;
      const L = Math.hypot(gx, gz) || 1;
      const s = Math.min(L, 6);
      return [{ x: c.x + (gx / L) * s, z: c.z + (gz / L) * s, pocket: false }];
    });
    return plan.target ? plan : { target: null, goal: { x: c.x - 1.5, z: c.z + 1.5 } };
  }

  hudCells() {
    return [
      { k: '送達', v: `${this.delivered}／${P.escortGoal}` },
      { k: '弄丟', v: `${this.lost}／${P.escortFail}` },
    ];
  }
}

// ───────────────────────── 接力挑戰 ─────────────────────────
// 只看隊友之間的連鎖：A 打出去（或挑起來）的東西，被隊友 B 接著打，就是接力 ×2，再接 ×3…
// 出界／進袋時得分 ＝ 基本分 × 接力數（進袋再 × 2）。限時內比團隊總分，三個門檻給星星。
const STARS = [20, 45, 80];

export class Relay {
  constructor(game) {
    this.game = game;
    this.title = '接力挑戰';
  }

  start() {
    this.score = 0;
    this.best = 1;
    this.left = P.relayTime;
    this.topT = 0;
  }

  update(dt) {
    const g = this.game;
    if (this.done) return;
    this.left -= dt;
    if (this.left <= 0) {
      this.left = 0;
      this.done = true;
      const stars = STARS.filter((s) => this.score >= s).length;
      if (stars) sfx.stageClear();
      else sfx.fail();
      g.match.finishMini(`${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`, `團隊得分 ${this.score}，最長接力 ×${this.best}（★ ${STARS.join('／')} 分）`, []);
      return;
    }
    // 場上保持 6 隻小兵、1 隻胖墩
    this.topT -= dt;
    if (this.topT <= 0) {
      this.topT = 0.6;
      const n = g.units.filter((u) => u.type === 'minion').length;
      const h = g.units.filter((u) => u.type === 'heavy').length;
      if (n < 6) g.spawnUnit('minion');
      else if (h < 1) g.spawnUnit('heavy');
    }
  }

  onScore(b, how, atk) {
    if (b.isFighter) return true;
    const base = P[`${b.type}Pts`] || 0;
    if (!base || !atk) return true;
    const chain = b.chain || 1;
    const pts = base * chain * (how === 'pocket' ? 2 : 1);
    this.score += pts;
    this.best = Math.max(this.best, chain);
    const g = this.game;
    g.fx.text(b.x, 2.8, b.z, chain > 1 ? `接力 ×${chain}！ +${pts}` : `+${pts}`, { color: chain > 1 ? '#7fe0ff' : atk.css, size: chain > 1 ? 44 : 28, cls: 'big', life: 1.4 });
    if (chain > 1) sfx.coin(true);
    return true;
  }

  // AI 隊友：附近有隊友挑起來的東西就接著打；不然把小怪挑起來給玩家接
  aiPlan(f) {
    const g = this.game;
    const air = g.units.find((u) => (u.state === 'popped' || u.state === 'sliding') && u.lastHitBy && u.lastHitBy !== f
      && u.lastHitBy.team === f.team && dist(u, f) < 4.5 && P[`${u.type}Pts`]);
    if (air) {
      const goals = g.goalsFor(air).sort((a, b) => dist(a, air) - dist(b, air));
      if (goals.length) return { target: air, goal: goals[0], tier: 1, err: 0, quick: true };
    }
    const humans = g.fighters.filter((o) => o.isHuman && o.state === 'normal');
    const h = humans[0];
    if (h && Math.random() < 0.6) {
      const u = g.units.filter((x) => x.type === 'minion' && g.solidGround(x) && dist(x, h) < 7).sort((a, b) => dist(a, h) - dist(b, h))[0];
      if (u) return { target: u, goal: { x: h.x, z: h.z }, tier: 0, err: 0, tap: true };
    }
    return null;
  }

  hudCells() {
    return [
      { k: '團隊得分', v: String(this.score) },
      { k: '最長接力', v: `×${this.best}` },
      { k: '剩下', v: `${Math.ceil(this.left)} 秒` },
    ];
  }
}

// ───────────────────────── 桌上曲棍球 ─────────────────────────
// 四周圍起來的桌上曲棍球：冰球幾乎不減速、撞擋板會反彈，只有兩端中間的球門口能進球。
// 每隊只能待在自己那半邊。跟乒乓不一樣的地方（比較好上手）：
//   ・走路撞到冰球就會把它撞出去（像真的曲棍球拍），不一定要揮錘
//   ・揮錘打冰球時，方向會自動往對方球門修正一些
//   ・移動速度比平常快
export class Hockey {
  constructor(game) {
    this.game = game;
    this.title = '桌上曲棍球';
  }

  start() {
    this.score = [0, 0];
    this.serveX = Math.random() < 0.5 ? -3 : 3; // 第一球隨機發給一邊
    this.serveT = 0.8;
    this.puck = null;
  }

  walkLimit(f) {
    return f.team === 0 ? { maxX: -0.6 } : { minX: 0.6 };
  }

  // 移動加快；AI 慢一點（不然守門太完美，很難進球）
  moveMult(f) {
    return P.hockeyMove * (f.isHuman ? 1 : 0.85);
  }

  weight(b) {
    return b.type === 'puck' ? 1 : undefined;
  }

  // 揮錘打冰球：方向往對方球門修正（差太多就不修）
  adjustLaunch(b, yaw, by) {
    if (b.type !== 'puck' || !by || !by.isFighter) return yaw;
    const gx = (by.team === 0 ? 1 : -1) * (ARENA.maxX + 0.5);
    const want = yawOf(gx - b.x, -b.z);
    let d = (want - yaw) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d) < 1.3 ? yaw + d * 0.65 : yaw;
  }

  update(dt) {
    const g = this.game;
    if (this.done) return;
    const p = this.puck && g.units.includes(this.puck) ? this.puck : null;
    if (!p) {
      this.puck = null;
      this.serveT -= dt;
      if (this.serveT <= 0) this.serve();
      return;
    }
    // 進球：冰球整顆越過球門線
    if (Math.abs(p.x) - p.r * 0.5 > ARENA.maxX) {
      this.point(p.x < 0 ? 1 : 0, p);
      return;
    }
    if (dt > 0) this.contacts(p, dt);
  }

  // 球拍效果：角色碰到冰球，冰球照相對速度彈開，角色往前衝的速度也會加上去
  contacts(p, dt) {
    const g = this.game;
    for (const f of g.fighters) {
      const fvx = (f.x - (f.hx ?? f.x)) / dt;
      const fvz = (f.z - (f.hz ?? f.z)) / dt;
      f.hx = f.x;
      f.hz = f.z;
      if (f.state !== 'normal' || p.y > 0.6 || p.state === 'falling') continue;
      const dx = p.x - f.x;
      const dz = p.z - f.z;
      const d = Math.hypot(dx, dz);
      const minD = f.r + p.r + 0.15;
      if (d >= minD || d < 1e-4) continue;
      const nx = dx / d;
      const nz = dz / d;
      p.x = f.x + nx * minD;
      p.z = f.z + nz * minD;
      let pvx = p.state === 'sliding' ? p.vx : 0;
      let pvz = p.state === 'sliding' ? p.vz : 0;
      const rn = (pvx - fvx) * nx + (pvz - fvz) * nz;
      if (rn < 0) {
        pvx -= 1.9 * rn * nx;
        pvz -= 1.9 * rn * nz;
      }
      const push = Math.max(0, fvx * nx + fvz * nz);
      pvx += nx * (push * 0.6 + 2);
      pvz += nz * (push * 0.6 + 2);
      const sp = Math.hypot(pvx, pvz);
      const cap = P.hockeySpeed * 1.25;
      if (sp > cap) {
        pvx *= cap / sp;
        pvz *= cap / sp;
      }
      g.slideBody(p, pvx, pvz, f);
      g.fx.spark(p.x, 0.4, p.z, nx, nz, 5, 0xffffff, 5);
      if (sp > 6) sfx.tap();
    }
  }

  serve() {
    const g = this.game;
    this.puck = g.spawnUnit('puck', { x: this.serveX, z: 0 }, true);
    g.label(this.serveX, 2.2, 0, '開球', '#ffffff', 28);
  }

  point(team, p) {
    const g = this.game;
    this.score[team]++;
    g.removeUnit(p, false);
    this.puck = null;
    this.serveX = team === 0 ? 3 : -3; // 球發給失分的那一邊
    this.serveT = 1.3;
    g.fx.ring(p.x, p.z, 3, team === 0 ? 0x3f7fe8 : 0xe8505b, 0.5, 0.2);
    g.label(0, 3, 0, `${team === 0 ? '藍隊' : '紅隊'} 進球！ ${this.score[0]}：${this.score[1]}`, team === 0 ? '#6aa2ff' : '#ff6b74', 40);
    if (team === 0) sfx.coin(true);
    else sfx.hurt();
    if (this.score[team] >= P.hockeyPoints) {
      this.done = true;
      const win = team === 0;
      if (win) sfx.stageClear();
      else sfx.fail();
      g.match.finishMini(win ? '藍隊贏了！' : '紅隊贏了…', `藍隊 ${this.score[0]} : ${this.score[1]} 紅隊`, []);
    }
  }

  onScore() {
    return true;
  }

  // 曲棍球 AI：冰球在自己這邊就繞到後面衝過去撞；朝自己來就守球門；不然回防守位置
  aiCtrl(f, dt) {
    const g = this.game;
    const ai = f.ai;
    const ctrl = { move: { x: 0, z: 0 }, aim: null, hammer: false, hammerPressed: false, rollPressed: false };
    const side = f.team === 0 ? -1 : 1;
    const mates = g.fighters.filter((o) => o.team === f.team);
    const two = mates.length > 1;
    const idx = mates.indexOf(f);
    const p = this.puck && g.units.includes(this.puck) ? this.puck : null;
    const goTo = (x, z, slow = 0.5) => {
      const dx = x - f.x;
      const dz = z - f.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.15) ctrl.move = { x: (dx / d) * Math.min(1, d / slow), z: (dz / d) * Math.min(1, d / slow) };
    };
    const homeX = side * (two ? (idx === 0 ? 5 : 10) : 9);
    if (!p) {
      goTo(homeX, 0);
      return ctrl;
    }
    // 反應時間＋誤差
    ai.hkT = (ai.hkT || 0) - dt;
    if (ai.hkT <= 0) {
      ai.hkT = rand(0.15, 0.3);
      ai.hkNoise = (Math.random() * 2 - 1) * (P.aiAimError / 6) * 1.6;
      // 瞄門柱附近；四分之一的機會打擋板反彈（瞄到擋板外面）
      if (ai.hkAimZ === undefined || Math.random() < 0.15) {
        ai.hkAimZ = Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) * rand(9, 13) : (Math.random() < 0.5 ? -1 : 1) * rand(1.0, 2.2);
      }
    }
    const pvx = p.state === 'sliding' ? p.vx : 0;
    const pvz = p.state === 'sliding' ? p.vz : 0;
    const sp = Math.hypot(pvx, pvz);
    const myHalf = p.x * side > -0.4; // 剛好在中線上的也去搶
    const coming = pvx * side > 1;
    const oppX = -side * (ARENA.maxX + 0.5);
    ctrl.aim = yawOf(oppX - f.x, ai.hkAimZ - f.z);
    const attacker = !two || idx === 0 || p.x * side > 7;
    if (myHalf && attacker && (!coming || sp < 7)) {
      // 進攻：站到冰球後面（相對瞄準點），再直直衝過去
      const ax = oppX - p.x;
      const az = ai.hkAimZ - p.z;
      const al = Math.hypot(ax, az) || 1;
      const dx = ax / al;
      const dz = az / al;
      const rx = f.x - p.x;
      const rz = f.z - p.z;
      const along = rx * dx + rz * dz;
      const lat = Math.abs(rx * dz - rz * dx);
      if (along < -0.2 && lat < 0.6) {
        goTo(p.x + dx * 1.6, p.z + dz * 1.6, 0.01);
      } else if (along > -0.2) {
        const s = (rx * -dz + rz * dx) >= 0 ? 1 : -1;
        goTo(p.x - dz * s * (p.r + f.r + 0.9) - dx * 0.6, p.z + dx * s * (p.r + f.r + 0.9) - dz * 0.6);
      } else {
        goTo(p.x - dx * (p.r + f.r + 0.4), p.z - dz * (p.r + f.r + 0.4));
      }
      return ctrl;
    }
    if (coming) {
      // 守門：預測冰球到自己防守線的位置（上下擋板會反彈）
      const tx = side * (two && idx === 0 ? 6 : 10.5);
      if (Math.hypot(p.x - f.x, p.z - f.z) < 2.6) {
        goTo(p.x, p.z, 0.01);
        return ctrl;
      }
      const t = Math.max(0, (tx - p.x) / pvx);
      const lo = ARENA.minZ + p.r;
      const span = ARENA.maxZ - p.r - lo;
      let z = p.z + pvz * t - lo;
      z = ((z % (2 * span)) + 2 * span) % (2 * span);
      if (z > span) z = 2 * span - z;
      goTo(tx, clamp(lo + z + ai.hkNoise, -3.6, 3.6));
      return ctrl;
    }
    goTo(homeX, clamp(p.z * 0.4, -3, 3));
    return ctrl;
  }

  hudCells() {
    return [
      { k: '藍隊', v: String(this.score[0]) },
      { k: `先得 ${P.hockeyPoints} 分`, v: '：' },
      { k: '紅隊', v: String(this.score[1]) },
    ];
  }
}

// 地圖：每個模式用哪張地圖（null＝用開始畫面選的）
export const COOP_MAPS = { defense: 'city', boss: 'table', escort: 'city', relay: null, hockey: 'hockey' };
export const COOP_CLASSES = { defense: Defense, boss: BossFight, escort: Escort, relay: Relay, hockey: Hockey };
