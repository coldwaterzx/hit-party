// 高爾夫球場引擎：把一洞的設計（向量圖形或 PNG 圖片）變成可以玩的場地。
//
// 地形用格子記（預設 1 格＝0.25 m），每格是一種地形：
//   void 虛空（掉下去）、fairway 球道、green 果嶺、rough 長草、sand 沙坑、ice 冰面、water 水池、wall 牆
// 牆的碰撞用「有號距離場」（SDF）：斜牆、圓弧牆都能照真正的角度反彈，不會一格一格卡卡的。
// 高度另外用 0.5 m 一格的高度圖，球會順著坡滾（game.js 的 stepSlide）。
//
// 一洞的設計（courses.js），座標以這一洞的左上角為 (0, 0)，單位 m：
//   { name, par, size: [寬, 高], tee: [x, z], cup: [x, z], rails（四周自動加牆，預設 true）,
//     shapes: [{ t: 'rect'|'circle'|'poly'|'path'|'ring', terrain, ... }]（後畫的蓋掉先畫的）,
//     noRails: [{ x, z, w, h }]（這些矩形裡不自動加牆）,
//     heights: [{ t: 'hill'|'ramp', ... }], items: [{ type: 'bumper'|'windmill'|'boost'|'teleport'|'conveyor'|'gate', ... }] }
import * as THREE from 'three';
import { toon, canvasTex, makeTree } from './world.js';

export const CELL = 0.25;
export const TERRAIN = {
  void: { id: 0, name: '虛空', color: '#000000', friction: 1 },
  fairway: { id: 1, name: '球道', color: '#5fae4a', friction: 1 },
  green: { id: 2, name: '果嶺', color: '#86d46c', friction: 0.75 },
  rough: { id: 3, name: '長草', color: '#3b7a33', friction: 2.6 },
  sand: { id: 4, name: '沙坑', color: '#e6cf94', friction: 5 },
  ice: { id: 5, name: '冰面', color: '#bfe8ff', friction: 0.25 },
  water: { id: 6, name: '水池', color: '#2f7fc4', friction: 1 },
  wall: { id: 7, name: '牆', color: '#8a5a32', friction: 1 },
};
const BY_ID = Object.values(TERRAIN);
const ID = Object.fromEntries(Object.entries(TERRAIN).map(([k, v]) => [k, v.id]));
// PNG 匯入時的標記色：白＝發球台、紅＝球洞
export const MARKERS = { tee: '#ffffff', cup: '#ff0000' };
const SLOPE_G = 12; // 坡度造成的加速度（m/s²，乘上坡度）

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ───────────────────────── 形狀判斷 ─────────────────────────

function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

function inShape(s, x, z) {
  switch (s.t) {
    case 'rect':
      return x >= s.x && x <= s.x + s.w && z >= s.z && z <= s.z + s.h;
    case 'circle':
      return Math.hypot(x - s.x, z - s.z) <= s.r;
    case 'ring': {
      const d = Math.hypot(x - s.x, z - s.z);
      return d >= s.r1 && d <= s.r2;
    }
    case 'path': {
      for (let i = 0; i < s.pts.length - 1; i++) {
        const [ax, az] = s.pts[i];
        const [bx, bz] = s.pts[i + 1];
        if (segDist(x, z, ax, az, bx, bz) <= s.width / 2) return true;
      }
      return false;
    }
    case 'poly': {
      let inside = false;
      const p = s.pts;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, zi] = p[i];
        const [xj, zj] = p[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    }
    default:
      return false;
  }
}

// 高度：小山（餘弦形狀）、坡道（矩形內沿一個方向線性升高）
function heightAt(heights, x, z) {
  let h = 0;
  for (const s of heights) {
    if (s.t === 'hill') {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.r) h += (s.h * (1 + Math.cos((Math.PI * d) / s.r))) / 2;
    } else if (s.t === 'ramp') {
      // dir：'x'＝往 +x 升高、'-x'、'z'、'-z'；h＝升高幾公尺；矩形外保持最後的高度
      const inX = x >= s.x && x <= s.x + s.w;
      const inZ = z >= s.z && z <= s.z + s.h;
      if (s.dir === 'x' || s.dir === '-x') {
        if (!inZ) continue;
        const k = Math.max(0, Math.min(1, (x - s.x) / s.w));
        h += s.rise * (s.dir === 'x' ? k : 1 - k);
      } else {
        if (!inX) continue;
        const k = Math.max(0, Math.min(1, (z - s.z) / s.h));
        h += s.rise * (s.dir === 'z' ? k : 1 - k);
      }
    }
  }
  return h;
}

// 兩段式倒角距離轉換（3-4 chamfer）：每格到最近的「目標格」有多遠（格數）
function distanceField(mask, cols, rows) {
  const INF = 1e9;
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const a = 1;
  const b = Math.SQRT2;
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const i = z * cols + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (z > 0) {
        v = Math.min(v, d[i - cols] + a);
        if (x > 0) v = Math.min(v, d[i - cols - 1] + b);
        if (x < cols - 1) v = Math.min(v, d[i - cols + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let z = rows - 1; z >= 0; z--) {
    for (let x = cols - 1; x >= 0; x--) {
      const i = z * cols + x;
      let v = d[i];
      if (x < cols - 1) v = Math.min(v, d[i + 1] + a);
      if (z < rows - 1) {
        v = Math.min(v, d[i + cols] + a);
        if (x < cols - 1) v = Math.min(v, d[i + cols + 1] + b);
        if (x > 0) v = Math.min(v, d[i + cols - 1] + b);
      }
      d[i] = v;
    }
  }
  return d;
}

// 有號距離場（m）：在 solid 外面是正的、裡面是負的
function signedField(solid, cols, rows) {
  const out = distanceField(solid, cols, rows);
  const free = new Uint8Array(solid.length);
  for (let i = 0; i < solid.length; i++) free[i] = solid[i] ? 0 : 1;
  const inn = distanceField(free, cols, rows);
  const sdf = new Float32Array(solid.length);
  for (let i = 0; i < solid.length; i++) sdf[i] = (solid[i] ? -(inn[i] - 0.5) : out[i] - 0.5) * CELL;
  return sdf;
}

// ───────────────────────── 一洞的執行期資料 ─────────────────────────

export class CourseHole {
  // def：一洞的設計；或 { image: ImageData 版的格子 } 由 fromImage() 產生
  constructor(def, types = null) {
    this.def = def;
    this.name = def.name;
    this.par = def.par;
    [this.w, this.h] = def.size;
    this.cols = Math.ceil(this.w / CELL);
    this.rows = Math.ceil(this.h / CELL);
    this.ox = -this.w / 2; // 世界座標＝本地座標＋o
    this.oz = -this.h / 2;
    this.heights = def.heights || [];
    this.types = types || this.rasterize();
    if (def.rails !== false) this.addRails();
    this.buildFields();
    this.buildHeight();
    this.tee = this.toWorld(def.tee);
    this.cup = this.toWorld(def.cup);
    this.items = (def.items || []).map((it) => ({ ...it }));
    this.time = 0;
    this.buildNav();
  }

  toWorld([x, z]) {
    return { x: x + this.ox, z: z + this.oz };
  }

  get bounds() {
    return { minX: this.ox, maxX: this.ox + this.w, minZ: this.oz, maxZ: this.oz + this.h };
  }

  rasterize() {
    const t = new Uint8Array(this.cols * this.rows);
    const shapes = this.def.shapes || [];
    for (let r = 0; r < this.rows; r++) {
      const z = (r + 0.5) * CELL;
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * CELL;
        let id = 0;
        for (const s of shapes) if (inShape(s, x, z)) id = ID[s.terrain];
        t[r * this.cols + c] = id;
      }
    }
    return t;
  }

  // 四周自動加牆：虛空中離可以打的地方 0.5 m 內的格子變成牆
  addRails() {
    const { cols, rows, types } = this;
    const add = [];
    const R = 2;
    const open = this.def.noRails || []; // 這些矩形裡不加牆（例如沒有欄杆的窄橋）
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (types[r * cols + c] !== ID.void) continue;
        const lx = (c + 0.5) * CELL;
        const lz = (r + 0.5) * CELL;
        if (open.some((o) => lx >= o.x && lx <= o.x + o.w && lz >= o.z && lz <= o.z + o.h)) continue;
        let near = false;
        for (let dr = -R; dr <= R && !near; dr++) {
          for (let dc = -R; dc <= R; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
            const v = types[rr * cols + cc];
            if (v !== ID.void && v !== ID.wall) {
              near = true;
              break;
            }
          }
        }
        if (near) add.push(r * cols + c);
      }
    }
    for (const i of add) types[i] = ID.wall;
  }

  buildFields() {
    const n = this.cols * this.rows;
    const wall = new Uint8Array(n);
    const walk = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = this.types[i];
      wall[i] = v === ID.wall ? 1 : 0;
      walk[i] = v === ID.wall || v === ID.water || v === ID.void ? 1 : 0;
    }
    this.sdfWall = signedField(wall, this.cols, this.rows);
    this.sdfWalk = signedField(walk, this.cols, this.rows);
  }

  // 高度圖：0.5 m 一格
  buildHeight() {
    this.hc = Math.ceil(this.w / 0.5) + 1;
    this.hr = Math.ceil(this.h / 0.5) + 1;
    this.hgrid = new Float32Array(this.hc * this.hr);
    this.flat = !this.heights.length && !this.def.heightData;
    for (let r = 0; r < this.hr; r++) {
      for (let c = 0; c < this.hc; c++) {
        const x = c * 0.5;
        const z = r * 0.5;
        this.hgrid[r * this.hc + c] = this.def.heightData ? this.def.heightData(x, z) : heightAt(this.heights, x, z);
      }
    }
  }

  // ── 查詢（世界座標） ──
  cellIndex(x, z) {
    const c = Math.floor((x - this.ox) / CELL);
    const r = Math.floor((z - this.oz) / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  typeAt(x, z) {
    const i = this.cellIndex(x, z);
    return i < 0 ? ID.void : this.types[i];
  }

  terrainAt(x, z) {
    return BY_ID[this.typeAt(x, z)];
  }

  friction(x, z) {
    return this.terrainAt(x, z).friction;
  }

  isVoid(x, z) {
    return this.typeAt(x, z) === ID.void;
  }

  isWater(x, z) {
    return this.typeAt(x, z) === ID.water;
  }

  // 距離場雙線性取樣（超出範圍：牆場當作遠離牆、走路場當作撞牆）
  sample(field, x, z, outside) {
    const fx = (x - this.ox) / CELL - 0.5;
    const fz = (z - this.oz) / CELL - 0.5;
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    if (c < 0 || r < 0 || c >= this.cols - 1 || r >= this.rows - 1) return outside;
    const tx = fx - c;
    const tz = fz - r;
    const i = r * this.cols + c;
    const a = field[i] * (1 - tx) + field[i + 1] * tx;
    const b = field[i + this.cols] * (1 - tx) + field[i + this.cols + 1] * tx;
    return a * (1 - tz) + b * tz;
  }

  // 碰到牆（r＝半徑）：回傳跟 world.js wallHit 一樣格式的法線和接觸點
  fieldHit(field, x, z, r, outside) {
    const d = this.sample(field, x, z, outside);
    if (d >= r) return null;
    const e = CELL * 0.6;
    let nx = this.sample(field, x + e, z, outside) - this.sample(field, x - e, z, outside);
    let nz = this.sample(field, x, z + e, outside) - this.sample(field, x, z - e, outside);
    const l = Math.hypot(nx, nz);
    if (l < 1e-6) return null;
    nx /= l;
    nz /= l;
    return { nx, nz, cx: x - nx * d, cz: z - nz * d };
  }

  wallHit(x, z, r) {
    return this.fieldHit(this.sdfWall, x, z, r, 10) || this.dynamicHit(x, z, r);
  }

  // 走路：不能走進牆、水、虛空
  walkPush(o, r) {
    for (let k = 0; k < 3; k++) {
      const h = this.fieldHit(this.sdfWalk, o.x, o.z, r, -1);
      if (!h) return;
      o.x = h.cx + h.nx * (r + 0.01);
      o.z = h.cz + h.nz * (r + 0.01);
    }
  }

  height(x, z) {
    if (this.flat) return 0;
    const fx = Math.max(0, Math.min(this.hc - 1.001, (x - this.ox) / 0.5));
    const fz = Math.max(0, Math.min(this.hr - 1.001, (z - this.oz) / 0.5));
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const tx = fx - c;
    const tz = fz - r;
    const i = r * this.hc + c;
    const g = this.hgrid;
    return (g[i] * (1 - tx) + g[i + 1] * tx) * (1 - tz) + (g[i + this.hc] * (1 - tx) + g[i + this.hc + 1] * tx) * tz;
  }

  // 坡度造成的加速度（往低處）
  slopeAccel(x, z) {
    if (this.flat) return null;
    const e = 0.4;
    const gx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const gz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return { x: -gx * SLOPE_G, z: -gz * SLOPE_G, mag: Math.hypot(gx, gz) * SLOPE_G };
  }

  // ── 機關（會動的牆：風車葉片、定時門） ──
  segments() {
    const out = [];
    for (const it of this.items) {
      if (it.type === 'windmill') {
        const c = this.toWorld([it.x, it.z]);
        for (let b = 0; b < (it.blades || 4); b++) {
          const a = this.time * it.speed + (b / (it.blades || 4)) * Math.PI * 2;
          out.push({ ax: c.x, az: c.z, bx: c.x + Math.cos(a) * it.len, bz: c.z + Math.sin(a) * it.len, t: 0.18, item: it, angle: a });
        }
      } else if (it.type === 'gate' && this.gateClosed(it)) {
        const a = this.toWorld([it.x1, it.z1]);
        const b = this.toWorld([it.x2, it.z2]);
        out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, t: 0.2, item: it });
      }
    }
    return out;
  }

  gateClosed(it) {
    const p = ((this.time + (it.offset || 0)) % it.period) / it.period;
    return p < 0.5;
  }

  dynamicHit(x, z, r) {
    for (const s of this.segments()) {
      const vx = s.bx - s.ax;
      const vz = s.bz - s.az;
      const l2 = vx * vx + vz * vz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (z - s.az) * vz) / l2));
      const px = s.ax + vx * t;
      const pz = s.az + vz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < r + s.t && d > 1e-6) return { nx: (x - px) / d, nz: (z - pz) / d, cx: px + ((x - px) / d) * s.t, cz: pz + ((z - pz) / d) * s.t, seg: s };
    }
    return null;
  }

  // ── 尋路（AI 用）：1 m 一格的導航格 ──
  buildNav() {
    this.nc = Math.ceil(this.w);
    this.nr = Math.ceil(this.h);
    // 傳送門：導航時可以從入口直接跳到出口
    this.portals = (this.def.items || []).filter((it) => it.type === 'teleport').map((it) => {
      const a = this.toWorld(it.a);
      const b = this.toWorld(it.b);
      const cell = (p) => Math.floor(p.z - this.oz) * this.nc + Math.floor(p.x - this.ox);
      return { from: cell(a), to: cell(b) };
    });
    this.navBall = new Float32Array(this.nc * this.nr);
    this.navWalk = new Float32Array(this.nc * this.nr);
    for (let r = 0; r < this.nr; r++) {
      for (let c = 0; c < this.nc; c++) {
        const x = c + 0.5 + this.ox;
        const z = r + 0.5 + this.oz;
        const id = this.typeAt(x, z);
        const blocked = id === ID.wall || id === ID.water || id === ID.void || this.sample(this.sdfWall, x, z, 10) < 0.4;
        this.navBall[r * this.nc + c] = blocked ? 0 : BY_ID[id].friction;
        this.navWalk[r * this.nc + c] = this.sample(this.sdfWalk, x, z, -1) < 0.35 ? 0 : 1;
      }
    }
  }

  // A*：回傳世界座標的點列（找不到回傳 null）
  findPath(from, to, walk = false) {
    const nav = walk ? this.navWalk : this.navBall;
    const { nc, nr } = this;
    const idx = (p) => {
      const c = Math.max(0, Math.min(nc - 1, Math.floor(p.x - this.ox)));
      const r = Math.max(0, Math.min(nr - 1, Math.floor(p.z - this.oz)));
      return r * nc + c;
    };
    const s = idx(from);
    const g = idx(to);
    const cost = new Float32Array(nc * nr).fill(Infinity);
    const prev = new Int32Array(nc * nr).fill(-1);
    const open = [s];
    cost[s] = 0;
    const hx = g % nc;
    const hz = Math.floor(g / nc);
    const heur = (i) => Math.hypot((i % nc) - hx, Math.floor(i / nc) - hz);
    const fscore = new Float32Array(nc * nr).fill(Infinity);
    fscore[s] = heur(s);
    let guard = 0;
    while (open.length && guard++ < 20000) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (fscore[open[k]] < fscore[open[bi]]) bi = k;
      const cur = open.splice(bi, 1)[0];
      if (cur === g) break;
      const cx = cur % nc;
      const cz = Math.floor(cur / nc);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= nc || z >= nr) continue;
          const j = z * nc + x;
          const w = nav[j];
          if (!w && j !== g) continue;
          const step = (dx && dz ? Math.SQRT2 : 1) * (w || 1);
          const ncst = cost[cur] + step;
          if (ncst < cost[j]) {
            cost[j] = ncst;
            prev[j] = cur;
            fscore[j] = ncst + heur(j);
            if (!open.includes(j)) open.push(j);
          }
        }
      }
      for (const p of this.portals) {
        if (walk || p.from !== cur || cost[cur] + 1 >= cost[p.to]) continue;
        cost[p.to] = cost[cur] + 1;
        prev[p.to] = cur;
        fscore[p.to] = cost[p.to] + heur(p.to);
        if (!open.includes(p.to)) open.push(p.to);
      }
    }
    if (prev[g] === -1 && g !== s) return null;
    const path = [];
    for (let i = g; i !== -1; i = prev[i]) path.unshift({ x: (i % nc) + 0.5 + this.ox, z: Math.floor(i / nc) + 0.5 + this.oz });
    path[path.length - 1] = { ...to };
    return path;
  }

  // 球沿直線滑過去不會碰到牆、水、虛空
  lineClear(a, b, r = 0.3) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(d / 0.25);
    for (let i = 1; i <= n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n;
      const z = a.z + ((b.z - a.z) * i) / n;
      const id = this.typeAt(x, z);
      if (id === ID.water || id === ID.void || this.sample(this.sdfWall, x, z, 10) < r) return false;
    }
    return true;
  }

  // 一段路的平均摩擦力（AI 估算要打多遠）
  avgFriction(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / 0.5));
    let s = 0;
    for (let i = 0; i <= n; i++) s += this.friction(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n);
    return s / (n + 1);
  }

  // ── 匯出地形圖（PNG，1 格 1 像素） ──
  toCanvas() {
    const c = document.createElement('canvas');
    c.width = this.cols;
    c.height = this.rows;
    const g = c.getContext('2d');
    const img = g.createImageData(this.cols, this.rows);
    for (let i = 0; i < this.types.length; i++) {
      const [r, gg, b] = hexRgb(BY_ID[this.types[i]].color);
      img.data.set([r, gg, b, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
    const mark = (p, col) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc((p.x - this.ox) / CELL, (p.z - this.oz) / CELL, 2.5, 0, Math.PI * 2);
      g.fill();
    };
    mark(this.tee, MARKERS.tee);
    mark(this.cup, MARKERS.cup);
    return c;
  }
}

// PNG 圖片 → 一洞（顏色照 TERRAIN 的顏色取最接近的；白點＝發球台、紅點＝球洞）
export function holeFromImage(img, name = '自訂球洞', par = 4) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const palette = BY_ID.map((t) => ({ id: t.id, rgb: hexRgb(t.color) }));
  const types = new Uint8Array(c.width * c.height);
  const tee = [];
  const cup = [];
  for (let i = 0; i < types.length; i++) {
    const r = data[i * 4];
    const gg = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    if (a < 128) continue;
    if (r > 235 && gg > 235 && b > 235) {
      tee.push(i);
      types[i] = ID.fairway;
      continue;
    }
    if (r > 220 && gg < 60 && b < 60) {
      cup.push(i);
      types[i] = ID.green;
      continue;
    }
    let best = 0;
    let bd = Infinity;
    for (const p of palette) {
      const d = (r - p.rgb[0]) ** 2 + (gg - p.rgb[1]) ** 2 + (b - p.rgb[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = p.id;
      }
    }
    types[i] = best;
  }
  if (!tee.length || !cup.length) throw new Error('圖片裡要有白色（發球台）和紅色（球洞）的點');
  const center = (list) => {
    let sx = 0;
    let sz = 0;
    for (const i of list) {
      sx += (i % c.width) + 0.5;
      sz += Math.floor(i / c.width) + 0.5;
    }
    return [(sx / list.length) * CELL, (sz / list.length) * CELL];
  };
  const def = { name, par, size: [c.width * CELL, c.height * CELL], tee: center(tee), cup: center(cup), rails: false, items: [] };
  return new CourseHole(def, types);
}

// ───────────────────────── 畫出來 ─────────────────────────

const CUP_R = 0.55;
export { CUP_R };

function terrainTexture(hole) {
  const px = 4;
  const c = document.createElement('canvas');
  c.width = hole.cols * px;
  c.height = hole.rows * px;
  const g = c.getContext('2d');
  // 先畫小張（1 格 1 像素），再放大模糊一點，邊緣比較順
  const small = document.createElement('canvas');
  small.width = hole.cols;
  small.height = hole.rows;
  const sg = small.getContext('2d');
  const img = sg.createImageData(hole.cols, hole.rows);
  for (let r = 0; r < hole.rows; r++) {
    for (let col = 0; col < hole.cols; col++) {
      const i = r * hole.cols + col;
      const t = BY_ID[hole.types[i]];
      let [rr, gg, bb] = hexRgb(t.color);
      // 球道、果嶺有割草條紋；高的地方亮一點
      if (t.id === ID.fairway || t.id === ID.green) {
        const stripe = Math.floor(col / 12) % 2 ? 1.06 : 0.96;
        rr *= stripe;
        gg *= stripe;
        bb *= stripe;
      }
      const hgt = hole.height(col * CELL + hole.ox, r * CELL + hole.oz);
      const k = 1 + hgt * 0.06;
      img.data.set([Math.min(255, rr * k), Math.min(255, gg * k), Math.min(255, bb * k), t.id === ID.void ? 0 : 255], i * 4);
    }
  }
  sg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.filter = 'blur(1.5px)';
  g.drawImage(small, 0, 0, c.width, c.height);
  g.filter = 'none';
  // 雜點
  for (let i = 0; i < c.width * c.height * 0.01; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
  }
  const tex = canvasTex(c);
  return tex;
}

export function buildHoleMesh(hole) {
  const g = new THREE.Group();
  // 地面（照高度起伏）
  const segX = Math.max(1, Math.round(hole.w / 0.5));
  const segZ = Math.max(1, Math.round(hole.h / 0.5));
  const geo = new THREE.PlaneGeometry(hole.w, hole.h, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, hole.height(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, toon(0xffffff, { map: terrainTexture(hole), transparent: true, alphaTest: 0.5 }));
  g.add(ground);
  // 地面的側邊（厚度）
  const base = new THREE.Mesh(new THREE.BoxGeometry(hole.w, 0.01, hole.h), new THREE.MeshBasicMaterial({ visible: false }));
  g.add(base);

  // 牆：每一列連在一起的牆格合成一個長方塊，用 InstancedMesh 一次畫
  const boxes = [];
  for (let r = 0; r < hole.rows; r++) {
    let start = -1;
    for (let c = 0; c <= hole.cols; c++) {
      const isWall = c < hole.cols && hole.types[r * hole.cols + c] === ID.wall;
      if (isWall && start < 0) start = c;
      if (!isWall && start >= 0) {
        boxes.push({ r, c0: start, c1: c });
        start = -1;
      }
    }
  }
  if (boxes.length) {
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    const inst = new THREE.InstancedMesh(wallGeo, toon(0x8a5a32), boxes.length);
    const m = new THREE.Matrix4();
    boxes.forEach((b, i) => {
      const w = (b.c1 - b.c0) * CELL;
      const x = hole.ox + (b.c0 * CELL + w / 2);
      const z = hole.oz + (b.r + 0.5) * CELL;
      const y = hole.height(x, z);
      m.makeScale(w, 0.7, CELL);
      m.setPosition(x, y + 0.35, z);
      inst.setMatrixAt(i, m);
    });
    g.add(inst);
  }

  // 發球台、球洞、旗子
  const ty = hole.height(hole.tee.x, hole.tee.z);
  const tee = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), toon(0x2f6b2a));
  tee.rotation.x = -Math.PI / 2;
  tee.position.set(hole.tee.x, ty + 0.02, hole.tee.z);
  g.add(tee);
  const cy = hole.height(hole.cup.x, hole.cup.z);
  const cupMesh = new THREE.Mesh(new THREE.CircleGeometry(CUP_R, 24), new THREE.MeshBasicMaterial({ color: 0x050505 }));
  cupMesh.rotation.x = -Math.PI / 2;
  cupMesh.position.set(hole.cup.x, cy + 0.03, hole.cup.z);
  g.add(cupMesh);
  const rim = new THREE.Mesh(new THREE.RingGeometry(CUP_R, CUP_R + 0.08, 24), toon(0xf4f4f4));
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(hole.cup.x, cy + 0.032, hole.cup.z);
  g.add(rim);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5, 8), toon(0xf4f4f4));
  pole.position.set(hole.cup.x, cy + 2.5, hole.cup.z);
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.85), new THREE.MeshBasicMaterial({ color: 0xe8505b, side: THREE.DoubleSide }));
  flag.position.set(hole.cup.x + 0.7, cy + 4.5, hole.cup.z);
  g.add(flag);
  hole.flag = flag;

  // 機關
  hole.itemMeshes = [];
  for (const it of hole.items) {
    const p = it.x !== undefined ? hole.toWorld([it.x, it.z]) : null;
    if (it.type === 'bumper') {
      const b = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(it.r * 0.55, it.r * 0.65, 0.5, 16), toon(0xf4f4f4));
      stem.position.y = 0.25;
      b.add(stem);
      it.capMat = toon(it.color || 0xff4fa0, { emissive: it.color || 0xff4fa0, emissiveIntensity: 0.25 });
      const cap = new THREE.Mesh(new THREE.SphereGeometry(it.r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), it.capMat);
      cap.position.y = 0.45;
      b.add(cap);
      b.position.set(p.x, hole.height(p.x, p.z), p.z);
      g.add(b);
    } else if (it.type === 'windmill') {
      const wg = new THREE.Group();
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 2.4, 8), toon(0xf4ead8));
      tower.position.y = 1.2;
      wg.add(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.9, 8), toon(0xd23a2a));
      roof.position.y = 2.85;
      wg.add(roof);
      const blades = new THREE.Group();
      blades.position.y = 0.35;
      for (let k = 0; k < (it.blades || 4); k++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(it.len, 0.25, 0.36), toon(0x8a5a32));
        bl.position.x = it.len / 2;
        const holder = new THREE.Group();
        holder.rotation.y = -(k / (it.blades || 4)) * Math.PI * 2;
        holder.add(bl);
        blades.add(holder);
      }
      wg.add(blades);
      wg.position.set(p.x, hole.height(p.x, p.z), p.z);
      g.add(wg);
      it.blades3d = blades;
    } else if (it.type === 'boost') {
      const c2 = document.createElement('canvas');
      c2.width = c2.height = 64;
      const x2 = c2.getContext('2d');
      x2.fillStyle = '#ff8a1a';
      x2.beginPath();
      x2.arc(32, 32, 31, 0, Math.PI * 2);
      x2.fill();
      x2.fillStyle = '#fff3c4';
      for (const off of [-12, 4]) {
        x2.beginPath();
        x2.moveTo(32 + off + 14, 32);
        x2.lineTo(32 + off, 18);
        x2.lineTo(32 + off, 46);
        x2.closePath();
        x2.fill();
      }
      const pad = new THREE.Mesh(new THREE.CircleGeometry(it.r, 28), new THREE.MeshBasicMaterial({ map: canvasTex(c2), transparent: true }));
      pad.rotation.x = -Math.PI / 2;
      pad.rotation.z = -((it.angle || 0) * Math.PI) / 180;
      pad.position.set(p.x, hole.height(p.x, p.z) + 0.04, p.z);
      g.add(pad);
    } else if (it.type === 'teleport') {
      for (const [end, col] of [[it.a, 0x7fe0ff], [it.b, 0xc48bff]]) {
        const q = hole.toWorld(end);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.12, 8, 28), toon(col, { emissive: col, emissiveIntensity: 0.7 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.set(q.x, hole.height(q.x, q.z) + 0.12, q.z);
        g.add(ring);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35 }));
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(q.x, hole.height(q.x, q.z) + 0.05, q.z);
        g.add(disc);
        hole.itemMeshes.push(ring);
      }
    } else if (it.type === 'conveyor') {
      const c3 = document.createElement('canvas');
      c3.width = 64;
      c3.height = 64;
      const x3 = c3.getContext('2d');
      x3.fillStyle = '#3a3f4a';
      x3.fillRect(0, 0, 64, 64);
      x3.fillStyle = '#f2c230';
      for (let k = 0; k < 64; k += 32) {
        x3.beginPath();
        x3.moveTo(k + 24, 32);
        x3.lineTo(k + 8, 16);
        x3.lineTo(k + 8, 48);
        x3.closePath();
        x3.fill();
      }
      const tex = canvasTex(c3, true);
      tex.repeat.set(it.w / 2, it.h / 2);
      const belt = new THREE.Mesh(new THREE.PlaneGeometry(it.w, it.h), new THREE.MeshBasicMaterial({ map: tex }));
      belt.rotation.x = -Math.PI / 2;
      const q = hole.toWorld([it.x + it.w / 2, it.z + it.h / 2]);
      belt.position.set(q.x, hole.height(q.x, q.z) + 0.03, q.z);
      // 箭頭方向：angle 0＝往 +x
      tex.rotation = 0;
      tex.center.set(0.5, 0.5);
      tex.rotation = ((it.angle || 0) * Math.PI) / 180;
      g.add(belt);
      it.tex = tex;
    } else if (it.type === 'gate') {
      const a = hole.toWorld([it.x1, it.z1]);
      const b = hole.toWorld([it.x2, it.z2]);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, 0.35), toon(0xd23a2a));
      bar.position.set((a.x + b.x) / 2, hole.height((a.x + b.x) / 2, (a.z + b.z) / 2) + 0.3, (a.z + b.z) / 2);
      bar.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      g.add(bar);
      it.bar = bar;
      it.barY = bar.position.y;
    }
  }

  // 下面的大地、遠處的樹（球場是浮在空中的島）
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), toon(0x2c5228)); // 暗一點，跟球場分得出來
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -12;
  g.add(lawn);
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.max(hole.w, hole.h) * 0.6 + 8 + Math.random() * 30;
    const t = makeTree(2 + Math.random() * 1.5);
    t.position.set(Math.cos(a) * r, -12, Math.sin(a) * r);
    g.add(t);
  }
  hole.group = g;
  return g;
}

// 每幀：轉風車、動輸送帶、定時門，以及機關對球／角色的效果
export function updateHole(hole, dt, game) {
  hole.time += dt;
  for (const it of hole.items) {
    if (it.type === 'windmill' && it.blades3d) it.blades3d.rotation.y = -hole.time * it.speed;
    if (it.type === 'conveyor' && it.tex) it.tex.offset.x -= dt * it.speed * 0.25;
    if (it.type === 'gate' && it.bar) {
      const closed = hole.gateClosed(it);
      it.bar.position.y += ((closed ? it.barY : it.barY - 0.75) - it.bar.position.y) * Math.min(1, dt * 10);
    }
  }
  for (const r of hole.itemMeshes) r.rotation.z += dt * 2;
  if (dt <= 0) return;
  for (const b of game.bodies()) {
    if (!game.solid(b)) continue;
    for (const it of hole.items) {
      if (it.type === 'boost' && !b.isFighter) {
        const p = hole.toWorld([it.x, it.z]);
        if (Math.hypot(b.x - p.x, b.z - p.z) > it.r || (b.boostT || 0) > hole.time) continue;
        b.boostT = hole.time + 0.6;
        const a = ((it.angle || 0) * Math.PI) / 180;
        const sp = Math.max(Math.hypot(b.vx, b.vz), it.power || 18);
        game.slideBody(b, Math.cos(a) * sp, Math.sin(a) * sp, b.lastHitBy);
        if (it.jump) b.vy = 7; // 跳台：飛起來可以越過水池
        game.fx.ring(p.x, p.z, it.r + 0.6, 0xff8a1a, 0.3, 0.15);
      } else if (it.type === 'teleport' && !b.isFighter) {
        // 傳送門只傳送球（人走窄橋過去）
        const a = hole.toWorld(it.a);
        if (Math.hypot(b.x - a.x, b.z - a.z) > 0.8 || (b.portT || 0) > hole.time) continue;
        const to = hole.toWorld(it.b);
        b.portT = hole.time + 1.2;
        game.fx.ring(a.x, a.z, 1.4, 0x7fe0ff, 0.3, 0.15);
        b.x = to.x;
        b.z = to.z;
        game.fx.ring(to.x, to.z, 1.4, 0xc48bff, 0.3, 0.15);
      } else if (it.type === 'conveyor') {
        const q = hole.toWorld([it.x, it.z]);
        if (b.x < q.x || b.x > q.x + it.w || b.z < q.z || b.z > q.z + it.h) continue;
        const a = ((it.angle || 0) * Math.PI) / 180;
        if (b.isFighter) {
          if (b.state === 'normal') {
            b.x += Math.cos(a) * it.speed * dt;
            b.z += Math.sin(a) * it.speed * dt;
          }
        } else if (b.state === 'sliding') {
          b.vx += Math.cos(a) * it.speed * 3 * dt;
          b.vz += Math.sin(a) * it.speed * 3 * dt;
        } else {
          game.slideBody(b, Math.cos(a) * it.speed, Math.sin(a) * it.speed, b.lastHitBy);
        }
      }
    }
    // 風車葉片、定時門掃到站著的東西：推開並給它葉片的速度
    if (b.state !== 'sliding') {
      const h = hole.dynamicHit(b.x, b.z, b.r);
      if (h) {
        b.x = h.cx + h.nx * (b.r + 0.02);
        b.z = h.cz + h.nz * (b.r + 0.02);
        if (h.seg.item.type === 'windmill' && !b.isFighter) {
          const it = h.seg.item;
          const dist = Math.hypot(b.x - h.seg.ax, b.z - h.seg.az);
          const sp = Math.max(3, it.speed * dist * 1.5);
          game.slideBody(b, h.nx * sp, h.nz * sp, b.lastHitBy);
        }
      }
    }
  }
}
