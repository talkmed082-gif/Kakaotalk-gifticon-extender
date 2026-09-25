// gift.kakao.com 화면에서 "유효기간 연장" 버튼을 찾아 자동으로 클릭한다.
// 카카오의 실제 클래스명은 알 수 없고(리액트 앱이라 빌드마다 해시가 바뀜) 바뀔 수도 있으므로,
// 화면에 보이는 텍스트를 기준으로 동작한다. 문구가 다르면 아래 정규식을 수정해야 한다.
(function () {
  const DEFAULT_SETTINGS = { autoRun: true, thresholdDays: 30 };
  const EXTEND_BUTTON_TEXT = /유효기간\s*연장/;
  const CONFIRM_TEXT = /(연장하기|연장\s*신청|신청하기|확인)/;
  const CANCEL_TEXT = /(취소|닫기|아니요)/;
  const SCAN_DEBOUNCE_MS = 1500;
  const CLICK_DELAY_MS = 2000;
  const MODAL_WAIT_MS = 4000;

  let scanTimer = null;
  let isProcessing = false;

  function log(entry) {
    chrome.storage.local.get({ log: [] }, ({ log: prev }) => {
      const next = [{ time: Date.now(), ...entry }, ...prev].slice(0, 100);
      chrome.storage.local.set({ log: next });
    });
  }

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(DEFAULT_SETTINGS, resolve);
    });
  }

  function getProcessed() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ processed: {} }, ({ processed }) => resolve(processed));
    });
  }

  function markProcessed(key) {
    chrome.storage.local.get({ processed: {} }, ({ processed }) => {
      processed[key] = Date.now();
      chrome.storage.local.set({ processed });
    });
  }

  function hashKey(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) | 0;
    }
    return String(h);
  }

  function parseExpiry(text) {
    const withSuffix = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\s*까지/);
    const m = withSuffix || text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (!m) return null;
    const [, y, mo, d] = m;
    const date = new Date(Number(y), Number(mo) - 1, Number(d));
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function daysUntil(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function collectExtendButtons() {
    const all = document.querySelectorAll('button, a, [role="button"]');
    const result = [];
    all.forEach((el) => {
      const text = el.textContent.trim().replace(/\s+/g, ' ');
      if (EXTEND_BUTTON_TEXT.test(text) && text.length < 20 && isVisible(el)) {
        result.push(el);
      }
    });
    return result;
  }

  function findCardContext(button) {
    let node = button;
    for (let i = 0; i < 8 && node.parentElement; i++) {
      node = node.parentElement;
      if (/\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(node.textContent)) {
        return node;
      }
    }
    return button.parentElement || button;
  }

  function findMatchInNewNodes(mutationsList, matcher) {
    for (const mutation of mutationsList) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        const candidates = node.matches && node.matches('button, a, [role="button"]')
          ? [node, ...node.querySelectorAll('button, a, [role="button"]')]
          : [...node.querySelectorAll('button, a, [role="button"]')];
        for (const el of candidates) {
          const text = el.textContent.trim();
          if (matcher(text) && isVisible(el)) return el;
        }
      }
    }
    return null;
  }

  function waitForConfirmClick() {
    return new Promise((resolve) => {
      let done = false;
      const observer = new MutationObserver((mutations) => {
        if (done) return;
        const confirmBtn = findMatchInNewNodes(
          mutations,
          (t) => CONFIRM_TEXT.test(t) && !CANCEL_TEXT.test(t)
        );
        if (confirmBtn) {
          done = true;
          observer.disconnect();
          confirmBtn.click();
          resolve(true);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        if (!done) {
          done = true;
          observer.disconnect();
          resolve(false);
        }
      }, MODAL_WAIT_MS);
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function scan(force) {
    if (isProcessing) return;
    isProcessing = true;
    try {
      const settings = await getSettings();
      if (!settings.autoRun && !force) return;
      const processed = await getProcessed();
      const buttons = collectExtendButtons();

      for (const btn of buttons) {
        const card = findCardContext(btn);
        const cardText = card.textContent.replace(/\s+/g, ' ').trim();
        const key = hashKey(cardText.slice(0, 200));
        if (processed[key]) continue;

        const expiry = parseExpiry(cardText);
        if (!expiry) continue;
        const remaining = daysUntil(expiry);
        if (remaining < 0 || remaining > settings.thresholdDays) continue;

        const nameGuess = cardText.slice(0, 40);
        btn.scrollIntoView({ block: 'center' });
        btn.click();

        const confirmed = await waitForConfirmClick();
        markProcessed(key);
        log({
          name: nameGuess,
          expiry: expiry.toISOString().slice(0, 10),
          remaining,
          status: confirmed ? 'success' : 'clicked_no_modal',
        });

        await sleep(CLICK_DELAY_MS);
      }
    } finally {
      isProcessing = false;
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan(false), SCAN_DEBOUNCE_MS);
  }

  const pageObserver = new MutationObserver(() => scheduleScan());
  pageObserver.observe(document.body, { childList: true, subtree: true });
  scheduleScan();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'RUN_SCAN') {
      scan(true).then(() => sendResponse({ ok: true }));
      return true;
    }
  });
})();
