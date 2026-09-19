// room.js — seating-room geometry shared by the Seating builder and the hub's
// read-only chart. Positions and sizes are in grid units (G px each at zoom 1).
// seats: rectangles that hold a student (a desk = one seat); desks: extra
// non-seat rectangles (teacher desk); round: draw a circle.
// No DOM state and no Supabase in here — the layout JSON is passed in.

const G = 24;
const TYPES = {
  single:  { label: 'Single desk',  w: 3, h: 2, seats: [[0, 0, 3, 2]] },
  pair:    { label: 'Pair',         w: 6, h: 2, seats: [[0, 0, 3, 2], [3, 0, 3, 2]] },
  row3:    { label: 'Row of 3',     w: 9, h: 2, seats: [[0, 0, 3, 2], [3, 0, 3, 2], [6, 0, 3, 2]] },
  group4:  { label: 'Group of 4',   w: 6, h: 4, seats: [[0, 0, 3, 2], [3, 0, 3, 2], [0, 2, 3, 2], [3, 2, 3, 2]] },
  group6:  { label: 'Group of 6',   w: 9, h: 4, seats: [[0, 0, 3, 2], [3, 0, 3, 2], [6, 0, 3, 2], [0, 2, 3, 2], [3, 2, 3, 2], [6, 2, 3, 2]] },
  round:   { label: 'Round table',  w: 9, h: 6, round: true, seats: [[1.5, 0, 3, 1.5], [4.5, 0, 3, 1.5], [4.5, 4.5, 3, 1.5], [1.5, 4.5, 3, 1.5]] },
  teacher: { label: 'Teacher desk', w: 4, h: 2, seats: [], desks: [[0, 0, 4, 2]], text: 'Teacher' },
};
const FRONT = { w: 12, h: 1 };

// Pieces are positioned with a transform (composited, no layout), never top/left
const pieceTransform = (x, y, rot = 0) => `translate3d(${x * G}px, ${y * G}px, 0) rotate(${rot}deg)`;

// Axis-aligned visual bounding box of a piece rotated by any angle about its centre
function bbox(p) {
  const t = p.id === 'front' ? FRONT : TYPES[p.type];
  const r = ((p.rotation || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
  const w = t.w * c + t.h * sn, h = t.w * sn + t.h * c;
  const cx = p.x + t.w / 2, cy = p.y + t.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
}

// Labels counter-rotate so text stays upright. The label box takes the
// seat's width when the desk is roughly level, its height when roughly
// sideways, and the smaller side at odd angles so nothing gets clipped.
function labelStyle(p, w, h) {
  const rot = p.rotation || 0;
  const r = (rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
  const box = c > 0.87 ? w : sn > 0.87 ? h : Math.min(w, h);
  return `width:${box * G - 4}px;transform:translate(-50%,-50%) rotate(${-rot}deg)`;
}

// Grid-unit bounds of everything in a layout (front marker + pieces); an
// empty room frames the front marker with some air around it.
function roomBounds(layout) {
  const items = [{ id: 'front', ...layout.front }, ...layout.pieces].map(bbox);
  let minX = Math.min(...items.map((b) => b.x)), minY = Math.min(...items.map((b) => b.y));
  let maxX = Math.max(...items.map((b) => b.x + b.w)), maxY = Math.max(...items.map((b) => b.y + b.h));
  if (layout.pieces.length === 0) { minX = layout.front.x - 12; maxX = layout.front.x + FRONT.w + 12; minY = layout.front.y - 4; maxY = layout.front.y + 24; }
  return { minX, minY, maxX, maxY };
}
