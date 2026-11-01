// site.js — the public pages' shared chrome (login, features, about, terms,
// privacy): the floating nav, the footer and the storage notice. Loaded after
// shared.js on every body.public page; the app's own pages use nav.js instead.
// Plain globals, no modules, like the rest of the app.

const SITE_CONTACT = 'khalidjpal@gmail.com';
const SITE_NOTICE_KEY = 'teacherpal.notice.ok';   // '1' once the storage notice is dismissed

(function site() {
  const here = (location.pathname.split('/').pop() || 'login.html').toLowerCase();
  const cur = (file) => (here === file ? ' aria-current="page"' : '');
  const signedIn = typeof hasSession === 'function' && hasSession();

  // ---------- the floating nav: content links in the centre pill, the
  // sign-in pair in their own cluster at the top right ----------
  // On login.html the page's own script catches [data-nav] clicks (switch the
  // card, focus the field, no reload); everywhere else they are plain links.
  // The legal pages live in the footer only.
  const nav = document.createElement('nav');
  nav.className = 'site-nav';
  nav.setAttribute('aria-label', 'TeacherPal');
  nav.innerHTML = `
    <a class="sn-brand" href="login.html" data-nav="top"><span class="site-mark" aria-hidden="true"></span>TeacherPal</a>
    <div class="sn-items">
      <a class="sn-link" href="login.html" data-nav="top"${cur('login.html')}>Home</a>
      <a class="sn-link" href="features.html"${cur('features.html')}>Features</a>
      <a class="sn-link" href="about.html"${cur('about.html')}>About</a>
    </div>`;
  const auth = document.createElement('div');
  auth.className = 'site-auth';
  auth.setAttribute('role', 'group');
  auth.setAttribute('aria-label', 'Account');
  auth.innerHTML = signedIn
    ? '<a class="sn-link" href="index.html">Open TeacherPal</a>'
    : `<a class="sn-link sa-signin" href="login.html" data-nav="signin">Sign in</a>
      <a class="sn-link sa-signup" id="nav-signup" href="login.html#signup" data-nav="signup" hidden>Create account</a>`;
  document.body.prepend(nav, auth);

  // the slow ambient light behind every public page
  if (!document.querySelector('.site-ambient')) {
    const amb = document.createElement('div');
    amb.className = 'site-ambient';
    amb.setAttribute('aria-hidden', 'true');
    document.body.prepend(amb);
  }

  // The page scrolls inside <main>, so its scrollbar sits at the window's
  // right edge. The fixed nav and pill are placed from the window, so they
  // need that width as an offset or the pill lands on the scrollbar.
  const scroller = document.querySelector('main.public-page');
  if (scroller) {
    const fitScrollbar = () => document.body.style.setProperty('--sbw', `${scroller.offsetWidth - scroller.clientWidth}px`);
    new ResizeObserver(fitScrollbar).observe(scroller);
    fitScrollbar();
  }

  // ---------- the footer, at the end of the scrolling <main> ----------
  const main = document.querySelector('main.public-page') || document.body;
  const foot = document.createElement('footer');
  foot.className = 'site-foot';
  foot.innerHTML = `<div class="sf-inner">
    <div class="sf-brand"><span class="site-mark" aria-hidden="true"></span>TeacherPal · made by a teacher, for teachers</div>
    <nav class="sf-links" aria-label="Site">
      <a href="terms.html"${cur('terms.html')}>Terms</a>
      <a href="privacy.html"${cur('privacy.html')}>Privacy</a>
      <a href="mailto:${SITE_CONTACT}">Contact</a>
    </nav>
  </div>`;
  main.append(foot);

  // ---------- sign-up open? Shows the Create account buttons ----------
  // Every [data-signup-cta] on the page follows the same switch.
  const ctas = () => [...document.querySelectorAll('#nav-signup, [data-signup-cta]')];
  if (!signedIn && typeof signupOpen === 'function') {
    signupOpen().then((open) => { ctas().forEach((el) => { el.hidden = !open; }); }).catch(() => {});
  }

  // ---------- the storage notice: a small bar, not a gate ----------
  let dismissed = false;
  try { dismissed = localStorage.getItem(SITE_NOTICE_KEY) === '1'; } catch { dismissed = true; }
  if (!dismissed) {
    const bar = document.createElement('div');
    bar.className = 'site-notice depth-card';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Storage notice');
    bar.innerHTML = `
      <p>No tracking cookies here. TeacherPal only keeps what it needs to work in this browser: your sign-in, your theme and a few tool settings. No ads, no analytics. <a href="privacy.html#browser">Privacy policy</a></p>
      <button type="button" class="neu-btn">Got it</button>`;
    bar.querySelector('button').addEventListener('click', () => {
      try { localStorage.setItem(SITE_NOTICE_KEY, '1'); } catch { /* private mode: it just comes back next time */ }
      const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (calm) { bar.remove(); return; }
      bar.classList.add('leaving');
      bar.addEventListener('animationend', () => bar.remove(), { once: true });
      setTimeout(() => bar.remove(), 400);
    });
    document.body.append(bar);
  }

  // ---------- [data-reveal]: children rise in the first time it's seen ----------
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const blocks = [...document.querySelectorAll('[data-reveal]')];
  if (!calm && blocks.length && 'IntersectionObserver' in window) {
    const root = document.querySelector('main.public-page');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        io.unobserve(en.target);
      });
    }, { root, threshold: 0.12 });
    blocks.forEach((b) => {
      [...b.children].forEach((c, i) => c.style.setProperty('--i', i));
      b.classList.add('reveal');
      io.observe(b);
    });
  }
})();
