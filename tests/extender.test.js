// 실제 확장을 크로미움에 올리고, gift.kakao.com 요청을 가짜 화면(fixtures)으로 바꿔치기해서 검사한다.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(here, '..');
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');
const DETAIL_MODES = { 111: 'ok', 333: 'silent', 444: 'none', 555: 'ok' };
const INBOX_URL = 'https://gift.kakao.com/giftbox/inbox?couponStatus=OPEN';

let context, worker, userDataDir;
let inboxFixture = 'inbox.html';
let dialogs = [];

before(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'gx-test-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  await context.route('https://gift.kakao.com/**', (route) => {
    const { pathname } = new URL(route.request().url());
    const detail = pathname.match(/^\/giftbox\/inbox\/detail\/(\d+)/);
    const body = detail
      ? fixture('detail.html').replace('__MODE__', DETAIL_MODES[detail[1]] || 'none')
      : fixture(inboxFixture);
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
  context.on('page', (p) => p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); }));
  worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
});

after(async () => {
  await context?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  dialogs = [];
  inboxFixture = 'inbox.html';
  await worker.evaluate(() => chrome.storage.local.clear());
});

const storage = () => worker.evaluate(() => chrome.storage.local.get(null));
const setStorage = (v) => worker.evaluate((v) => chrome.storage.local.set(v), v);

async function waitFor(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 300));
  }
}

test('자동 실행: D-30 이내만 처리하고 결과를 정확히 구분한다(확인창은 뜨지 않음)', async () => {
  await setStorage({ autoRun: true, thresholdDays: 30 });
  const page = await context.newPage();
  await page.goto(INBOX_URL);
  const s = await waitFor(async () => {
    const st = await storage();
    return st.log?.length === 3 && (await page.url()).includes('/giftbox/inbox?') && st.queue?.length === 0 ? st : null;
  }, 45000);
  const byName = Object.fromEntries(s.log.map((e) => [e.name.replace(/D-\d+$/, ''), e.status]));
  assert.deepEqual(byName, { 아메리카노: 'success', 치킨: 'unconfirmed', 상품권: 'no_button' });
  assert.ok(!s.processed['222'], 'D-40 항목은 건드리지 않아야 함');
  assert.deepEqual(dialogs, [], '연장 확인창은 자동 확인되어 사용자에게 뜨지 않아야 함');
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-gx-armed')), false);
  assert.equal(s.structureWarning ?? null, null);
  await page.close();
});

test('연장 중이 아닐 때 다른 확인창(환불)은 자동 확인되지 않는다', async () => {
  await setStorage({ autoRun: true });
  const page = await context.newPage();
  await page.goto('https://gift.kakao.com/giftbox/inbox/detail/555'); // 큐에 없는 상세 화면
  await page.waitForTimeout(2500); // 확장의 디바운스 대기
  await page.click('#refund');
  assert.equal(await page.textContent('#result'), 'kept', '환불 확인창이 사용자에게 떠서 취소되어야 함');
  assert.deepEqual(dialogs, ['환불하시겠어요?']);
  await page.close();
});

test('표시 유효시간이 지나면 자동 확인하지 않는다', async () => {
  const page = await context.newPage();
  await page.goto('https://gift.kakao.com/giftbox/inbox/detail/555');
  await page.evaluate(() => document.documentElement.setAttribute('data-gx-armed', String(Date.now() - 11000)));
  await page.click('#refund');
  assert.equal(await page.textContent('#result'), 'kept');
  await page.close();
});

test('클래스명이 없어도 D-day를 읽고, 표기가 바뀌면 구조 변경 경고를 남긴다', async () => {
  await setStorage({ autoRun: true, processed: { 111: 1, 333: 1, 444: 1 } });
  inboxFixture = 'inbox-changed.html';
  const page = await context.newPage();
  await page.goto(INBOX_URL);
  const warned = await waitFor(async () => (await storage()).structureWarning);
  assert.equal(warned.linkCount, 2);

  inboxFixture = 'inbox.html';
  await page.reload();
  await waitFor(async () => (await storage()).structureWarning === null);
  await page.close();
});

test('팝업 "지금 검사" 메시지: 상세 화면에서 수동 실행하면 결과를 돌려준다', async () => {
  const page = await context.newPage();
  await page.goto('https://gift.kakao.com/giftbox/inbox/detail/555');
  await page.waitForTimeout(2000);
  const res = await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return chrome.tabs.sendMessage(tab.id, { type: 'RUN_SCAN' });
  }, page.url());
  assert.equal(res.result.status, 'success');
  assert.deepEqual(dialogs, []);
  await page.close();
});
