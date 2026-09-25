// 카카오 "기간 연장" 버튼은 DOM 팝업이 아니라 브라우저 네이티브 confirm()을 띄운다.
// 네이티브 confirm/alert는 스크립트로 클릭할 수 없고, 뜨는 동안 페이지 전체가 멈춘다.
// 그래서 페이지 스크립트가 실행되기 전(document_start, MAIN world)에 미리 자동 확인으로 덮어쓴다.
window.confirm = function () {
  return true;
};
window.alert = function () {};
