// 其他地圖：冰湖、彈珠台、頂樓、保齡球道。
// 每張地圖用 world.addMap() 登記：場景物件（group）、碰撞資料（data）、燈光（look）。
// 碰撞資料的格式見 world.js 的 MAP_DATA；場地大小一律是 ARENA（26 m × 15 m）。
import * as THREE from 'three';
import {
  ARENA, toon, canvasTex, speckle, hazard, makeTree, makeWindowTexture, scaleBoxUV,
} from './world.js';

const OPEN = { l: true, r: true, t: true, b: true };
const W = ARENA.maxX - ARENA.minX;
const D = ARENA.maxZ - ARENA.minZ;

// 場地貼圖：k 像素／m，畫布左上角＝(minX, minZ)
function fieldCanvas(k = 24) {
  const c = document.createElement('canvas');
  c.width = W * k;
  c.height = D * k;
  const g = c.getContext('2d');
  return { c, g, k, X: (x) => (x - ARENA.minX) * k, Z: (z) => (z - ARENA.minZ) * k };
}

// 平板場地：上面貼圖，側面一種顏色
function slab(topMat, sideMat, thick = 1) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(W, thick, D), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
  m.position.y = -thick / 2;
  return m;
}

function holeMesh(g, x, z, r, color, rimColor) {
  const hole = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ color }));
  hole.rotation.x = -Math.PI / 2;
  hole.position.set(x, 0.014, z);
  g.add(hole);
  if (rimColor !== undefined) {
    const rim = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.18, 32), toon(rimColor));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(x, 0.016, z);
    g.add(rim);
  }
}

// ───────────────────────── 冰湖 ─────────────────────────
// 結冰的湖面：四面都是冰的邊緣（打出去掉進湖裡），滑行減速只有平常的 35%。
// 右半邊畫著冰壺的大本營（冰壺小遊戲用），左右上下各有一個釣魚冰洞＝袋口。
export const CURLING = { x: 7, z: 0, rings: [0.8, 1.8, 3.0], hogX: -3, startX: -10 };

function buildIce() {
  const g = new THREE.Group();
  const { c, g: ctx, k, X, Z } = fieldCanvas(24);
  const grad = ctx.createLinearGradient(0, 0, c.width, c.height);
  grad.addColorStop(0, '#dff1fb');
  grad.addColorStop(1, '#c4e2f3');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);
  // 冰刀刮痕
  for (let i = 0; i < 160; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.4})`;
    ctx.lineWidth = 1 + Math.random() * 1.5;
    ctx.beginPath();
    const x = Math.random() * c.width;
    const y = Math.random() * c.height;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 60, x + (Math.random() - 0.5) * 220, y + (Math.random() - 0.5) * 80);
    ctx.stroke();
  }
  // 冰壺大本營、投擲線
  const ringCols = ['#d9433a', '#f4f4f4', '#2f6fd0'];
  for (let i = CURLING.rings.length - 1; i >= 0; i--) {
    ctx.fillStyle = ringCols[i];
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(X(CURLING.x), Z(CURLING.z), CURLING.rings[i] * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#f4f4f4';
  ctx.beginPath();
  ctx.arc(X(CURLING.x), Z(CURLING.z), 0.3 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(217,67,58,0.7)';
  ctx.fillRect(X(CURLING.hogX) - 2, 0, 4, c.height);
  ctx.fillStyle = 'rgba(47,111,208,0.5)';
  ctx.fillRect(X(CURLING.startX) - 2, Z(-1.5), 4, 3 * k);
  const top = toon(0xffffff, { map: canvasTex(c) });
  const edge = toon(0xa9d4ec, { transparent: true, opacity: 0.9 });
  g.add(slab(top, edge, 0.6));

  // 冰洞（袋口）
  for (const p of ICE_POCKETS) holeMesh(g, p.x, p.z, p.r, 0x0d3550, 0xeaf6fd);

  // 雪人（障礙物）
  const snow = toon(0xffffff);
  for (const o of ICE_OBS) {
    const s = new THREE.Group();
    const b1 = new THREE.Mesh(new THREE.SphereGeometry(o.rad, 16, 12), snow);
    b1.position.y = o.rad * 0.9;
    s.add(b1);
    const b2 = new THREE.Mesh(new THREE.SphereGeometry(o.rad * 0.7, 16, 12), snow);
    b2.position.y = o.rad * 2.2;
    s.add(b2);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 8), toon(0xf08a3c));
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, o.rad * 2.3, o.rad * 0.7);
    s.add(nose);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.4, 12), toon(0x222222));
    hat.position.y = o.rad * 2.9;
    s.add(hat);
    s.position.set(o.x, 0, o.z);
    g.add(s);
  }

  // 湖水、岸邊雪地、松樹
  const water = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), toon(0x1d4f73));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.2;
  g.add(water);
  const shore = new THREE.Mesh(new THREE.RingGeometry(30, 120, 48), toon(0xf4f8fb));
  shore.rotation.x = -Math.PI / 2;
  shore.scale.set(1, 0.75, 1);
  shore.position.y = -0.9;
  g.add(shore);
  const pine = toon(0x2f6b4a);
  const trunk = toon(0x6b4a2b);
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + Math.random() * 0.1;
    const r = 34 + Math.random() * 14;
    const t = new THREE.Group();
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2, 6), trunk);
    tr.position.y = 1;
    t.add(tr);
    for (let j = 0; j < 3; j++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4 - j * 0.6, 3, 8), pine);
      cone.position.y = 2.6 + j * 1.6;
      t.add(cone);
    }
    t.position.set(Math.cos(a) * r, -0.9, Math.sin(a) * r * 0.75);
    t.scale.setScalar(0.8 + Math.random() * 0.6);
    g.add(t);
  }
  return g;
}
const ICE_POCKETS = [{ x: -8, z: 5, r: 0.8 }, { x: -7, z: -5.2, r: 0.8 }];
const ICE_OBS = [{ x: -1.5, z: -5, rad: 0.7 }, { x: 1.5, z: 5, rad: 0.7 }];

// ───────────────────────── 彈珠台 ─────────────────────────
// 四面是金屬邊框，場上有 4 個彈跳柱（撞到會被大力彈開），下方中間和左右下角是出球口＝袋口。
export const PINBALL_BUMPERS = [
  { x: -5, z: -2.5, rad: 0.85, bumper: true, color: 0xff4fa0 },
  { x: 0, z: -4.2, rad: 0.85, bumper: true, color: 0x4fd2ff },
  { x: 5, z: -2.5, rad: 0.85, bumper: true, color: 0xffd23f },
  { x: 0, z: 0.6, rad: 0.85, bumper: true, color: 0x8dff6a },
];
const PINBALL_POCKETS = [{ x: 0, z: 6.9, r: 1.3 }, { x: -12.3, z: 6.8, r: 1.0 }, { x: 12.3, z: 6.8, r: 1.0 }];

function buildPinball() {
  const g = new THREE.Group();
  const { c, g: ctx, k, X, Z } = fieldCanvas(24);
  const grad = ctx.createRadialGradient(c.width / 2, c.height * 0.4, 20, c.width / 2, c.height / 2, c.width * 0.7);
  grad.addColorStop(0, '#2b2a7a');
  grad.addColorStop(1, '#120f3a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);
  // 星星、箭頭燈
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.6})`;
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
  }
  const arrow = (x, z, rot, col) => {
    ctx.save();
    ctx.translate(X(x), Z(z));
    ctx.rotate(rot);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, -0.7 * k);
    ctx.lineTo(0.45 * k, 0.2 * k);
    ctx.lineTo(-0.45 * k, 0.2 * k);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  for (let i = 0; i < 4; i++) {
    arrow(-9, 3 - i * 1.4, 0, `rgba(255,79,160,${0.4 + i * 0.15})`);
    arrow(9, 3 - i * 1.4, 0, `rgba(79,210,255,${0.4 + i * 0.15})`);
  }
  ctx.font = `bold ${1.5 * k}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,210,63,0.35)';
  ctx.fillText('HAMMER BALL', X(0), Z(4.3));
  // 出球口前的斜線
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 3;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(X(s * 9), Z(4.5));
    ctx.lineTo(X(s * 2), Z(7.2));
    ctx.stroke();
  }
  const top = toon(0xffffff, { map: canvasTex(c) });
  g.add(slab(top, toon(0x1a1a2e), 1));

  // 金屬邊框
  const chrome = toon(0xc9d1db);
  const railGeoL = new THREE.BoxGeometry(W + 1.2, 0.7, 0.6);
  const railGeoS = new THREE.BoxGeometry(0.6, 0.7, D);
  for (const z of [ARENA.minZ - 0.3, ARENA.maxZ + 0.3]) {
    const m = new THREE.Mesh(railGeoL, chrome);
    m.position.set(0, 0.35, z);
    g.add(m);
  }
  for (const x of [ARENA.minX - 0.3, ARENA.maxX + 0.3]) {
    const m = new THREE.Mesh(railGeoS, chrome);
    m.position.set(x, 0.35, 0);
    g.add(m);
  }
  // 機台外框、背板
  const cab = toon(0x2a1238);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 4, 6, D + 4), cab);
  frame.position.y = -3.6;
  g.add(frame);
  const back = new THREE.Mesh(new THREE.BoxGeometry(W + 4, 9, 1.2), [cab, cab, cab, cab, toon(0xffffff, { map: makeBackglass() }), cab]);
  back.position.set(0, 3.5, ARENA.minZ - 2.4);
  g.add(back);

  // 彈跳柱：底座＋發光的頂蓋；撞到時 game.js 會讓 obstacle.mesh 閃一下
  for (const b of PINBALL_BUMPERS) {
    const grp = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(b.rad, b.rad, 0.5, 24), toon(0xf4f4f4));
    base.position.y = 0.25;
    grp.add(base);
    const capMat = toon(b.color, { emissive: b.color, emissiveIntensity: 0.25 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(b.rad * 0.9, b.rad, 0.35, 24), capMat);
    cap.position.y = 0.68;
    grp.add(cap);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(b.rad, 0.08, 8, 24), toon(0x222222));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.5;
    grp.add(ring);
    grp.position.set(b.x, 0, b.z);
    g.add(grp);
    b.mesh = grp;
    b.capMat = capMat;
  }
  for (const p of PINBALL_POCKETS) holeMesh(g, p.x, p.z, p.r, 0x050208, 0xc9d1db);

  // 街機廳地板
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), toon(0x1c1430));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -6.6;
  g.add(floor);
  return g;
}

function makeBackglass() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 512, 160);
  grad.addColorStop(0, '#ff4fa0');
  grad.addColorStop(1, '#4f6bff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = '#ffd23f';
  g.font = 'bold 56px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.strokeStyle = '#2a1238';
  g.lineWidth = 8;
  g.strokeText('HAMMER BALL', 256, 70);
  g.fillText('HAMMER BALL', 256, 70);
  g.fillStyle = '#fff';
  g.font = 'bold 22px "Microsoft JhengHei", sans-serif';
  g.fillText('彈 珠 台 大 亂 鬥', 256, 125);
  return canvasTex(c);
}

// ───────────────────────── 頂樓 ─────────────────────────
// 大樓頂樓：四面都是邊緣（打出去會掉到樓下），中間是直升機停機坪，有水塔和冷氣機擋路。
const ROOF_OBS = [
  { x: -7.5, z: -3.5, rad: 1.3 },
  { x: 7, z: 3.5, hw: 1.0, hd: 0.8 },
  { x: 8.5, z: -4.5, hw: 0.8, hd: 1.0 },
  { x: -6, z: 4.5, hw: 1.2, hd: 0.6 },
];

function buildRooftop() {
  const g = new THREE.Group();
  const { c, g: ctx, k, X, Z } = fieldCanvas(24);
  ctx.fillStyle = '#7d8084';
  ctx.fillRect(0, 0, c.width, c.height);
  speckle(ctx, c.width, c.height, 8000, 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.1)');
  // 防水磁磚
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x < c.width; x += k) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, c.height);
    ctx.stroke();
  }
  for (let y = 0; y < c.height; y += k) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(c.width, y);
    ctx.stroke();
  }
  // 停機坪
  ctx.fillStyle = '#3b3f45';
  ctx.beginPath();
  ctx.arc(X(0), Z(0), 4 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f2c230';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(X(0), Z(0), 3.6 * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f4f4f4';
  ctx.font = `bold ${4 * k}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', X(0), Z(0.2));
  // 四周的警示條
  const s = 10;
  hazard(ctx, 0, 0, c.width, s);
  hazard(ctx, 0, c.height - s, c.width, s);
  hazard(ctx, 0, 0, s, c.height);
  hazard(ctx, c.width - s, 0, s, c.height);
  const top = toon(0xffffff, { map: canvasTex(c) });

  // 大樓本體（往下 60 m）
  const winTex = makeWindowTexture('#c4c9cf', '#4f7896', '#9cc3dc');
  const H = 60;
  const geo = new THREE.BoxGeometry(W, H, D);
  scaleBoxUV(geo, W, H, D, 3, 3.2);
  const side = toon(0xffffff, { map: winTex });
  const roofEdge = toon(0x6a6d72);
  const body = new THREE.Mesh(geo, [side, side, roofEdge, roofEdge, side, side]);
  body.position.y = -H / 2 - 0.3;
  g.add(body);
  // 樓頂地板另外一塊（大樓側面的窗格 UV 是放大過的，不能共用）
  g.add(slab(top, roofEdge, 0.3));

  // 水塔、冷氣機
  for (const o of ROOF_OBS) {
    if (o.rad) {
      const tank = new THREE.Group();
      const legMat = toon(0x5a4a3a);
      for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2, 0.2), legMat);
        leg.position.set(lx, 1, lz);
        tank.add(leg);
      }
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(o.rad, o.rad, 2.6, 20), toon(0x8a6a4a));
      barrel.position.y = 3.3;
      tank.add(barrel);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(o.rad * 1.08, 1, 20), toon(0x5a4a3a));
      roof.position.y = 5.1;
      tank.add(roof);
      tank.position.set(o.x, 0, o.z);
      g.add(tank);
    } else {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(o.hw * 2, 1.4, o.hd * 2), toon(0xc9ccd1));
      ac.position.set(o.x, 0.7, o.z);
      g.add(ac);
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(o.hw, o.hd) * 0.7, Math.min(o.hw, o.hd) * 0.7, 0.05, 16), toon(0x444444));
      fan.position.set(o.x, 1.43, o.z);
      g.add(fan);
    }
  }

  // 周圍的大樓、地面
  const palettes = [['#d9cbb4', '#5f8fb0', '#86b3cf'], ['#e8e2d6', '#6a8fa6', '#f5dc9b'], ['#b48f78', '#4d6f88', '#89aac2'], ['#9fb3c2', '#3f5f78', '#a7cde3']];
  const texs = palettes.map((p) => makeWindowTexture(...p));
  const roofMat = toon(0x8d9096);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = 30 + Math.random() * 20;
    const w = 8 + Math.random() * 6;
    const d = 8 + Math.random() * 6;
    const h = 30 + Math.random() * 50;
    const bg = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(bg, w, h, d, 3, 3.2);
    const sm = toon(0xffffff, { map: texs[i % texs.length] });
    const m = new THREE.Mesh(bg, [sm, sm, roofMat, roofMat, sm, sm]);
    m.position.set(Math.cos(a) * r * 1.2, -H + h / 2, Math.sin(a) * r);
    g.add(m);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toon(0x6d6a64));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -H;
  g.add(ground);
  for (let i = 0; i < 10; i++) {
    const t = makeTree(2.5);
    t.position.set((Math.random() - 0.5) * 120, -H, 20 + Math.random() * 30);
    g.add(t);
  }
  return g;
}

// ───────────────────────── 保齡球道 ─────────────────────────
// 球道沿 x 方向：左邊是助走區（玩家只能站在犯規線左邊），右邊是球瓶區，右側盡頭是球坑（掉下去）。
// 球道兩邊是溝槽：球或球瓶的中心超過 laneHalf 就掉進溝裡。
export const LANE = { half: 2.4, foulX: -6, headX: 7.5, pinR: 0.3 };
// 10 支球瓶的位置（三角形，1 號瓶在最前面）
export const PIN_SPOTS = (() => {
  const out = [];
  for (let row = 0; row < 4; row++) {
    for (let j = 0; j <= row; j++) out.push({ x: LANE.headX + row * 0.95, z: (j - row / 2) * 1.05 });
  }
  return out;
})();

function buildLane() {
  const g = new THREE.Group();
  const { c, g: ctx, k, X, Z } = fieldCanvas(24);
  // 整塊：球道（木頭）＋兩邊溝槽＋外面的地毯
  ctx.fillStyle = '#3a2440';
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = ['#ff4fa0', '#4fd2ff', '#ffd23f'][i % 3];
    ctx.globalAlpha = 0.35;
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 6, 6);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#d8a868';
  ctx.fillRect(0, Z(-LANE.half), c.width, LANE.half * 2 * k);
  ctx.strokeStyle = 'rgba(120,70,30,0.25)';
  for (let z = -LANE.half; z < LANE.half; z += 0.25) {
    ctx.beginPath();
    ctx.moveTo(0, Z(z));
    ctx.lineTo(c.width, Z(z));
    ctx.stroke();
  }
  // 溝槽
  ctx.fillStyle = '#2a2a30';
  ctx.fillRect(0, Z(-LANE.half - 0.7), c.width, 0.7 * k);
  ctx.fillRect(0, Z(LANE.half), c.width, 0.7 * k);
  // 犯規線、引導點、箭頭
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(X(LANE.foulX) - 3, Z(-LANE.half), 6, LANE.half * 2 * k);
  ctx.fillStyle = '#5a3418';
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(X(LANE.foulX + 1.5), Z(i * 0.6), 4, 0, Math.PI * 2);
    ctx.fill();
    const ax = X(LANE.foulX + 5 + Math.abs(i) * 0.6);
    const az = Z(i * 0.6);
    ctx.beginPath();
    ctx.moveTo(ax + 12, az);
    ctx.lineTo(ax - 6, az - 6);
    ctx.lineTo(ax - 6, az + 6);
    ctx.closePath();
    ctx.fill();
  }
  // 球瓶位置
  ctx.fillStyle = 'rgba(90,52,24,0.6)';
  for (const p of PIN_SPOTS) {
    ctx.beginPath();
    ctx.arc(X(p.x), Z(p.z), 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const top = toon(0xffffff, { map: canvasTex(c) });
  g.add(slab(top, toon(0x2a1a30), 1));

  // 球坑（右邊盡頭）與後牆
  const pit = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, LANE.half * 2 + 3), toon(0x111114));
  pit.position.set(ARENA.maxX + 2, -2.5, 0);
  g.add(pit);
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5, D + 4), toon(0x1d1d24));
  backWall.position.set(ARENA.maxX + 4.2, 1, 0);
  g.add(backWall);
  const curtain = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.6, D + 4), toon(0x2a1238));
  curtain.position.set(ARENA.maxX + 2.2, 3.4, 0);
  g.add(curtain);
  // 上下兩邊的隔板（四面中只有右邊開放，其他是牆）
  const kick = toon(0x3a3f4a);
  for (const z of [ARENA.minZ - 0.3, ARENA.maxZ + 0.3]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(W, 0.8, 0.6), kick);
    m.position.set(0, 0.4, z);
    g.add(m);
  }
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, D), kick);
  leftWall.position.set(ARENA.minX - 0.3, 0.4, 0);
  g.add(leftWall);
  // 回球機
  const ret = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.2), toon(0x4f6bff));
  ret.position.set(ARENA.minX + 2, 0.6, ARENA.minZ + 1.5);
  g.add(ret);
  // 球館地板、隔壁球道（裝飾）
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), toon(0x241a2c));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1;
  g.add(floor);
  for (const dz of [-18, 18]) {
    const n = slab(top, toon(0x2a1a30), 1);
    n.position.z = dz;
    g.add(n);
  }
  return g;
}

// ───────────────────────── 桌上曲棍球 ─────────────────────────
// 四周都是擋板（冰球會反彈），只有左右兩端中間各開一個球門口。
// 冰球幾乎不減速；中線把場地分成兩半，每隊只能待在自己那半邊。
export const HOCKEY = { goalHalf: 3.0, goalDepth: 1.0 };
const HOCKEY_POSTS = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: sx * ARENA.maxX, z: sz * HOCKEY.goalHalf, hw: 0.12, hd: 0.12 })));

function buildHockey() {
  const g = new THREE.Group();
  const { c, g: ctx, k, X, Z } = fieldCanvas(32);
  ctx.fillStyle = '#e9f3fb';
  ctx.fillRect(0, 0, c.width, c.height);
  // 出氣孔
  ctx.fillStyle = 'rgba(70,110,150,0.25)';
  for (let x = ARENA.minX + 0.5; x < ARENA.maxX; x += 0.7) {
    for (let z = ARENA.minZ + 0.5; z < ARENA.maxZ; z += 0.7) {
      ctx.beginPath();
      ctx.arc(X(x), Z(z), 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 中線、藍線、中圈
  ctx.fillStyle = '#d23a2a';
  ctx.fillRect(X(0) - 4, 0, 8, c.height);
  ctx.fillStyle = '#2f6fd0';
  for (const x of [-4.5, 4.5]) ctx.fillRect(X(x) - 3, 0, 6, c.height);
  ctx.strokeStyle = '#d23a2a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(X(0), Z(0), 2.4 * k, 0, Math.PI * 2);
  ctx.stroke();
  // 球門前的半圓（藍隊左邊、紅隊右邊）
  for (const [sx, col] of [[-1, 'rgba(63,127,232,0.28)'], [1, 'rgba(232,80,91,0.28)']]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(X(sx * ARENA.maxX), Z(0), 3.2 * k, sx < 0 ? -Math.PI / 2 : Math.PI / 2, sx < 0 ? Math.PI / 2 : Math.PI * 1.5);
    ctx.fill();
  }
  const top = toon(0xffffff, { map: canvasTex(c) });
  g.add(slab(top, toon(0x1d2a3a), 1));

  // 擋板（左右兩邊中間留球門口）
  const rail = toon(0x22324a);
  const strip = toon(0x7fe0ff, { emissive: 0x7fe0ff, emissiveIntensity: 0.6 });
  const railBox = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), rail);
    m.position.set(x, 0.35, z);
    g.add(m);
    const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.06, d + 0.02), strip);
    s.position.set(x, 0.72, z);
    g.add(s);
  };
  railBox(0, ARENA.minZ - 0.3, W + 1.2, 0.6);
  railBox(0, ARENA.maxZ + 0.3, W + 1.2, 0.6);
  const sideLen = ARENA.maxZ - HOCKEY.goalHalf;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) railBox(sx * (ARENA.maxX + 0.3), sz * (HOCKEY.goalHalf + sideLen / 2), 0.6, sideLen);
    // 球門：凹進去的暗格，發隊伍顏色的光
    const col = sx < 0 ? 0x3f7fe8 : 0xe8505b;
    const pit = new THREE.Mesh(new THREE.BoxGeometry(HOCKEY.goalDepth, 0.1, HOCKEY.goalHalf * 2), new THREE.MeshBasicMaterial({ color: 0x05070a }));
    pit.position.set(sx * (ARENA.maxX + HOCKEY.goalDepth / 2), 0.01, 0);
    g.add(pit);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, HOCKEY.goalHalf * 2 + 0.6), toon(col, { emissive: col, emissiveIntensity: 0.5 }));
    back.position.set(sx * (ARENA.maxX + HOCKEY.goalDepth + 0.15), 0.35, 0);
    g.add(back);
  }
  // 桌腳、遊樂場地板
  const legMat = toon(0x2a2f3a);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 7, 1.2), legMat);
      leg.position.set(sx * (W / 2 - 1.2), -4.5, sz * (D / 2 - 1.2));
      g.add(leg);
    }
  }
  const body = new THREE.Mesh(new THREE.BoxGeometry(W + 2.4, 1.6, D + 1.6), toon(0x22324a));
  body.position.y = -1.6;
  g.add(body);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), toon(0x1c1430));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -8;
  g.add(floor);
  return g;
}

// ───────────────────────── 測試場 ─────────────────────────
// 訓練室：格線地板（1 m 一格），從起點量 Lv1／Lv2／Lv3 的擊退距離。
// 左、上、下是軟墊牆（測壁咚），右邊是開放的邊緣（測出界）。另有柱子、彈跳柱、袋口各一個。
export const LAB = { startX: -9, marks: [{ d: 4, name: 'Lv1', color: '#f4f4f4' }, { d: 8, name: 'Lv2', color: '#ffd23f' }, { d: 14, name: 'Lv3', color: '#ff4b3a' }] };
const LAB_OBS = [
  { x: 2, z: -5, hw: 0.6, hd: 0.6 },
  { x: 8, z: 4.6, rad: 0.8, bumper: true, color: 0x4fd2ff },
];
const LAB_POCKETS = [{ x: 8, z: -5, r: 0.9 }];

function buildLab() {
  const g = new THREE.Group();
  const { c, g: ctx, k, X, Z } = fieldCanvas(32);
  ctx.fillStyle = '#2b3139';
  ctx.fillRect(0, 0, c.width, c.height);
  // 格線：1 m 細線、5 m 粗線
  for (let x = Math.ceil(ARENA.minX); x <= ARENA.maxX; x++) {
    const major = (x - LAB.startX) % 5 === 0;
    ctx.fillStyle = major ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
    ctx.fillRect(X(x) - (major ? 1.5 : 0.5), 0, major ? 3 : 1, c.height);
  }
  for (let z = Math.ceil(ARENA.minZ); z <= ARENA.maxZ; z++) {
    const major = z % 5 === 0;
    ctx.fillStyle = major ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, Z(z) - (major ? 1.5 : 0.5), c.width, major ? 3 : 1);
  }
  // 起點
  ctx.strokeStyle = '#6aa2ff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(X(LAB.startX), Z(0), 0.7 * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#6aa2ff';
  ctx.font = `bold ${0.42 * k}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('START', X(LAB.startX), Z(1.2));
  // Lv1／Lv2／Lv3 距離線
  for (const m of LAB.marks) {
    const x = X(LAB.startX + m.d);
    ctx.fillStyle = m.color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - 2, Z(-6.8), 4, 13.6 * k);
    ctx.globalAlpha = 1;
    ctx.font = `bold ${0.5 * k}px "Microsoft JhengHei", Arial, sans-serif`;
    ctx.fillText(`${m.name}　${m.d} m`, x, Z(-6.3));
  }
  // 底部刻度
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `${0.32 * k}px Arial, sans-serif`;
  for (let d = 0; d <= 21; d += 2) ctx.fillText(`${d}`, X(LAB.startX + d), Z(7.0));
  // 右邊邊緣警示
  hazard(ctx, c.width - 12, 0, 12, c.height);
  const top = toon(0xffffff, { map: canvasTex(c) });
  g.add(slab(top, toon(0x1d2229), 1));

  // 軟墊牆（左、上、下）
  const pad = toon(0x3f6fb5);
  const trim = toon(0xf2c230);
  const wall = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), pad);
    m.position.set(x, 0.55, z);
    g.add(m);
    const t = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.12, d + 0.02), trim);
    t.position.set(x, 1.12, z);
    g.add(t);
  };
  wall(-0.3, ARENA.minZ - 0.3, W + 0.6, 0.6);
  wall(-0.3, ARENA.maxZ + 0.3, W + 0.6, 0.6);
  wall(ARENA.minX - 0.3, 0, 0.6, D);

  // 柱子、彈跳柱、袋口
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.7, 1.2), toon(0x9aa3ad));
  pillar.position.set(LAB_OBS[0].x, 0.85, LAB_OBS[0].z);
  g.add(pillar);
  const b = LAB_OBS[1];
  const bump = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(b.rad, b.rad, 0.5, 24), toon(0xf4f4f4));
  base.position.y = 0.25;
  bump.add(base);
  const capMat = toon(b.color, { emissive: b.color, emissiveIntensity: 0.25 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(b.rad * 0.9, b.rad, 0.35, 24), capMat);
  cap.position.y = 0.68;
  bump.add(cap);
  bump.position.set(b.x, 0, b.z);
  g.add(bump);
  b.capMat = capMat;
  for (const p of LAB_POCKETS) holeMesh(g, p.x, p.z, p.r, 0x050505, 0xf2c230);

  // 房間：深色地板、後牆的大字
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), toon(0x161a20));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -8;
  g.add(floor);
  const sign = document.createElement('canvas');
  sign.width = 1024;
  sign.height = 160;
  const sg = sign.getContext('2d');
  sg.fillStyle = '#1d232c';
  sg.fillRect(0, 0, 1024, 160);
  sg.fillStyle = 'rgba(106,162,255,0.85)';
  sg.font = 'bold 96px Arial, sans-serif';
  sg.textAlign = 'center';
  sg.textBaseline = 'middle';
  sg.fillText('TRAINING  ROOM', 512, 84);
  const back = new THREE.Mesh(new THREE.BoxGeometry(60, 9.4, 1), [toon(0x1d232c), toon(0x1d232c), toon(0x1d232c), toon(0x1d232c), toon(0xffffff, { map: canvasTex(sign) }), toon(0x1d232c)]);
  back.position.set(0, -3.3, ARENA.minZ - 6);
  g.add(back);
  return g;
}

// ───────────────────────── 登記 ─────────────────────────

export function registerMaps(world) {
  world.addMap('ice', {
    group: buildIce(),
    data: { sides: OPEN, pockets: ICE_POCKETS, obstacles: ICE_OBS, friction: 0.35, fallY: -3 },
    look: { bg: 0xcfe3f2, fog: [70, 170], sky: 0xffffff, ground: 0x9ab8cc, hemi: 1.2, sun: 0xffffff, sunI: 1.6 },
  });
  world.addMap('pinball', {
    group: buildPinball(),
    data: { sides: { l: false, r: false, t: false, b: false }, pockets: PINBALL_POCKETS, obstacles: PINBALL_BUMPERS },
    look: { bg: 0x140c22, fog: [70, 170], sky: 0xf0e8ff, ground: 0x3a2a4a, hemi: 1.15, sun: 0xffffff, sunI: 1.6 },
  });
  world.addMap('rooftop', {
    group: buildRooftop(),
    data: { sides: OPEN, pockets: [], obstacles: ROOF_OBS, fallY: -60 },
    look: { bg: 0xf3c29a, fog: [70, 190], sky: 0xffe6cc, ground: 0x6d6a64, hemi: 1.1, sun: 0xffd7a8, sunI: 1.8 },
  });
  world.addMap('lab', {
    group: buildLab(),
    data: { sides: { l: false, r: true, t: false, b: false }, pockets: LAB_POCKETS, obstacles: LAB_OBS, fallY: -7 },
    look: { bg: 0x1a1f27, fog: [80, 190], sky: 0xf0f4ff, ground: 0x3a4250, hemi: 1.2, sun: 0xffffff, sunI: 1.6 },
  });
  world.addMap('hockey', {
    group: buildHockey(),
    data: { sides: { l: false, r: false, t: false, b: false }, pockets: [], obstacles: HOCKEY_POSTS, goalHalf: HOCKEY.goalHalf, goalDepth: HOCKEY.goalDepth },
    look: { bg: 0x161026, fog: [70, 170], sky: 0xf4f8ff, ground: 0x3a2a4a, hemi: 1.2, sun: 0xffffff, sunI: 1.7 },
  });
  world.addMap('lane', {
    group: buildLane(),
    data: { sides: { l: false, r: true, t: false, b: false }, pockets: [], obstacles: [], laneHalf: LANE.half, fallY: -3 },
    look: { bg: 0x1a1022, fog: [70, 170], sky: 0xfff0f8, ground: 0x3a2a4a, hemi: 1.15, sun: 0xffffff, sunI: 1.7 },
  });
}
