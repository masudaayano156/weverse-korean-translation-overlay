// 위버스 페이지가 원래 받아오는 게시물 응답에서 공개 방송 시작 시각만 읽습니다.
// 요청이나 응답은 변경하지 않으며, 확장프로그램이 별도 서명 요청을 보내지 않습니다.
(function hookWeversePostResponses() {
  "use strict";

  const HOOK_MARKER = Symbol.for("weverse-korean-overlay-page-hooked");
  if (window.top !== window || window[HOOK_MARKER]) {
    return;
  }
  Object.defineProperty(window, HOOK_MARKER, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });

  const MESSAGE_SOURCE = "weverse-korean-overlay-page-hook";
  const REQUEST_SOURCE = "weverse-korean-overlay-content";
  const REQUEST_TYPE = "request-timing";
  const PRIVACY_TYPE = "privacy-consent";
  const POST_PATH_PATTERN = /\/post\/v1\.0\/post-([0-9]+-[0-9]+)(?:[/?#]|$)/;
  const MAX_RECENT_TIMINGS = 20;
  const ALLOWED_RESPONSE_ORIGINS = new Set([
    window.location.origin,
    "https://global.apis.naver.com"
  ]);
  const xhrPostId = Symbol("weverseKoreanOverlayPostId");
  const xhrObservation = Symbol("weverseKoreanOverlayObservation");
  const recentTimings = new Map();
  let privacyConsent = false;
  let consentRevision = 0;

  function postIdFromUrl(url) {
    let parsedUrl;
    try {
      parsedUrl = new URL(String(url || ""), window.location.href);
    } catch (_error) {
      return null;
    }
    if (!ALLOWED_RESPONSE_ORIGINS.has(parsedUrl.origin)) {
      return null;
    }
    const match = POST_PATH_PATTERN.exec(parsedUrl.pathname);
    return match ? match[1] : null;
  }

  function isReasonableTimestamp(value) {
    const timestamp = Number(value);
    const earliest = Date.UTC(2018, 0, 1);
    return Number.isFinite(timestamp) &&
      timestamp >= earliest &&
      timestamp <= Date.now() + 24 * 60 * 60 * 1000;
  }

  function postTiming(postId, timing) {
    if (!/^[0-9]+-[0-9]+$/.test(String(postId || ""))) {
      return;
    }
    const onAirStartAt = Number(timing?.onAirStartAt);
    if (!isReasonableTimestamp(onAirStartAt)) {
      return;
    }
    const publishedAt = Number(timing?.publishedAt);
    const videoType = String(timing?.videoType || "").toUpperCase();
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        postId,
        onAirStartAt,
        publishedAt: isReasonableTimestamp(publishedAt)
          ? publishedAt
          : onAirStartAt,
        liveToVod: timing?.liveToVod === true,
        videoType: videoType === "LIVE" || videoType === "VOD"
          ? videoType
          : ""
      },
      window.location.origin
    );
  }

  function publish(postId, payload) {
    const wrappedPost = payload?.data;
    const post = wrappedPost?.extension?.video
      ? wrappedPost
      : payload;
    const video = post?.extension?.video;
    const onAirStartAt = Number(video?.onAirStartAt);
    if (!isReasonableTimestamp(onAirStartAt)) {
      return;
    }
    const publishedAt = Number(post?.publishedAt);
    const timing = {
      onAirStartAt,
      publishedAt: isReasonableTimestamp(publishedAt)
        ? publishedAt
        : onAirStartAt,
      liveToVod: video?.liveToVod === true,
      videoType: ["LIVE", "VOD"].includes(
        String(video?.type || "").toUpperCase()
      )
        ? String(video.type).toUpperCase()
        : ""
    };
    recentTimings.delete(postId);
    recentTimings.set(postId, timing);
    while (recentTimings.size > MAX_RECENT_TIMINGS) {
      recentTimings.delete(recentTimings.keys().next().value);
    }
    postTiming(postId, timing);
  }

  function inspectText(postId, text) {
    try {
      publish(postId, JSON.parse(text));
    } catch (_error) {
      // 게시물 JSON이 아니거나 형식이 변경되면 기존 대체 시각을 사용합니다.
    }
  }

  // 콘텐츠 스크립트가 준비되기 전에 응답을 읽었을 수 있으므로 현재 방송의
  // 시각을 요청받으면 최근 캐시에서 다시 전달합니다.
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }
    const data = event.data;
    if (
      data?.source === REQUEST_SOURCE &&
      data?.type === PRIVACY_TYPE &&
      typeof data.granted === "boolean"
    ) {
      if (privacyConsent !== data.granted) {
        consentRevision += 1;
      }
      privacyConsent = data.granted;
      if (!privacyConsent) {
        recentTimings.clear();
      }
      return;
    }
    if (
      !privacyConsent ||
      !data ||
      data.source !== REQUEST_SOURCE ||
      data.type !== REQUEST_TYPE ||
      !/^[0-9]+-[0-9]+$/.test(String(data.postId || ""))
    ) {
      return;
    }
    const timing = recentTimings.get(data.postId);
    if (timing) {
      postTiming(data.postId, timing);
    }
  });

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function patchedFetch(input) {
      const result = Reflect.apply(originalFetch, this, arguments);
      const requestRevision = consentRevision;
      const startedWithConsent = privacyConsent;
      try {
        const requestUrl = typeof input === "string" || input instanceof URL
          ? String(input)
          : input?.url;
        const postId = postIdFromUrl(requestUrl);
        if (postId) {
          result.then(
            (response) => {
              // 요청이 먼저 시작됐어도 응답 도착 전에 동의가 완료되면 읽을 수
              // 있습니다. 철회 전 요청은 재동의 후에도 다시 채택하지 않습니다.
              if (
                !privacyConsent ||
                consentRevision !== requestRevision + (startedWithConsent ? 0 : 1)
              ) {
                return;
              }
              const responseRevision = consentRevision;
              try {
                response.clone().text().then(
                  (text) => {
                    if (privacyConsent && consentRevision === responseRevision) {
                      inspectText(postId, text);
                    }
                  },
                  () => {}
                );
              } catch (_error) {
                // 응답을 복제할 수 없어도 원래 페이지 요청은 그대로 유지합니다.
              }
            },
            () => {}
          );
        }
      } catch (_error) {
        // 관찰 실패가 위버스 요청에 영향을 주지 않도록 무시합니다.
      }
      return result;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  function clearXhrObservation(xhr, expectedObservation) {
    const observation = xhr[xhrObservation];
    if (
      !observation ||
      (expectedObservation && observation !== expectedObservation)
    ) {
      return;
    }
    xhr[xhrObservation] = null;
    try {
      xhr.removeEventListener("load", observation.onLoad);
      xhr.removeEventListener("abort", observation.onDone);
      xhr.removeEventListener("error", observation.onDone);
      xhr.removeEventListener("timeout", observation.onDone);
      xhr.removeEventListener("loadend", observation.onDone);
    } catch (_error) {
      // 페이지의 XHR 구현이 이미 정리된 경우입니다.
    }
  }

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    clearXhrObservation(this);
    try {
      this[xhrPostId] = postIdFromUrl(url);
    } catch (_error) {
      this[xhrPostId] = null;
    }
    return Reflect.apply(originalOpen, this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend() {
    clearXhrObservation(this);
    try {
      const postId = this[xhrPostId];
      if (postId) {
        const observation = {};
        const requestRevision = consentRevision;
        const startedWithConsent = privacyConsent;
        const onDone = () => clearXhrObservation(this, observation);
        const onLoad = () => {
          if (
            !privacyConsent ||
            consentRevision !== requestRevision + (startedWithConsent ? 0 : 1) ||
            this[xhrObservation] !== observation ||
            this[xhrPostId] !== postId
          ) {
            return;
          }
          try {
            try {
              if (this.responseType === "" || this.responseType === "text") {
                inspectText(postId, this.responseText);
              } else if (this.responseType === "json") {
                publish(postId, this.response);
              }
            } catch (_error) {
              // 읽을 수 없는 응답 형식이면 기존 대체 시각을 사용합니다.
            }
          } finally {
            clearXhrObservation(this, observation);
          }
        };
        observation.onLoad = onLoad;
        observation.onDone = onDone;
        this[xhrObservation] = observation;
        this.addEventListener("load", onLoad);
        this.addEventListener("abort", onDone);
        this.addEventListener("error", onDone);
        this.addEventListener("timeout", onDone);
        this.addEventListener("loadend", onDone);
      }
    } catch (_error) {
      // 관찰 실패가 위버스 요청에 영향을 주지 않도록 무시합니다.
    }
    try {
      return Reflect.apply(originalSend, this, arguments);
    } catch (error) {
      clearXhrObservation(this);
      throw error;
    }
  };
})();
