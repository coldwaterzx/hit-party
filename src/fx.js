// 視覺特效：粒子、地面環、揮擊殘影、星形閃光、傷害數字。
// 粒子與環用「遊戲時間」更新，所以打擊停頓時會凍結在空中；傷害數字用真實時間，停頓時照樣彈出。
import * as THREE from 'three';
import { P } from './config.js';
import { groundY } from './world.js';

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 8, 6),
  tetra: new THREE.TetrahedronGeometry(1),
};

function makeStarTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  g.fillStyle = '#fff';
  g.beginPath();
  const spikes = 8;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 ? 16 : 62;
    const a = (i / (spikes * 2)) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FX {
  constructor(scene, camera, layer) {
    this.scene = scene;
    this.camera = camera;
    this.layer = layer;
    this.particles = [];
    this.flats = [];
    this.sprites = [];
    this.texts = [];
    this.matCache = new Map();
    this.starTex = makeStarTexture();
    this.v = new THREE.Vector3();
  }

  mat(color) {
    let m = this.matCache.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      this.matCache.set(color, m);
    }
    return m;
  }

  particle(geo, color, x, y, z, vx, vy, vz, size, life, gravity = 0, spark = false) {
    if (!P.particlesOn) return;
    const m = new THREE.Mesh(GEO[geo], this.mat(color));
    m.position.set(x, y, z);
    m.scale.setScalar(size);
    this.scene.add(m);
    this.particles.push({ m, vx, vy, vz, size, life, max: life, gravity, spark });
  }

  // 擊中火花：沿著擊飛方向噴出的細長碎片
  spark(x, y, z, dirX, dirZ, count, color, speed = 9) {
    for (let i = 0; i < count; i++) {
      const a = Math.atan2(dirX, dirZ) + (Math.random() - 0.5) * 1.6;
      const s = speed * (0.5 + Math.random());
      this.particle('box', color, x, y, z, Math.sin(a) * s, 2 + Math.random() * 6, Math.cos(a) * s,
        0.06 + Math.random() * 0.05, 0.18 + Math.random() * 0.2, 18, true);
    }
  }

  dust(x, z, count, color = 0xd8c9a8, spread = 1) {
    const gy = groundY(x, z);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (1 + Math.random() * 2.5) * spread;
      this.particle('sphere', color, x, gy + 0.15, z, Math.cos(a) * s, 0.6 + Math.random() * 1.2, Math.sin(a) * s,
        0.12 + Math.random() * 0.12, 0.35 + Math.random() * 0.25, 2);
    }
  }

  debris(x, y, z, nx, nz, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.atan2(nx, nz) + (Math.random() - 0.5) * 2.2;
      const s = 3 + Math.random() * 5;
      const c = Math.random() < 0.5 ? 0x8c7b6a : 0x6b5a4a;
      this.particle('tetra', c, x, y, z, Math.sin(a) * s, 3 + Math.random() * 5, Math.cos(a) * s,
        0.1 + Math.random() * 0.12, 0.5 + Math.random() * 0.3, 22);
    }
  }

  splash(x, y, z) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 4;
      const c = Math.random() < 0.5 ? 0x9a948a : 0xd8d2c4;
      this.particle('sphere', c, x, y, z, Math.cos(a) * s, 5 + Math.random() * 7, Math.sin(a) * s,
        0.15 + Math.random() * 0.2, 0.7 + Math.random() * 0.4, 16);
    }
    this.ring(x, z, 3, 0xe8e2d4, 0.5, 0.25, y + 0.05);
  }

  // 飛行拖尾
  puff(x, y, z, color, size) {
    this.particle('sphere', color, x, y, z, 0, 0, 0, size, 0.22, 0);
  }

  // 地面擴散環
  ring(x, z, radius, color, life, width = 0.12, y = 0.04) {
    if (!P.particlesOn) return;
    const geo = new THREE.RingGeometry(1 - width, 1, 48);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.position.set(x, y + groundY(x, z), z);
    m.scale.setScalar(radius * 0.3);
    this.scene.add(m);
    this.flats.push({ m, kind: 'ring', radius, life, max: life });
  }

  // 扇形閃光（秒揮的判定範圍、揮擊殘影）。yawA→yawB 為世界方向角。
  sector(x, y, z, yawA, yawB, inner, outer, color, life, opacity = 0.55) {
    const geo = new THREE.RingGeometry(inner, outer, 32, 1, yawA - Math.PI / 2, yawB - yawA);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }));
    m.position.set(x, y, z);
    this.scene.add(m);
    this.flats.push({ m, kind: 'fade', life, max: life, opacity });
  }

  star(x, y, z, color, size = 2.6) {
    if (!P.particlesOn) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.starTex, color, transparent: true, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    s.position.set(x, y, z);
    s.material.rotation = Math.random() * Math.PI;
    s.renderOrder = 10;
    this.scene.add(s);
    this.sprites.push({ s, size, life: 0.2, max: 0.2 });
  }

  // 傷害數字／標籤（DOM）
  text(x, y, z, str, { color = '#fff', size = 24, life = 0.9, cls = '' } = {}) {
    const el = document.createElement('div');
    el.className = `dmg ${cls}`;
    el.textContent = str;
    el.style.color = color;
    el.style.fontSize = `${size}px`;
    this.layer.appendChild(el);
    this.texts.push({ el, x: x + (Math.random() - 0.5) * 0.4, y, z, t: 0, life });
  }

  update(dt, realDt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.m);
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      if (p.m.position.y < 0.03 && p.gravity > 0 && p.m.position.y > -0.5) {
        p.m.position.y = 0.03;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      const k = p.life / p.max;
      if (p.spark) {
        this.v.set(p.m.position.x + p.vx, p.m.position.y + p.vy, p.m.position.z + p.vz);
        p.m.lookAt(this.v);
        p.m.scale.set(p.size * k, p.size * k, p.size * 6 * k);
      } else {
        p.m.scale.setScalar(p.size * k);
      }
    }

    for (let i = this.flats.length - 1; i >= 0; i--) {
      const f = this.flats[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.scene.remove(f.m);
        f.m.geometry.dispose();
        f.m.material.dispose();
        this.flats.splice(i, 1);
        continue;
      }
      const k = 1 - f.life / f.max;
      if (f.kind === 'ring') {
        const e = 1 - (1 - k) ** 3;
        f.m.scale.setScalar(f.radius * (0.3 + 0.7 * e));
        f.m.material.opacity = 1 - k;
      } else {
        f.m.material.opacity = f.opacity * (1 - k);
      }
    }

    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.s);
        s.s.material.dispose();
        this.sprites.splice(i, 1);
        continue;
      }
      const k = 1 - s.life / s.max;
      s.s.scale.setScalar(s.size * (0.4 + 0.8 * Math.min(1, k * 3)));
      s.s.material.opacity = 1 - k;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += realDt;
      if (t.t >= t.life) {
        t.el.remove();
        this.texts.splice(i, 1);
        continue;
      }
      const k = t.t / t.life;
      this.v.set(t.x, t.y + 1.2 * (1 - (1 - k) ** 2), t.z).project(this.camera);
      const sx = (this.v.x * 0.5 + 0.5) * w;
      const sy = (-this.v.y * 0.5 + 0.5) * h;
      const pop = t.t < 0.09 ? 1.5 - (t.t / 0.09) * 0.5 : 1;
      t.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(${pop})`;
      t.el.style.opacity = k > 0.7 ? String(1 - (k - 0.7) / 0.3) : '1';
    }
  }
}
