// 派對高爾夫：所有人同時打、各打各的球，誰先把自己的球打進洞誰先完成。
// 不分回合；可以去打別人的球、打別人（干擾）。只有自己打自己的球才算桿數。
// 計分：比總桿數（少的贏），或比完成順序（每洞第 1 名 5 分、第 2 名 3 分、第 3 名 2 分、第 4 名以後 1 分）。
// 一洞結束：全部人進洞，或第一個人進洞後再過 golfAfterFirst 秒，或超過 golfHoleTime 秒；沒進洞的罰 2 桿。
import * as THREE from 'three';
import { P } from './config.js';
import { sfx } from './audio.js';
import { CourseHole, buildHoleMesh, updateHole } from './course.js';
import { COURSES } from './courses.js';

const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ORDER_POINTS = [5, 3, 2, 1];
const angGap = (a, b) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
};

// 匯入的自訂球場（ui.js 匯入 PNG 後放進來）
export const CUSTOM = { name: '自訂球場', holes: [] };

export class PartyGolf {
  constructor(game) {
    this.game = game;
    this.title = '高爾夫';
  }

  start() {
    const g = this.game;
    const course = P.golfCourse === 'custom' && CUSTOM.holes.length ? CUSTOM : COURSES[P.golfCourse] || COURSES.party;
    this.course = course;
    this.defs = Number(P.golfHoles) === 3 ? course.holes.slice(0, 3) : course.holes;
    this.cache = [];
    for (const f of g.fighters) f.total = { strokes: 0, points: 0, holes: [] };
    this.buildUi();
    this.loadHole(0);
  }

  stop() {
    if (this.ui) this.ui.remove();
    this.ui = null;
  }

  get hole() {
    return this.cache[this.index];
  }

  loadHole(i) {
    const g = this.game;
    this.index = i;
    if (!this.cache[i]) {
      const d = this.defs[i];
      const hole = d instanceof CourseHole ? d : new CourseHole(d);
      if (!hole.group) buildHoleMesh(hole);
      this.cache[i] = hole;
    }
    const hole = this.cache[i];
    hole.time = 0;
    g.world.setCourse(hole);
    for (const u of [...g.units]) g.removeUnit(u, false);
    for (const b of [...g.balls]) g.removeBall(b);
    g.respawns = [];
    // 每個人一顆球，在發球台旁邊排一排
    const yaw = Math.atan2(hole.cup.x - hole.tee.x, hole.cup.z - hole.tee.z);
    const px = Math.cos(yaw);
    const pz = -Math.sin(yaw);
    const n = g.fighters.length;
    g.fighters.forEach((f, k) => {
      const off = (k - (n - 1) / 2) * 1.3;
      const at = { x: hole.tee.x + px * off, z: hole.tee.z + pz * off };
      g.cancelCharge(f);
      Object.assign(f, {
        x: at.x - Math.sin(yaw) * 1.4, z: at.z - Math.cos(yaw) * 1.4, y: 0, vx: 0, vz: 0, state: 'normal', t: 0,
        facing: yaw, anim: { kind: 'rest', t: 0 }, rollT: 0,
      });
      f.golf = { strokes: 0, done: false, place: 0, ball: null, safe: { ...at }, respawnT: 0 };
      this.spawnBall(f, at);
      f.ai.gplan = null;
    });
    this.state = 'play';
    this.timeLeft = P.golfHoleTime;
    this.after = null;
    this.finished = 0;
    this.minimapBase = null;
    g.label(hole.tee.x, 3.2, hole.tee.z, `第 ${i + 1} 洞「${hole.name}」 Par ${hole.par}`, '#ffd23f', 38);
    sfx.spawn();
  }

  spawnBall(f, at) {
    const g = this.game;
    const b = g.spawnUnit('golfball', at, true);
    b.owner = f;
    b.restPos = { ...at };
    // 球上加一圈主人的顏色（球上的小點也換成主人的顏色）
    const spin = b.mesh.bodyRoot.userData.spin;
    spin.children.forEach((c) => {
      if (c.material && c.material.color) c.material.color.setHex(f.color);
    });
    const band = new THREE.Mesh(new THREE.TorusGeometry(b.r * 1.01, 0.06, 6, 20), new THREE.MeshBasicMaterial({ color: f.color }));
    band.rotation.x = Math.PI / 2;
    spin.add(band);
    f.golf.ball = b;
    return b;
  }

  // ── 規則 ──

  // 點一下＝短推桿；按住從 Lv1 門檻開始連續變遠，到 Lv3 門檻是最遠
  swingDist(f, tier, holdT) {
    const k = Math.max(0, Math.min(1, (holdT - P.chargeLv1) / (P.chargeLv3 - P.chargeLv1)));
    return P.golfTap + k * (P.golfDrive - P.golfTap);
  }

  indicatorLen(f) {
    return this.swingDist(f, f.tier, f.holdT);
  }

  canSink(b) {
    if (b.type !== 'golfball') return false;
    if (Math.hypot(b.vx, b.vz) <= P.golfCupSpeed) return true;
    if ((b.lipT || 0) < this.game.time) {
      b.lipT = this.game.time + 0.6;
      this.game.label(b.x, 1.6, b.z, '太快，滑過洞口！', '#ffffff', 20);
    }
    return false;
  }

  onLaunch(b, info) {
    if (b.type !== 'golfball' || !b.owner) return;
    b.safe = { ...b.restPos };
    const o = b.owner;
    if (info.by === o && !o.golf.done && this.state === 'play') {
      o.golf.strokes++;
      this.checkCap(o);
    }
    else if (info.by && info.by.isFighter && info.by !== o) this.game.label(b.x, 1.8, b.z, `${info.by.name} 干擾！`, info.by.css, 22);
  }

  // 球掉進水裡：回到上一桿的位置，是自己打的就罰 1 桿
  onWater(b) {
    if (b.type !== 'golfball') return false;
    this.penalty(b, '落水');
    Object.assign(b, { x: b.safe.x, z: b.safe.z, vx: 0, vz: 0, vy: 0, y: 0, state: 'idle' });
    return true;
  }

  penalty(b, why) {
    const o = b.owner;
    const self = b.lastHitBy === o;
    if (self && !o.golf.done) o.golf.strokes++;
    this.game.label(b.x, 2, b.z, `${o.name} 的球${why}${self ? '！罰 1 桿' : ''}`, o.css, 24);
    if (self) this.checkCap(o);
  }

  // 打到桿數上限：這一洞直接結束（不算名次）
  checkCap(o) {
    const gf = o.golf;
    if (gf.done || gf.strokes < this.hole.par + P.golfMaxOver) return;
    gf.done = true;
    gf.place = 0;
    gf.capped = true;
    const b = gf.ball;
    if (b && this.game.units.includes(b)) this.game.removeUnit(b, false);
    gf.ball = null;
    this.game.label(o.x, 2.6, o.z, `${o.name} 達到桿數上限，這洞結束`, o.css, 24);
  }

  onScore(b, how) {
    const g = this.game;
    if (b.type !== 'golfball' || !b.owner) return true;
    const o = b.owner;
    if (how === 'pocket') {
      if (!o.golf.done) {
        o.golf.done = true;
        o.golf.place = ++this.finished;
        const diff = o.golf.strokes - this.hole.par;
        const name = o.golf.strokes === 1 ? '一桿進洞！！' : { '-3': '信天翁！', '-2': '老鷹！', '-1': '小鳥！', 0: '標準桿', 1: '柏忌', 2: '雙柏忌' }[diff] || `+${diff}`;
        g.label(this.hole.cup.x, 3.6, this.hole.cup.z, `${o.name} 第 ${o.golf.place} 個進洞：${name}（${o.golf.strokes} 桿）`, o.css, o.isHuman ? 40 : 28);
        if (o.isHuman) sfx.stageClear();
        else sfx.coin(false);
        if (this.finished === 1 && g.fighters.length > 1) {
          this.after = P.golfAfterFirst;
          g.label(this.hole.cup.x, 6, this.hole.cup.z, `其他人剩 ${P.golfAfterFirst} 秒！`, '#ff6b5a', 32);
        }
      }
      o.golf.ball = null;
    } else {
      // 掉出球場：稍後在上一桿的位置放回來
      this.penalty(b, '掉出球場');
      o.golf.respawnT = 0.8;
    }
    return true;
  }

  respawnPoint(f) {
    const b = f.golf && f.golf.ball && this.game.units.includes(f.golf.ball) ? f.golf.ball : null;
    const p = b ? b.restPos || b : this.hole.tee;
    return { x: p.x - 1.2, z: p.z };
  }

  update(dt) {
    const g = this.game;
    const hole = this.hole;
    if (!hole) return;
    updateHole(hole, dt, g);
    if (this.state === 'between') {
      this.t -= dt;
      if (this.t <= 0) {
        if (this.index + 1 < this.defs.length) this.loadHole(this.index + 1);
        else this.finish();
      }
      this.renderUi();
      return;
    }
    if (this.state !== 'play') return;
    for (const f of g.fighters) {
      const gf = f.golf;
      if (!gf || gf.done) continue;
      const b = gf.ball;
      if (b && g.units.includes(b)) {
        if (b.state === 'idle' || b.state === 'down') b.restPos = { x: b.x, z: b.z };
      } else {
        gf.respawnT -= dt;
        if (gf.respawnT <= 0) this.spawnBall(f, gf.safe || hole.tee);
      }
      if (b && b.safe) gf.safe = b.safe;
    }
    this.timeLeft -= dt;
    if (this.after !== null) this.after -= dt;
    const allDone = g.fighters.every((f) => f.golf.done);
    if (allDone || this.timeLeft <= 0 || (this.after !== null && this.after <= 0)) this.endHole();
    this.renderUi();
  }

  endHole() {
    const g = this.game;
    const par = this.hole.par;
    for (const f of g.fighters) {
      const gf = f.golf;
      if (!gf.done) {
        gf.strokes = Math.min(par + P.golfMaxOver, Math.max(gf.strokes, par) + 2); // 沒進洞：至少標準桿再罰 2 桿
        gf.place = 0;
      }
      const pts = gf.place ? ORDER_POINTS[gf.place - 1] ?? 1 : 0;
      f.total.strokes += gf.strokes;
      f.total.points += pts;
      f.total.holes.push({ strokes: gf.strokes, place: gf.place });
    }
    this.state = 'between';
    this.t = 3.2;
    g.label(this.hole.cup.x, 4.5, this.hole.cup.z, `第 ${this.index + 1} 洞結束`, '#ffffff', 36);
  }

  ranking() {
    const fs = [...this.game.fighters];
    return P.golfScoring === 'order'
      ? fs.sort((a, b) => b.total.points - a.total.points || a.total.strokes - b.total.strokes)
      : fs.sort((a, b) => a.total.strokes - b.total.strokes || b.total.points - a.total.points);
  }

  finish() {
    this.state = 'done';
    const rank = this.ranking();
    const me = rank.findIndex((f) => f.isHuman);
    const par = this.defs.reduce((s, d) => s + d.par, 0);
    if (me === 0) sfx.stageClear();
    else sfx.fail();
    const mode = P.golfScoring === 'order' ? '比完成順序' : '比總桿數';
    this.game.match.finishMini(me === 0 ? '你贏了！' : `你是第 ${me + 1} 名`, `${this.course.name} ${this.defs.length} 洞（標準桿 ${par}）・${mode}`,
      rank.map((f) => `${f.name}：${f.total.strokes} 桿（${f.total.strokes - par >= 0 ? '+' : ''}${f.total.strokes - par}）・順序分 ${f.total.points}`), '總成績');
  }

  // 鏡頭：跟著玩家（雙人時取中點並拉遠）
  cameraFocus() {
    const hs = this.game.fighters.filter((f) => f.isHuman && f.state !== 'out');
    if (!hs.length) return null;
    if (hs.length === 1) return { x: hs[0].x, z: hs[0].z, spread: 0 };
    return { x: (hs[0].x + hs[1].x) / 2, z: (hs[0].z + hs[1].z) / 2, spread: dist(hs[0], hs[1]) };
  }

  hudCells() {
    const me = this.game.player;
    const t = this.after !== null ? this.after : this.timeLeft;
    return [
      { k: `第 ${(this.index || 0) + 1}／${this.defs ? this.defs.length : 1} 洞`, v: this.hole ? this.hole.name : '' },
      { k: 'Par', v: String(this.hole ? this.hole.par : '') },
      { k: '你的桿數', v: me.golf ? (me.golf.done ? `${me.golf.strokes} ✓` : String(me.golf.strokes)) : '0' },
      { k: this.after !== null ? '其他人剩' : '剩餘時間', v: `${Math.max(0, Math.ceil(t))} 秒` },
    ];
  }

  // ── 排行榜和小地圖 ──
  buildUi() {
    this.ui = document.createElement('div');
    this.ui.className = 'golf-ui hud';
    this.ui.innerHTML = '<div class="golf-board"></div><canvas class="golf-map" width="260" height="150"></canvas>';
    document.body.appendChild(this.ui);
    this.boardEl = this.ui.querySelector('.golf-board');
    this.mapEl = this.ui.querySelector('.golf-map');
    this.boardText = '';
  }

  renderUi() {
    if (!this.ui) return;
    const g = this.game;
    const scoring = P.golfScoring === 'order';
    const rows = this.ranking().map((f) => {
      const gf = f.golf || {};
      const now = gf.capped ? '上限' : gf.done ? `進洞 #${gf.place}` : `${gf.strokes ?? 0} 桿`;
      const tot = scoring ? `${f.total.points} 分` : `${f.total.strokes} 桿`;
      return `<div class="gb-row${f.isHuman ? ' me' : ''}${gf.done ? ' done' : ''}"><i style="background:${f.css}"></i><b>${f.name}</b><span>${now}</span><em>${tot}</em></div>`;
    }).join('');
    const html = `<div class="gb-head">${scoring ? '比完成順序' : '比總桿數'}</div>${rows}`;
    if (html !== this.boardText) {
      this.boardText = html;
      this.boardEl.innerHTML = html;
    }
    // 小地圖：地形底圖＋球洞＋每個人的球和位置
    const hole = this.hole;
    const cv = this.mapEl;
    const ctx = cv.getContext('2d');
    if (!this.minimapBase) {
      this.minimapBase = hole.toCanvas();
      const s = Math.min(260 / hole.w, 150 / hole.h);
      cv.width = Math.round(hole.w * s);
      cv.height = Math.round(hole.h * s);
      this.mapScale = s;
    }
    const s = this.mapScale;
    const X = (x) => (x - hole.ox) * s;
    const Z = (z) => (z - hole.oz) * s;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.minimapBase, 0, 0, cv.width, cv.height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ff2a2a';
    ctx.beginPath();
    ctx.arc(X(hole.cup.x), Z(hole.cup.z), 3.5, 0, Math.PI * 2);
    ctx.fill();
    for (const f of g.fighters) {
      const b = f.golf && f.golf.ball;
      if (b && g.units.includes(b)) {
        ctx.fillStyle = f.css;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(X(b.x), Z(b.z), 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (f.state !== 'out') {
        ctx.strokeStyle = f.css;
        ctx.lineWidth = f.isHuman ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(X(f.x), Z(f.z), f.isHuman ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // ── AI 高爾夫球員 ──
  // 平常：沿著球洞的路線找「看得到、打得到」最遠的點，算好要按多久再出手。
  // 有時候（aiAggro）會去打旁邊對手的球；自己進洞後就專門搗蛋。
  aiCtrl(f, dt) {
    const g = this.game;
    const ai = f.ai;
    const ctrl = { move: { x: 0, z: 0 }, aim: null, hammer: false, hammerPressed: false, rollPressed: false };
    const finish = (hammer) => {
      ctrl.hammer = hammer;
      ctrl.hammerPressed = hammer && !ai.prevHammer;
      ai.prevHammer = hammer;
      return ctrl;
    };
    if (this.state !== 'play' || !f.golf) return finish(false);
    const hole = this.hole;
    const own = f.golf.ball && g.units.includes(f.golf.ball) ? f.golf.ball : null;
    ai.messT = (ai.messT ?? rand(2, 5)) - dt;
    if (ai.messT <= 0) {
      ai.messT = rand(3, 6);
      ai.mess = null;
      const rivals = g.units.filter((b) => b.type === 'golfball' && b.owner && b.owner !== f && !b.owner.golf.done && (b.state === 'idle' || b.state === 'down') && dist(b, f) < 9);
      const want = f.golf.done ? 0.8 : P.aiAggro * 0.5;
      if (rivals.length && Math.random() < want) ai.mess = rivals.sort((a, b) => dist(a, hole.cup) - dist(b, hole.cup))[0];
    }
    if (ai.mess && (!g.units.includes(ai.mess) || ai.mess.state === 'sliding')) ai.mess = null;
    const target = ai.mess || (f.golf.done ? null : own);
    if (!target) {
      // 沒事做：在球洞附近晃
      this.walkTo(f, ctrl, { x: hole.cup.x - 3, z: hole.cup.z + 2 }, dt);
      return finish(false);
    }
    if (target.state === 'sliding' || target.state === 'popped') {
      ai.gplan = null;
      this.walkTo(f, ctrl, target, dt, 2.5);
      return finish(false);
    }
    if (!ai.gplan || ai.gplan.ball !== target || dist(ai.gplan.at, target) > 0.3) ai.gplan = this.planShot(f, target, !!ai.mess);
    const pl = ai.gplan;
    const dx = Math.sin(pl.yaw);
    const dz = Math.cos(pl.yaw);
    const cue = { x: target.x - dx * (target.r + f.r + 0.55), z: target.z - dz * (target.r + f.r + 0.55) };
    const dc = dist(cue, f);
    if (dc > 0.35 && !f.holding) {
      this.walkTo(f, ctrl, cue, dt);
      return finish(false);
    }
    ctrl.aim = pl.yaw;
    if (dc > 0.35) {
      const m = Math.hypot(cue.x - f.x, cue.z - f.z) || 1;
      ctrl.move = { x: (cue.x - f.x) / m * 0.5, z: (cue.z - f.z) / m * 0.5 };
    }
    if (pl.tap) {
      if (f.tapCd > 0 || angGap(f.facing, pl.yaw) > 0.15) return finish(false);
      ai.gplan = null;
      return finish(!ai.prevHammer);
    }
    // 按住到需要的時間就放開
    const holding = f.holding;
    if (holding && f.holdT >= pl.holdT && angGap(f.facing, pl.yaw) < 0.12) {
      ai.gplan = null;
      return finish(false);
    }
    return finish(f.swingCd <= 0 || holding);
  }

  // 走到某個點（照走路的路線繞過牆和水）
  walkTo(f, ctrl, to, dt, stopAt = 0.3) {
    const ai = f.ai;
    const hole = this.hole;
    const d = dist(f, to);
    if (d < stopAt) return;
    ai.pathT = (ai.pathT || 0) - dt;
    if (ai.pathT <= 0 || !ai.walkPath) {
      ai.pathT = 0.6;
      ai.walkPath = hole.findPath(f, to, true) || [to];
    }
    let next = ai.walkPath[0];
    while (ai.walkPath.length > 1 && dist(next, f) < 0.8) {
      ai.walkPath.shift();
      next = ai.walkPath[0];
    }
    if (ai.walkPath.length === 1) next = to;
    const m = dist(next, f) || 1;
    const s = Math.min(1, d / 0.8);
    ctrl.move = { x: ((next.x - f.x) / m) * s, z: ((next.z - f.z) / m) * s };
  }

  planShot(f, ball, mess) {
    const hole = this.hole;
    const errYaw = (Math.random() * 2 - 1) * P.aiAimError * 0.6 * (Math.PI / 180);
    const errDist = 1 + (Math.random() * 2 - 1) * (0.04 + P.aiAimError * 0.006);
    let aim;
    let need;
    if (mess) {
      // 把別人的球往離球洞遠的方向打
      const ax = ball.x - hole.cup.x;
      const az = ball.z - hole.cup.z;
      const l = Math.hypot(ax, az) || 1;
      aim = { x: ball.x + (ax / l) * 8, z: ball.z + (az / l) * 8 };
      need = 9;
    } else {
      const path = hole.findPath(ball, hole.cup) || [hole.cup];
      aim = hole.cup;
      for (let i = path.length - 1; i >= 0; i--) {
        const p = path[i];
        const d = dist(ball, p);
        const fr = hole.avgFriction(ball, p);
        if (d * fr > P.golfDrive * 0.95) continue;
        if (!hole.lineClear(ball, p)) continue;
        aim = p;
        break;
      }
      const d = dist(ball, aim);
      const atCup = aim === hole.cup || dist(aim, hole.cup) < 0.5;
      need = (atCup ? d + 0.5 : d) * hole.avgFriction(ball, aim);
    }
    need = Math.max(0.5, Math.min(P.golfDrive, need * errDist));
    const yaw = Math.atan2(aim.x - ball.x, aim.z - ball.z) + errYaw;
    const tap = need <= P.golfTap * 1.15;
    const k = (need - P.golfTap) / (P.golfDrive - P.golfTap);
    const holdT = P.chargeLv1 + Math.max(0, k) * (P.chargeLv3 - P.chargeLv1);
    return { ball, at: { x: ball.x, z: ball.z }, yaw, holdT, tap };
  }
}
