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
// The "Front of room" marker: a FRONT.w × FRONT.h bar, stored as
// layout.front = { x, y, w, h, rotation? }. It turns about its centre like a
// desk. Its FACING is its local +y (straight down at 0°): the side the room
// is on. So a marker on the right wall faces left at 90°, on the left wall
// faces right at 270°, on the back wall faces up at 180°.
const FRONT = { w: 12, h: 1 };
const pieceDims = (p) => (p.id === 'front' ? FRONT : TYPES[p.type]);

// Pieces are positioned with a transform (composited, no layout), never top/left
const pieceTransform = (x, y, rot = 0) => `translate3d(${x * G}px, ${y * G}px, 0) rotate(${rot}deg)`;

// The marker's label runs along the bar (upright text can't fit across a
// 1-unit bar once it's turned) and flips whenever it would read upside down.
function frontLabelStyle(rot = 0) {
  const n = ((rot % 360) + 360) % 360;
  return n > 90 && n <= 270 ? 'transform:rotate(180deg)' : '';
}
// The marker's inside: a notch on the room side (its facing) + the label
const frontMarkerHtml = (rot = 0) =>
  `<span class="front-face" aria-hidden="true"></span><span class="front-text" style="${frontLabelStyle(rot)}">Front of room</span>`;

// Distance from a point (grid units) to the marker at its real position and
// angle: to the nearest point of the bar's centre line. behind = the point
// is on the far side of the marker from the room (against its facing).
function frontDistance(front, x, y) {
  const r = ((front.rotation || 0) * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const dx = x - (front.x + FRONT.w / 2), dy = y - (front.y + FRONT.h / 2);
  const along = dx * cos + dy * sin;          // along the bar (local x)
  const across = -dx * sin + dy * cos;        // toward the room (local +y)
  const clamped = Math.max(-FRONT.w / 2, Math.min(FRONT.w / 2, along));
  return { dist: Math.hypot(along - clamped, across), behind: across < 0 };
}

// Axis-aligned visual bounding box of a piece rotated by any angle about its centre
function bbox(p) {
  const t = pieceDims(p);
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
