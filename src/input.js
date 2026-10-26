// 鍵盤＋滑鼠＋手把（標準配置），支援本機雙人。
// 1P：WASD 移動、J／滑鼠左鍵揮錘、空白／K／左 Shift 翻滾、滑鼠瞄準；第 1 支手把。
// 2P（雙人時）：方向鍵移動、/ 或 Numpad1 揮錘、. 或 Numpad2 或右 Shift 翻滾；第 2 支手把。
// 單人時方向鍵也可以移動 1P。
// 手把：左搖桿移動、X 揮錘（RB／RT 也可以）、B 翻滾（LB 也可以）、右搖桿可選擇性瞄準、Start 重置。
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: false };
    this.lastDevice = 'kb'; // 1P 最後用的裝置：'kb' | 'mouse' | 'pad'
    this.prev = [{}, {}];
    this.twoPlayers = false;
    this.onKey = null;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // 在調參面板的數字欄位打字時，不要觸發快捷鍵與角色操作
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA'
        || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range'].includes(t.type)))) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'].includes(e.code)) e.preventDefault();
      if (this.onKey) this.onKey(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
    });
    canvas.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.lastDevice = 'mouse';
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouse.down = true;
        this.lastDevice = 'mouse';
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  pads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    return [...pads].filter((g) => g && g.connected);
  }

  pad() {
    return this.pads()[0] || null;
  }

  // who：0＝1P，1＝2P
  poll(who = 0) {
    let mx = 0;
    let mz = 0;
    const k = this.keys;
    const two = this.twoPlayers;
    if (who === 0) {
      if (k.has('KeyA') || (!two && k.has('ArrowLeft'))) mx -= 1;
      if (k.has('KeyD') || (!two && k.has('ArrowRight'))) mx += 1;
      if (k.has('KeyW') || (!two && k.has('ArrowUp'))) mz -= 1;
      if (k.has('KeyS') || (!two && k.has('ArrowDown'))) mz += 1;
    } else {
      if (k.has('ArrowLeft')) mx -= 1;
      if (k.has('ArrowRight')) mx += 1;
      if (k.has('ArrowUp')) mz -= 1;
      if (k.has('ArrowDown')) mz += 1;
    }

    let padAim = null;
    let padHammer = false;
    let padRoll = false;
    let padStart = false;
    let padAny = false;
    const pad = this.pads()[who] || null;
    if (pad) {
      const ax = pad.axes[0] || 0;
      const ay = pad.axes[1] || 0;
      const mag = Math.hypot(ax, ay);
      if (mag > 0.2) {
        const s = Math.min(1, (mag - 0.2) / 0.75) / mag;
        mx += ax * s;
        mz += ay * s;
        if (who === 0) this.lastDevice = 'pad';
      }
      const rx = pad.axes[2] || 0;
      const ry = pad.axes[3] || 0;
      if (Math.hypot(rx, ry) > 0.4) {
        padAim = { x: rx, z: ry };
        if (who === 0) this.lastDevice = 'pad';
      }
      const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
      padHammer = b(2) || b(5) || b(7);
      padRoll = b(1) || b(4);
      padStart = b(9);
      padAny = pad.buttons.some((x) => x.pressed);
      if ((padHammer || padRoll) && who === 0) this.lastDevice = 'pad';
    }

    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }

    const hammer = who === 0
      ? k.has('KeyJ') || this.mouse.down || padHammer
      : k.has('Slash') || k.has('Numpad1') || k.has('Numpad0') || padHammer;
    const roll = who === 0
      ? k.has('Space') || k.has('KeyK') || k.has('ShiftLeft') || padRoll
      : k.has('Period') || k.has('Numpad2') || k.has('ShiftRight') || padRoll;
    const prev = this.prev[who];
    const out = {
      move: { x: mx, z: mz },
      hammer,
      hammerPressed: hammer && !prev.hammer,
      roll,
      rollPressed: roll && !prev.roll,
      startPressed: padStart && !prev.start,
      padAim,
      padAny,
      usingMouse: who === 0 && this.lastDevice === 'mouse',
    };
    prev.hammer = hammer;
    prev.roll = roll;
    prev.start = padStart;
    return out;
  }
}
