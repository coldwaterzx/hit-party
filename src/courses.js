// 高爾夫球場資料（格式說明在 course.js 開頭）。座標：這一洞的左上角是 (0, 0)，單位 m，x 往右、z 往下。
// 想加新的一洞：照下面的樣子加一個物件就好；也可以在主選單「高爾夫」分頁匯入自己畫的 PNG。

// 球道：外面一圈長草、裡面球道
const corridor = (pts, w, rough = 2.2) => [
  { t: 'path', pts, width: w + rough * 2, terrain: 'rough' },
  { t: 'path', pts, width: w, terrain: 'fairway' },
];
const green = (x, z, r) => ({ t: 'circle', x, z, r, terrain: 'green' });
const sand = (x, z, r) => ({ t: 'circle', x, z, r, terrain: 'sand' });

// ───────────────────────── 派對球場（9 洞） ─────────────────────────
const PARTY = [
  {
    name: '開球', par: 3, size: [52, 26], tee: [6, 13], cup: [45.5, 13],
    shapes: [...corridor([[6, 13], [46, 13]], 9), green(45, 13, 4.5), sand(39, 7.5, 1.6), sand(40, 18.8, 1.8)],
    heights: [{ t: 'hill', x: 24, z: 13, r: 6, h: 0.7 }],
  },
  {
    name: '狗腿', par: 4, size: [46, 42], tee: [6, 35], cup: [38, 6.5],
    shapes: [
      ...corridor([[6, 35], [32, 35], [38, 29], [38, 7]], 8),
      green(38, 7, 4.5),
      { t: 'circle', x: 26, z: 25, r: 6, terrain: 'water' },
      sand(33, 12, 1.5),
    ],
    heights: [{ t: 'hill', x: 38, z: 20, r: 7, h: 0.6 }],
  },
  {
    name: '風車', par: 3, size: [52, 22], tee: [5, 11], cup: [46, 11],
    shapes: [
      ...corridor([[5, 11], [47, 11]], 10),
      { t: 'rect', x: 23, z: 0, w: 6, h: 6.6, terrain: 'wall' },
      { t: 'rect', x: 23, z: 15.4, w: 6, h: 6.6, terrain: 'wall' },
      green(46, 11, 4.5),
      sand(40, 6.5, 1.4),
    ],
    items: [{ type: 'windmill', x: 26, z: 11, len: 3.6, speed: 1.3, blades: 4 }],
  },
  {
    name: '碗公', par: 3, size: [40, 40], tee: [9, 31], cup: [20, 20],
    shapes: [
      { t: 'circle', x: 20, z: 20, r: 17, terrain: 'rough' },
      { t: 'circle', x: 20, z: 20, r: 14.5, terrain: 'fairway' },
      green(20, 20, 6),
    ],
    heights: [{ t: 'hill', x: 20, z: 20, r: 13, h: -1.6 }],
    items: [
      { type: 'bumper', x: 20, z: 8.5, r: 0.8, color: 0xff4fa0 },
      { type: 'bumper', x: 31.5, z: 20, r: 0.8, color: 0x4fd2ff },
      { type: 'bumper', x: 20, z: 31.5, r: 0.8, color: 0xffd23f },
      { type: 'bumper', x: 8.5, z: 20, r: 0.8, color: 0x8dff6a },
    ],
  },
  {
    name: '跳台', par: 5, size: [72, 26], tee: [5, 13], cup: [64.5, 13],
    shapes: [
      ...corridor([[5, 13], [67, 13]], 9),
      { t: 'rect', x: 28, z: 0, w: 7, h: 26, terrain: 'water' },
      { t: 'rect', x: 28, z: 11, w: 7, h: 4, terrain: 'fairway' },
      { t: 'rect', x: 47, z: 0, w: 4, h: 26, terrain: 'water' },
      { t: 'rect', x: 47, z: 6.4, w: 4, h: 4, terrain: 'fairway' }, // 邊邊的窄橋；正中間要靠跳台飛過去
      green(64, 13, 4.5),
      sand(58, 8, 1.4),
    ],
    heights: [{ t: 'ramp', x: 39, z: 0, w: 6, h: 26, dir: 'x', rise: 0.8 }],
    items: [{ type: 'boost', x: 43, z: 13, r: 1.3, angle: 0, power: 20, jump: true }],
    noRails: [{ x: 28, z: 0, w: 7, h: 11 }, { x: 28, z: 15, w: 7, h: 11 }],
  },
  {
    name: '傳送門', par: 3, size: [62, 28], tee: [7, 14], cup: [53, 14],
    shapes: [
      { t: 'rect', x: 3, z: 3, w: 20, h: 22, terrain: 'fairway' },
      { t: 'rect', x: 40, z: 3, w: 19, h: 22, terrain: 'fairway' },
      { t: 'path', pts: [[22, 23.3], [41, 23.3]], width: 1.6, terrain: 'fairway' },
      green(52, 14, 4.2),
      sand(47, 7.5, 1.5),
    ],
    items: [{ type: 'teleport', a: [19.5, 14], b: [43.5, 14] }],
    noRails: [{ x: 23, z: 21.8, w: 17, h: 3.2 }],
  },
  {
    name: '輸送帶', par: 4, size: [46, 30], tee: [6, 6], cup: [9, 21],
    shapes: [...corridor([[6, 6], [38, 6], [38, 21], [9, 21]], 8, 2), green(9, 21, 4)],
    items: [
      { type: 'conveyor', x: 14, z: 17.5, w: 20, h: 7, angle: 180, speed: 3 },
      { type: 'conveyor', x: 24, z: 2.5, w: 4, h: 7, angle: 180, speed: 2 },
    ],
  },
  {
    name: '冰原', par: 3, size: [52, 30], tee: [6, 15], cup: [44, 15],
    shapes: [
      { t: 'rect', x: 2, z: 2, w: 48, h: 26, terrain: 'ice' },
      sand(20, 8, 2), sand(28, 22, 2.2), sand(36, 11, 1.8),
      { t: 'circle', x: 44, z: 15, r: 5.6, terrain: 'rough' },
      green(44, 15, 4.5),
    ],
    heights: [{ t: 'hill', x: 44, z: 15, r: 7, h: 0.9 }],
    items: [
      { type: 'bumper', x: 14, z: 15, r: 0.8, color: 0x7fe0ff },
      { type: 'bumper', x: 30, z: 15, r: 0.8, color: 0xc48bff },
    ],
  },
  {
    name: '大決戰', par: 5, size: [84, 46], tee: [6, 23], cup: [77, 23],
    shapes: [
      ...corridor([[6, 23], [30, 23], [44, 12], [64, 12], [76, 23]], 9),
      ...corridor([[30, 23], [44, 36], [64, 36], [76, 23]], 6),
      { t: 'circle', x: 54, z: 24, r: 6.5, terrain: 'water' },
      green(76, 23, 5),
      sand(70, 16.5, 1.6), sand(70, 29.5, 1.6),
    ],
    heights: [{ t: 'hill', x: 76, z: 23, r: 9, h: 0.5 }],
    items: [
      { type: 'windmill', x: 54, z: 12, len: 3.4, speed: 1.1, blades: 3 },
      { type: 'boost', x: 36, z: 28.5, r: 1.2, angle: 43, power: 20 },
      { type: 'gate', x1: 52, z1: 33, x2: 52, z2: 39, period: 4 },
      { type: 'conveyor', x: 58, z: 33, w: 6, h: 6, angle: 0, speed: 3 },
    ],
  },
];

// ───────────────────────── 入門球場（5 洞，原本的迷你高爾夫） ─────────────────────────
const field = { t: 'rect', x: 0.5, z: 0.5, w: 26, h: 15, terrain: 'fairway' };
const box = (x, z, w, h, terrain) => ({ t: 'rect', x, z, w, h, terrain });
const CLASSIC = [
  { name: '暖身', par: 2, size: [27, 16], tee: [4.5, 8], cup: [21.5, 8], shapes: [field] },
  {
    name: '轉角', par: 3, size: [27, 16], tee: [3.5, 3], cup: [23.5, 3],
    shapes: [field, box(13.2, 0.5, 0.6, 10, 'wall'), box(19.5, 9, 3, 3, 'sand')],
  },
  {
    name: '彈珠', par: 3, size: [27, 16], tee: [3.5, 8], cup: [23.5, 8],
    shapes: [field, box(20.8, 6.6, 1.3, 2.8, 'sand')],
    items: [
      { type: 'bumper', x: 10.5, z: 5.4, r: 0.7, color: 0xff4fa0 }, { type: 'bumper', x: 10.5, z: 10.6, r: 0.7, color: 0x4fd2ff },
      { type: 'bumper', x: 15.5, z: 8, r: 0.7, color: 0xffd23f }, { type: 'bumper', x: 19.5, z: 5, r: 0.7, color: 0x8dff6a },
      { type: 'bumper', x: 19.5, z: 11, r: 0.7, color: 0xc48bff },
    ],
  },
  {
    name: '小橋', par: 3, size: [27, 16], tee: [3.5, 8], cup: [21.5, 10],
    shapes: [field, box(23, 5, 3, 6, 'sand'), box(10.5, 0.5, 5, 6.5, 'water'), box(10.5, 9, 5, 6.5, 'water')],
  },
  {
    name: '庫邊', par: 4, size: [27, 16], tee: [3, 13.5], cup: [24, 2.5],
    shapes: [field, box(9.2, 3.5, 0.6, 12, 'wall'), box(17.2, 0.5, 0.6, 12, 'wall'), box(12, 6, 3, 4, 'water')],
  },
];

export const COURSES = {
  party: { name: '派對球場', holes: PARTY },
  classic: { name: '入門球場', holes: CLASSIC },
};
