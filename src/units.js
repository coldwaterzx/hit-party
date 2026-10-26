// 角色與道具的模型（全部用基本幾何組成，之後換正式美術）。
// 每個模型的「正面」是本地 +Z，group.rotation.y = yaw 就會面向 (sin yaw, cos yaw)。
import * as THREE from 'three';
import { toon } from './world.js';
import { makeCrateMesh } from './items.js';

const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
const EYE_GEO = new THREE.SphereGeometry(0.06, 8, 8);
// 所有角色共用，單位消失時不能釋放
EYE_MAT.userData.shared = true;
EYE_GEO.userData.shared = true;

function addEyes(parent, y, z, spread = 0.12, scale = 1) {
  for (const ex of [-spread, spread]) {
    const e = new THREE.Mesh(EYE_GEO, EYE_MAT);
    e.position.set(ex, y, z);
    e.scale.setScalar(scale);
    parent.add(e);
  }
}

// color：角色顏色（玩家黃色，AI 對手各有自己的顏色）；ringColor：腳下的圈（足球模式是隊伍顏色）
export function makePlayerMesh(color = 0xf2c14e, ringColor = color) {
  const group = new THREE.Group();
  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);

  const bodyMat = toon(color, { emissive: 0x000000 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.45, 6, 14), bodyMat);
  body.position.y = 0.6;
  bodyRoot.add(body);
  addEyes(body, 0.25, 0.3);

  // 錘子：pivot 在右肩，握把沿本地 +Y，錘頭在握把頂端
  const pivot = new THREE.Group();
  pivot.rotation.order = 'YXZ';
  pivot.position.set(0.3, 0.75, 0);
  group.add(pivot);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.1, 8), toon(0x6b4a2b));
  handle.position.y = 0.55;
  pivot.add(handle);
  const headMat = toon(0x9aa3ad, { emissive: 0x000000 });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.38, 0.38), headMat);
  head.position.y = 1.12;
  pivot.add(head);

  // 腳下的玩家顏色圈
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.62, 36),
    new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);

  return { group, bodyRoot, body, pivot, head, headMat, mats: [bodyMat] };
}

// 足球的黑白花紋（球面展開圖上點黑色五邊形）
const SOCCER_TEX = (() => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f7f7';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#1b1b1b';
  const penta = (x, y, r) => {
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  };
  for (const [x, y] of [[32, 30], [96, 30], [160, 30], [224, 30], [0, 78], [64, 78], [128, 78], [192, 78], [256, 78], [32, 118], [160, 118]]) penta(x, y, 14);
  penta(128, 6, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
SOCCER_TEX.userData = { shared: true };

export function makeEnemyMesh(type, def) {
  const group = new THREE.Group();
  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);
  const mats = [];
  const m = (c) => {
    const mat = toon(c, { emissive: 0x000000 });
    mats.push(mat);
    return mat;
  };

  if (type === 'dummy') {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 1.2, 14), m(def.color));
    post.position.y = 0.6;
    bodyRoot.add(post);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.06, 8, 20), m(0xd23a2a));
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.8;
    bodyRoot.add(band);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(0xb08a58));
    cap.position.y = 1.2;
    bodyRoot.add(cap);
    addEyes(bodyRoot, 1.0, 0.38, 0.13);
  } else if (type === 'minion' || type === 'gold') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), m(def.color));
    b.scale.set(1, 1.1, 1);
    b.position.y = 0.44;
    bodyRoot.add(b);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 8), m(type === 'gold' ? 0xfff2b0 : 0x3d6b35));
      horn.position.set(0.18 * s, 0.9, 0);
      horn.rotation.z = -0.4 * s;
      bodyRoot.add(horn);
    }
    addEyes(bodyRoot, 0.55, 0.36, 0.13);
  } else if (type === 'heavy') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 14), m(def.color));
    b.scale.set(1, 0.92, 1);
    b.position.y = 0.72;
    bodyRoot.add(b);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), m(0xf0c0a0));
    belly.position.set(0, 0.6, 0.35);
    belly.scale.set(1, 0.9, 0.6);
    bodyRoot.add(belly);
    addEyes(bodyRoot, 1.05, 0.62, 0.2, 1.4);
  } else if (type === 'ball') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 24, 16), m(0xffffff));
    b.material.map = SOCCER_TEX;
    b.position.y = def.radius;
    bodyRoot.add(b);
    bodyRoot.userData.spin = b;
  } else if (type === 'crate') {
    bodyRoot.add(makeCrateMesh(mats));
  } else if (type === 'egg') {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), m(def.color));
    e.scale.set(1, 1.3, 1);
    e.position.y = 0.55;
    bodyRoot.add(e);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff6d0 }));
    shine.position.set(0.15, 0.85, 0.3);
    bodyRoot.add(shine);
  } else if (type === 'keeper') {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.5, 6, 12), m(def.color));
    b.position.y = 0.75;
    bodyRoot.add(b);
    for (const s of [-1, 1]) {
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), m(0x7be07b));
      glove.position.set(0.62 * s, 1.0, 0.1);
      bodyRoot.add(glove);
    }
    addEyes(bodyRoot, 1.1, 0.42, 0.14);
  } else if (type === 'cueball' || type === 'steel' || type === 'bowlball') {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 22, 16), m(def.color));
    ball.position.y = def.radius;
    bodyRoot.add(ball);
    if (type === 'bowlball') {
      for (const [x, y] of [[-0.12, 0.2], [0.12, 0.2], [0, 0.02]]) {
        const hole = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0x0a0a14 }));
        hole.position.set(x, y, def.radius * 0.93);
        ball.add(hole);
      }
    } else if (type === 'cueball') {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), new THREE.MeshBasicMaterial({ color: 0xd23a2a }));
      dot.position.set(0, 0, def.radius + 0.001);
      ball.add(dot);
    }
    bodyRoot.userData.spin = ball;
  } else if (type === 'pin') {
    const pinMat = m(def.color);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.27, 0.7, 14), pinMat);
    body.position.y = 0.35;
    bodyRoot.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.25, 12), pinMat);
    neck.position.y = 0.82;
    bodyRoot.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), pinMat);
    head.position.y = 1.0;
    bodyRoot.add(head);
    for (const y of [0.74, 0.8]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 16), m(0xd23a2a));
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      bodyRoot.add(band);
    }
  } else if (type === 'stone') {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(def.radius, def.radius * 0.9, 0.35, 20), m(def.color));
    s.position.y = 0.18;
    bodyRoot.add(s);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(def.radius * 0.8, def.radius, 0.08, 20), m(0xd23a2a));
    top.position.y = 0.39;
    bodyRoot.add(top);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.6), m(0x2a2a2a));
    handle.position.set(0, 0.5, 0.1);
    bodyRoot.add(handle);
  } else if (type === 'boss') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 24, 18), m(def.color));
    b.scale.set(1, 0.95, 1);
    b.position.y = def.radius * 1.05;
    bodyRoot.add(b);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(def.radius * 0.7, 18, 12), m(0xe0b0f0));
    belly.position.set(0, def.radius * 0.9, def.radius * 0.55);
    belly.scale.set(1, 0.9, 0.6);
    bodyRoot.add(belly);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.45, 5), m(0xffd23f));
    crown.position.y = def.radius * 2.1;
    bodyRoot.add(crown);
    addEyes(bodyRoot, def.radius * 1.45, def.radius * 0.85, 0.32, 2.2);
  } else if (type === 'cart') {
    const metal = m(def.color);
    const basket = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 1.5), metal);
    basket.position.y = 0.9;
    bodyRoot.add(basket);
    const inside = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 1.35), m(0x5a6068));
    inside.position.y = 1.31;
    bodyRoot.add(inside);
    for (const [x, c] of [[-0.3, 0xf08a3c], [0.25, 0x7bc96f], [0, 0xd23a2a]]) {
      const goods = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), m(c));
      goods.position.set(x, 1.45, (Math.random() - 0.5) * 0.6);
      bodyRoot.add(goods);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), m(0xd23a2a));
    handle.position.set(0, 1.45, -0.85);
    bodyRoot.add(handle);
    for (const sx of [-0.5, 0.5]) {
      for (const sz of [-0.55, 0.55]) {
        const w = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), m(0x222222));
        w.position.set(sx, 0.15, sz);
        bodyRoot.add(w);
      }
    }
  } else if (type === 'puck') {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(def.radius, def.radius, 0.22, 28), m(def.color));
    disc.position.y = 0.11;
    bodyRoot.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(def.radius * 0.65, 0.05, 6, 24), m(0xe8505b));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.23;
    bodyRoot.add(ring);
  } else if (type === 'golfball') {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 18, 12), m(def.color));
    ball.position.y = def.radius;
    bodyRoot.add(ball);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.08, 10), new THREE.MeshBasicMaterial({ color: 0xd23a2a }));
    dot.position.set(0, 0, def.radius + 0.001);
    ball.add(dot);
    bodyRoot.userData.spin = ball;
  } else if (type === 'thrower') {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.38, 6, 12), m(def.color));
    b.position.y = 0.52;
    bodyRoot.add(b);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.45, 12), m(0x2f5e92));
    hat.position.y = 1.15;
    bodyRoot.add(hat);
    addEyes(bodyRoot, 0.72, 0.27, 0.11);
  }

  return { group, bodyRoot, mats };
}

export function makeBallMesh() {
  const mat = toon(0xf5f0e6, { emissive: 0x000000 });
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10), mat);
  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.025, 6, 20), new THREE.MeshBasicMaterial({ color: 0xd23a2a }));
  m.add(seam);
  return { mesh: m, mat };
}

export function makeShadow(r) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(r * 1.15, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  return m;
}

export function makeHpBar(width = 0.9) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 0.06, 0.14),
    new THREE.MeshBasicMaterial({ color: 0x220a0a, depthTest: false, transparent: true }),
  );
  const fillGeo = new THREE.PlaneGeometry(width, 0.09);
  fillGeo.translate(width / 2, 0, 0);
  const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: 0xe8483a, depthTest: false, transparent: true }));
  fill.position.set(-width / 2, 0, 0.001);
  bg.renderOrder = 5;
  fill.renderOrder = 6;
  g.add(bg, fill);
  g.userData.fill = fill;
  return g;
}

// 暈眩時頭上轉圈的星星
export function makeStars() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe14d });
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), mat);
    const a = (i / 3) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4);
    g.add(s);
  }
  return g;
}

// 敵人攻擊預警：紅色圓圈（外框＋隨時間長大的填色）
export function makeTelegraphCircle(r) {
  const g = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(r - 0.07, r, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.9, depthWrite: false }));
  const fillGeo = new THREE.CircleGeometry(r, 40);
  fillGeo.rotateX(-Math.PI / 2);
  const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.28, depthWrite: false }));
  g.add(ring, fill);
  g.position.y = 0.035;
  g.userData.fill = fill;
  return g;
}

// 投擲兵的瞄準線
export function makeTelegraphLine(len = 11) {
  const geo = new THREE.PlaneGeometry(0.28, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, 0.5);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.5, depthWrite: false }));
  m.scale.z = len;
  m.position.y = 0.035;
  return m;
}

// LoL 式地面指示器：蓄力時的扇形判定範圍＋擊退方向箭頭
export function makeIndicator() {
  const g = new THREE.Group();
  g.position.y = 0.04;

  const coneGeo = new THREE.CircleGeometry(1, 32, -Math.PI / 2 - 0.61, 1.22);
  coneGeo.rotateX(-Math.PI / 2);
  const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
  g.add(cone);

  const shaftGeo = new THREE.PlaneGeometry(0.5, 1);
  shaftGeo.rotateX(-Math.PI / 2);
  shaftGeo.translate(0, 0, 0.5);
  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
  });
  const shaft = new THREE.Mesh(shaftGeo, arrowMat);
  g.add(shaft);

  const tri = new THREE.Shape();
  tri.moveTo(-0.55, 0);
  tri.lineTo(0.55, 0);
  tri.lineTo(0, 0.8);
  tri.closePath();
  const headGeo = new THREE.ShapeGeometry(tri);
  headGeo.rotateX(Math.PI / 2); // 形狀的 +Y 轉到 +Z
  const head = new THREE.Mesh(headGeo, arrowMat);
  g.add(head);

  return { group: g, cone, shaft, head, arrowMat };
}
