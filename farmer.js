// farmer.js — the thanksgiving Name Wheel's farmer, drawn to each teacher's
// own look, plus the "Your farmer" settings dialog.
// window.FarmerArt = { DEFAULT, OPTIONS, normalize, markup, vars, apply,
//   current, user, openDialog }.
// The look is profiles.farmer (jsonb, null = DEFAULT), cached on the session
// like the theme (see shared.js: setMyFarmer). farmyard.js draws the farmer
// with apply(); nav.js loads this file on demand for the gear menu's dialog.
// The option colours are the teacher's choices (data), not theme tokens; a
// look equal to DEFAULT sets no colour at all, so the theme's --fy-* tokens
// draw the default farmer exactly.
(() => {
  // ---------- the choices ----------
  const OPTIONS = {
    skin: [['#F1C9A5', 'Light'], ['#D9A07A', 'Light medium'], ['#B97A50', 'Medium'], ['#A86B45', 'Medium brown'], ['#7E4B2E', 'Brown'], ['#5A3420', 'Deep']],
    face: [['classic', 'Classic'], ['soft', 'Soft']],
    figure: [['straight', 'Straight'], ['curvy', 'Curvy']],
    hairStyle: [['wavy', 'Wavy, middle part'], ['straight', 'Short straight'], ['curly', 'Curly'], ['buzz', 'Buzz cut'], ['tied', 'Tied back'], ['hijab', 'Hijab']],
    hair: [['#1E1512', 'Black'], ['#3B2416', 'Dark brown'], ['#6B4226', 'Brown'], ['#8E3B1E', 'Auburn'], ['#D8B25A', 'Blonde'], ['#9A948C', 'Gray']],
    head: [['none', 'None'], ['cap', 'Cap'], ['beanie', 'Beanie']],
    headColor: [['#97928B', 'Grey'], ['#7A3B5E', 'Plum'], ['#2F3B57', 'Navy'], ['#3F7F6E', 'Green'], ['#B5475E', 'Rose'], ['#C9A27A', 'Sand'], ['#1F1A1C', 'Black'], ['#E9DCC4', 'Cream']],
    shirt: [['#CC3A31', 'Red'], ['#3566A8', 'Blue'], ['#3F7F6E', 'Green'], ['#D9A23A', 'Mustard'], ['#6E4A9A', 'Purple'], ['#E9DCC4', 'Cream'], ['#F4F1EA', 'White']],
    sleeves: [['short', 'Short'], ['long', 'Long']],
    over: [['none', 'None'], ['overalls', 'Overalls']],
    pants: [['#25232A', 'Black'], ['#3A5784', 'Denim'], ['#2F3B57', 'Navy'], ['#A88E62', 'Khaki'], ['#5A3D28', 'Brown']],
    lashes: [[false, 'Off'], [true, 'On']],
  };
  // the original farmer: the theme's own --fy-* colours
  const DEFAULT = Object.freeze({
    skin: '#A86B45', face: 'classic', figure: 'straight', hairStyle: 'wavy', hair: '#1E1512', head: 'none', headColor: '#7A3B5E',
    shirt: '#CC3A31', sleeves: 'short', over: 'none', pants: '#25232A', lashes: false,
  });

  // older looks: the hijab was headwear, and three hair styles were renamed
  const OLD_STYLE = { crop: 'straight', long: 'tied', bun: 'tied' };
  // anything unknown falls back to the default, key by key
  function normalize(raw) {
    const out = { ...DEFAULT };
    if (!raw || typeof raw !== 'object') return out;
    if (raw.head === 'hijab') raw = { ...raw, hairStyle: 'hijab', head: 'none' };
    if (OLD_STYLE[raw.hairStyle]) raw = { ...raw, hairStyle: OLD_STYLE[raw.hairStyle] };
    for (const k of Object.keys(DEFAULT)) {
      const v = typeof raw[k] === 'string' ? raw[k].toUpperCase() : raw[k];
      const hit = OPTIONS[k].find(([o]) => (typeof o === 'string' ? o.toUpperCase() : o) === v);
      if (hit) out[k] = hit[0];
    }
    return out;
  }
  const same = (a, b) => Object.keys(DEFAULT).every((k) => a[k] === b[k]);

  // ---------- colours: one choice, its darker and lighter tones ----------
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (a) => '#' + a.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
  const tone = (h, t) => hex(rgb(h).map((x) => (t < 0 ? x * (1 + t) : x + (255 - x) * t)));
  // the CSS custom properties for a look; only what differs from DEFAULT
  function vars(look) {
    const d = DEFAULT, o = [];
    if (look.skin !== d.skin) o.push(['skin', look.skin], ['skin-d', tone(look.skin, -0.18)], ['nose', tone(look.skin, -0.12)]);
    if (look.hair !== d.hair) o.push(['hair', look.hair], ['hair-hi', tone(look.hair, look.hair === '#1E1512' ? 0.22 : 0.3)], ['hair-d', tone(look.hair, -0.35)]);
    if (look.shirt !== d.shirt) o.push(['shirt', look.shirt], ['shirt-back', tone(look.shirt, -0.24)], ['shirt-d', tone(look.shirt, -0.3)], ['shirt-hi', tone(look.shirt, 0.16)]);
    if (look.pants !== d.pants) o.push(['jeans', look.pants], ['jeans-d', tone(look.pants, -0.3)], ['jeans-hi', tone(look.pants, 0.18)]);
    o.push(['headwear', look.headColor], ['headwear-d', tone(look.headColor, -0.22)], ['headwear-hi', tone(look.headColor, 0.22)]);
    return o.map(([k, x]) => `--fy-${k}:${x}`).join(';');
  }

  // ---------- the drawing: facing left, feet at (0, 0), about 112 units to the top of the head ----------
  // Drawn like the turkeys: flat fills, a darker tone on the far side,
  // outlined (`.o`). An arm: an outline, bare skin from shoulder to hand, a
  // sleeve over its top (the same path dashed by the CSS to a short sleeve,
  // or here, inline, to the wrist), a crease at the elbow, then the hand.
  function armer(long) {
    return (cls, d, hx, hy, extra = '') => {
      const n = d.match(/-?\d*\.?\d+/g).map(Number);
      let len = 0;
      for (let i = 2; i < n.length; i += 2) len += Math.hypot(n[i] - n[i - 2], n[i + 1] - n[i - 1]);
      const dash = (k) => (long ? ` style="stroke-dasharray:${(len - k).toFixed(1)} 400"` : '');
      const crease = n.length >= 6 ? `<path class="ff-crease${long ? ' on-sleeve' : ''}" d="M${n[2] - 1.3} ${n[3] + 0.4}q1.3-1.2 2.6 0"/>` : '';
      return `<g class="ff-a ${cls}"><path class="ff-arm-o" d="${d}"/><path class="ff-arm" d="${d}"/><path class="ff-sleeve-o" d="${d}"${dash(3.4)}/><path class="ff-sleeve" d="${d}"${dash(4)}/>${crease}${extra}<circle class="ff-hand o" cx="${hx}" cy="${hy}" r="3.7"/><path class="ff-knuckle" d="M${hx - 1.6} ${hy + 1.2}q1.6 1 3.2 0"/></g>`;
    };
  }
  const finger = (d) => `<path class="ff-finger-o" d="${d}"/><path class="ff-finger" d="${d}"/>`;

  // hair, by style: `back` is drawn behind the head, `top` over it. Each is
  // one outlined shape with volume, a darker underside / far side
  // (.ff-hair-d), strand lines (.ff-hair-strand) and a highlight
  // (.ff-hair-hi). The head is the ellipse (-1, -91.6) 10.4 × 11.4, turned
  // 3/4 to the left; the face's middle is about x -4.5. (The hijab is a
  // style too: head() draws it instead of hair and head.)
  const HAIR = {
    // wavy, parted in the middle: two sides falling away from a centre
    // parting over the forehead, a wave in each, some height on top
    wavy: {
      back: '',
      top: '<path class="ff-hair o" d="M-11.8-91.4C-13.6-93.6-14.6-97.8-13-101.8C-11.6-106.4-8.4-110.4-4.6-111.2C-3.4-110.4-2.6-108.8-2.2-106.8C-1.4-109.4.6-112 4.4-112.2C8.8-112.2 12.2-109.2 13.2-105C14-101.6 13.4-98.4 12.2-96.2C13.4-92.8 12.2-88.6 9.6-86.2L7.6-88C8-91.6 7.4-94.8 5.2-96.8C2.8-98.8 0-100.6-1.8-104.6C-3.6-100.6-6.4-98.6-8.6-97.6C-10.6-96.6-11.2-94.6-11.8-91.4Z"/>'
        // the far side, and the curl at the temple, a shade darker
        + '<path class="ff-hair-d" d="M8.4-95.6C10.6-98 12.2-97.8 12.2-96.2C13.4-92.8 12.2-88.6 9.6-86.2L7.6-88C8-91.4 8.4-93.6 8.4-95.6Z"/>'
        + '<path class="ff-hair-d" d="M-11.8-91.4C-12.6-93.4-12.6-95.6-11.2-97.2C-10.6-95.4-10.8-93.4-11.8-91.4Z"/>'
        // the waves: strands running down each side from the parting
        + '<path class="ff-hair-strand ff-wave" d="M-3.2-107.6C-6-107-8-104.6-8.2-102C-8.4-100-9.8-98.6-11-97.8M-5.2-109.6C-9-108.8-12-105.6-12.2-101.8C-12.2-99.4-12.8-97.6-13.2-96M-1-107.4C2-110 6.6-109.6 8.4-106.4C9.4-104.4 10.2-101.6 12-100.4M-.4-104.6C2.6-106.4 5.8-105.4 6.8-103C7.4-101.2 7.8-99.4 9-98"/>'
        + '<path class="ff-hair-hi" d="M-5.6-108.8Q-9-107.4-10.6-103.6M2.6-110.2Q7-110.6 9.6-107.4"/>'
        // the parting itself
        + '<path class="ff-hair-line" d="M-1.8-104.6Q-2-105.8-2.2-106.8"/>',
    },
    // short and straight: a neat fringe swept a little to the side
    straight: {
      back: '',
      top: '<path class="ff-hair o" d="M-11.6-93.6C-12.8-100.8-8.4-106.4-1-106.8C6.6-107.2 12.2-103 11.8-96.4C12-92.4 11-89 9.6-86.6L7.6-88C8-91.8 7.2-94.8 5-96.4C2.4-98.4.4-97.6-1.4-98.6L-2.6-96.6-4.2-98-5.6-95.8-7.2-97.2-8.6-94.8-9.8-96.2-11.6-93.6Z"/>'
        + '<path class="ff-hair-d" d="M8.2-95.8C10.4-97.6 12-98 11.8-96.4C12-92.4 11-89 9.6-86.6L7.6-88C8-91 8.2-93.6 8.2-95.8Z"/>'
        + '<path class="ff-hair-strand" d="M-7.8-103.4L-10.4-96.6M-3.4-105.2L-6.2-97.4M1.4-105.6L-.6-98.4M5.6-104.4L4.6-97.6"/>'
        + '<path class="ff-hair-hi" d="M-7.4-104.2Q-1.4-106.6 5.4-105.2"/>',
    },
    // short curly / coiled: a rounded mass of small coils, outlined only
    // round the outside (outlined circles, then the same circles plain)
    curly: {
      back: '',
      top: (() => {
        const c = [[-11.6, -96.6, 3], [-12, -101.2, 3.3], [-9.8, -105.4, 3.4], [-5.8, -108.4, 3.5], [-1.2, -109.8, 3.6], [3.6, -109.4, 3.5], [7.8, -107, 3.4],
          [10.8, -103, 3.3], [12, -98.4, 3.1], [11.6, -93.6, 2.8], [10, -89.4, 2.5]];
        const ring = (cls) => c.map(([x, y, r]) => `<circle class="${cls}" cx="${x}" cy="${y}" r="${r}"/>`).join('');
        const coils = c.filter((_, i) => i % 2 === 0).map(([x, y, r]) => `M${(x - r * 0.5).toFixed(1)} ${(y + r * 0.1).toFixed(1)}a${(r * 0.5).toFixed(1)} ${(r * 0.5).toFixed(1)} 0 1 1 ${(r * 0.6).toFixed(1)} ${(r * 0.4).toFixed(1)}`).join('');
        return ring('ff-hair o') + '<path class="ff-hair" d="M-12-96C-12.4-104-6.4-107.6 0-107.6C6.4-107.6 12.4-103.6 11.8-96.6C12-92.8 11-89.6 9.6-87.4L7.6-88.4C8-92 7-95 4.8-96.6C1-98.6-6.6-98.6-12-96Z"/>'
          + ring('ff-hair') + `<path class="ff-hair-strand" d="${coils}"/>`
          + '<path class="ff-hair-hi" d="M-7.6-107.6Q-6-109.2-3.8-109M1-111.6Q3.2-112.4 5-111.2M9.6-106.4Q11.4-105.4 11.6-103.4"/>';
      })(),
    },
    // buzz cut: a close crop that follows the skull, scalp showing through
    buzz: {
      back: '',
      top: '<path class="ff-hair ff-buzz o" d="M-11-94.8C-11.6-101.2-7-104.6-1-104.6C5.4-104.6 10.6-101 10.4-95C10.6-91.6 10-89 9-87L7.6-88C7.8-91.6 7-94.2 5-95.6C1.4-97.6-5-97.8-11-94.8Z"/>'
        + '<path class="ff-hair-strand ff-buzz-dots" d="M-8-100.2h.1M-5-102h.1M-1.6-102.8h.1M2-102.4h.1M5.4-100.8h.1M8-98.4h.1M-6.6-98.6h.1M-3-99.8h.1M.8-100h.1M4-98.8h.1M7-96.2h.1"/>'
        + '<path class="ff-hair-hi" d="M-6.6-102.6Q-2-104 3.2-103.2"/>',
    },
    // longer, tied back: combed back from the forehead into a ponytail
    tied: {
      back: '<path class="ff-hair o" d="M8.6-102.6C15.6-104.4 21-99 20.2-91C19.6-85.4 20.6-80.4 23-76C17.4-75.6 13.6-80 13-86C12.4-91 11-95.6 8-99Z"/>'
        + '<path class="ff-hair-d" d="M13-86C13.6-80 17.4-75.6 23-76C20.6-80.4 19.6-85.4 20.2-91C18.4-88 15.6-86.4 13-86Z"/>'
        + '<path class="ff-hair-strand" d="M12.4-99C16.4-96 17-90 17.2-84.6M14.6-101C18.6-98 18.8-93 18.4-89"/>'
        + '<path class="ff-hair-hi" d="M15.4-101.6Q18.4-99.4 18.8-95.6"/>',
      top: '<path class="ff-hair o" d="M-11.6-94.4C-12.6-101.8-7.6-107.4 0-107.6C7-107.8 12.6-103.6 12.2-97C12.2-93 11-89.6 9.4-87L7.6-88.2C8-92 7.2-95 5-96.6C.6-99.6-6.6-99-11.6-94.4Z"/>'
        + '<path class="ff-hair-strand" d="M-9.4-98C-6-102.6 0-103.8 8.2-101.4M-7.2-96.8C-3-100.2 3-100.6 9-98.2M-10.6-101.4C-6-105.6 2-106 9.6-103.6"/>'
        + '<path class="ff-hair-hi" d="M-7-104.6Q-1-107 6-105.4"/>'
        + '<rect class="ff-hair-tie o" x="9.4" y="-103.8" width="3.4" height="5" rx="1.3" transform="rotate(-30 11.1 -101.3)"/>',
    },
  };
  // under a cap or a beanie the hair is cut down to what shows below it
  const UNDER_HAT = '<path class="ff-hair o" d="M-11.4-95C-12.4-101-8.6-106-1-106.4C6.6-106.6 11.6-102.6 11.2-96C11.4-92 10.6-89 9.4-87L7.6-88.4C8-92 7-95 4.6-96.6C0-98.6-6-97.6-11.4-95Z"/>';
  // headwear over the hair (the hijab is a hair style: it replaces the hair and the head, below)
  const HAT = {
    none: '',
    cap: '<path class="ff-hat o" d="M-11.6-97.2C-11.4-105.6-5-109.8 1.4-109.6C8-109.2 12-104.6 11.8-97.6Q0-99.6-11.6-97.2Z"/>'
      + '<path class="ff-hat-line" d="M.4-109Q-1.4-103-.8-98.8M-6.6-106.2Q-4.4-104.6-4-99"/>'
      + '<path class="ff-hat-hi" d="M-7.6-104.8Q-3.6-108 1-107.8"/>'
      + '<path class="ff-hat-d o" d="M-10.6-97.4C-14.6-98.4-19.6-97.8-21.4-95.8C-18-94.6-13.4-94.8-10-96Z"/>'
      + '<circle class="ff-hat-d o" cx=".4" cy="-109.6" r="1.3"/>',
    beanie: '<path class="ff-hat o" d="M-12-98C-12.6-106.6-6.4-113 .2-113C7-113 12.8-106.8 12.2-98.4Z"/>'
      + '<path class="ff-hat-hi" d="M-7.8-107.4Q-4-111 .6-111"/>'
      + '<path class="ff-hat-d o" d="M-12.6-101.4Q0-104 12.8-101.4L12.6-97.2Q0-99.6-12.4-97Z"/>'
      + '<path class="ff-hat-line" d="M-6-102.4V-97.6M-2-103V-98.2M2-103V-98.2M6-102.6V-97.8"/>'
      + '<circle class="ff-hat-hi-f o" cx=".2" cy="-114" r="3"/>',
  };

  // the face: eyes with whites, pupils and a highlight, brows, nose, blush,
  // the three mouths (CSS shows one per pose), lashes if chosen
  function face(look) {
    return '<circle class="ff-blush" cx="-9" cy="-87.2" r="2"/><circle class="ff-blush" cx="1" cy="-87.4" r="1.8"/>'
      + '<g class="ff-eye">'
      + '<ellipse class="ff-eye-w" cx="-7.4" cy="-92.6" rx="2.1" ry="2.5"/><circle class="ff-pupil" cx="-8" cy="-92.3" r="1.35"/><circle class="ff-eye-hi" cx="-8.5" cy="-93" r=".55"/>'
      + '<ellipse class="ff-eye-w" cx="-1.6" cy="-92.8" rx="1.9" ry="2.4"/><circle class="ff-pupil" cx="-2.2" cy="-92.5" r="1.25"/><circle class="ff-eye-hi" cx="-2.7" cy="-93.2" r=".5"/>'
      + (look.lashes ? '<path class="ff-lash" d="M-9.2-94.2l-1.5-.8M-8.6-94.9l-1.1-1.3M.2-94.4l1.3-.9M-.3-95.1l.9-1.3"/>' : '')
      + '</g>'
      + '<path class="ff-brow" d="M-10-96.8Q-7.6-98.6-5.2-97.4M-3.4-97.6Q-1.2-98.8 1-97.4"/>'
      + '<path class="ff-nose o" d="M-9.8-91.6C-12.6-90.6-13.2-88.2-10.6-87.6Q-9.4-87.4-9-88.4"/>'
      + '<g class="ff-mouth ff-m-smile"><path d="M-9.4-84.8Q-6.4-81.8-3.2-84.4"/></g>'
      + '<g class="ff-mouth ff-m-hmm"><path d="M-9.2-84Q-6.4-84.8-3.6-83.6"/></g>'
      + '<g class="ff-mouth ff-m-grin"><path class="ff-grin" d="M-10-85.2Q-6.4-79.2-2.6-85Q-6.4-84-10-85.2Z"/><path class="ff-teeth" d="M-8.8-84.3Q-6.4-83.6-3.8-84.2"/></g>';
  }

  // the soft face: larger round eyes with two highlights each and lashes,
  // softer arched brows, a wider warm smile, rounder blush, a small nose
  function faceSoft() {
    return '<ellipse class="ff-blush" cx="-9.4" cy="-87" rx="2.4" ry="1.8"/><ellipse class="ff-blush" cx="1.6" cy="-87.2" rx="1.9" ry="1.6"/>'
      + '<g class="ff-eye">'
      + '<ellipse class="ff-eye-w" cx="-7.6" cy="-92.2" rx="2.6" ry="3.1"/><circle class="ff-pupil" cx="-8" cy="-91.8" r="1.85"/><circle class="ff-eye-hi" cx="-8.7" cy="-92.8" r=".75"/><circle class="ff-eye-hi" cx="-7.3" cy="-90.9" r=".35"/>'
      + '<ellipse class="ff-eye-w" cx="-1.4" cy="-92.4" rx="2.3" ry="2.9"/><circle class="ff-pupil" cx="-1.8" cy="-92" r="1.65"/><circle class="ff-eye-hi" cx="-2.4" cy="-93" r=".65"/><circle class="ff-eye-hi" cx="-1.1" cy="-91.2" r=".3"/>'
      + '<path class="ff-lash" d="M-10.1-93.4l-1.4-.5M-9.8-94.5l-1.2-1.1M-9-95.2l-.8-1.4M.8-93.7l1.3-.5M.5-94.8l1.1-1.1M-.2-95.4l.7-1.4"/>'
      + '</g>'
      + '<path class="ff-brow ff-brow-soft" d="M-10.8-97.4Q-8.2-100-5.4-98.6M-3.4-98.8Q-.8-100.4 1.6-98.4"/>'
      + '<path class="ff-nose o" d="M-10.4-90.2Q-12.2-88.6-10.2-88"/>'
      + '<g class="ff-mouth ff-m-smile"><path d="M-10.8-85.2Q-6.4-80.4-1.8-85.2"/></g>'
      + '<g class="ff-mouth ff-m-hmm"><path d="M-9.6-84.2Q-6.4-85-3.2-84"/></g>'
      + '<g class="ff-mouth ff-m-grin"><path class="ff-grin" d="M-11-85.6Q-6.4-78.8-1.6-85.6Q-6.2-84-11-85.6Z"/><path class="ff-teeth" d="M-9.8-84.8Q-6.2-83.8-2.8-84.8"/></g>';
  }
  // a softer, narrower jaw and chin (for the soft face): the hair's head,
  // and the face in a hijab's opening
  const JAW = '<path class="ff-skin o" d="M-1-103C5.6-103 9.4-98.4 9.4-92.4C9.4-86 6-81.2-1.4-80.2C-8.2-81-11.4-86-11.4-92.4C-11.4-98.4-7.4-103-1-103Z"/>';
  const JAW_HIJAB = '<path class="ff-skin o" d="M-3.4-100.6C1.8-100.6 5.2-96.8 5.2-91.6C5.2-86.4 2.2-81.4-3.6-80.4C-9.2-81.2-12-86.2-12-91.6C-12-96.8-8.6-100.6-3.4-100.6Z"/>';

  // an invisible box round every head, so its fill-box (and the CSS pivot,
  // a % of it: the neck at (-1, -82)) is the same for any hair or headwear
  const HEAD_BOX = '<rect class="ff-head-box" x="-16" y="-118" width="40" height="54"/>';
  function head(look) {
    const soft = look.face === 'soft';
    const faceOf = () => (soft ? faceSoft() : face(look));
    if (look.hairStyle === 'hijab') {
      // one smooth rounded hood round the face, outlined only round the
      // outside, so it flows straight on into the drape (hijabDrape, drawn
      // with the body underneath it): no rim, no edge across the neck
      const hood = 'M-12.4-77.6C-15.4-81.4-16-86-15.6-91.4C-15.2-100.6-10.2-107.6-2-107.6C7.4-107.6 13.8-100.8 13.8-91.6C13.8-86 12.6-81.4 10.6-78';
      return '<g class="ff-head">' + HEAD_BOX
        + `<path class="ff-hood" d="${hood}Q0-72.4-12.4-77.6Z"/>`
        + '<path class="ff-hood-d" d="M7-105.2C11.6-102 13.8-97 13.8-91.6C13.8-86 12.6-81.4 10.6-78L8-76.6C10.4-81 11.2-86.4 10.8-91.8C10.4-97.4 9.2-101.8 7-105.2Z"/>'
        + `<path class="ff-hood-edge" d="${hood}"/>`
        // light catching the top
        + '<path class="ff-hood-hi ff-hood-top" d="M-11.6-100.6Q-6.8-106.2.8-106.2"/>'
        + (soft ? JAW_HIJAB : '<ellipse class="ff-skin o" cx="-3.4" cy="-90.6" rx="8.4" ry="9.8"/>')
        // the fabric gathers softly under the chin
        + '<path class="ff-hood-line ff-soft" d="M-9.4-78.6Q-3.4-75.8 3-79.2"/>'
        + faceOf() + '</g>';
    }
    const covered = look.head === 'cap' || look.head === 'beanie';
    const h = HAIR[look.hairStyle] || HAIR.wavy;
    const top = covered && look.hairStyle !== 'buzz' ? UNDER_HAT : h.top;
    return '<g class="ff-head">' + HEAD_BOX + h.back
      + (soft ? JAW : '<ellipse class="ff-skin o" cx="-1" cy="-91.6" rx="10.4" ry="11.4"/>')
      + '<path class="ff-skin-d" d="M6.6-99Q10.6-92 7.4-83.6Q9.6-85 9.4-91.6Q9.2-96.6 6.6-99Z"/>'
      + top + (HAT[look.head] || '')
      + '<ellipse class="ff-skin o" cx="6.6" cy="-90.4" rx="2.4" ry="3.4"/><path class="ff-ear-in" d="M7-92.2Q5.6-90.6 7-88.6"/>'
      + faceOf() + '</g>';
  }
  // the hijab over the shoulders and down the chest: soft folds from the
  // neck, a highlight on the near side, the far side in shadow
  const hijabDrape = (look) => (look.hairStyle !== 'hijab' ? '' :
    '<path class="ff-hood o" d="M-12.4-81C-13.8-77-14.2-72.6-13.4-69C-12.4-65-8.8-61.6-3.4-60.6Q2.6-59.8 7.6-62.2C11.8-64.4 13.8-67.6 13.8-71.4C13.8-75.6 13.2-79 12.2-82.4Z"/>'
    + '<path class="ff-hood-d" d="M7.8-80.4C9.2-75 9.2-69.4 7.4-62.4Q11.8-64.2 13.2-67.2C13.8-68.6 13.8-70 13.8-71.4C13.8-75.6 13.2-79 12.2-82.4Z"/>'
    + '<path class="ff-hood-line ff-soft" d="M-6.2-73Q-3.8-68.6-5.2-62.4M3.6-73.8Q5.4-69.4 4.2-62.8"/>'
    + '<path class="ff-hood-hi" d="M-12.4-75.4Q-12.8-72-12-69.4"/>');
  // farm clothes over the shirt: overalls (the trousers' colour) with a bib,
  // straps over the shoulders, buttons and a pocket
  const OVER = {
    'overalls-curvy': '<path class="ff-strap-o" d="M-6.4-63.6L-9-77M5.6-63.6L8.2-77.2"/><path class="ff-strap" d="M-6.4-63.6L-9-77M5.6-63.6L8.2-77.2"/>'
      + '<path class="ff-jeans o" d="M-7.4-64.4H6.6L5.6-55Q5.6-49.6 7.6-45.4H-8.2Q-6-49.6-6.2-55Z"/>'
      + '<path class="ff-jeans-sh" d="M3.4-64H6.5L5.5-55Q5.5-49.8 7.4-45.8H4.6Q3-50 3.4-55Z"/>'
      + '<path class="ff-fold" d="M-3.6-59.4H2.4V-54.6Q-.6-53.4-3.6-54.6Z"/>'
      + '<circle class="ff-ov-btn" cx="-5.6" cy="-62.6" r="1"/><circle class="ff-ov-btn" cx="4.8" cy="-62.6" r="1"/>',
    overalls: '<path class="ff-strap-o" d="M-6.6-63.6L-9.4-77M5.8-63.6L8.6-77.2"/><path class="ff-strap" d="M-6.6-63.6L-9.4-77M5.8-63.6L8.6-77.2"/>'
      + '<path class="ff-jeans o" d="M-7.8-64.4H7L6.6-45.6H-7.4Z"/>'
      + '<path class="ff-jeans-sh" d="M3.8-64H6.9L6.5-46H4.2Z"/>'
      + '<path class="ff-fold" d="M-3.8-58.4H2.6V-53Q-.6-51.8-3.8-53Z"/>'
      + '<circle class="ff-ov-btn" cx="-6" cy="-62.6" r="1"/><circle class="ff-ov-btn" cx="5.2" cy="-62.6" r="1"/>',
  };

  // the torso by figure: the shirt, and the hips with the belt. Curvy is an
  // hourglass: the same shoulders, in at the waist, out again at the hips
  const SHIRT = {
    straight: '<path class="ff-shirt o" d="M-12.4-73.4Q-12.2-77.4-7-77.8Q0-75.2 7-77.8Q12.2-77.4 12.6-73.4L11.4-44Q0-41.4-11.4-44Z"/>'
      + '<path class="ff-shirt-sh" d="M5.2-77.2Q12-77.2 12.4-73.4L11.3-44.2Q8.6-43.2 5.8-42.8Q8.8-60 5.2-77.2Z"/>'
      + '<path class="ff-shirt-hi" d="M-9.2-69Q-10-60-9.2-50"/>'
      + '<path class="ff-shirt-fold" d="M-9-48.8Q-6.4-47.6-3.6-48.4M-9.8-64.6Q-8-62-8.6-58.6"/>',
    curvy: '<path class="ff-shirt o" d="M-11.6-74Q-11.4-77.6-6.8-77.8Q0-75.4 6.8-77.8Q11.6-77.6 11.8-74C12.4-69.6 12-65 10-61C8.4-57.6 7.4-54.6 7.6-51.4C8-48.6 9.8-46.4 11.2-44.2Q0-41.6-11-44.2C-9.6-46.4-7.8-48.6-7.4-51.4C-7.2-54.6-8.2-57.6-9.8-61C-11.8-65-12.2-69.6-11.6-74Z"/>'
      + '<path class="ff-shirt-sh" d="M5-77.2Q11.6-77.4 11.8-74C12.4-69.6 12-65 10-61C8.4-57.6 7.4-54.6 7.6-51.4C8-48.6 9.8-46.4 11.2-44.2Q8.6-43.2 5.8-42.8Q6.6-48 5.6-53Q8-60 5-77.2Z"/>'
      + '<path class="ff-shirt-hi" d="M-9.6-70Q-9.8-65.4-8.6-62"/>'
      + '<path class="ff-shirt-fold" d="M-6.2-49.6Q-3.6-48.6-1-49.2"/>',
  };
  const HIPS = {
    straight: '<path class="ff-jeans o" d="M-11-46.6H11L11.2-37.4Q0-35.8-11.2-37.4Z"/><path class="ff-belt" d="M-11-43.8H11M-1.2-43.4V-37"/>',
    curvy: '<path class="ff-jeans o" d="M-9.6-47.6C-11-45-12-41.6-12-37.6Q0-35.4 12.2-37.6C12.2-41.6 11.2-45 9.8-47.6Q0-45.8-9.6-47.6Z"/><path class="ff-belt" d="M-10.4-44.8Q0-43.2 10.6-44.8M-1.2-44.2V-37"/>',
  };

  function markup(raw) {
    const look = normalize(raw);
    const arm = armer(look.sleeves === 'long');
    return `
    <g class="ff-body">
      <g class="ff-leg ff-leg-b">
        <path class="ff-jeans-d o" d="M.8-41H10.4L9.8-24 9.2-7.4H1.8L1.4-24Z"/>
        <path class="ff-fold" d="M2.6-25.6Q5.4-23.8 8.4-25.6M3.2-22Q5.4-21 7.8-22.2"/>
        <path class="ff-shoe o" d="M10-8.4H1.8C-3.4-8.2-5.6-4.8-5.2-1.6Q-5 0-3.2 0H9.8Q10.8 0 10.6-1.6Z"/>
        <path class="ff-sole" d="M-4.8-1.3H10.2"/>
      </g>
      <g class="ff-leg ff-leg-f">
        <path class="ff-jeans o" d="M-10.4-41H-.6L-1.4-24-1.8-7.4H-9.2L-9.8-24Z"/>
        <path class="ff-jeans-sh" d="M-3.6-40.4H-.8L-1.6-24-1.9-8H-3.6L-3.4-24Z"/>
        <path class="ff-fold" d="M-8.6-25.6Q-5.8-23.8-2.8-25.6M-7.8-22Q-5.6-21-3.2-22.2"/>
        <path class="ff-shoe o" d="M-1.6-8.4H-9.6C-14.8-8.2-17.2-4.8-16.8-1.6Q-16.6 0-14.8 0H-1.4Q-.4 0-.6-1.6Z"/>
        <path class="ff-sole" d="M-16.4-1.3H-1"/>
        <path class="ff-shoe-hi" d="M-14.4-5.2Q-12.6-7-10-7.2"/>
      </g>
      <g class="ff-upper">
        ${arm('ff-a-think ff-back', 'M10.5-72L19.6-61 14.5-50', 14.5, -50)}
        ${arm('ff-a-walk ff-back ff-swing-b', 'M10-72L13.4-60 12.4-48', 12.4, -47.5)}
        ${arm('ff-a-lean ff-back', 'M10.5-72L18.5-58 10-51.5', 10, -51.5)}
        ${arm('ff-a-nope ff-back', 'M10.5-72L19.6-61 14.5-50', 14.5, -50)}
        ${arm('ff-a-point ff-back', 'M10.5-72L19.6-61 14.5-50', 14.5, -50)}
        ${arm('ff-a-lift ff-back', 'M10-74L15-98 10.5-124', 10.5, -125)}
        ${arm('ff-a-toss ff-back', 'M10.5-72L-1-88-12-104', -12.4, -105)}
        ${HIPS[look.figure] || HIPS.straight}
        <path class="ff-skin o" d="M-3.8-84H3.4V-74.6H-3.8Z"/>
        <path class="ff-skin-d" d="M-3.8-81.4Q0-79.4 3.4-81.4V-77.8Q0-76.4-3.8-77.8Z"/>
        ${SHIRT[look.figure] || SHIRT.straight}
        <path class="ff-collar" d="M-6.4-77.2Q0-73 6.4-77.2"/>
        ${OVER[look.over + (look.figure === 'curvy' ? '-curvy' : '')] || OVER[look.over] || ''}
        ${hijabDrape(look)}
        ${head(look)}
        ${arm('ff-a-think ff-front ff-tap', 'M-10.5-72L-19-59.5-11.6-80.4', -11.6, -80.6)}
        ${arm('ff-a-walk ff-front ff-swing-f', 'M-10-72L-13.4-60-12.4-48', -12.4, -47.5)}
        ${arm('ff-a-lean ff-front', 'M-10.5-72L-19-59.5-11.6-80.4', -11.6, -80.6)}
        ${arm('ff-a-nope ff-front ff-wag', 'M-10.5-72L-22-73-24.6-89', -24.6, -89.6, finger('M-24.6-91.4V-97.6'))}
        ${arm('ff-a-point ff-front', 'M-10.5-72L-27.6-67.4-44-64.6', -45, -64.4, finger('M-47-64L-54.4-62.4'))}
        ${arm('ff-a-lift ff-front', 'M-10-74L-15-98-10.5-124', -10.5, -125)}
        ${arm('ff-a-toss ff-front', 'M-10.5-72L-27-82-38-98', -38.6, -99)}
      </g>
      <g class="ff-bubble"><circle cx="-17" cy="-119" r="2.4"/><circle cx="-23" cy="-126" r="3.6"/><ellipse cx="-31" cy="-140" rx="11" ry="9.6"/><text class="ff-bubble-q" x="-31" y="-135.6">?</text></g>
      <g class="ff-alarm"><text x="-24" y="-122">!</text></g>
    </g>`;
  }

  // draw a look into a `.fy-farmer` group (keeps its pose)
  function apply(g, raw) {
    const look = normalize(raw);
    const key = JSON.stringify(look);
    if (g.dataset.look === key) return;
    g.dataset.look = key;
    g.innerHTML = markup(look);
    g.setAttribute('style', vars(look));
  }

  // the signed-in teacher's profile: shared.js's session where it's loaded,
  // else the same session from storage (the pop-out doesn't load shared.js)
  function user() {
    if (typeof currentUser === 'function') return currentUser();
    try { return (JSON.parse(localStorage.getItem('teacherpal.session') || 'null') || {}).user || null; } catch { return null; }
  }
  const current = () => normalize(user() && user().farmer);

  // ---------- Settings → Your farmer ----------
  // A preview that walks, beside one row per choice. Every change shows at
  // once and is saved 400ms later (setMyFarmer: the session, the scene
  // behind via 'teacherpal:farmer', then the profile).
  // the rows for a look: a hijab has its colour instead of hair colour and
  // headwear; headwear's colour shows only with some
  const rowsFor = (look) => {
    const hijab = look.hairStyle === 'hijab';
    return [
      ['skin', 'Skin'],
      ['face', 'Face'],
      ['figure', 'Figure'],
      ['hairStyle', 'Hair'],
      hijab ? ['headColor', 'Hijab colour'] : ['hair', 'Hair colour'],
      ...(hijab ? [] : [['head', 'Headwear']]),
      ...(hijab || look.head === 'none' ? [] : [['headColor', look.head === 'cap' ? 'Cap colour' : 'Beanie colour']]),
      ['shirt', 'Shirt'],
      ['sleeves', 'Sleeves'],
      ['over', 'Farm clothes'],
      ['pants', look.over === 'overalls' ? 'Overalls colour' : 'Trousers'],
      ['lashes', 'Eyelashes'],
    ];
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function openDialog() {
    let dlg = document.getElementById('farmer-dialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'farmer-dialog';
      dlg.className = 'farmer-dialog';
      dlg.setAttribute('aria-labelledby', 'fd-title');
      dlg.innerHTML = `
        <div class="fd-inner">
          <div class="cd-head">
            <h2 id="fd-title">Your farmer</h2>
            <button type="button" class="corner-btn" data-fd="close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
          </div>
          <p class="cd-note">How you look on the Name Wheel's farm. Changes save as you make them.</p>
          <div class="fd-body">
            <div class="fd-preview"><svg viewBox="-30 -122 60 126" aria-hidden="true"><g class="fy-farmer" data-pose="walk"></g></svg></div>
            <div class="fd-opts"></div>
          </div>
          <div class="fd-foot">
            <span class="fd-status" role="status"></span>
            <button type="button" data-fd="reset">Back to the default</button>
            <button type="button" class="primary" data-fd="close">Done</button>
          </div>
        </div>`;
      document.body.appendChild(dlg);
    }
    const g = dlg.querySelector('.fy-farmer');
    const opts = dlg.querySelector('.fd-opts');
    const status = dlg.querySelector('.fd-status');
    let look = current(), timer = 0;

    function render() {
      apply(g, look);
      opts.innerHTML = rowsFor(look).map(([k, label]) => {
        const colour = typeof OPTIONS[k][0][0] === 'string' && OPTIONS[k][0][0][0] === '#';
        const items = OPTIONS[k].map(([val, name]) => `<button type="button" class="${colour ? 'fd-swatch' : 'fd-chip'}" data-k="${k}" data-v="${esc(String(val))}" aria-pressed="${look[k] === val}" title="${esc(name)}"${colour ? ` aria-label="${esc(name)}" style="--sw:${val}"` : ''}>${colour ? '' : esc(name)}</button>`).join('');
        return `<div class="fd-row"><span class="fd-label">${label}</span><div class="fd-set" role="group" aria-label="${label}">${items}</div></div>`;
      }).join('');
    }
    function save() {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        status.textContent = 'Saving…';
        try {
          await setMyFarmer(same(look, DEFAULT) ? null : look);
          status.textContent = 'Saved';
        } catch (err) {
          status.textContent = /set_my_farmer|PGRST202|404/.test(String(err && err.message))
            ? 'Not saved: run migration-farmer.sql in Supabase.'
            : `Not saved: ${err && err.message}`;
        }
      }, 400);
    }
    opts.onclick = (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      const k = b.dataset.k;
      const hit = OPTIONS[k].find(([o]) => String(o) === b.dataset.v);
      if (!hit || look[k] === hit[0]) return;
      look = { ...look, [k]: hit[0] };
      if (k === 'hairStyle' && hit[0] === 'hijab') look.head = 'none';     // a hijab, not a hat over it
      render();
      save();
      opts.querySelector(`button[data-k="${k}"][data-v="${CSS.escape(b.dataset.v)}"]`)?.focus();
    };
    dlg.onclick = (e) => {
      if (e.target === dlg || e.target.closest('[data-fd="close"]')) dlg.close();
      else if (e.target.closest('[data-fd="reset"]')) { look = { ...DEFAULT }; render(); save(); }
    };
    status.textContent = '';
    render();
    dlg.showModal();
  }

  window.FarmerArt = { DEFAULT, OPTIONS, normalize, markup, vars, apply, user, current, openDialog };
})();
