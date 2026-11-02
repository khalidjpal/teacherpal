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

// Fits a seat's name inside its seat (Seating and Attendance both call it):
// wrap only between words, shrink the type — down to `min` × its starting
// size — until the longest word and all the lines fit, and as a last resort
// one line with an ellipsis (`.clip`). The full name stays in the title.
// `base` (px) overrides the CSS starting size. It measures layout, so call
// it once the label is in the DOM; a hidden seat (no size yet) is skipped.
function fitSeatLabel(lb, { base = 0, min = 0.7 } = {}) {
  lb.classList.remove('clip');
  lb.style.fontSize = base ? `${base}px` : '';
  const seat = lb.parentElement;
  if (!lb.textContent.trim() || !seat || !seat.clientWidth) return;
  const sw = seat.clientWidth, sh = seat.clientHeight;
  // the label box is the seat's width, or its height when the desk is sideways
  const availH = (Math.abs(lb.offsetWidth + 4 - sw) <= 3 ? sh : sw) - 2;
  const start = parseFloat(getComputedStyle(lb).fontSize), floor = start * min;
  const fits = () => lb.scrollWidth <= lb.clientWidth + 0.5 && lb.offsetHeight <= availH + 0.5;
  let size = start;
  while (!fits() && size > floor) { size = Math.max(floor, size - 0.5); lb.style.fontSize = `${size}px`; }
  if (!fits()) lb.classList.add('clip');
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

// ---------------------------------------------------------------------------
// Starter layouts — one click builds a whole room (the Seating page's
// "Change layout" picker and the setup wizard's Room step). Positions are
// whole grid units; every layout sits under a centred Front of room bar with
// the teacher's desk to its right. buildStarter(id, n) → { front, pieces }
// with at least n seats.
// ---------------------------------------------------------------------------
const BLANK_FRONT = { x: 20, y: 3, w: FRONT.w, h: FRONT.h, rotation: 0 };
const roomPieceId = () => Math.random().toString(36).slice(2, 9);

const STARTERS = [
  { id: 'rows',     label: 'Rows',        note: 'Single desks in rows' },
  { id: 'pairs',    label: 'Pairs',       note: 'Desks side by side in twos' },
  { id: 'groups',   label: 'Groups of 4', note: 'Four desks pushed together' },
  { id: 'ushape',   label: 'U-shape',     note: 'Desks around three sides' },
  { id: 'stations', label: 'Stations',    note: 'Big tables of six' },
];

function buildStarter(id, n) {
  const pieces = [];
  // place by the desk's footprint on screen (rot 90 = standing on its side)
  const add = (type, vx, vy, rot = 0) => {
    const t = TYPES[type], side = rot % 180 !== 0;
    const vw = side ? t.h : t.w, vh = side ? t.w : t.h;
    pieces.push({ id: roomPieceId(), type, x: vx + vw / 2 - t.w / 2, y: vy + vh / 2 - t.h / 2, rotation: rot });
  };
  const top = 4;                                   // clear of the front bar and teacher's desk
  let width;
  if (id === 'rows') {
    const cols = 6, rows = Math.ceil(n / cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) add('single', c * 4, top + r * 4);
    width = cols * 4 - 1;
  } else if (id === 'pairs') {
    const cols = 3, rows = Math.ceil(n / (cols * 2));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) add('pair', c * 8, top + r * 4);
    width = cols * 8 - 2;
  } else if (id === 'groups') {
    const count = Math.ceil(n / 4), cols = Math.min(3, count);
    for (let i = 0; i < count; i++) add('group4', (i % cols) * 9, top + Math.floor(i / cols) * 7);
    width = cols * 9 - 3;
  } else if (id === 'stations') {
    const count = Math.ceil(n / 6), cols = Math.min(3, count);
    for (let i = 0; i < count; i++) add('group6', (i % cols) * 12, top + Math.floor(i / cols) * 8);
    width = cols * 12 - 3;
  } else {                                         // U-shape: back row + two sides, facing in
    const back = Math.min(10, Math.max(4, Math.ceil(n / 3)));
    const side = Math.max(2, Math.ceil((n - back) / 2));
    width = back * 3 + 6;
    for (let i = 0; i < side; i++) { add('single', 0, top + i * 3, 90); add('single', width - 2, top + i * 3, 270); }
    for (let i = 0; i < back; i++) add('single', 3 + i * 3, top + side * 3 + 1, 180);
  }
  const fx = Math.round(width / 2 - FRONT.w / 2);
  pieces.push({ id: roomPieceId(), type: 'teacher', x: Math.max(fx + FRONT.w + 1, width - 4), y: 0, rotation: 0 });
  return { front: { x: fx, y: 0, w: FRONT.w, h: FRONT.h, rotation: 0 }, pieces };
}

// The setup wizard's guided room: `desks` student desks as singles, pairs or
// groups of four, in about `rows` rows from front to back (a short last row
// is centred), under the Front bar with the teacher's desk to its right.
// → { front, pieces }. suggestRows() is the wizard's starting guess.
const ROOM_SHAPES = {
  single: { per: 1, dx: 4, dy: 4, across: 6 },
  pair:   { per: 2, dx: 8, dy: 4, across: 3 },
  group4: { per: 4, dx: 9, dy: 7, across: 3 },
};
const suggestRows = (type, desks) => {
  const s = ROOM_SHAPES[type] || ROOM_SHAPES.single;
  return Math.max(1, Math.ceil(Math.ceil(desks / s.per) / s.across));
};
function buildRoom({ type = 'single', desks = 30, rows = 5 } = {}) {
  const s = ROOM_SHAPES[type] || ROOM_SHAPES.single, t = TYPES[type];
  const count = Math.max(1, Math.ceil(desks / s.per));
  const r = Math.max(1, Math.min(count, Math.round(rows) || 1));
  const cols = Math.ceil(count / r);
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols), inRow = Math.min(cols, count - row * cols);
    const off = Math.round(((cols - inRow) * s.dx) / 2);
    pieces.push({ id: roomPieceId(), type, x: off + (i % cols) * s.dx, y: 4 + row * s.dy, rotation: 0 });
  }
  const width = (cols - 1) * s.dx + t.w;
  const fx = Math.round(width / 2 - FRONT.w / 2);
  pieces.push({ id: roomPieceId(), type: 'teacher', x: Math.max(fx + FRONT.w + 1, width - 4), y: 0, rotation: 0 });
  return { front: { x: fx, y: 0, w: FRONT.w, h: FRONT.h, rotation: 0 }, pieces };
}

// Seat ids of a layout, in desk order: '<pieceId>:<index>' (the keys of an
// arrangement's assignments).
const layoutSeatIds = (lay) => (lay.pieces || []).filter((p) => TYPES[p.type]).flatMap((p) => TYPES[p.type].seats.map((_, i) => `${p.id}:${i}`));

// A small drawing of a room: each desk's footprint (and the Front bar),
// scaled to fit maxW × maxH rem keeping its shape. Arrangement cards and
// the starter layouts both use it.
function layoutPic(lay, maxW, maxH, cls = '') {
  const pieces = (lay.pieces || []).filter((p) => TYPES[p.type]);
  const boxes = [{ ...bbox({ id: 'front', ...(lay.front || BLANK_FRONT) }), front: true }, ...pieces.map((p) => ({ ...bbox(p), teacher: p.type === 'teacher' }))];
  const minX = Math.min(...boxes.map((b) => b.x)), minY = Math.min(...boxes.map((b) => b.y));
  const w = Math.max(1, Math.max(...boxes.map((b) => b.x + b.w)) - minX);
  const h = Math.max(1, Math.max(...boxes.map((b) => b.y + b.h)) - minY, pieces.length ? 0 : w * 0.6);   // an empty room still looks like a room
  const sc = Math.min(maxW / w, maxH / h);
  return `<span class="room-pic ${cls}" style="width:${(w * sc).toFixed(2)}rem;height:${(h * sc).toFixed(2)}rem">${boxes.map((b) =>
    `<i class="${b.front ? 'f' : b.teacher ? 't' : ''}" style="left:${((b.x - minX) / w) * 100}%;top:${((b.y - minY) / h) * 100}%;width:${(b.w / w) * 100}%;height:${(b.h / h) * 100}%"></i>`).join('')}</span>`;
}
