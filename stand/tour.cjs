// Проход тура «Как работать» на живом стенде (stand/live.py должен работать):
//   NODE_PATH=$(npm root -g) node stand/tour.cjs 'http://127.0.0.1:8765/?user=b.kotov' <каталог> [ширина] [высота] [0|1 — кадры]
// Новый контекст браузера = чистая память: приглашение → весь тур по вкладкам (по «Дальше — тур
// по вкладке …»), показ «нажми — будет», затем: приглашение не вернулось после перезагрузки,
// кнопка в шапке запускает тур текущей вкладки, стрелки листают, Esc закрывает.
// Печатает каждый шаг (вкладка, номер, заголовок, где рамка и карточка, влезла ли карточка в окно).
const { chromium } = require('playwright');
const [,, url, out, w, h, shotsArg] = process.argv;
const shots = shotsArg !== '0';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: +w || 1440, height: +h || 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => { errs.push(e.message); console.log('PAGEERR', e.message); });
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__runs > 0 && document.querySelector('.hh-root'), null, { timeout: 60000 });
  await page.waitForTimeout(700);
  const inv = await page.$('[data-tact="invite"]');
  console.log('INVITE', !!inv);
  if (shots) await page.screenshot({ path: out + '/t00-invite.png' });
  await page.click('[data-tact="invite"]');
  await page.waitForTimeout(500);
  const seen = [];
  for (let n = 0; n < 60; n++) {
    const st = await page.evaluate(() => {
      const c = document.querySelector('.hh-tcard'), L = document.querySelector('.hh-tour');
      if (!L || L.style.display !== 'block' || !c) return null;
      const rings = Array.from(document.querySelectorAll('.hh-tring')).filter(x => x.style.display === 'block');
      const ring = rings[0], rr = ring ? ring.getBoundingClientRect() : null, cr = c.getBoundingClientRect();
      const arr = c.querySelector('.hh-tarr');
      return {
        head: (c.querySelector('.hh-tcs') || {}).textContent, title: (c.querySelector('.hh-tct') || {}).textContent,
        ring: ring ? [Math.round(rr.left), Math.round(rr.top), Math.round(rr.width), Math.round(rr.height)] : null, rings: rings.length,
        card: [Math.round(cr.left), Math.round(cr.top), Math.round(cr.width), Math.round(cr.height)],
        arrow: arr ? arr.className.replace('hh-tarr', '').trim() : '',
        btns: Array.from(c.querySelectorAll('[data-tact]')).map(b => b.getAttribute('data-tact')),
        inView: cr.top >= 0 && cr.bottom <= innerHeight && cr.left >= 0 && cr.right <= innerWidth
      };
    });
    if (!st) { console.log('TOUR CLOSED after', n, 'steps'); break; }
    console.log('STEP', JSON.stringify(st));
    seen.push(st.head + ' ' + st.title);
    if (shots) await page.screenshot({ path: out + '/t' + String(n + 1).padStart(2, '0') + '.png' });
    if (st.btns.indexOf('demo') > -1) {
      await page.click('.hh-tcard [data-tact="demo"]');
      await page.waitForTimeout(1900);
      continue;
    }
    if (st.btns.indexOf('nexttab') > -1) {
      await page.click('.hh-tcard [data-tact="nexttab"]');
      await page.waitForTimeout(1500);
      await page.waitForFunction(() => !(window.__pvtState.hh.pend), null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
      continue;
    }
    if (st.btns.indexOf('next') > -1) { await page.click('.hh-tcard .hh-pri[data-tact="next"], .hh-tcard [data-tact="next"]'); await page.waitForTimeout(450); continue; }
    await page.click('.hh-tcard .hh-pri[data-tact="close"]');
    await page.waitForTimeout(400);
  }
  // Приглашение не возвращается после перезагрузки (память браузера).
  await page.reload();
  await page.waitForFunction(() => window.__runs > 0 && document.querySelector('.hh-root'), null, { timeout: 60000 });
  await page.waitForTimeout(600);
  console.log('INVITE AFTER RELOAD', !!(await page.$('[data-tact="invite"]')));
  // Кнопка в шапке — тур по текущей вкладке; Esc закрывает.
  await page.click('[data-view="teams"]');
  await page.waitForTimeout(500);
  await page.click('[data-tact="tour"]');
  await page.waitForTimeout(500);
  const head = await page.evaluate(() => (document.querySelector('.hh-tcs') || {}).textContent);
  console.log('HELP ON TEAMS', head);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  console.log('ARROW', await page.evaluate(() => (document.querySelector('.hh-tcs') || {}).textContent));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  console.log('AFTER ESC visible', await page.evaluate(() => { const L = document.querySelector('.hh-tour'); return !!L && L.style.display === 'block'; }));
  console.log('STEPS', seen.length, 'ERRORS', errs.length);
  await browser.close();
})();
