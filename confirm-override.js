// 카카오 "기간 연장" 버튼은 DOM 팝업이 아니라 브라우저 네이티브 confirm()을 띄운다.
// 네이티브 confirm/alert는 스크립트로 클릭할 수 없고, 뜨는 동안 페이지 전체가 멈춘다.
// 그래서 페이지 스크립트가 실행되기 전(document_start, MAIN world)에 confirm/alert를 감싸 두되,
// content.js가 "기간 연장"을 누르기 직전에 켜 둔 표시(data-gx-armed)가 살아 있을 때만 자동 확인한다.
// 그 밖의 확인창(사용자가 직접 누른 환불·취소 등)은 원래대로 사용자에게 묻는다.
(function () {
  const ARMED_ATTR = 'data-gx-armed';
  const ARMED_TTL_MS = 10000;
  const originalConfirm = window.confirm;
  const originalAlert = window.alert;

  function isArmed() {
    const armedAt = Number(document.documentElement.getAttribute(ARMED_ATTR));
    return armedAt > 0 && Date.now() - armedAt <= ARMED_TTL_MS;
  }

  window.confirm = function (message) {
    return isArmed() ? true : originalConfirm.call(window, message);
  };

  window.alert = function (message) {
    if (isArmed()) return;
    return originalAlert.call(window, message);
  };
})();
