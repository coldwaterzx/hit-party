// 測試場：像格鬥遊戲的訓練模式。可以生成木樁／小怪／道具箱、直接拿任何道具、
// 放慢時間或凍結一格一格看、顯示判定範圍，並量出每一次擊退的初速、滑行距離、撞牆速度。
// 左右兩邊的工具列和調整面板在 ui.js；這裡只管場上的事和量測。
import { FIGHTERS } from './config.js';
import { MAP } from './world.js';
import { LAB } from './maps.js';

const NAMES = {
  dummy: '木樁', minion: '小兵', heavy: '胖墩', thrower: '投擲兵', gold: '金色小兵', crate: '道具箱',
  ball: '足球', puck: '冰球', golfball: '高爾夫球', cueball: '母球', steel: '鋼珠', cart: '購物車', boss: '胖墩王',
};
const TIER_NAME = ['秒揮', 'Lv1', 'Lv2', 'Lv3'];

export class Lab {
  constructor(game) {
    this.game = game;
    this.title = '測試場';
    this.sandbag = true; // AI 對手站著不動
    this.history = []; // 最近幾次擊退的量測
  }

  start() {
    const g = this.game;
    g.showHitbox = !!this.showHitbox;
    this.resetField();
  }

  stop() {
    this.game.labScale = 1;
    this.game.labFrozen = false;
    this.game.showHitbox = false;
  }

  // 木樁擺在 Lv1／Lv2／Lv3 的距離線上（訓練室），其他地圖就擺在玩家前面
  resetField() {
    const g = this.game;
    for (const u of [...g.units]) g.removeUnit(u, false);
    g.respawns = [];
    const p = g.player;
    if (MAP.id === 'lab') {
      Object.assign(p, { x: LAB.startX, z: 0, facing: Math.PI / 2, state: 'normal', vx: 0, vz: 0, y: 0 });
      for (const m of LAB.marks) g.spawnUnit('dummy', { x: LAB.startX + m.d, z: 0 }, true);
    } else {
      const s = g.safePoint(0.4, 1);
      Object.assign(p, { x: s.x, z: s.z, state: 'normal', vx: 0, vz: 0, y: 0 });
      for (const d of [3, 5, 7]) {
        const at = this.ahead(d);
        if (at) g.spawnUnit('dummy', at, true);
      }
    }
  }

  // 玩家面前 d m 的位置（夾在場內）
  ahead(d) {
    const g = this.game;
    const p = g.player;
    const x = Math.max(-12.3, Math.min(12.3, p.x + Math.sin(p.facing) * d));
    const z = Math.max(-6.8, Math.min(6.8, p.z + Math.cos(p.facing) * d));
    return { x, z };
  }

  spawn(type) {
    const g = this.game;
    const u = g.spawnUnit(type, this.ahead(3), type === 'dummy');
    if (type === 'dummy') u.home = { x: u.x, z: u.z };
    return u;
  }

  giveItem(id) {
    this.game.items.give(this.game.player, id);
  }

  clearAll() {
    const g = this.game;
    for (const u of [...g.units]) g.removeUnit(u, false);
    for (const b of [...g.balls]) g.removeBall(b);
    g.respawns = [];
    g.items.reset();
  }

  addRival() {
    const g = this.game;
    const n = g.fighters.length;
    if (n >= FIGHTERS.length) return null;
    const at = this.ahead(4);
    const f = g.createFighter(n, FIGHTERS[n], null, at, -1);
    g.fighters.push(f);
    return f;
  }

  removeRivals() {
    const g = this.game;
    const keep = g.fighters.filter((f) => f.isHuman);
    for (const f of g.fighters) {
      if (keep.includes(f)) continue;
      g.scene.remove(f.mesh.group, f.shadow, f.ind.group, f.stars, f.bubble);
      f.tag.remove();
      if (f.hitbox) g.scene.remove(f.hitbox);
    }
    g.fighters = keep;
  }

  // 沙包模式：AI 對手站著不動（不閃避、不出手）
  aiCtrl() {
    if (!this.sandbag) return null;
    return { move: { x: 0, z: 0 }, aim: null, hammer: false, hammerPressed: false, rollPressed: false };
  }

  // 測試場不算分
  onScore() {
    return true;
  }

  // ── 量測 ──
  onLaunch(b, info) {
    const rec = {
      name: b.isFighter ? b.name : NAMES[b.type] || b.type,
      tier: TIER_NAME[info.tier] || `Lv${info.tier}`,
      by: info.by ? info.by.name : '（機關）',
      speed: info.sp,
      expect: info.dist,
      from: { x: b.x, z: b.z },
      actual: null,
      impact: 0,
      walls: 0,
      hitstop: 0,
      t: performance.now(),
    };
    b.labRec = rec;
    this.history.unshift(rec);
    this.history.length = Math.min(this.history.length, 6);
  }

  // 打擊停頓是在擊退之後才決定的：補到同一下的紀錄上
  onHitstop(frames) {
    const r = this.history[0];
    if (r && performance.now() - r.t < 50) r.hitstop = Math.max(r.hitstop, frames);
  }

  onImpact(b, impact) {
    if (!b.labRec) return;
    b.labRec.impact = Math.max(b.labRec.impact, impact);
    b.labRec.walls++;
  }

  onStop(b) {
    const r = b.labRec;
    if (!r) return;
    r.actual = Math.hypot(b.x - r.from.x, b.z - r.from.z);
    b.labRec = null;
  }

  // 出界、進袋時也結算距離
  onGone(b, how) {
    const r = b.labRec;
    if (!r) return;
    r.actual = Math.hypot(b.x - r.from.x, b.z - r.from.z);
    r.end = how === 'pocket' ? '進袋' : '出界';
    b.labRec = null;
  }

  hudCells() {
    return [];
  }
}
