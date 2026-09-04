(function syncTranslatorAnonymousClientId() {
  "use strict";

  const SITE_CLIENT_ID_KEY = "client-id";
  const EXTENSION_CLIENT_ID_KEY = "weverseOverlayReactionClientIdV1";
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isValidUuid(value) {
    return UUID_PATTERN.test(String(value || ""));
  }

  let clientId = "";
  try {
    const siteClientId = localStorage.getItem(SITE_CLIENT_ID_KEY);
    clientId = isValidUuid(siteClientId)
      ? siteClientId
      : crypto.randomUUID();
    if (clientId !== siteClientId) {
      localStorage.setItem(SITE_CLIENT_ID_KEY, clientId);
    }
  } catch (_error) {
    // 사이트 저장소가 차단된 경우에는 기존 확장프로그램 번호를 유지합니다.
    return;
  }

  chrome.storage.local.set({ [EXTENSION_CLIENT_ID_KEY]: clientId });
})();
