// 小遊戲（單人）：保齡球、冰壺。（高爾夫在 golf.js）
// 只能站在投擲線後面，用錘子把球／冰壺打出去。物理跟主遊戲共用（滑行、互撞、溝槽、出界）。
import { sfx } from './audio.js';
import { LANE, PIN_SPOTS, CURLING } from './maps.js';

const FRAMES = 5;
const STONES = 6;

// ───────────────────────── 保齡球 ─────────────────────────
// 5 格，每格最多 2 球。全倒（STRIKE）＋10、補中（SPARE）＋5。
export class Bowling {
  constructor(game) {
    this.game = game;
    this.title = '保齡球';
  }

  // 玩家可以走的範圍（game.js 的 clampWalk 之後再夾一次）
  walkLimit() {
    return { maxX: LANE.foulX - 0.45, minZ: -LANE.half + 0.45, maxZ: LANE.half - 0.45 };
  }

  start() {
    this.frame = 1;
    this.roll = 1;
    this.total = 0;
    this.frames = [];
    this.cur = [];
    this.state = 'aim';
    this.t = 0;
    this.setPins();
    this.setBall();
    const p = this.game.player;
    Object.assign(p, { x: LANE.foulX - 5, z: 0, facing: Math.PI / 2 });
    this.game.label(LANE.foulX - 2, 2.5, 0, '第 1 格', '#ffd23f', 34);
  }

  setPins() {
    const g = this.game;
    for (const u of [...g.units]) if (u.type === 'pin') g.removeUnit(u, false);
    this.pins = PIN_SPOTS.map((s) => {
      const u = g.spawnUnit('pin', s, true);
      u.spot = s;
      return u;
    });
  }

  setBall() {
    const g = this.game;
    for (const u of [...g.units]) if (u.type === 'bowlball') g.removeUnit(u, false);
    this.ball = g.spawnUnit('bowlball', { x: LANE.foulX - 2, z: 0 }, true);
  }

  standing() {
    const g = this.game;
    return this.pins.filter((u) => g.units.includes(u) && !u.knocked && Math.hypot(u.x - u.spot.x, u.z - u.spot.z) < 0.45);
  }

  update(dt) {
    const g = this.game;
    // 球被打過犯規線才算這一球開始
    if (this.state === 'aim') {
      const b = this.ball;
      if (!g.units.includes(b)) {
        this.setBall();
        return;
      }
      if (b.x > LANE.foulX + 0.3) {
        this.state = 'rolling';
        this.t = 0;
      }
      return;
    }
    if (this.state === 'rolling') {
      this.t += dt;
      const moving = g.units.some((u) => (u.type === 'pin' || u.type === 'bowlball') && (u.state === 'sliding' || u.state === 'sinking' || u.state === 'falling' || u.state === 'popped'));
      const ballGone = !g.units.includes(this.ball) || this.ball.state !== 'sliding';
      if ((ballGone && !moving && this.t > 0.8) || this.t > 7) this.endRoll();
    }
  }

  endRoll() {
    const g = this.game;
    const before = this.roll === 1 ? 10 : this.cur[0] === 10 ? 10 : 10 - this.cur[0];
    const left = this.standing().length;
    const down = before - left;
    this.cur.push(down);
    for (const u of this.pins) if (g.units.includes(u) && !this.standing().includes(u)) g.removeUnit(u, false);
    this.pins = this.standing();
    let done = false;
    if (this.roll === 1 && down === 10) {
      g.label(LANE.headX, 3, 0, 'STRIKE！', '#ffd23f', 54);
      sfx.stageClear();
      this.total += 10 + 10;
      done = true;
    } else if (this.roll === 2) {
      const sum = this.cur[0] + down;
      if (sum === 10) {
        g.label(LANE.headX, 3, 0, 'SPARE！', '#7fe0ff', 48);
        sfx.coin(true);
        this.total += 10 + 5;
      } else {
        g.label(LANE.headX, 3, 0, `${sum} 支`, '#ffffff', 36);
        this.total += sum;
      }
      done = true;
    } else {
      g.label(LANE.headX, 3, 0, down ? `${down} 支` : '洗溝…', '#ffffff', 36);
      if (down) sfx.coin(false);
    }
    if (done) {
      this.frames.push(this.cur);
      this.cur = [];
      this.frame++;
      this.roll = 1;
      if (this.frame > FRAMES) {
        this.state = 'done';
        g.match.finishMini('保齡球結束！', `總分 ${this.total}（${FRAMES} 格，全倒 +10、補中 +5）`, this.frameText());
        return;
      }
      this.setPins();
      g.label(LANE.foulX - 2, 2.5, 0, `第 ${this.frame} 格`, '#ffd23f', 34);
    } else {
      this.roll = 2;
    }
    this.setBall();
    this.state = 'aim';
  }

  frameText() {
    return this.frames.map((f, i) => {
      const mark = f[0] === 10 ? 'X' : f[0] + (f[1] ?? 0) === 10 ? `${f[0]} /` : f.join(' ');
      return `第 ${i + 1} 格：${mark}`;
    });
  }

  hudCells() {
    return [
      { k: '格數', v: `${Math.min(this.frame, FRAMES)}／${FRAMES}` },
      { k: '第幾球', v: String(this.roll) },
      { k: '總分', v: String(this.total) },
    ];
  }
}

// ───────────────────────── 冰壺 ─────────────────────────
// 6 顆冰壺，要在紅線（投擲線）前打出去，停下來後看離大本營中心多近：
// 中心圈 3 分、白圈 2 分、藍圈 1 分。冰壺會互撞，可以把前面的推進去。
export class Curling {
  constructor(game) {
    this.game = game;
    this.title = '冰壺';
  }

  walkLimit() {
    return { maxX: CURLING.hogX - 0.45, minZ: -5, maxZ: 5 };
  }

  start() {
    this.left = STONES;
    this.stones = [];
    this.state = 'aim';
    this.t = 0;
    this.next();
    Object.assign(this.game.player, { x: CURLING.startX - 1.5, z: 0, facing: Math.PI / 2 });
  }

  next() {
    const g = this.game;
    this.cur = g.spawnUnit('stone', { x: CURLING.startX + 1.2, z: 0 }, true);
    this.stones.push(this.cur);
    this.left--;
    this.state = 'aim';
  }

  pointsOf(u) {
    const d = Math.hypot(u.x - CURLING.x, u.z - CURLING.z) - u.r;
    if (d <= CURLING.rings[0]) return 3;
    if (d <= CURLING.rings[1]) return 2;
    if (d <= CURLING.rings[2]) return 1;
    return 0;
  }

  score() {
    const g = this.game;
    return this.stones.filter((u) => g.units.includes(u) && u.state !== 'falling' && u.state !== 'sinking').reduce((s, u) => s + this.pointsOf(u), 0);
  }

  update(dt) {
    const g = this.game;
    const c = this.cur;
    if (this.state === 'aim') {
      if (!g.units.includes(c)) {
        // 還沒過線就掉進洞或湖裡：這顆算丟了
        this.state = 'wait';
        this.t = 0;
        return;
      }
      if (c.x > CURLING.hogX + 0.3) {
        this.state = 'wait';
        this.t = 0;
      }
      return;
    }
    if (this.state === 'wait') {
      this.t += dt;
      const moving = g.units.some((u) => u.type === 'stone' && ['sliding', 'sinking', 'falling', 'popped'].includes(u.state));
      if ((!moving && this.t > 0.6) || this.t > 12) {
        g.label(CURLING.x, 2.5, CURLING.z, `目前 ${this.score()} 分`, '#ffd23f', 32);
        if (this.left <= 0) {
          this.state = 'done';
          const s = this.score();
          if (s > 0) sfx.stageClear();
          else sfx.fail();
          g.match.finishMini('冰壺結束！', `得分 ${s}（中心圈 3 分、白圈 2 分、藍圈 1 分）`, []);
          return;
        }
        this.next();
      }
    }
  }

  hudCells() {
    return [
      { k: '剩下冰壺', v: String(this.left + (this.state === 'aim' ? 1 : 0)) },
      { k: '目前得分', v: String(this.score()) },
    ];
  }
}
