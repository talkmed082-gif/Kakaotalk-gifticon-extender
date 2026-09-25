const DEFAULT_SETTINGS = { autoRun: true, thresholdDays: 30 };
const UPDATE_REMINDER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function renderLastRun(lastRunAt) {
  const el = document.getElementById('lastRun');
  if (!lastRunAt) {
    el.textContent = '아직 실행 기록이 없습니다.';
    el.classList.remove('overdue');
    return;
  }
  const daysSince = Math.floor((Date.now() - lastRunAt) / DAY_MS);
  const dateLabel = new Date(lastRunAt).toLocaleDateString('ko-KR');
  if (daysSince <= 0) {
    el.textContent = `마지막 검사: 오늘 (${dateLabel})`;
  } else {
    el.textContent = `마지막 검사: ${daysSince}일 전 (${dateLabel})`;
  }
  el.classList.toggle('overdue', daysSince >= UPDATE_REMINDER_DAYS);
  if (daysSince >= UPDATE_REMINDER_DAYS) {
    el.textContent += ` — ${UPDATE_REMINDER_DAYS}일 이상 지났어요, 한 번 확인해보세요.`;
  }
}

function render() {
  chrome.storage.local.get({ ...DEFAULT_SETTINGS, log: [], lastRunAt: null }, ({ autoRun, thresholdDays, log, lastRunAt }) => {
    document.getElementById('autoRun').checked = autoRun;
    document.getElementById('threshold').value = thresholdDays;
    document.getElementById('thresholdLabel').textContent = thresholdDays;
    renderLastRun(lastRunAt);
    const logEl = document.getElementById('log');
    logEl.innerHTML = log.length
      ? log
          .map(
            (e) =>
              `<div class="entry ${e.status}">${new Date(e.time).toLocaleString('ko-KR')} · ${
                e.name
              } (D-${e.remaining}) · ${e.status === 'success' ? '연장 완료' : '버튼 클릭됨(확인 필요)'}</div>`
          )
          .join('')
      : '<div>기록 없음</div>';
  });
}

document.getElementById('autoRun').addEventListener('change', (e) => {
  chrome.storage.local.set({ autoRun: e.target.checked });
});

document.getElementById('threshold').addEventListener('change', (e) => {
  const v = Math.max(1, Math.min(90, Number(e.target.value) || 30));
  chrome.storage.local.set({ thresholdDays: v });
  document.getElementById('thresholdLabel').textContent = v;
});

document.getElementById('resetProcessed').addEventListener('click', () => {
  chrome.storage.local.set({ processed: {} }, () => {
    document.getElementById('status').textContent = '처리 기록이 초기화되었습니다.';
  });
});

document.getElementById('runNow').addEventListener('click', () => {
  document.getElementById('status').textContent = '검사 중...';
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab || !tab.url || !tab.url.includes('gift.kakao.com')) {
      document.getElementById('status').textContent = 'gift.kakao.com 탭에서 실행하세요.';
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'RUN_SCAN' }, () => {
      document.getElementById('status').textContent = '검사 완료';
      render();
    });
  });
});

render();
chrome.storage.onChanged.addListener(render);
