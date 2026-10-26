// 場景、場地、碰撞與 LoL 式鏡頭。
// 座標：x 向右、z 向畫面下方（朝鏡頭）、y 向上。1 單位＝1 m。
import * as THREE from 'three';
import { P } from './config.js';
import { CUP_R } from './course.js';

// 場地是超市門口的停車場，蓋在 7 m 高的平台上，26 m × 15 m。
// 上方是超市門面、左側是矮牆（可以壁咚）；右側與下方是平台邊緣，打出去會掉到街上。
export const ARENA = { minX: -13, maxX: 13, minZ: -7.5, maxZ: 7.5 };
// 高爾夫球場每一洞大小不一樣，會改 ARENA；換回一般地圖時還原成這個
const DEFAULT_ARENA = { ...ARENA };
export const PILLARS = [
  { x: -5, z: -2, hw: 0.6, hd: 0.6 },
  { x: 4.5, z: 2.5, hw: 0.6, hd: 0.6 },
];
// 停在格子裡的車，跟柱子一樣可以壁咚。nose：車頭朝 -z（-1）或 +z（1）
export const PARKED_CARS = [
  { x: -8.9, z: -4.3, hw: 0.9, hd: 2.1, nose: -1, color: 0xd94040 },
  { x: 8.9, z: -4.3, hw: 0.9, hd: 2.1, nose: -1, color: 0x3b6fd6 },
  { x: -6.3, z: 4.9, hw: 0.9, hd: 2.1, nose: 1, color: 0xf2f2f2 },
  { x: 1.5, z: 4.9, hw: 0.9, hd: 2.1, nose: 1, color: 0xf2c14e },
];
// 袋口：滑行中的東西經過就會掉進去
export const POCKET_R = 0.9;
// 停車場的袋口是沒蓋的排水孔
const CITY_POCKETS = [
  { x: -12.2, z: -6.7 },
  { x: 0, z: -6.85 },
  { x: 12.2, z: -6.7 },
  { x: -12.3, z: 0.4 },
  { x: -12.2, z: 6.7 },
];
// 撞球桌：四個角＋上下兩條長邊的中間，跟真的撞球桌一樣
const TABLE_POCKETS = [
  { x: -12.55, z: -7.05 }, { x: 0, z: -7.1 }, { x: 12.55, z: -7.05 },
  { x: -12.55, z: 7.05 }, { x: 0, z: 7.1 }, { x: 12.55, z: 7.05 },
];

// 足球場：左右兩邊牆上各開一個球門（寬 2 × GOAL_HALF、深 GOAL_DEPTH），門柱是小障礙物
export const GOAL_HALF = 2.5;
const GOAL_DEPTH = 1.2;
const GOAL_POSTS = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: sx * ARENA.maxX, z: sz * GOAL_HALF, hw: 0.15, hd: 0.15 })));

// 目前的地圖。
// sides：哪幾邊是開放的平台邊緣（打得出界）；沒開放的邊是牆。open＝有任何一邊開放。
// goalHalf＝球門半寬（0＝沒有球門）；laneHalf＝保齡球道半寬（超過就掉進溝裡，0＝沒有）；
// friction＝滑行減速倍率（冰面比較滑）；fallY＝掉出場外時，掉到這個高度就算消失。
// 障礙物：方塊 { x, z, hw, hd }，或圓柱 { x, z, rad }；bumper＝彈珠台的彈跳柱（撞到會加速彈開）。
// 切換地圖時直接改這幾個物件／陣列的內容，其他模組 import 的是同一份，不用重新 import
export const MAP = {
  id: 'city', open: true, sides: { l: false, r: true, t: false, b: true },
  goalHalf: 0, goalDepth: 0, laneHalf: 0, friction: 1, fallY: -7,
  grid: null, // 高爾夫球場（course.js 的 CourseHole）：地形、牆、高度都問它
  follow: false, // 鏡頭跟著玩家（場地比畫面大）
};

// 地面高度（只有高爾夫球場有起伏）
export function groundY(x, z) {
  return MAP.grid ? MAP.grid.height(x, z) : 0;
}
export const POCKETS = [...CITY_POCKETS];
export const OBSTACLES = [...PILLARS, ...PARKED_CARS];
const CLOSED = { l: false, r: false, t: false, b: false };
const MAP_DATA = {
  city: { sides: { l: false, r: true, t: false, b: true }, pockets: CITY_POCKETS, obstacles: [...PILLARS, ...PARKED_CARS] },
  table: { sides: CLOSED, pockets: TABLE_POCKETS, obstacles: [] },
  soccer: { sides: CLOSED, pockets: [], obstacles: GOAL_POSTS, goalHalf: GOAL_HALF, goalDepth: GOAL_DEPTH },
};
// 其他檔案（maps.js）加進來的地圖：{ group, data, look, tick }
const EXTRA = {};
// 街道高度：掉到這裡就算出局
export const LAVA_Y = -7;

const GRADIENT = (() => {
  const t = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

export function toon(color, extra = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT, ...extra });
}

// 撞牆判定：回傳牆面法線（指向場內），沒撞到回傳 null。
// ball＝足球：可以穿過球門口進到網子裡，其他東西撞到球門口就跟撞牆一樣
export function wallHit(x, z, r, ball = false) {
  if (MAP.grid) {
    const h = MAP.grid.wallHit(x, z, r);
    if (h) return h;
    return obstacleHit(x, z, r);
  }
  const G = MAP.goalHalf;
  if (G && ball && Math.abs(x) > ARENA.maxX) {
    // 已經在網子裡：撞後網、側網
    const back = ARENA.maxX + MAP.goalDepth;
    if (x - r < -back) return { nx: 1, nz: 0, cx: -back, cz: z };
    if (x + r > back) return { nx: -1, nz: 0, cx: back, cz: z };
    if (z + r > G) return { nx: 0, nz: -1, cx: x, cz: G };
    if (z - r < -G) return { nx: 0, nz: 1, cx: x, cz: -G };
    return null;
  }
  const mouth = G && ball && Math.abs(z) < G;
  const S = MAP.sides;
  if (!S.l && !mouth && x - r < ARENA.minX) return { nx: 1, nz: 0, cx: ARENA.minX, cz: z };
  if (!S.t && z - r < ARENA.minZ) return { nx: 0, nz: 1, cx: x, cz: ARENA.minZ };
  if (!S.r && !mouth && x + r > ARENA.maxX) return { nx: -1, nz: 0, cx: ARENA.maxX, cz: z };
  if (!S.b && z + r > ARENA.maxZ) return { nx: 0, nz: -1, cx: x, cz: ARENA.maxZ };
  return obstacleHit(x, z, r);
}

// 障礙物（方塊、圓柱、彈跳柱）
function obstacleHit(x, z, r) {
  for (const p of OBSTACLES) {
    if (p.rad) {
      const dx = x - p.x;
      const dz = z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < r + p.rad) {
        const nx = d > 1e-5 ? dx / d : 0;
        const nz = d > 1e-5 ? dz / d : 1;
        return { nx, nz, cx: p.x + nx * p.rad, cz: p.z + nz * p.rad, obstacle: p };
      }
      continue;
    }
    const cx = Math.max(p.x - p.hw, Math.min(x, p.x + p.hw));
    const cz = Math.max(p.z - p.hd, Math.min(z, p.z + p.hd));
    const dx = x - cx;
    const dz = z - cz;
    const d = Math.hypot(dx, dz);
    if (d < r) {
      if (d < 1e-5) return { nx: 0, nz: 1, cx, cz, obstacle: p };
      return { nx: dx / d, nz: dz / d, cx, cz, obstacle: p };
    }
  }
  return null;
}

// 中心點越過開放的平台邊緣就算出界
export function offPlatform(x, z) {
  if (MAP.grid) return MAP.grid.isVoid(x, z);
  const S = MAP.sides;
  return (S.r && x > ARENA.maxX) || (S.b && z > ARENA.maxZ) || (S.l && x < ARENA.minX) || (S.t && z < ARENA.minZ);
}

// 走路時不能走出場地、不能穿過柱子（足球可以被推進球門）
export function clampWalk(o, r) {
  if (MAP.grid) {
    // 高爾夫球場：人不能走進牆、水、虛空；球只會被牆擋住
    if (o.isFighter) MAP.grid.walkPush(o, r);
    else {
      const h = MAP.grid.wallHit(o.x, o.z, r);
      if (h) {
        o.x = h.cx + h.nx * (r + 0.01);
        o.z = h.cz + h.nz * (r + 0.01);
      }
    }
    pushOutOfObstacles(o, r);
    return;
  }
  const G = MAP.goalHalf;
  const intoGoal = G && o.isBall && (Math.abs(o.z) < G - r || Math.abs(o.x) > ARENA.maxX);
  const xLim = intoGoal ? ARENA.maxX + MAP.goalDepth : ARENA.maxX;
  o.x = Math.max(-xLim + r, Math.min(xLim - r, o.x));
  o.z = Math.max(ARENA.minZ + r, Math.min(ARENA.maxZ - r, o.z));
  if (intoGoal && Math.abs(o.x) > ARENA.maxX) o.z = Math.max(-G + r, Math.min(G - r, o.z));
  pushOutOfObstacles(o, r);
}

function pushOutOfObstacles(o, r) {
  for (const p of OBSTACLES) {
    if (p.rad) {
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < r + p.rad && d > 1e-5) {
        o.x = p.x + (dx / d) * (r + p.rad);
        o.z = p.z + (dz / d) * (r + p.rad);
      }
      continue;
    }
    const cx = Math.max(p.x - p.hw, Math.min(o.x, p.x + p.hw));
    const cz = Math.max(p.z - p.hd, Math.min(o.z, p.z + p.hd));
    const dx = o.x - cx;
    const dz = o.z - cz;
    const d = Math.hypot(dx, dz);
    if (d < r && d > 1e-5) {
      o.x = cx + (dx / d) * r;
      o.z = cz + (dz / d) * r;
    }
  }
}

// ── 貼圖 ──
// 1 m＝PX 像素。畫布左上角對應場地的 (minX, minZ)。
const PX = 40;

export function canvasTex(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function speckle(g, w, h, n, light, dark) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = Math.random() < 0.5 ? light : dark;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

// 黃黑斜紋（危險邊緣）
export function hazard(g, x, y, w, h, step = 12) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#f2c230';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#222';
  for (let i = -h; i < w + h; i += step * 2) {
    g.beginPath();
    g.moveTo(x + i, y + h);
    g.lineTo(x + i + step, y + h);
    g.lineTo(x + i + step + h, y);
    g.lineTo(x + i + h, y);
    g.fill();
  }
  g.restore();
}

function makeLotTexture() {
  const c = document.createElement('canvas');
  c.width = 26 * PX;
  c.height = 15 * PX;
  const g = c.getContext('2d');
  const X = (x) => (x - ARENA.minX) * PX;
  const Z = (z) => (z - ARENA.minZ) * PX;

  // 柏油
  g.fillStyle = '#55585d';
  g.fillRect(0, 0, c.width, c.height);
  speckle(g, c.width, c.height, 9000, 'rgba(255,255,255,0.07)', 'rgba(0,0,0,0.12)');

  // 店門口的人行區
  g.fillStyle = '#8a8c8f';
  g.fillRect(0, 0, c.width, Z(-6.6));
  speckle(g, c.width, Z(-6.6), 600, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.08)');
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, Z(-6.6) - 3, c.width, 6);

  // 身障車位（最靠近入口兩格）
  g.fillStyle = '#2f6db5';
  g.fillRect(X(-5.0), Z(-6.6), 2.6 * PX, 4.8 * PX);
  g.fillRect(X(2.4), Z(-6.6), 2.6 * PX, 4.8 * PX);
  g.fillStyle = '#f2f2f2';
  for (const cx of [-3.7, 3.7]) {
    const x = X(cx);
    const y = Z(-4.2);
    g.beginPath();
    g.arc(x - 6, y - 26, 7, 0, Math.PI * 2);
    g.fill();
    g.fillRect(x - 11, y - 16, 9, 22);
    g.fillRect(x - 11, y + 2, 26, 7);
    g.lineWidth = 6;
    g.strokeStyle = '#f2f2f2';
    g.beginPath();
    g.arc(x - 2, y + 12, 16, Math.PI * 0.15, Math.PI * 1.55);
    g.stroke();
  }

  // 停車格白線
  g.fillStyle = '#ececec';
  const line = (x, z0, z1) => g.fillRect(X(x) - 2.5, Z(z0), 5, (z1 - z0) * PX);
  for (let k = 0; k < 5; k++) {
    line(-2.4 - k * 2.6, -6.6, -1.8);
    if (k < 4) line(2.4 + k * 2.6, -6.6, -1.8);
  }
  for (let x = -12.8; x < 12.5; x += 2.6) line(x, 2.6, 7.2);
  g.fillRect(0, Z(-1.8) - 2.5, X(-2.4), 5);
  g.fillRect(X(2.4), Z(-1.8) - 2.5, c.width - X(2.4), 5);
  g.fillRect(0, Z(2.6) - 2.5, c.width, 5);

  // 入口前的行人通道和斑馬線
  g.fillStyle = 'rgba(236,236,236,0.9)';
  g.fillRect(X(-2.4), Z(-6.6), 5, 4.8 * PX);
  g.fillRect(X(2.4) - 5, Z(-6.6), 5, 4.8 * PX);
  for (let x = -2.1; x < 2.2; x += 0.9) g.fillRect(X(x), Z(-1.5), 0.45 * PX, 3.8 * PX);

  // 車道箭頭和「慢」字
  g.fillStyle = '#ececec';
  const arrow = (cx, cz, dir) => {
    const x = X(cx);
    const y = Z(cz);
    g.beginPath();
    g.moveTo(x + dir * 60, y);
    g.lineTo(x + dir * 20, y - 26);
    g.lineTo(x + dir * 20, y - 9);
    g.lineTo(x - dir * 60, y - 9);
    g.lineTo(x - dir * 60, y + 9);
    g.lineTo(x + dir * 20, y + 9);
    g.lineTo(x + dir * 20, y + 26);
    g.closePath();
    g.fill();
  };
  arrow(-9.8, 0.4, -1);
  arrow(9.8, 0.4, 1);
  g.font = `bold ${1.6 * PX}px "Microsoft JhengHei", "PingFang TC", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('慢', X(-6.6), Z(0.4));
  g.fillText('慢', X(6.6), Z(0.4));

  // 油漬
  for (let i = 0; i < 14; i++) {
    const row = Math.random() < 0.5 ? -4.2 : 4.9;
    g.fillStyle = 'rgba(20,20,24,0.25)';
    g.beginPath();
    g.ellipse(X(-11.5 + Math.random() * 23), Z(row + (Math.random() - 0.5) * 2), 8 + Math.random() * 20, 6 + Math.random() * 12, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }

  // 平台邊緣的警示條（右側、下方）
  hazard(g, c.width - 12, 0, 12, c.height);
  hazard(g, 0, c.height - 12, c.width, 12);
  return canvasTex(c);
}

// 清水模牆面，sign＝在正中間畫停車場招牌
function makeConcreteTexture(w, h, sign = false) {
  const c = document.createElement('canvas');
  c.width = w * 20;
  c.height = h * 20;
  const g = c.getContext('2d');
  g.fillStyle = '#b9b4aa';
  g.fillRect(0, 0, c.width, c.height);
  speckle(g, c.width, c.height, w * h * 25, 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.08)');
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 0; x < c.width; x += 60) g.fillRect(x, 0, 2, c.height);
  for (let y = 0; y < c.height; y += 40) g.fillRect(0, y, c.width, 2);
  // 頂部壓條
  g.fillStyle = '#8f8a80';
  g.fillRect(0, 0, c.width, 10);
  hazard(g, 0, 10, c.width, 6, 8);
  // 底部水漬
  const grad = g.createLinearGradient(0, c.height - 40, 0, c.height);
  grad.addColorStop(0, 'rgba(60,55,50,0)');
  grad.addColorStop(1, 'rgba(60,55,50,0.35)');
  g.fillStyle = grad;
  g.fillRect(0, c.height - 40, c.width, 40);
  if (sign) {
    const cx = c.width / 2;
    const cy = c.height * 0.45;
    g.fillStyle = '#1f5fbf';
    g.fillRect(cx - 160, cy - 34, 320, 68);
    g.fillStyle = '#fff';
    g.fillRect(cx - 154, cy - 28, 56, 56);
    g.fillStyle = '#1f5fbf';
    g.font = 'bold 52px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('P', cx - 126, cy + 2);
    g.fillStyle = '#fff';
    g.font = 'bold 30px "Microsoft JhengHei", "PingFang TC", sans-serif';
    g.fillText('顧客停車場', cx + 30, cy - 8);
    g.font = 'bold 16px Arial, sans-serif';
    g.fillText('CUSTOMER PARKING', cx + 30, cy + 20);
  }
  return canvasTex(c);
}

// 超市門面：下層玻璃與自動門，上層綠色招牌
function makeStorefrontTexture(w, h) {
  const k = 40;
  const c = document.createElement('canvas');
  c.width = w * k;
  c.height = h * k;
  const g = c.getContext('2d');
  const Y = (y) => c.height - y * k; // y：離地高度（m）

  g.fillStyle = '#f1ece2';
  g.fillRect(0, 0, c.width, c.height);

  // 玻璃窗
  const glass = g.createLinearGradient(0, Y(3), 0, Y(0));
  glass.addColorStop(0, '#5b9cbc');
  glass.addColorStop(1, '#a9dbea');
  g.fillStyle = glass;
  g.fillRect(0.4 * k, Y(3), c.width - 0.8 * k, 3 * k);
  // 店內貨架剪影
  g.fillStyle = 'rgba(40,70,90,0.35)';
  for (let x = 1; x < w - 1; x += 1.6) g.fillRect(x * k, Y(1.7), 1.1 * k, 1.3 * k);
  // 反光
  g.fillStyle = 'rgba(255,255,255,0.28)';
  for (let x = 0; x < w; x += 3.1) {
    g.beginPath();
    g.moveTo(x * k, Y(0));
    g.lineTo((x + 0.5) * k, Y(0));
    g.lineTo((x + 1.6) * k, Y(3));
    g.lineTo((x + 1.1) * k, Y(3));
    g.fill();
  }
  // 窗框
  g.fillStyle = '#d9d9d9';
  for (let x = 0.4; x <= w - 0.3; x += 2.2) g.fillRect(x * k - 3, Y(3), 6, 3 * k);
  g.fillRect(0.4 * k, Y(3), c.width - 0.8 * k, 6);
  g.fillRect(0.4 * k, Y(0.25), c.width - 0.8 * k, 0.25 * k);

  // 自動門
  const dx = w / 2;
  g.fillStyle = '#3d4a52';
  g.fillRect((dx - 2.3) * k, Y(2.9), 4.6 * k, 2.9 * k);
  g.fillStyle = '#7fbdd3';
  g.fillRect((dx - 2.1) * k, Y(2.7), 2.0 * k, 2.7 * k);
  g.fillRect((dx + 0.1) * k, Y(2.7), 2.0 * k, 2.7 * k);
  g.fillStyle = '#e94b3c';
  g.font = `bold ${0.32 * k}px "Microsoft JhengHei", "PingFang TC", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('歡迎光臨', dx * k, Y(1.5));

  // 招牌
  g.fillStyle = '#1f8a4c';
  g.fillRect(0.3 * k, Y(h - 0.3), c.width - 0.6 * k, (h - 3.8) * k);
  g.fillStyle = '#ffb51f';
  g.beginPath();
  g.arc((dx - 4.6) * k, Y(4.7), 0.95 * k, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1f8a4c';
  g.font = `bold ${1.2 * k}px "Microsoft JhengHei", "PingFang TC", sans-serif`;
  g.fillText('鮮', (dx - 4.6) * k, Y(4.65));
  g.fillStyle = '#fff';
  g.font = `bold ${1.4 * k}px "Microsoft JhengHei", "PingFang TC", sans-serif`;
  g.textAlign = 'left';
  g.fillText('全鮮超市', (dx - 3.3) * k, Y(4.95));
  g.font = `bold ${0.55 * k}px Arial, sans-serif`;
  g.fillText('FRESH MART  ·  24H', (dx - 3.2) * k, Y(3.9));
  return canvasTex(c);
}

// 大樓窗格（每格 3 m × 3.2 m，用 RepeatWrapping 鋪滿）
export function makeWindowTexture(wall, glassA, glassB) {
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = wall;
  g.fillRect(0, 0, 120, 128);
  for (let i = 0; i < 2; i++) {
    g.fillStyle = Math.random() < 0.5 ? glassA : glassB;
    g.fillRect(10 + i * 56, 26, 44, 74);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(10 + i * 56, 26, 44, 8);
  }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 120, 120, 8);
  return canvasTex(c, true);
}

function makeRoadTexture() {
  const c = document.createElement('canvas');
  c.width = 200;
  c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#3f4246';
  g.fillRect(0, 0, 200, 200);
  speckle(g, 200, 200, 900, 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.12)');
  // 寬 10 m：中間雙黃線，兩側車道虛線，路緣白線
  g.fillStyle = '#f2c230';
  g.fillRect(96, 0, 3, 200);
  g.fillRect(101, 0, 3, 200);
  g.fillStyle = '#e8e8e8';
  g.fillRect(48, 0, 3, 100);
  g.fillRect(149, 0, 3, 100);
  g.fillRect(8, 0, 3, 200);
  g.fillRect(189, 0, 3, 200);
  return canvasTex(c, true);
}

function makeZebraTexture() {
  const c = document.createElement('canvas');
  c.width = 200;
  c.height = 60;
  const g = c.getContext('2d');
  g.fillStyle = '#3f4246';
  g.fillRect(0, 0, 200, 60);
  g.fillStyle = '#e8e8e8';
  for (let x = 6; x < 200; x += 20) g.fillRect(x, 4, 10, 52);
  return canvasTex(c);
}

// 讓方塊每一面的 UV 依實際尺寸放大，配合 RepeatWrapping 鋪貼圖
export function scaleBoxUV(geo, w, h, d, cellW, cellH) {
  const uv = geo.attributes.uv;
  const size = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const j = f * 4 + i;
      uv.setXY(j, uv.getX(j) * (size[f][0] / cellW), uv.getY(j) * Math.max(1, Math.round(size[f][1] / cellH)));
    }
  }
  uv.needsUpdate = true;
}

// ── 模型 ──
const CAR_COLORS = [0xd94040, 0xf2f2f2, 0x3b6fd6, 0x2b2b2b, 0xf2c14e, 0x9aa3ad, 0x2f9e6a, 0xf08a3c];
const tireMat = toon(0x1e1e1e);
const carGlassMat = toon(0x6fa3c7);

// 車頭朝 +z
export function makeCar(color) {
  const car = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.65, 4.2), toon(color));
  body.position.y = 0.55;
  car.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.55, 2.1), carGlassMat);
  cabin.position.set(0, 1.12, -0.25);
  car.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 1.7), toon(color));
  roof.position.set(0, 1.42, -0.3);
  car.add(roof);
  const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 12);
  wheel.rotateZ(Math.PI / 2);
  for (const sx of [-0.85, 0.85]) {
    for (const sz of [-1.3, 1.3]) {
      const w = new THREE.Mesh(wheel, tireMat);
      w.position.set(sx, 0.34, sz);
      car.add(w);
    }
  }
  return car;
}

const trunkMat = toon(0x7a5536);
const leafMats = [toon(0x4f9a45), toon(0x5fae4a), toon(0x3f8a44)];
export function makeTree(s = 1) {
  const t = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 1.6 * s, 6), trunkMat);
  trunk.position.y = 0.8 * s;
  t.add(trunk);
  const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 * s, 0), leafMats[Math.floor(Math.random() * 3)]);
  leaf.position.y = 2.2 * s;
  leaf.rotation.y = Math.random() * 3;
  t.add(leaf);
  return t;
}

export function makeStreetLamp(height) {
  const lamp = new THREE.Group();
  const poleMat = toon(0x4a5058);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, height, 8), poleMat);
  pole.position.y = height / 2;
  lamp.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.12), poleMat);
  arm.position.set(0.5, height - 0.05, 0);
  lamp.add(arm);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.3), toon(0xfff3c4, { emissive: 0xfff0b0, emissiveIntensity: 0.6 }));
  head.position.set(1.0, height - 0.14, 0);
  lamp.add(head);
  return lamp;
}

// ── 街道交通 ──
// 右側馬路沿 z 方向（x 17–27），下方馬路沿 x 方向（z 11–21），十字路口有紅綠燈。
const ROAD_R = { x0: 17, x1: 27 };
const ROAD_B = { z0: 11, z1: 21 };
const LANES = [
  { axis: 'z', at: 19.6, dir: 1, stop: ROAD_B.z0 - 3, road: 'R' },
  { axis: 'z', at: 24.4, dir: -1, stop: ROAD_B.z1 + 3, road: 'R' },
  { axis: 'x', at: 13.6, dir: -1, stop: ROAD_R.x1 + 3, road: 'B' },
  { axis: 'x', at: 18.4, dir: 1, stop: ROAD_R.x0 - 3, road: 'B' },
];
const LOOP = 75;
const CYCLE = 22; // 0–9 右側綠燈、9–11 全紅、11–20 下方綠燈、20–22 全紅

function buildTraffic(scene) {
  const cars = [];
  for (const lane of LANES) {
    for (let s = -LOOP + Math.random() * 10; s < LOOP; s += 16 + Math.random() * 18) {
      const mesh = makeCar(CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]);
      if (lane.axis === 'z') mesh.rotation.y = lane.dir > 0 ? 0 : Math.PI;
      else mesh.rotation.y = lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      scene.add(mesh);
      cars.push({ lane, s: s * lane.dir, v: 8, vmax: 7 + Math.random() * 4, mesh });
    }
  }
  return cars;
}

function updateTraffic(cars, t, dt) {
  const phase = t % CYCLE;
  const green = phase < 9 ? 'R' : phase >= 11 && phase < 20 ? 'B' : null;
  for (const c of cars) {
    const { lane } = c;
    const front = c.s + lane.dir * 2.1;
    let gap = Infinity;
    if (green !== lane.road) {
      const toStop = (lane.stop - front) * lane.dir;
      if (toStop > -0.5) gap = Math.max(0, toStop);
    }
    for (const o of cars) {
      if (o === c || o.lane !== lane) continue;
      const d = (o.s - c.s) * lane.dir;
      if (d > 0) gap = Math.min(gap, d - 5.2);
    }
    const target = Math.max(0, Math.min(c.vmax, gap * 1.6));
    c.v += Math.max(-25 * dt, Math.min(6 * dt, target - c.v));
    c.s += c.v * lane.dir * dt;
    if (c.s * lane.dir > LOOP) c.s -= 2 * LOOP * lane.dir;
    if (lane.axis === 'z') c.mesh.position.set(lane.at, LAVA_Y, c.s);
    else c.mesh.position.set(c.s, LAVA_Y, lane.at);
  }
}

// ── 城市 ──
function buildCity(scene) {
  const G = LAVA_Y;

  // 地面（人行道）
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toon(0xbdb8ae));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = G;
  scene.add(ground);

  // 馬路
  const roadTex = makeRoadTexture();
  const roadR = new THREE.Mesh(new THREE.PlaneGeometry(10, 300), toon(0xffffff, { map: roadTex }));
  roadTex.repeat.set(1, 30);
  roadR.rotation.x = -Math.PI / 2;
  roadR.position.set((ROAD_R.x0 + ROAD_R.x1) / 2, G + 0.01, 0);
  scene.add(roadR);
  const roadB = roadR.clone();
  roadB.rotation.z = Math.PI / 2;
  roadB.position.set(0, G + 0.01, (ROAD_B.z0 + ROAD_B.z1) / 2);
  scene.add(roadB);
  // 路口
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), toon(0x3f4246));
  cross.rotation.x = -Math.PI / 2;
  cross.position.set(22, G + 0.02, 16);
  scene.add(cross);
  const zebraMat = toon(0xffffff, { map: makeZebraTexture() });
  const zebraGeo = new THREE.PlaneGeometry(10, 3);
  zebraGeo.rotateX(-Math.PI / 2);
  for (const [x, z, r] of [[22, 9.5, 0], [22, 22.5, 0], [15.5, 16, 1], [28.5, 16, 1]]) {
    const zb = new THREE.Mesh(zebraGeo, zebraMat);
    zb.position.set(x, G + 0.03, z);
    zb.rotation.y = r * Math.PI / 2;
    scene.add(zb);
  }

  // 路燈、行道樹
  for (let z = -40; z <= 40; z += 9) {
    if (z > 6 && z < 26) continue;
    const t = makeTree(1.1);
    t.position.set(15.2, G, z + 3);
    scene.add(t);
    const l = makeStreetLamp(5);
    l.position.set(16.3, G, z);
    l.rotation.y = 0;
    scene.add(l);
  }
  for (let x = -40; x <= 40; x += 9) {
    if (x > 12 && x < 32) continue;
    const t = makeTree(1.1);
    t.position.set(x + 3, G, 9.6);
    scene.add(t);
  }

  // 大樓
  const palettes = [
    ['#d9cbb4', '#5f8fb0', '#86b3cf'],
    ['#c4c9cf', '#4f7896', '#9cc3dc'],
    ['#e8e2d6', '#6a8fa6', '#f5dc9b'],
    ['#b48f78', '#4d6f88', '#89aac2'],
    ['#9fb3c2', '#3f5f78', '#a7cde3'],
  ];
  const winTex = palettes.map((p) => makeWindowTexture(...p));
  const roofMat = toon(0x8d9096);
  const addBuilding = (x, z, w, d, h) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(geo, w, h, d, 3, 3.2);
    const side = toon(0xffffff, { map: winTex[Math.floor(Math.random() * winTex.length)] });
    const m = new THREE.Mesh(geo, [side, side, roofMat, roofMat, side, side]);
    m.position.set(x, G + h / 2, z);
    scene.add(m);
    if (w > 6 && d > 6 && Math.random() < 0.7) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 1.6), toon(0xc9ccd1));
      ac.position.set(x + (Math.random() - 0.5) * (w - 3), G + h + 0.5, z + (Math.random() - 0.5) * (d - 3));
      scene.add(ac);
    }
  };
  // 右側街區（靠近鏡頭的矮一點，免得擋到場地）
  for (let z = -60; z < 9; z += 11) addBuilding(35, z + 5, 10, 9, 8 + Math.random() * 14);
  for (let z = 24; z < 60; z += 11) addBuilding(35, z + 5, 10, 9, 6 + Math.random() * 5);
  // 下方街區
  for (let x = -60; x < 5; x += 11) addBuilding(x + 5, 29, 9, 10, 5 + Math.random() * 5);
  // 超市後面的天際線
  for (let x = -70; x < 70; x += 12) addBuilding(x + Math.random() * 3, -34 - Math.random() * 10, 9, 9, 22 + Math.random() * 26);
  for (let x = -64; x < 70; x += 15) addBuilding(x, -52 - Math.random() * 8, 11, 10, 34 + Math.random() * 30);
  // 左側街區
  for (let z = -30; z < 8; z += 11) addBuilding(-40, z + 5, 10, 9, 10 + Math.random() * 16);
}

// ── 巨大撞球桌 ──
// 球台面＝場地（26 m × 15 m），四周是綠色庫邊＋木頭台框，所有人都站在桌面上；只有袋口能把東西打出去
const RAIL_CUSHION = 0.5; // 庫邊厚度（場地邊界外）
const RAIL_WOOD = 1.3; // 木框寬度
const RAIL_H = 0.8;

function makeFeltTexture() {
  const k = 24;
  const c = document.createElement('canvas');
  c.width = 26 * k;
  c.height = 15 * k;
  const g = c.getContext('2d');
  const X = (x) => (x - ARENA.minX) * k;
  const Z = (z) => (z - ARENA.minZ) * k;
  g.fillStyle = '#1f7d4d';
  g.fillRect(0, 0, c.width, c.height);
  // 中間比較亮（吊燈照下來）
  const glow = g.createRadialGradient(c.width / 2, c.height / 2, 20, c.width / 2, c.height / 2, c.width * 0.6);
  glow.addColorStop(0, 'rgba(255,255,220,0.14)');
  glow.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = glow;
  g.fillRect(0, 0, c.width, c.height);
  speckle(g, c.width, c.height, 7000, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.08)');
  // 開球線、開球區半圓、置球點
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(X(-6.5), 0);
  g.lineTo(X(-6.5), c.height);
  g.stroke();
  g.beginPath();
  g.arc(X(-6.5), Z(0), 2.6 * k, Math.PI / 2, Math.PI * 1.5);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (const x of [-6.5, 0, 6.5]) {
    g.beginPath();
    g.arc(X(x), Z(0), 0.16 * k, 0, Math.PI * 2);
    g.fill();
  }
  return canvasTex(c);
}

export function makeWoodTexture(base = '#6b3a1e', dark = 'rgba(40,18,6,0.35)') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = Math.random() < 0.5 ? dark : 'rgba(255,220,170,0.08)';
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    const y = Math.random() * 64;
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
    g.stroke();
  }
  return canvasTex(c, true);
}

function buildTable() {
  const g = new THREE.Group();
  const W = ARENA.maxX - ARENA.minX;
  const D = ARENA.maxZ - ARENA.minZ;
  const outerW = W + 2 * (RAIL_CUSHION + RAIL_WOOD);
  const outerD = D + 2 * (RAIL_CUSHION + RAIL_WOOD);

  // 台面
  const woodTex = makeWoodTexture();
  woodTex.repeat.set(6, 1);
  const wood = toon(0xffffff, { map: woodTex });
  const woodDark = toon(0x4a2814);
  const felt = new THREE.Mesh(new THREE.BoxGeometry(W + 2 * RAIL_CUSHION, 1, D + 2 * RAIL_CUSHION),
    [woodDark, woodDark, toon(0xffffff, { map: makeFeltTexture() }), woodDark, woodDark, woodDark]);
  felt.position.y = -0.5;
  g.add(felt);

  // 綠色庫邊（在袋口的地方斷開）
  const cushionMat = toon(0x17663e);
  const cushion = (x0, x1, z0, z1) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.6, z1 - z0), cushionMat);
    m.position.set((x0 + x1) / 2, 0.3, (z0 + z1) / 2);
    g.add(m);
  };
  const { minX, maxX, minZ, maxZ } = ARENA;
  const c = RAIL_CUSHION;
  for (const [z0, z1] of [[minZ - c, minZ], [maxZ, maxZ + c]]) {
    cushion(minX + 1.4, -0.95, z0, z1);
    cushion(0.95, maxX - 1.4, z0, z1);
  }
  for (const [x0, x1] of [[minX - c, minX], [maxX, maxX + c]]) cushion(x0, x1, minZ + 1.4, maxZ - 1.4);

  // 木框
  const railLong = new THREE.BoxGeometry(outerW, RAIL_H, RAIL_WOOD);
  const railShort = new THREE.BoxGeometry(RAIL_WOOD, RAIL_H, D + 2 * c);
  for (const z of [minZ - c - RAIL_WOOD / 2, maxZ + c + RAIL_WOOD / 2]) {
    const m = new THREE.Mesh(railLong, wood);
    m.position.set(0, RAIL_H / 2 - 0.05, z);
    g.add(m);
  }
  for (const x of [minX - c - RAIL_WOOD / 2, maxX + c + RAIL_WOOD / 2]) {
    const m = new THREE.Mesh(railShort, wood);
    m.position.set(x, RAIL_H / 2 - 0.05, 0);
    g.add(m);
  }
  // 木框上的菱形標點
  const pearl = toon(0xf3ead8);
  const diamond = new THREE.OctahedronGeometry(0.16);
  diamond.scale(1, 0.25, 1.6);
  const railZ = maxZ + c + RAIL_WOOD / 2;
  const railX = maxX + c + RAIL_WOOD / 2;
  for (let i = 1; i < 8; i++) {
    if (i === 4) continue;
    const x = minX + (W / 8) * i;
    for (const z of [-railZ, railZ]) {
      const d = new THREE.Mesh(diamond, pearl);
      d.position.set(x, RAIL_H - 0.03, z);
      d.rotation.y = Math.PI / 2;
      g.add(d);
    }
  }
  for (let i = 1; i < 4; i++) {
    const z = minZ + (D / 4) * i;
    for (const x of [-railX, railX]) {
      const d = new THREE.Mesh(diamond, pearl);
      d.position.set(x, RAIL_H - 0.03, z);
      g.add(d);
    }
  }

  // 袋口：黑洞＋皮革邊
  const holeGeo = new THREE.CircleGeometry(POCKET_R, 32);
  holeGeo.rotateX(-Math.PI / 2);
  const rimGeo = new THREE.RingGeometry(POCKET_R, POCKET_R + 0.2, 32);
  rimGeo.rotateX(-Math.PI / 2);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x070504 });
  const rimMat = toon(0x3b2414);
  for (const p of TABLE_POCKETS) {
    const hole = new THREE.Mesh(holeGeo, holeMat);
    hole.position.set(p.x, 0.014, p.z);
    g.add(hole);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.set(p.x, 0.016, p.z);
    g.add(rim);
  }

  // 台身與桌腳，下面是撞球間的木地板
  const FLOOR = -14;
  const apron = new THREE.Mesh(new THREE.BoxGeometry(outerW + 0.3, 2.4, outerD + 0.3), woodDark);
  apron.position.y = -1.2 - 0.05;
  g.add(apron);
  const legGeo = new THREE.CylinderGeometry(1.1, 1.6, -FLOOR - 2.4, 16);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, woodDark);
      leg.position.set(sx * (outerW / 2 - 1.6), (FLOOR - 2.4) / 2, sz * (outerD / 2 - 1.6));
      g.add(leg);
    }
  }
  const floorTex = makeWoodTexture('#3d2618', 'rgba(15,8,3,0.4)');
  floorTex.repeat.set(20, 60);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toon(0xffffff, { map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  floor.rotation.z = Math.PI / 2;
  floor.position.y = FLOOR;
  g.add(floor);

  // 靠在木框上的巨大球桿和巧克
  const cue = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 26, 16), toon(0xe8cf9a));
  shaft.position.y = 13;
  cue.add(shaft);
  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 14, 16), toon(0x2e1a10));
  butt.position.y = -7;
  cue.add(butt);
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 16), toon(0xf4f0e6));
  ferrule.position.y = 26.25;
  cue.add(ferrule);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.25, 16), toon(0x2f6fd0));
  tip.position.y = 26.6;
  cue.add(tip);
  cue.rotation.z = -Math.PI / 2;
  cue.rotation.y = 0.05;
  cue.position.set(-18, RAIL_H + 0.35, minZ - c - RAIL_WOOD / 2 - 0.1);
  g.add(cue);
  const chalk = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), toon(0x2f6fd0));
  chalk.position.set(railX, RAIL_H + 0.4, -railZ);
  chalk.rotation.y = 0.35;
  g.add(chalk);

  // 遠處撞球間：散落的大球
  const ballColors = [0xf2c14e, 0x2f5fd0, 0xd23a2a, 0x6b2fa0, 0xf08a3c, 0x2f9e6a, 0x8a1f1f, 0x111111];
  const ballGeo = new THREE.SphereGeometry(2.6, 24, 16);
  [[-34, -30], [30, -34], [-40, 12], [36, 20], [6, -46], [-18, -50]].forEach(([x, z], i) => {
    const b = new THREE.Mesh(ballGeo, toon(ballColors[i % ballColors.length]));
    b.position.set(x, FLOOR + 2.6, z);
    g.add(b);
  });
  return g;
}

// ── 足球場 ──
// 場地＝草地，四周是廣告看板圍起來（像室內五人制），左右看板中間開球門
function makePitchTexture() {
  const k = 24;
  const c = document.createElement('canvas');
  c.width = 26 * k;
  c.height = 15 * k;
  const g = c.getContext('2d');
  const X = (x) => (x - ARENA.minX) * k;
  const Z = (z) => (z - ARENA.minZ) * k;
  // 割草條紋
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? '#3f9a45' : '#47a74c';
    g.fillRect(i * 2 * k, 0, 2 * k, c.height);
  }
  speckle(g, c.width, c.height, 6000, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.07)');
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 4;
  g.strokeRect(X(-12.7), Z(-7.2), 25.4 * k, 14.4 * k);
  g.beginPath();
  g.moveTo(X(0), Z(-7.2));
  g.lineTo(X(0), Z(7.2));
  g.stroke();
  g.beginPath();
  g.arc(X(0), Z(0), 2.4 * k, 0, Math.PI * 2);
  g.stroke();
  for (const s of [-1, 1]) {
    // 禁區、小禁區、罰球點
    g.strokeRect(s < 0 ? X(-12.7) : X(9.2), Z(-4.6), 3.5 * k, 9.2 * k);
    g.strokeRect(s < 0 ? X(-12.7) : X(11.3), Z(-3.1), 1.4 * k, 6.2 * k);
    g.beginPath();
    g.arc(X(s * 10.3), Z(0), 0.12 * k, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.arc(X(0), Z(0), 0.14 * k, 0, Math.PI * 2);
  g.fill();
  return canvasTex(c);
}

function makeBoardTexture(len) {
  const c = document.createElement('canvas');
  c.width = Math.round(len * 32);
  c.height = 32;
  const g = c.getContext('2d');
  const ads = [['#1f8a4c', '全鮮超市'], ['#2f5fd0', 'FRESH MART'], ['#d9433a', '打擊操作基底'], ['#f2c230', 'HAMMER CUP']];
  const seg = 6 * 32;
  for (let x = 0, i = 0; x < c.width; x += seg, i++) {
    const [bg, text] = ads[i % ads.length];
    g.fillStyle = bg;
    g.fillRect(x, 0, seg, 32);
    g.fillStyle = bg === '#f2c230' ? '#1a0d08' : '#fff';
    g.font = 'bold 20px "Microsoft JhengHei", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x + seg / 2, 17);
  }
  return canvasTex(c);
}

function makeCrowdTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2f3a';
  g.fillRect(0, 0, 512, 128);
  const cols = ['#3f7fe8', '#e8505b', '#f2f2f2', '#f2c14e', '#2a2a2a', '#9aa3ad'];
  for (let y = 4; y < 128; y += 8) {
    for (let x = (y / 8) % 2 ? 2 : 6; x < 512; x += 8) {
      g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
      g.beginPath();
      g.arc(x, y, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  return canvasTex(c, true);
}

function makeNetTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 2;
  for (let i = 0; i <= 64; i += 8) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 64);
    g.moveTo(0, i);
    g.lineTo(64, i);
    g.stroke();
  }
  return canvasTex(c, true);
}

function buildSoccer() {
  const g = new THREE.Group();
  const W = ARENA.maxX - ARENA.minX;
  const D = ARENA.maxZ - ARENA.minZ;
  const { maxX, minZ, maxZ } = ARENA;
  const grass = toon(0x3f8f45);
  const pitch = new THREE.Mesh(new THREE.BoxGeometry(W, 1, D), [grass, grass, toon(0xffffff, { map: makePitchTexture() }), grass, grass, grass]);
  pitch.position.y = -0.5;
  g.add(pitch);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(120, 90), toon(0x3a7f40));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  g.add(apron);

  // 廣告看板（場地邊界外，高 1 m），字朝場內
  const H = 1;
  const T = 0.3;
  const back = toon(0x2a2f3a);
  const board = (x, z, len, alongX) => {
    const face = toon(0xffffff, { map: makeBoardTexture(len) });
    const geo = alongX ? new THREE.BoxGeometry(len, H, T) : new THREE.BoxGeometry(T, H, len);
    const mats = alongX
      ? [back, back, back, back, z < 0 ? face : back, z < 0 ? back : face]
      : [x < 0 ? face : back, x < 0 ? back : face, back, back, back, back];
    const m = new THREE.Mesh(geo, mats);
    m.position.set(x, H / 2, z);
    g.add(m);
  };
  board(0, minZ - T / 2, W + 2 * T, true);
  board(0, maxZ + T / 2, W + 2 * T, true);
  const sideLen = maxZ - GOAL_HALF;
  for (const sx of [-1, 1]) {
    const x = sx * (maxX + T / 2);
    board(x, -(GOAL_HALF + sideLen / 2), sideLen, false);
    board(x, GOAL_HALF + sideLen / 2, sideLen, false);
  }

  // 球門：門柱、橫樑、網子
  const postMat = toon(0xf4f4f4);
  const netTex = makeNetTexture();
  netTex.repeat.set(3, 2);
  const netMat = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
  const GH = 2.0;
  for (const sx of [-1, 1]) {
    const x0 = sx * maxX;
    const x1 = sx * (maxX + GOAL_DEPTH);
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, GH, 10), postMat);
      post.position.set(x0, GH / 2, sz * GOAL_HALF);
      g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, GOAL_HALF * 2 + 0.24, 10), postMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(x0, GH, 0);
    g.add(bar);
    const backNet = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_HALF * 2, GH), netMat);
    backNet.rotation.y = Math.PI / 2;
    backNet.position.set(x1, GH / 2, 0);
    g.add(backNet);
    for (const sz of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, GH), netMat);
      side.position.set((x0 + x1) / 2, GH / 2, sz * GOAL_HALF);
      g.add(side);
    }
    const top = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, GOAL_HALF * 2), netMat);
    top.rotation.x = -Math.PI / 2;
    top.position.set((x0 + x1) / 2, GH, 0);
    g.add(top);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, GOAL_HALF * 2), toon(0x357a3a));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((x0 + x1) / 2, 0.01, 0);
    g.add(floor);
  }

  // 看台（上方、左右），觀眾用貼圖點點
  const standMat = toon(0xffffff, { map: makeCrowdTexture() });
  const concrete = toon(0x3a3f4a);
  const stand = (x, z, w, rotY) => {
    const s = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, 2), [concrete, concrete, standMat, concrete, standMat, concrete]);
      step.position.set(0, 0.6 + i * 1.2, -i * 2);
      s.add(step);
    }
    s.position.set(x, -0.6, z);
    s.rotation.y = rotY;
    g.add(s);
  };
  stand(0, minZ - 3, 44, 0);
  stand(-maxX - 4.5, 0, 26, Math.PI / 2);
  stand(maxX + 4.5, 0, 26, -Math.PI / 2);

  // 四角照明塔
  const poleMat = toon(0x6a707a);
  const lampMat = toon(0xffffff, { emissive: 0xfff6d0, emissiveIntensity: 0.9 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 26, 10), poleMat);
      pole.position.set(sx * 26, 13, sz * 20 - 6);
      g.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.8), lampMat);
      lamp.position.set(sx * 26, 26, sz * 20 - 6);
      lamp.lookAt(0, 0, 0);
      g.add(lamp);
    }
  }
  return g;
}

// 每張地圖的天空／霧／燈光
const LOOKS = {
  city: { bg: 0xbcd8ec, fog: [60, 150], sky: 0xeef6ff, ground: 0x6d6a64, hemi: 1.15, sun: 0xfff6e6, sunI: 1.7 },
  table: { bg: 0x22160e, fog: [70, 170], sky: 0xfff1d6, ground: 0x3a2a1f, hemi: 1.05, sun: 0xfff0d0, sunI: 1.6 },
  course: { bg: 0xbfe0f2, fog: [70, 220], sky: 0xffffff, ground: 0x6a9a5a, hemi: 1.15, sun: 0xfff6e6, sunI: 1.7 },
  soccer: { bg: 0x101a2c, fog: [80, 180], sky: 0xf4f8ff, ground: 0x4a5a4a, hemi: 1.2, sun: 0xffffff, sunI: 1.8 },
};

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbcd8ec);
  scene.fog = new THREE.Fog(0xbcd8ec, 60, 150);

  const camera = new THREE.PerspectiveCamera(P.camFov, 16 / 9, 0.1, 260);

  const hemi = new THREE.HemisphereLight(0xeef6ff, 0x6d6a64, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff6e6, 1.7);
  sun.position.set(-6, 14, 8);
  scene.add(sun);

  // ── 地圖一：超市門口停車場 ──
  const city = new THREE.Group();
  scene.add(city);

  // 停車場平台：頂面柏油、側面清水模
  const H = -LAVA_Y;
  const side = toon(0xffffff, { map: makeConcreteTexture(15, H) });
  const front = toon(0xffffff, { map: makeConcreteTexture(26, H, true) });
  const top = toon(0xffffff, { map: makeLotTexture() });
  const plain = toon(0xb9b4aa);
  const platform = new THREE.Mesh(new THREE.BoxGeometry(26, H, 15), [side, plain, top, plain, front, plain]);
  platform.position.y = -H / 2;
  city.add(platform);

  // 超市（上方的牆）
  const sw = 26.8;
  const sh = 6.2;
  const sd = 10.5;
  const sx = -0.4;
  const sz = ARENA.minZ - sd / 2;
  const wallMat = toon(0xe6dfd2);
  const store = new THREE.Mesh(
    new THREE.BoxGeometry(sw, sh, sd),
    [wallMat, wallMat, toon(0x9a9da2), wallMat, toon(0xffffff, { map: makeStorefrontTexture(sw, sh) }), wallMat],
  );
  store.position.set(sx, sh / 2, sz);
  city.add(store);
  const storeBase = new THREE.Mesh(new THREE.BoxGeometry(sw, H, sd), plain);
  storeBase.position.set(sx, -H / 2, sz);
  city.add(storeBase);
  // 雨遮（紅白條）
  const awnC = document.createElement('canvas');
  awnC.width = 256;
  awnC.height = 8;
  const ag = awnC.getContext('2d');
  for (let i = 0; i < 16; i++) {
    ag.fillStyle = i % 2 ? '#f4f1ea' : '#d9433a';
    ag.fillRect(i * 16, 0, 16, 8);
  }
  const awnTex = canvasTex(awnC, true);
  awnTex.repeat.set(sw / 12, 1);
  const awning = new THREE.Mesh(new THREE.BoxGeometry(sw - 0.6, 0.1, 1.1), toon(0xffffff, { map: awnTex }));
  awning.position.set(sx, 3.35, ARENA.minZ + 0.45);
  awning.rotation.x = 0.28;
  city.add(awning);
  // 屋頂女兒牆和冷氣機
  const parapetMat = toon(0xd6cfc2);
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.5, 0.3), parapetMat);
  parapet.position.set(sx, sh + 0.25, ARENA.minZ - 0.15);
  city.add(parapet);
  const acMat = toon(0xc9ccd1);
  for (const [x, z] of [[-9, -12], [-6.5, -12], [6, -14], [9, -11.5]]) {
    const ac = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 1.8), acMat);
    ac.position.set(x, sh + 0.55, z);
    city.add(ac);
  }
  // 購物車回收區（在左側廣場，不擋場地）
  const cartMat = toon(0xb8c0c8);
  const cartRed = toon(0xd9433a);
  for (let i = 0; i < 6; i++) {
    const cart = new THREE.Group();
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.8), cartMat);
    basket.position.y = 0.75;
    cart.add(basket);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.06), cartRed);
    handle.position.set(0, 1.05, 0.42);
    cart.add(handle);
    cart.position.set(ARENA.minX - 2.2, 0, ARENA.minZ + 0.7 + i * 0.32);
    city.add(cart);
  }

  // 左側矮牆（上面種樹籬），外面是人行廣場
  const curbMat = toon(0xa8a297);
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 15), curbMat);
  leftWall.position.set(ARENA.minX - 0.4, 0.4, 0);
  city.add(leftWall);
  const hedge = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 14.9), toon(0x4f9a45));
  hedge.position.set(ARENA.minX - 0.4, 1.05, 0);
  city.add(hedge);
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(16, H, 15), [plain, plain, toon(0xd2cabb), plain, side, plain]);
  plaza.position.set(ARENA.minX - 0.8 - 8, -H / 2, 0);
  city.add(plaza);
  for (const z of [-5, 0, 5]) {
    const t = makeTree(1);
    t.position.set(ARENA.minX - 2.6, 0, z);
    city.add(t);
  }

  // 柱子：水泥柱＋停車場燈
  const pillarMat = toon(0xc4beb3);
  const stripeC = document.createElement('canvas');
  stripeC.width = 64;
  stripeC.height = 64;
  hazard(stripeC.getContext('2d'), 0, 0, 64, 64, 8);
  const stripeMat = toon(0xffffff, { map: canvasTex(stripeC) });
  for (const p of PILLARS) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.hw * 2, 1.7, p.hd * 2), pillarMat);
    m.position.set(p.x, 0.85, p.z);
    city.add(m);
    const band = new THREE.Mesh(new THREE.BoxGeometry(p.hw * 2 + 0.02, 0.5, p.hd * 2 + 0.02), stripeMat);
    band.position.set(p.x, 0.25, p.z);
    city.add(band);
    const lamp = makeStreetLamp(3.4);
    lamp.position.set(p.x, 1.7, p.z);
    lamp.rotation.y = p.x < 0 ? 0 : Math.PI;
    city.add(lamp);
  }

  // 停著的車
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
  for (const p of PARKED_CARS) {
    const car = makeCar(p.color);
    car.position.set(p.x, 0, p.z);
    car.rotation.y = p.nose > 0 ? 0 : Math.PI;
    city.add(car);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(p.hw * 2 + 0.3, p.hd * 2 + 0.3), blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(p.x, 0.015, p.z);
    city.add(blob);
  }

  // 袋口
  const holeGeo = new THREE.CircleGeometry(POCKET_R, 32);
  holeGeo.rotateX(-Math.PI / 2);
  const rimGeo = new THREE.RingGeometry(POCKET_R, POCKET_R + 0.16, 32);
  rimGeo.rotateX(-Math.PI / 2);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0d });
  const rimMat = toon(0xffffff, { map: canvasTex(stripeC) });
  for (const p of CITY_POCKETS) {
    const hole = new THREE.Mesh(holeGeo, holeMat);
    hole.position.set(p.x, 0.014, p.z);
    city.add(hole);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.set(p.x, 0.016, p.z);
    city.add(rim);
  }

  buildCity(city);
  const cars = buildTraffic(city);
  let clock = Math.random() * CYCLE;

  // ── 地圖二：巨大撞球桌 ──
  const table = buildTable();
  table.visible = false;
  scene.add(table);

  // ── 地圖三：足球場 ──
  const soccer = buildSoccer();
  soccer.visible = false;
  scene.add(soccer);

  // 每張地圖的天空、霧、燈光
  let courseGroup = null;
  function applyLook(look) {
    scene.background.setHex(look.bg);
    scene.fog.color.setHex(look.bg);
    scene.fog.near = look.fog[0];
    scene.fog.far = look.fog[1];
    hemi.color.setHex(look.sky);
    hemi.groundColor.setHex(look.ground);
    hemi.intensity = look.hemi;
    sun.color.setHex(look.sun);
    sun.intensity = look.sunI;
  }

  const world = {
    renderer, scene, camera,
    camBase: { x: 0, z: 0.4, dist: 30, pitch: 0 },
    // 每幀推進場景動畫（街上的車、其他地圖自己的動畫）
    tick(dt) {
      const extra = EXTRA[MAP.id];
      if (extra && extra.tick) extra.tick(dt);
      if (!city.visible) return;
      clock += dt;
      updateTraffic(cars, clock, dt);
    },
    // 換成高爾夫球場的某一洞（course.js 的 CourseHole；group 已經用 buildHoleMesh 建好）
    setCourse(hole) {
      world.setMap('city');
      city.visible = false;
      if (courseGroup && courseGroup !== hole.group) scene.remove(courseGroup);
      courseGroup = hole.group;
      courseGroup.visible = true;
      if (!courseGroup.parent) scene.add(courseGroup);
      MAP.id = 'course';
      MAP.grid = hole;
      MAP.follow = true;
      MAP.sides = { ...CLOSED };
      MAP.open = false;
      MAP.fallY = -6;
      Object.assign(ARENA, hole.bounds);
      const obs = [];
      for (const it of hole.items) {
        if (it.type === 'bumper') obs.push({ ...hole.toWorld([it.x, it.z]), rad: it.r, bumper: true, color: it.color, capMat: it.capMat });
        if (it.type === 'windmill') obs.push({ ...hole.toWorld([it.x, it.z]), rad: 0.55 });
      }
      OBSTACLES.splice(0, OBSTACLES.length, ...obs);
      POCKETS.splice(0, POCKETS.length, { x: hole.cup.x, z: hole.cup.z, r: CUP_R, cup: true });
      applyLook(LOOKS.course);
    },
    // 加一張地圖（maps.js 用）：group＝場景物件，data＝碰撞資料（同 MAP_DATA），look＝燈光
    addMap(id, { group, data, look, tick }) {
      group.visible = false;
      scene.add(group);
      MAP_DATA[id] = data;
      LOOKS[id] = look;
      EXTRA[id] = { group, tick };
    },
    // 切換地圖：換場景、碰撞（牆／障礙物）、袋口、燈光
    setMap(id) {
      MAP.grid = null;
      MAP.follow = false;
      Object.assign(ARENA, DEFAULT_ARENA);
      if (courseGroup) courseGroup.visible = false;
      const d = MAP_DATA[id] || MAP_DATA.city;
      MAP.id = MAP_DATA[id] ? id : 'city';
      MAP.sides = { ...(d.sides || CLOSED) };
      MAP.open = Object.values(MAP.sides).some(Boolean);
      MAP.goalHalf = d.goalHalf || 0;
      MAP.goalDepth = d.goalDepth || 0;
      MAP.laneHalf = d.laneHalf || 0;
      MAP.friction = d.friction || 1;
      MAP.fallY = d.fallY ?? LAVA_Y;
      OBSTACLES.splice(0, OBSTACLES.length, ...d.obstacles);
      POCKETS.splice(0, POCKETS.length, ...d.pockets);
      city.visible = MAP.id === 'city';
      table.visible = MAP.id === 'table';
      soccer.visible = MAP.id === 'soccer';
      for (const [k, e] of Object.entries(EXTRA)) e.group.visible = MAP.id === k;
      applyLook(LOOKS[MAP.id]);
    },
    resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      world.fit();
    },
    // 用二分搜尋找出能塞下整個場地的最近鏡頭距離
    fit() {
      camera.fov = P.camFov;
      camera.updateProjectionMatrix();
      const pitch = (P.camPitch * Math.PI) / 180;
      const tx = 0;
      const tz = 0.4;
      const pts = [];
      for (const x of [-14.2, 14.2]) {
        for (const z of [-8.6, 8.4]) {
          for (const y of [0, 1.6]) pts.push(new THREE.Vector3(x, y, z));
        }
      }
      const v = new THREE.Vector3();
      let lo = 8;
      let hi = 150;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        camera.position.set(tx, Math.sin(pitch) * mid, tz + Math.cos(pitch) * mid);
        camera.lookAt(tx, 0, tz);
        camera.updateMatrixWorld();
        const okAll = pts.every((p) => {
          v.copy(p).project(camera);
          return Math.abs(v.x) <= 0.97 && Math.abs(v.y) <= 0.93;
        });
        if (okAll) hi = mid;
        else lo = mid;
      }
      world.camBase = { x: tx, z: tz, dist: hi, pitch };
    },
  };
  return world;
}
