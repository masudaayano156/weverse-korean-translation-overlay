(function managePrivacyConsent() {
  "use strict";

  const PRIVACY_CONSENT_KEY = "weverseOverlayPrivacyConsentV1";
  const PRIVACY_CONSENT_AT_KEY = "weverseOverlayPrivacyConsentAtV1";
  const ANONYMOUS_CLIENT_ID_KEY = "weverseOverlayReactionClientIdV1";
  const PRIVACY_CONSENT_VERSION = 1;
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const agreementCheck = document.getElementById("agreement-check");
  const acceptButton = document.getElementById("accept-button");
  const revokeButton = document.getElementById("revoke-button");
  const consentStatus = document.getElementById("consent-status");

  function setStatus(granted, message = "") {
    consentStatus.classList.toggle("active", granted);
    consentStatus.textContent = message || (granted
      ? "현재 동의 상태입니다. 확장프로그램의 번역 기능을 사용할 수 있습니다."
      : "현재 동의하지 않은 상태입니다. 번역 서버와 연결하지 않습니다.");
    revokeButton.disabled = !granted;
  }

  function isValidUuid(value) {
    return UUID_PATTERN.test(String(value || ""));
  }

  agreementCheck.addEventListener("change", (event) => {
    if (!event.isTrusted) {
      return;
    }
    acceptButton.disabled = !agreementCheck.checked;
  });

  acceptButton.addEventListener("click", (event) => {
    if (!event.isTrusted || !agreementCheck.checked) {
      return;
    }
    acceptButton.disabled = true;
    chrome.storage.local.get([ANONYMOUS_CLIENT_ID_KEY], (result) => {
      if (chrome.runtime.lastError) {
        setStatus(false, "동의 상태를 저장하지 못했습니다. 확장프로그램을 다시 로드한 뒤 시도해 주세요.");
        acceptButton.disabled = false;
        return;
      }
      const storedClientId = result?.[ANONYMOUS_CLIENT_ID_KEY];
      const clientId = isValidUuid(storedClientId)
        ? storedClientId
        : crypto.randomUUID();
      chrome.storage.local.set(
        {
          [PRIVACY_CONSENT_KEY]: PRIVACY_CONSENT_VERSION,
          [PRIVACY_CONSENT_AT_KEY]: new Date().toISOString(),
          [ANONYMOUS_CLIENT_ID_KEY]: clientId
        },
        () => {
          if (chrome.runtime.lastError) {
            setStatus(false, "동의 상태를 저장하지 못했습니다. 확장프로그램을 다시 로드한 뒤 시도해 주세요.");
            acceptButton.disabled = false;
            return;
          }
          agreementCheck.checked = false;
          setStatus(true, "동의가 저장되었습니다. 열려 있던 방송 화면으로 돌아가면 번역이 자동으로 연결됩니다.");
        }
      );
    });
  });

  revokeButton.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    revokeButton.disabled = true;
    chrome.storage.local.remove(
      [
        PRIVACY_CONSENT_KEY,
        PRIVACY_CONSENT_AT_KEY,
        ANONYMOUS_CLIENT_ID_KEY
      ],
      () => {
        if (chrome.runtime.lastError) {
          setStatus(true, "동의 철회 상태를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
          revokeButton.disabled = false;
          return;
        }
        agreementCheck.checked = false;
        acceptButton.disabled = true;
        setStatus(false, "동의를 철회하고 확장프로그램에 저장된 익명 번호를 삭제했습니다. 서버 연결도 중지됩니다.");
      }
    );
  });

  chrome.storage.local.get([PRIVACY_CONSENT_KEY], (result) => {
    if (chrome.runtime.lastError) {
      setStatus(false, "현재 상태를 확인하지 못했습니다. 확장프로그램을 다시 로드해 주세요.");
      return;
    }
    setStatus(
      Number(result?.[PRIVACY_CONSENT_KEY]) === PRIVACY_CONSENT_VERSION
    );
  });
})();
