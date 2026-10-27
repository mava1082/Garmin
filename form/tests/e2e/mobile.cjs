// Mobile end-to-end flow (Playwright). Run against `wrangler dev --local` after tests/e2e/seed.ts:
//   node tests/e2e/mobile.cjs
const { chromium, devices } = require('playwright');
const BASE = 'http://localhost:8787';
const errors = [];
require('fs').mkdirSync('/tmp/form-shots', { recursive: true });
const check = (cond, msg) => { if (!cond) { errors.push('FAIL: ' + msg); console.log('FAIL', msg); } else console.log('ok', msg); };
(async () => {
  const b = await chromium.launch();
  // Cookies are Secure; localhost is treated as secure by Chromium.
  const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|401/.test(m.text())) errors.push('console: ' + m.text()); });
  const overflow = async (name) => check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `no horizontal scroll on ${name}`);
  const shot = (n) => p.screenshot({ path: `/tmp/form-shots/${n}.png`, fullPage: true });

  await p.goto(BASE);
  await p.waitForSelector('text=Logga in');
  await p.fill('input[type=password]', 'fel');
  await p.click('button:has-text("Logga in")');
  await p.waitForSelector('text=Fel lösenord');
  check(true, 'wrong password rejected');
  await p.fill('input[type=password]', 'testlosen123');
  await p.click('button:has-text("Logga in")');
  await p.waitForSelector('.hero', { timeout: 10000 });
  check(!(await p.isVisible('text=Demoläge')), 'real mode has no demo banner');
  await overflow('Idag'); await shot('01-idag');

  // Check-in with knee pain and low energy
  if (await p.isVisible('text=Dagens check-in')) await p.click('.card:has-text("Dagens check-in") button:has-text("Ändra")');
  await p.locator('.scale[aria-label="Energi"] button').nth(1).click();
  await p.locator('.scale[aria-label="Träningsvärk"] button').nth(1).click();
  await p.locator('.scale[aria-label="Stress"] button').nth(2).click();
  await p.click('.chip:has-text("Lätt")');
  await p.click('.chip:has-text("Knä")');
  await p.click('button:has-text("Spara")');
  await p.waitForSelector('text=Dagens check-in');
  const state = await p.textContent('.state');
  check(/lugnare|återhämtning/i.test(state), `low energy lowers the day (${state.trim()})`);
  const sessionText = await p.textContent('.session');
  check(!/löpning/i.test(sessionText.split('·')[1] || ''), 'no running suggested with knee pain');
  await p.click('button:has-text("Visa passet")');
  await p.waitForSelector('text=Därför föreslår vi detta');
  check(await p.isVisible('text=Uppvärmning') || await p.isVisible('text=Huvuddel'), 'workout has structure');
  await shot('02-pass');
  await p.click('button[aria-label="Stäng"]');
  await p.click('button:has-text("20 min")');
  check(/20 min/.test(await p.textContent('.session .facts')), 'time choice changes duration');
  await p.click('button:has-text("Byt aktivitet")');
  const before = await p.textContent('.session h2');
  await p.locator('.sheet .btn').first().click();
  const after = await p.textContent('.session h2');
  check(before !== after, `swap activity works (${before} → ${after})`);
  await shot('03-idag-efter-checkin');

  // Träning
  await p.click('.tab:has-text("Träning")');
  await p.waitForSelector('text=pass');
  await overflow('Träning flöde'); await shot('04-flode');
  await p.locator('.item').first().click();
  await p.waitForSelector('text=Din upplevelse');
  await p.waitForTimeout(500);
  await overflow('Aktivitet'); await shot('05-aktivitet');
  await p.goBack();
  await p.click('.seg button:has-text("Plan")');
  await p.click('button:has-text("Skapa plan"), button:has-text("Föreslå justering")');
  await p.waitForSelector('text=Förslag på plan');
  await shot('06-planforslag');
  if (await p.isVisible('text=Planen följer redan')) await p.click('button[aria-label="Stäng"]'); else await p.click('button:has-text("Godkänn")');
  await p.waitForSelector('.tag:has-text("Planerat"), .tag:has-text("Idag")', { timeout: 8000 });
  check(true, 'plan approved and stored');
  await overflow('Plan'); await shot('07-plan');
  await p.click('.seg button:has-text("Trender")');
  await p.waitForTimeout(400);
  await overflow('Trender'); await shot('08-trender');
  await p.click('.seg button:has-text("Styrka")');
  await overflow('Styrka');

  await p.click('.tab:has-text("Återhämtning")');
  await p.waitForSelector('text=Vad driver din återhämtning?');
  await overflow('Återhämtning'); await shot('09-aterhamtning');

  await p.click('.tab:has-text("Kropp")');
  await p.click('button:has-text("Lägg in vikt")');
  await p.fill('.sheet input[type=number]', '88.4');
  await p.click('.sheet button:has-text("Spara")');
  await p.waitForSelector('text=88,4 kg');
  check(true, 'manual weight saved and labelled');
  await overflow('Kropp'); await shot('10-kropp');

  await p.click('.tab:has-text("Coach")');
  await p.click('button:has-text("Ge mig ett kortpass")');
  await p.waitForSelector('.sheet >> text=Därför föreslår vi detta');
  await p.click('button[aria-label="Stäng"]');
  await p.click('.chip:has-text("Hur går min kondition?")');
  await p.waitForSelector('text=Underlag:');
  await overflow('Coach'); await shot('11-coach');

  await p.click('button[aria-label="Inställningar"]').catch(() => {});
  await p.goto(BASE + '/#/installningar');
  await p.click('.chip:has-text("Aktuella besvär")');
  await p.click('button:has-text("Spara inställningar")');
  await p.waitForSelector('text=Sparat');
  await overflow('Inställningar'); await shot('12-installningar');

  // Reload keeps session (server-side), then logout ends it
  await p.reload();
  await p.waitForSelector('.tabbar');
  check(true, 'session survives reload');
  await p.click('button:has-text("Logga ut")');
  await p.waitForSelector('text=Logga in');
  const r = await p.evaluate(() => fetch('/api/data').then((x) => x.status));
  check(r === 401, 'logged out on server');

  // Demo
  await p.click('button:has-text("Utforska med påhittade data")');
  await p.waitForSelector('text=Demoläge');
  await shot('13-demo');
  const desk = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await desk.goto(BASE);
  await desk.click('button:has-text("Utforska med påhittade data")');
  await desk.waitForSelector('.hero');
  await desk.screenshot({ path: '/tmp/form-shots/14-desktop.png', fullPage: true });
  await b.close();
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL GOOD');
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
