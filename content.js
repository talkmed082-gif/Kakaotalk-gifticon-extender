// gift.kakao.com에서 유효기간 연장을 자동화한다.
// 목록 화면(/giftbox/inbox)에는 "D-16" 같은 배지로 남은 일수만 보이고,
// 실제 "기간 연장" 버튼은 각 기프티콘의 상세 화면(/giftbox/inbox/detail/<id>)에 있다.
// 그래서 목록에서 대상(D-30 이내)을 골라 큐에 담아두고, 상세 화면으로 하나씩 이동하며 처리한다.
// 카카오 화면은 리액트라 클래스명이 자주 바뀌므로, 클래스명이 아니라 화면에 보이는 텍스트를 기준으로 동작한다.
(function () {
  const DEFAULT_SETTINGS = { autoRun: false, thresholdDays: 30 };
  const INBOX_PATH = '/giftbox/inbox';
  const INBOX_URL = 'https://gift.kakao.com/giftbox/inbox?couponStatus=OPEN';
  const AUTO_REDIRECT_FROM_PATHS = ['/home', '/'];
  const DETAIL_PATH_RE = /^\/giftbox\/inbox\/detail\/(\d+)/;
  const EXTEND_BUTTON_TEXT = /(유효)?기간\s*연장/;
  const SCAN_DEBOUNCE_MS = 1500;
  const NAV_DELAY_MS = 1200;
  const EXTEND_REQUEST_WAIT_MS = 1500;

  let scanTimer = null;
  let isProcessing = false;

  function log(entry) {
    chrome.storage.local.get({ log: [] }, ({ log: prev }) => {
      const next = [{ time: Date.now(), ...entry }, ...prev].slice(0, 100);
      chrome.storage.local.set({ log: next });
    });
  }

  function getSettings() {
    return new Promise((resolve) => chrome.storage.local.get(DEFAULT_SETTINGS, resolve));
  }

  function getProcessed() {
    return new Promise((resolve) => chrome.storage.local.get({ processed: {} }, ({ processed }) => resolve(processed)));
  }

  function markProcessed(id) {
    chrome.storage.local.get({ processed: {} }, ({ processed }) => {
      processed[id] = Date.now();
      chrome.storage.local.set({ processed });
    });
  }

  // 연장 버튼이 없어서 건너뛴 항목을 팝업에서 계속 볼 수 있게 별도로 쌓아둔다.
  function addUnextendable(item) {
    return new Promise((resolve) => {
      chrome.storage.local.get({ unextendable: [] }, ({ unextendable }) => {
        const next = [{ ...item, time: Date.now() }, ...unextendable.filter((u) => u.id !== item.id)].slice(0, 50);
        chrome.storage.local.set({ unextendable: next }, resolve);
      });
    });
  }

  function getQueue() {
    return new Promise((resolve) => chrome.storage.local.get({ queue: [] }, ({ queue }) => resolve(queue)));
  }

  function setQueue(queue) {
    return new Promise((resolve) => chrome.storage.local.set({ queue }, resolve));
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  // 카카오 화면은 <button>/<a>가 아니라 <div>로 만든 가짜 버튼도 많다.
  // 태그 종류를 가리지 않고, 자식 요소가 없는(텍스트를 직접 담은) 최말단 요소만
  // 대상으로 텍스트를 매칭한다 — 그래야 텍스트를 감싸는 큰 컨테이너를 잘못 클릭하지 않는다.
  function isLeaf(el) {
    return el.children.length === 0;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function findExtendButton() {
    const all = [...document.querySelectorAll('*')].filter(isLeaf);
    for (const el of all) {
      const text = el.textContent.trim().replace(/\s+/g, ' ');
      if (EXTEND_BUTTON_TEXT.test(text) && text.length < 20 && isVisible(el)) return el;
    }
    return null;
  }

  // confirm-override.js가 MAIN world에서 window.confirm을 자동 확인으로 덮어써두므로
  // 클릭하면 네이티브 확인창 없이 바로 연장 요청이 진행된다. 요청이 끝날 시간만 잠깐 준다.
  async function attemptExtend() {
    const btn = findExtendButton();
    if (!btn) return 'no_button';
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    await sleep(EXTEND_REQUEST_WAIT_MS);
    return 'success';
  }

  function parseDaysRemaining(text) {
    const m = text.match(/D-(\d+|DAY)\b/);
    if (!m) return null;
    return m[1] === 'DAY' ? 0 : Number(m[1]);
  }

  // 실제 구조 확인 결과 <span class="badge_deadline">D-16</span>은
  // <a class="link_receive" href="/giftbox/inbox/detail/...">의 자손이다.
  // closest()로 그 조상 링크를 바로 찾는다.
  function collectListItems() {
    const badges = document.querySelectorAll('.badge_deadline');
    const items = [];
    const seen = new Set();
    badges.forEach((badge) => {
      const remaining = parseDaysRemaining(badge.textContent);
      if (remaining === null) return;
      const link = badge.closest('a[href*="/giftbox/inbox/detail/"]');
      if (!link) return;
      const href = link.getAttribute('href');
      const m = href && href.match(/detail\/(\d+)/);
      if (!m) return;
      const id = m[1];
      if (seen.has(id)) return;
      seen.add(id);
      items.push({
        id,
        url: new URL(href, location.origin).href,
        remaining,
        name: link.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) || badge.parentElement.textContent.trim().slice(0, 40),
      });
    });
    return items;
  }

  async function scanListPage(force) {
    if (isProcessing) return { skipped: true };
    isProcessing = true;
    try {
      const settings = await getSettings();
      if (!settings.autoRun && !force) return { skipped: true };
      chrome.storage.local.set({ lastRunAt: Date.now(), reminderNotifiedFor: null });
      const processed = await getProcessed();
      const all = collectListItems();
      const items = all.filter(
        (i) => i.remaining >= 0 && i.remaining <= settings.thresholdDays && !processed[i.id]
      );
      if (items.length === 0) {
        return { totalCards: all.length, eligible: 0 };
      }
      await setQueue(items);
      chrome.storage.local.set({ runNoButtonIds: [] });
      location.href = items[0].url;
      return { totalCards: all.length, eligible: items.length, navigating: true };
    } finally {
      isProcessing = false;
    }
  }

  // 목록에서 큐에 담아 보낸 상세 화면에서만 자동으로 동작한다.
  // 사용자가 직접 다른 기프티콘 상세 화면을 열었을 때는 아무것도 하지 않는다.
  async function processDetailPage(id) {
    if (isProcessing) return;
    isProcessing = true;
    try {
      const queue = await getQueue();
      const current = queue.find((i) => i.id === id);
      if (!current) return;

      const status = await attemptExtend();
      markProcessed(id);
      log({ name: current.name, remaining: current.remaining, status });
      if (status === 'no_button') {
        await addUnextendable({ id, name: current.name });
        await new Promise((resolve) => {
          chrome.storage.local.get({ runNoButtonIds: [] }, ({ runNoButtonIds }) => {
            chrome.storage.local.set({ runNoButtonIds: [...runNoButtonIds, id] }, resolve);
          });
        });
      }

      const rest = queue.filter((i) => i.id !== id);
      await setQueue(rest);
      if (rest.length === 0) {
        const { runNoButtonIds } = await new Promise((resolve) =>
          chrome.storage.local.get({ runNoButtonIds: [] }, resolve)
        );
        if (runNoButtonIds.length > 0) {
          chrome.runtime.sendMessage({ type: 'NOTIFY_UNEXTENDABLE', count: runNoButtonIds.length });
        }
        chrome.storage.local.set({ runNoButtonIds: [] });
      }
      await sleep(NAV_DELAY_MS);
      location.href = rest.length > 0 ? rest[0].url : INBOX_URL;
    } finally {
      isProcessing = false;
    }
  }

  // 팝업의 "지금 검사 및 연장" 수동 실행: 상세 화면이면 큐 여부와 무관하게 바로 시도한다.
  async function processDetailPageManual(id) {
    if (isProcessing) return { skipped: true };
    isProcessing = true;
    try {
      const status = await attemptExtend();
      markProcessed(id);
      log({ name: id, remaining: null, status });
      if (status === 'no_button') {
        await addUnextendable({ id, name: id });
      }
      return { status };
    } finally {
      isProcessing = false;
    }
  }

  async function maybeRedirectToInbox() {
    const settings = await getSettings();
    if (!settings.autoRun) return false;
    if (location.pathname === INBOX_PATH) return false;
    if (AUTO_REDIRECT_FROM_PATHS.includes(location.pathname)) {
      location.href = INBOX_URL;
      return true;
    }
    return false;
  }

  function scheduleScan(fn) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(fn, SCAN_DEBOUNCE_MS);
  }

  async function init() {
    const detailMatch = location.pathname.match(DETAIL_PATH_RE);
    if (detailMatch) {
      const id = detailMatch[1];
      const trigger = () => processDetailPage(id);
      const observer = new MutationObserver(() => scheduleScan(trigger));
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleScan(trigger);
      return;
    }
    if (location.pathname === INBOX_PATH) {
      const trigger = () => scanListPage(false);
      const observer = new MutationObserver(() => scheduleScan(trigger));
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleScan(trigger);
      return;
    }
    await maybeRedirectToInbox();
  }

  init();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'RUN_SCAN') {
      const detailMatch = location.pathname.match(DETAIL_PATH_RE);
      const task = detailMatch ? () => processDetailPageManual(detailMatch[1]) : () => scanListPage(true);
      task().then((result) => sendResponse({ ok: true, result }));
      return true;
    }
  });
})();
