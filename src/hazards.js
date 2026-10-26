// 地圖機關（開始畫面「地圖機關」打開時才有）：
//   超市停車場：有車開進來找車位，撞到的人會被撞飛
//   巨大撞球桌：桌上有一顆母球，巨大球桿每隔幾秒朝某個人推一桿
//   冰湖：冰面會裂開，變成臨時的洞
//   彈珠台：每隔一陣子從右下角射進一顆鋼珠
//   頂樓：直升機的強風，把所有人往同一邊吹
// 足球場的守門員在 game.js（它是一個會動的小怪）。
import * as THREE from 'three';
import { P } from './config.js';
import { sfx } from './audio.js';
import { MAP, makeCar } from './world.js';
import { makeTelegraphLine } from './units.js';

const rand = (a, b) => a + Math.random() * (b - a);
const AISLE_Z = 0.4; // 停車場中間車道

export class Hazards {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.car = makeCar(0x2f9e6a);
    this.car.visible = false;
    this.car.rotation.y = -Math.PI / 2; // 車頭朝 -x
    this.scene.add(this.car);
    // 車道上的預警帶
    const warnGeo = new THREE.PlaneGeometry(30, 2.2);
    warnGeo.rotateX(-Math.PI / 2);
    this.carWarn = new THREE.Mesh(warnGeo, new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.3, depthWrite: false }));
    this.carWarn.position.set(0, 0.04, AISLE_Z);
    this.carWarn.visible = false;
    this.scene.add(this.carWarn);
    this.line = makeTelegraphLine(1);
    this.line.visible = false;
    this.scene.add(this.line);
    const crackGeo = new THREE.RingGeometry(0.6, 1.1, 24);
    crackGeo.rotateX(-Math.PI / 2);
    this.crack = new THREE.Mesh(crackGeo, new THREE.MeshBasicMaterial({ color: 0x2a6f9a, transparent: true, opacity: 0.6, depthWrite: false }));
    this.crack.visible = false;
    this.scene.add(this.crack);
    this.reset();
  }

  get enabled() {
    const m = this.game.mode;
    return P.mapEvents && !['bowling', 'curling', 'golf', 'hockey'].includes(m) && !MAP.grid;
  }

  reset() {
    this.t = rand(6, 9);
    this.phase = 'idle';
    this.car.visible = false;
    this.carWarn.visible = false;
    this.line.visible = false;
    this.crack.visible = false;
    this.cue = null;
    this.target = null;
    this.wind = null;
  }

  update(dt, realDt) {
    if (!this.enabled) {
      if (this.phase !== 'idle') this.reset();
      return;
    }
    const id = MAP.id;
    if (id === 'city') this.updateCar(dt);
    else if (id === 'table') this.updateCue(dt);
    else if (id === 'ice') this.updateCrack(dt);
    else if (id === 'pinball') this.updateMultiball(dt);
    else if (id === 'rooftop') this.updateWind(dt);
    this.carWarn.material.opacity = 0.18 + 0.18 * Math.sin(performance.now() * 0.02);
  }

  // ── 停車場：找車位的車 ──
  updateCar(dt) {
    const g = this.game;
    this.t -= dt;
    if (this.phase === 'idle' && this.t <= 0) {
      this.phase = 'warn';
      this.t = 1.6;
      this.carWarn.visible = true;
      g.label(11, 2.5, AISLE_Z, '叭叭！有車！', '#ff6b3a', 30);
      sfx.error();
    } else if (this.phase === 'warn' && this.t <= 0) {
      this.phase = 'in';
      this.carX = 16;
      this.car.visible = true;
      this.carWarn.visible = false;
    } else if (this.phase === 'in') {
      this.carX -= 12 * dt;
      if (this.carX <= -3) {
        this.phase = 'park';
        this.t = 0.9;
      }
    } else if (this.phase === 'park' && this.t <= 0) {
      this.phase = 'out';
    } else if (this.phase === 'out') {
      this.carX += 10 * dt;
      if (this.carX >= 17) {
        this.phase = 'idle';
        this.car.visible = false;
        this.t = rand(12, 16);
      }
    }
    if (this.car.visible) {
      this.car.position.set(this.carX, 0, AISLE_Z);
      const dir = this.phase === 'out' ? 1 : -1;
      for (const b of g.bodies()) {
        if (!g.solid(b) || b.type === 'crate' || (b.carCd || 0) > g.time) continue;
        if (b.isFighter && b.iframe > 0) continue;
        if (Math.abs(b.x - this.carX) > 2.1 + b.r || Math.abs(b.z - AISLE_Z) > 0.95 + b.r) continue;
        const side = b.z >= AISLE_Z ? 1 : -1;
        b.carCd = g.time + 0.8;
        g.flash(b, 2);
        g.launch(b, Math.atan2(dir * 0.5, side), 7 * g.weightMult(b), 1.2, 2, null);
        g.label(b.x, 2, b.z, '被車撞！', '#ff6b3a', 26);
        sfx.wall();
        g.shake(0.15);
      }
    }
  }

  // ── 撞球桌：母球被巨大球桿推 ──
  updateCue(dt) {
    const g = this.game;
    const cue = g.units.find((u) => u.type === 'cueball');
    if (!cue) {
      if (!g.respawns.some((r) => r.type === 'cueball')) g.respawns.push({ type: 'cueball', t: 2 });
      return;
    }
    this.t -= dt;
    if (this.phase === 'idle' && this.t <= 0) {
      const alive = g.fighters.filter((f) => f.state === 'normal');
      if (!alive.length || cue.state !== 'idle') {
        this.t = 1;
        return;
      }
      this.target = alive[Math.floor(Math.random() * alive.length)];
      this.phase = 'aim';
      this.t = 1.3;
      this.line.visible = true;
      g.label(cue.x, 2.2, cue.z, '母球要來了！', '#ffffff', 24);
    } else if (this.phase === 'aim') {
      const tg = this.target;
      const yaw = Math.atan2(tg.x - cue.x, tg.z - cue.z);
      this.line.position.set(cue.x, 0.04, cue.z);
      this.line.rotation.y = yaw;
      this.line.scale.z = Math.hypot(tg.x - cue.x, tg.z - cue.z);
      if (this.t <= 0 || cue.state !== 'idle') {
        this.line.visible = false;
        this.phase = 'idle';
        this.t = rand(6, 9);
        if (cue.state === 'idle') {
          g.launch(cue, yaw, 16, 0.3, 3, null);
          g.fx.ring(cue.x, cue.z, 1.5, 0xffffff, 0.3, 0.15);
          sfx.clang(3);
        }
      }
    }
  }

  // ── 冰湖：冰面裂開 ──
  updateCrack(dt) {
    const g = this.game;
    this.t -= dt;
    if (this.phase === 'idle' && this.t <= 0) {
      this.crackAt = g.safePoint(1.0, 1.5);
      this.phase = 'warn';
      this.t = 1.6;
      this.crack.visible = true;
      this.crack.position.set(this.crackAt.x, 0.04, this.crackAt.z);
      g.label(this.crackAt.x, 1.8, this.crackAt.z, '喀啦…', '#2a6f9a', 26);
    } else if (this.phase === 'warn') {
      this.crack.scale.setScalar(0.6 + 0.4 * Math.sin(performance.now() * 0.03));
      if (this.t <= 0) {
        this.crack.visible = false;
        this.phase = 'idle';
        this.t = rand(10, 14);
        g.items.addHoleAt(this.crackAt, 6);
        sfx.wall();
      }
    }
  }

  // ── 彈珠台：鋼珠 ──
  updateMultiball(dt) {
    const g = this.game;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = rand(13, 18);
    if (g.units.filter((u) => u.type === 'steel').length >= 2) return;
    const s = g.spawnUnit('steel', { x: 12, z: 5.6 }, true);
    g.launch(s, Math.atan2(-1, -0.55), 20, 0.3, 3, null);
    g.label(12, 2.2, 5.6, '鋼珠發射！', '#c9d1db', 28);
    sfx.clang(3);
  }

  // ── 頂樓：強風 ──
  updateWind(dt) {
    const g = this.game;
    this.t -= dt;
    if (this.phase === 'idle' && this.t <= 0) {
      const dirs = [{ x: 1, z: 0, name: '→' }, { x: -1, z: 0, name: '←' }, { x: 0, z: 1, name: '↓' }, { x: 0, z: -1, name: '↑' }];
      this.wind = dirs[Math.floor(Math.random() * dirs.length)];
      this.phase = 'warn';
      this.t = 1.6;
      g.label(0, 3, 0, `強風來了 ${this.wind.name}`, '#ffffff', 34);
    } else if (this.phase === 'warn' && this.t <= 0) {
      this.phase = 'blow';
      this.t = 2.5;
      const yaw = Math.atan2(this.wind.x, this.wind.z);
      for (const b of g.bodies()) {
        if (!g.solid(b) || b.type === 'crate' || b.state === 'sliding') continue;
        if (b.isFighter && b.iframe > 0) continue;
        g.launch(b, yaw, 3 * g.weightMult(b), 0.3, 1, null);
      }
      sfx.whiff(3);
      g.shake(0.2);
    } else if (this.phase === 'blow') {
      // 吹的期間持續推，邊緣附近的人很危險
      for (const b of g.bodies()) {
        if (!g.solid(b) || b.type === 'crate' || b.state === 'sliding') continue;
        b.x += this.wind.x * 2.2 * dt;
        b.z += this.wind.z * 2.2 * dt;
      }
      if (Math.random() < dt * 30) g.fx.puff(rand(-13, 13), rand(0.3, 2), rand(-7, 7), 0xffffff, 0.15);
      if (this.t <= 0) {
        this.phase = 'idle';
        this.t = rand(11, 15);
      }
    }
  }
}
