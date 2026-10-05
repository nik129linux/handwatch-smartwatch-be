/* ==========================================================================
   tests/electron-smoke.js — the desktop app boots and behaves
   node tests/electron-smoke.js   (run from the prototype folder;
   under Wayland use: xvfb-run -a node tests/electron-smoke.js)
   Screenshots land in shots/app-*.png.
   ========================================================================== */

const path = require('path');
const fs = require('fs');
const { _electron } =
  require('/home/nico/.nvm/versions/node/v22.23.2/lib/node_modules/playwright');
const electronPath = require('electron');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'shots');

let pass = 0;
const fails = [];

function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); return true; }
  fails.push(label + (detail ? ' — ' + detail : ''));
  console.log('  ✗ ' + label + (detail ? '\n      ' + detail : ''));
  return false;
}
function head(s) { console.log('\n' + s); }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  head('electron · Hand Hygiene Watch boots as a desktop app');

  const app = await _electron.launch({
    executablePath: electronPath,
    args: [ROOT],
    env: { ...process.env, ELECTRON_DISABLE_GPU: '1' }
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('.view[data-screen="home"]', { timeout: 15000 });

  ok(await window.title() === 'Hand Hygiene Watch',
    'window title is "Hand Hygiene Watch"', await window.title());

  const errs = [];
  window.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  window.on('pageerror', e => errs.push(e.message));

  /* theme toggle flips data-theme inside the app window */
  ok(await window.locator('#themeToggle[aria-label="Switch theme"]').count() === 1,
    'the app window has a theme toggle');
  const before = await window.evaluate(() => document.documentElement.dataset.theme);
  await window.locator('#themeToggle').click();
  await window.waitForTimeout(600);
  const after = await window.evaluate(() => document.documentElement.dataset.theme);
  ok(before !== after && (after === 'light' || after === 'dark'),
    'the toggle flips data-theme (' + before + ' → ' + after + ')');

  await window.evaluate(() => window.__setTheme('dark'));
  await window.waitForTimeout(600);

  /* W4 — above the fold at both window sizes: the whole watch
     (case + both band stubs) and Guided shift need no scrolling */
  async function foldState() {
    return await window.evaluate(() => {
      window.scrollTo(0, 0);
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const parts = ['.case', '.band--top', '.band--bottom'].map(r);
      const pill = r('#storyPlay');
      return {
        vh: window.innerHeight,
        top: Math.min(...parts.map(p => p.top)),
        bottom: Math.max(...parts.map(p => p.bottom)),
        pillTop: pill.top, pillBottom: pill.bottom
      };
    });
  }
  for (const [fw, fh] of [[1440, 900], [1280, 720]]) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => {
      BrowserWindow.getAllWindows()[0].setSize(w, h);
    }, [fw, fh]);
    await window.waitForTimeout(800);
    const f = await foldState();
    ok(f.top >= 0 && f.bottom <= f.vh,
      'the whole watch clears the fold at ' + fw + 'x' + fh,
      'watch ' + Math.round(f.top) + '–' + Math.round(f.bottom) + 'px of ' + f.vh + 'px');
    ok(f.pillTop >= 0 && f.pillBottom <= f.vh,
      'Guided shift clears the fold at ' + fw + 'x' + fh,
      'pill ' + Math.round(f.pillTop) + '–' + Math.round(f.pillBottom) + 'px of ' + f.vh + 'px');
  }
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1440, 900);
  });
  await window.waitForTimeout(600);

  /* stage stills, both themes: idle, doubtful, wash in progress */
  async function settled(name) {
    await window.waitForSelector(`.view[data-screen="${name}"]`, { timeout: 8000 });
    await window.waitForFunction((n) => {
      const views = Array.from(document.querySelectorAll('#viewport .view'));
      if (views.length !== 1) return false;
      if (views[0].getAttribute('data-screen') !== n) return false;
      if (views[0].hasAttribute('data-anim')) return false;
      return getComputedStyle(views[0]).opacity === '1';
    }, name, { timeout: 8000 });
  }
  for (const theme of ['dark', 'light']) {
    const suffix = theme === 'light' ? '-light' : '';
    await window.evaluate((t) => window.__setTheme(t), theme);
    await window.waitForTimeout(600);
    await window.evaluate(() => { window.scrollTo(0, 0); watch.home(); });
    await settled('home');
    await window.screenshot({ path: path.join(SHOTS, 'app-' + theme + '.png') });
    await window.locator('#freeMode [data-act="dudoso"]').click();
    await settled('dudoso');
    await window.screenshot({ path: path.join(SHOTS, 'app-doubt' + suffix + '.png') });
    await window.evaluate(() => {
      watch.state.washMs = 20000; watch.startWash({});
    });
    await settled('lavando');
    await window.waitForTimeout(1200);
    await window.screenshot({ path: path.join(SHOTS, 'app-wash' + suffix + '.png') });
    /* two Escapes unwind the trail (wash -> doubt -> home) and the
       first one already killed the wash timer, so no credit lands */
    await window.keyboard.press('Escape');
    await settled('dudoso');
    await window.keyboard.press('Escape');
    await settled('home');
  }
  /* the old names survive: app-dark.png / app-light.png are the idle stills */
  await window.evaluate(() => { watch.resume(); watch.home(); });
  await settled('home');
  ok(['app-dark.png', 'app-light.png', 'app-doubt.png', 'app-doubt-light.png',
    'app-wash.png', 'app-wash-light.png'].every(f => fs.existsSync(path.join(SHOTS, f))),
    'dark + light stage screenshots saved (idle, doubtful, wash)');

  /* free mode: Doubtful wash opens the confirm screen */
  await window.evaluate(() => window.__setTheme('dark'));
  await window.waitForTimeout(400);
  await window.locator('#freeMode [data-act="dudoso"]').click();
  await settled('dudoso');
  const q = (await window.locator('.doubt__q').textContent()).trim();
  ok(q === 'Did you wash?', 'Doubtful wash shows the confirm screen', q);
  ok(await window.evaluate(() =>
    document.querySelector('#screen [data-features], #screen .doubt__why') === null),
    'the watch carries no diagnostic line');

  /* the Infection Control link navigates inside the same window */
  await window.evaluate(() => { watch.home(); });
  await window.waitForSelector('.view[data-screen="home"]', { timeout: 5000 });
  await window.locator('.panel__link').click();
  await window.waitForSelector('#momentBars .ubar', { timeout: 5000 });
  ok(/Unit 4B/.test(await window.title()) || (await window.locator('.unit__name').count()) === 1,
    'the unit page opens inside the same window');
  /* unit sections reveal on scroll ([data-io] → .is-in) and the bar /
     heat keyframes hang off the same class: stroll down first, or a
     fullPage still captures them at opacity 0 / scaleX(0) */
  for (const sel of ['#momentBars', '#heat', '#corrN']) {
    await window.locator(sel).scrollIntoViewIfNeeded();
    await window.waitForTimeout(600);
  }
  /* park on the bars: a fullPage capture from scrollY 0 drops finished
     keyframe fills in this Electron build, mid-page captures fine */
  await window.locator('#momentBars').scrollIntoViewIfNeeded();
  await window.waitForTimeout(600);
  const hidden = await window.evaluate(() =>
    Array.from(document.querySelectorAll('[data-io]'))
      .filter(e => !e.classList.contains('is-in')).length);
  ok(hidden === 0, 'every unit section revealed after scrolling', hidden + ' still hidden');
  const grown = await window.evaluate(() => {
    const f = document.querySelector('.ubar__fill');
    const c = document.querySelector('.uheat__cell');
    if (!f || !c) return 'missing nodes';
    const t = getComputedStyle(f).transform;
    const o = getComputedStyle(c).opacity;
    return (t === 'matrix(1, 0, 0, 1, 0, 0)' && o === '1')
      ? 'ok' : 'fill ' + t + ' / cell opacity ' + o;
  });
  ok(grown === 'ok', 'bar fills and heat cells finished growing', grown);
  /* the fixed notice would stitch mid-page in a full-height capture */
  await window.evaluate(() => {
    const n = document.querySelector('.unotice');
    if (n) n.style.display = 'none';
  });
  await window.evaluate(() => window.__setTheme('dark'));
  await window.waitForTimeout(1200);
  await window.screenshot({ path: path.join(SHOTS, 'app-unit-dark.png'), fullPage: true });
  await window.evaluate(() => window.__setTheme('light'));
  await window.waitForTimeout(1200);
  await window.screenshot({ path: path.join(SHOTS, 'app-unit-light.png'), fullPage: true });

  /* back to the watch */
  await window.evaluate(() =>
    document.querySelector('.unit__back').scrollIntoView({ block: 'center' }));
  await window.waitForTimeout(600);
  await window.locator('.unit__back').click({ force: true });
  await window.waitForSelector('.view[data-screen="home"]', { timeout: 5000 });
  ok(true, 'unit page links back to the watch');

  ok(errs.length === 0, 'no console errors inside the app window',
    errs.slice(0, 3).join(' | '));

  await app.close();

  head('summary');
  if (fails.length) {
    console.log(fails.length + ' failed, ' + pass + ' passed\n');
    process.exit(1);
  }
  console.log('  ' + pass + ' passed, 0 failed');
  console.log('  screenshots → shots/app-*.png');
  console.log('');
})().catch(err => {
  console.error('\n  harness error:', err && err.message ? err.message : err);
  process.exit(1);
});
