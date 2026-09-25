// lastRunAt(마지막 검사 실행 시각) 기준으로 30일이 지나면 알림을 보낸다.
const THRESHOLD_DAYS = 30;
const CHECK_ALARM_NAME = 'gifticon-update-check';
const DAY_MS = 24 * 60 * 60 * 1000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ lastRunAt: null }, ({ lastRunAt }) => {
    if (!lastRunAt) {
      chrome.storage.local.set({ lastRunAt: Date.now() });
    }
  });
  chrome.alarms.create(CHECK_ALARM_NAME, { periodInMinutes: 60 * 24 });
  checkAndNotify();
});

chrome.runtime.onStartup.addListener(() => {
  checkAndNotify();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM_NAME) {
    checkAndNotify();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'NOTIFY_UNEXTENDABLE' && msg.count > 0) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title: '연장할 수 없는 기프티콘이 있어요',
      message: `${msg.count}개는 "기간 연장" 버튼이 없어 건너뛰었습니다. 팝업에서 목록을 확인하세요.`,
      priority: 1,
    });
  }
});

function checkAndNotify() {
  chrome.storage.local.get({ lastRunAt: null, reminderNotifiedFor: null }, ({ lastRunAt, reminderNotifiedFor }) => {
    if (!lastRunAt) return;
    const daysSince = Math.floor((Date.now() - lastRunAt) / DAY_MS);
    if (daysSince >= THRESHOLD_DAYS && reminderNotifiedFor !== lastRunAt) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon128.png',
        title: '카카오 기프티콘 확인이 필요해요',
        message: `마지막 검사 후 ${daysSince}일이 지났습니다. gift.kakao.com에서 다시 확인해보세요.`,
        priority: 1,
      });
      chrome.storage.local.set({ reminderNotifiedFor: lastRunAt });
    }
  });
}
