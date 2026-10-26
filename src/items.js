// 道具賽：場上會掉道具箱，用錘子打破就拿到道具，拿到馬上生效。
// 道具分四類：
//   改錘子：巨錘、連發錘、磁力錘
//   改物理：彈力球化、重量化、冰面
//   陷阱：香蕉皮、地雷錐、臨時袋口
//   保命：護盾、錨
// 角色身上的效果記在 f.fx（剩幾秒）；game.js 在揮錘、擊退、碰撞時讀這些值。
import * as THREE from 'three';
import { P, FIGHTER_MASS } from './config.js';
import { sfx } from './audio.js';
import { ARENA, POCKETS, wallHit, toon } from './world.js';

export const ITEMS = [
  { id: 'big', name: '巨錘', desc: '判定範圍、擊退距離變大', color: '#ffb03a' },
  { id: 'rapid', name: '連發錘', desc: '蓄力時間減半', color: '#ffe14d' },
  { id: 'magnet', name: '磁力錘', desc: '蓄力時把附近的東西吸過來', color: '#c48bff' },
  { id: 'bouncy', name: '彈力球化', desc: '被你打到的東西撞牆不減速、滑很遠', color: '#ff7fbf' },
  { id: 'heavy', name: '重量化', desc: '很難被撞走，走路撞人會把人撞飛', color: '#9aa3ad' },
  { id: 'ice', name: '冰面', desc: '全場變滑一陣子', color: '#7fe0ff' },
  { id: 'banana', name: '香蕉皮', desc: '在身後和場上丟香蕉皮，別人踩到會滑出去', color: '#ffe14d' },
  { id: 'cone', name: '地雷錐', desc: '在前面放一個三角錐，被碰到就爆炸', color: '#ff6b3a' },
  { id: 'pocket', name: '臨時袋口', desc: '在前面開一個洞，幾秒後關閉', color: '#5fe3e3' },
  { id: 'shield', name: '護盾', desc: '擋掉一次打擊，打你的人反被彈開', color: '#6aa2ff' },
  { id: 'anchor', name: '錨', desc: '一陣子內幾乎不會被打飛', color: '#7be07b' },
];
const BY_ID = Object.fromEntries(ITEMS.map((it) => [it.id, it]));

// 角色身上會持續的效果
export const FX_KEYS = ['big', 'rapid', 'magnet', 'bouncy', 'heavy', 'shield', 'anchor'];

const rand = (a, b) => a + Math.random() * (b - a);

function makeCrateTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#c98a3c';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#7a4a1e';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 58, 58);
  g.fillStyle = '#fff3c4';
  g.font = 'bold 44px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.strokeStyle = '#5a3418';
  g.lineWidth = 5;
  g.strokeText('?', 32, 35);
  g.fillText('?', 32, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const CRATE_TEX = makeCrateTexture();
CRATE_TEX.userData = { shared: true };

// 道具箱的模型（給 units.js 的 makeEnemyMesh 用）
export function makeCrateMesh(mats) {
  const mat = toon(0xffffff, { map: CRATE_TEX, emissive: 0x000000 });
  mats.push(mat);
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), mat);
  m.position.y = 0.6;
  return m;
}

export class Items {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.traps = []; // { kind: 'banana'|'cone', x, z, owner, mesh, t }
    this.holes = []; // 臨時袋口 { p（放進 POCKETS 的物件）, life, mesh }
    this.iceT = 0;
    this.spawnT = 0;
    // 冰面效果：場地上蓋一層半透明的冰
    const iceGeo = new THREE.PlaneGeometry(ARENA.maxX - ARENA.minX, ARENA.maxZ - ARENA.minZ);
    iceGeo.rotateX(-Math.PI / 2);
    this.iceMesh = new THREE.Mesh(iceGeo, new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0, depthWrite: false }));
    this.iceMesh.position.y = 0.02;
    this.iceMesh.visible = false;
    this.scene.add(this.iceMesh);
  }

  get enabled() {
    const m = this.game.mode;
    return P.items && ['match', 'survival', 'egg', 'soccer', 'practice', 'defense', 'boss', 'escort', 'relay'].includes(m);
  }

  reset() {
    for (const t of this.traps) this.scene.remove(t.mesh);
    for (const h of this.holes) this.removeHole(h);
    this.traps = [];
    this.holes = [];
    this.iceT = 0;
    this.spawnT = P.itemEvery * 0.5;
  }

  // 滑行減速倍率（冰面道具）
  frictionMult() {
    return this.iceT > 0 ? 0.3 : 1;
  }

  update(dt) {
    const g = this.game;
    // 道具箱
    if (this.enabled) {
      const crates = g.units.filter((u) => u.type === 'crate').length;
      if (crates < P.itemMax) {
        this.spawnT -= dt;
        if (this.spawnT <= 0) {
          this.spawnT = P.itemEvery * rand(0.8, 1.2);
          const c = g.spawnUnit('crate');
          g.label(c.x, 2.4, c.z, '道具箱！', '#ffd23f', 22);
        }
      }
    }
    // 角色身上的效果倒數
    for (const f of g.fighters) {
      for (const k of FX_KEYS) {
        if (f.fx[k] > 0) {
          f.fx[k] = Math.max(0, f.fx[k] - dt);
          if (f.fx[k] === 0) this.expire(f, k);
        }
      }
      // 磁力錘：蓄力時把附近的東西往面前吸
      if (f.fx.magnet > 0 && f.charging && dt > 0) {
        const px = f.x + Math.sin(f.facing) * 1.4;
        const pz = f.z + Math.cos(f.facing) * 1.4;
        for (const b of g.bodies()) {
          if (b === f || !g.solid(b) || b.type === 'crate' || b.state === 'sliding') continue;
          if (b.isFighter && (b.iframe > 0 || (f.team !== null && b.team === f.team))) continue;
          const dx = px - b.x;
          const dz = pz - b.z;
          const d = Math.hypot(dx, dz);
          if (d > 5.5 || d < 0.9) continue;
          const s = Math.min(d - 0.9, 5 * dt);
          b.x += (dx / d) * s;
          b.z += (dz / d) * s;
          if (Math.random() < dt * 20) g.fx.puff(b.x, 0.6, b.z, 0xc48bff, 0.12);
        }
      }
    }
    // 冰面
    if (this.iceT > 0) this.iceT = Math.max(0, this.iceT - dt);
    this.iceMesh.visible = this.iceT > 0;
    this.iceMesh.material.opacity = Math.min(0.45, this.iceT * 0.4);
    // 陷阱
    for (const t of [...this.traps]) {
      t.t += dt;
      t.mesh.rotation.y += dt * (t.kind === 'cone' ? 0 : 0.5);
      if (t.kind === 'cone') t.light.material.color.setHex(Math.floor(t.t * 4) % 2 ? 0xff2a2a : 0x551010);
      if (t.t < 0.4) continue;
      if (t.kind === 'banana') {
        for (const f of g.fighters) {
          if (f === t.owner || f.state !== 'normal' || f.iframe > 0) continue;
          if (Math.hypot(f.x - t.x, f.z - t.z) > f.r + 0.35) continue;
          g.label(f.x, 2, f.z, '滑倒！', '#ffe14d', 28);
          g.launch(f, f.facing, 5, 0.4, 1, t.owner);
          sfx.pop();
          this.removeTrap(t);
          break;
        }
      } else {
        for (const b of g.bodies()) {
          if (b === t.owner || !g.solid(b) || b.type === 'crate') continue;
          if (Math.hypot(b.x - t.x, b.z - t.z) > b.r + 0.45) continue;
          this.explode(t);
          break;
        }
      }
    }
    // 臨時袋口
    for (const h of [...this.holes]) {
      h.life -= dt;
      h.age = (h.age || 0) + dt;
      const k = Math.min(1, h.age * 4, h.life * 3);
      h.mesh.scale.setScalar(Math.max(0.01, k));
      if (h.life <= 0) this.removeHole(h);
    }
  }

  // 道具箱被打破：打的人拿到一個隨機道具
  breakCrate(crate, f) {
    const g = this.game;
    g.fx.debris(crate.x, 0.6, crate.z, 0, 0, 14);
    g.fx.ring(crate.x, crate.z, 1.6, 0xffd23f, 0.3, 0.12);
    sfx.poof();
    g.removeUnit(crate, false);
    if (!f || !f.isFighter || f.state === 'out') return;
    const pool = ITEMS.filter((it) => g.mode !== 'soccer' || !['pocket'].includes(it.id));
    this.give(f, pool[Math.floor(Math.random() * pool.length)].id);
  }

  give(f, id) {
    const g = this.game;
    const it = BY_ID[id];
    g.fx.text(f.x, 2.6, f.z, it.name, { color: it.color, size: f.isHuman ? 34 : 24, cls: 'big', life: 1.4 });
    if (f.isHuman) sfx.coin(true);
    const ahead = (d) => ({ x: f.x + Math.sin(f.facing) * d, z: f.z + Math.cos(f.facing) * d });
    switch (id) {
      case 'heavy':
        f.mass = FIGHTER_MASS * 4;
        f.fx.heavy = P.itemTime;
        break;
      case 'shield':
        f.fx.shield = P.itemTime * 1.5;
        break;
      case 'ice':
        this.iceT = P.itemTime;
        g.label(0, 3, 0, '全場結冰！', '#7fe0ff', 36);
        break;
      case 'banana': {
        this.addTrap('banana', ahead(-1.3), f);
        const p = g.safePoint(0.3, 1);
        this.addTrap('banana', p, f);
        break;
      }
      case 'cone':
        this.addTrap('cone', ahead(2.2), f);
        break;
      case 'pocket':
        this.addHole(ahead(4), f);
        break;
      default:
        f.fx[id] = P.itemTime;
        break;
    }
  }

  expire(f, k) {
    if (k === 'heavy') f.mass = FIGHTER_MASS;
  }

  // 把點夾回場內、不跟障礙物重疊
  place(p, r) {
    const x = Math.max(ARENA.minX + r + 0.3, Math.min(ARENA.maxX - r - 0.3, p.x));
    const z = Math.max(ARENA.minZ + r + 0.3, Math.min(ARENA.maxZ - r - 0.3, p.z));
    if (wallHit(x, z, r)) return null;
    return { x, z };
  }

  addTrap(kind, at, owner) {
    const p = this.place(at, 0.4);
    if (!p) return;
    const mesh = new THREE.Group();
    let light = null;
    if (kind === 'banana') {
      const peel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.09, 6, 12, Math.PI * 1.2), toon(0xffe14d));
      peel.rotation.x = -Math.PI / 2;
      peel.position.y = 0.08;
      mesh.add(peel);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), toon(0x5a3a18));
      tip.position.set(0.28, 0.08, 0);
      mesh.add(tip);
    } else {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 12), toon(0xff6b1a));
      cone.position.y = 0.4;
      mesh.add(cone);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.14, 12), toon(0xf4f4f4));
      band.position.y = 0.45;
      mesh.add(band);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.06, 0.75), toon(0xff6b1a));
      base.position.y = 0.03;
      mesh.add(base);
      light = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
      light.position.y = 0.85;
      mesh.add(light);
    }
    mesh.position.set(p.x, 0, p.z);
    this.scene.add(mesh);
    this.traps.push({ kind, x: p.x, z: p.z, owner, mesh, light, t: 0 });
  }

  removeTrap(t) {
    this.scene.remove(t.mesh);
    const i = this.traps.indexOf(t);
    if (i >= 0) this.traps.splice(i, 1);
  }

  // 地雷錐爆炸：附近的東西全部往外炸飛，算放錐子的人的
  explode(t) {
    const g = this.game;
    this.removeTrap(t);
    for (const b of g.bodies()) {
      if (!g.solid(b) || b.type === 'crate') continue;
      if (b.isFighter && b.iframe > 0) continue;
      const dx = b.x - t.x;
      const dz = b.z - t.z;
      const d = Math.hypot(dx, dz);
      if (d > 3.4) continue;
      const yaw = d > 0.05 ? Math.atan2(dx, dz) : Math.random() * Math.PI * 2;
      g.flash(b, 2);
      g.launch(b, yaw, (8 - d) * g.weightMult(b), 1.2, 2, t.owner);
    }
    g.fx.star(t.x, 0.8, t.z, 0xff6b1a, 4);
    g.fx.ring(t.x, t.z, 3.4, 0xff6b1a, 0.4, 0.2);
    g.fx.debris(t.x, 0.5, t.z, 0, 0, 20);
    g.label(t.x, 2.2, t.z, '轟！', '#ff6b3a', 40);
    sfx.wall();
    sfx.ko();
    g.hitstop(8);
    g.shake(0.35);
  }

  addHole(at, owner) {
    const p = this.place(at, 1.0);
    if (!p) return null;
    const pk = { x: p.x, z: p.z, r: 1.0, temp: true, owner };
    POCKETS.push(pk);
    const mesh = new THREE.Group();
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.0, 32), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = 0.03;
    mesh.add(hole);
    const rim = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.18, 32), new THREE.MeshBasicMaterial({ color: 0x5fe3e3 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.035;
    mesh.add(rim);
    mesh.position.set(p.x, 0, p.z);
    this.scene.add(mesh);
    const h = { p: pk, life: P.itemTime, mesh };
    this.holes.push(h);
    this.game.label(p.x, 1.6, p.z, '袋口！', '#5fe3e3', 26);
    return h;
  }

  // 地圖機關（冰湖裂開）也會用到：開一個持續 life 秒的洞
  addHoleAt(p, life) {
    const h = this.addHole(p, null);
    if (h) h.life = life;
  }

  removeHole(h) {
    this.scene.remove(h.mesh);
    const i = POCKETS.indexOf(h.p);
    if (i >= 0) POCKETS.splice(i, 1);
    const j = this.holes.indexOf(h);
    if (j >= 0) this.holes.splice(j, 1);
  }

  // 頭上名牌後面顯示的效果
  tagText(f) {
    return FX_KEYS.filter((k) => f.fx[k] > 0).map((k) => BY_ID[k].name).join('・');
  }
}
