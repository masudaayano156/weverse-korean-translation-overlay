"use strict";

const QUERY_URL = "https://api.cutiestreet.kro.kr/api/query";
const QUERY_TIMEOUT_MS = 10000;
const ALLOWED_CONTENT_ORIGINS = new Set([
  "https://weverse.io",
  "https://www.instagram.com"
]);
const ALLOWED_QUERY_PATHS = new Set([
  "sessions:live",
  "sessions:list",
  "messages:list"
]);

function sanitizeQuery(path, rawArgs) {
  if (!ALLOWED_QUERY_PATHS.has(path)) {
    throw new Error("허용되지 않은 번역 데이터 요청입니다.");
  }

  if (path === "sessions:live") {
    return {};
  }

  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
  if (path === "sessions:list") {
    const requestedLimit = Number(args.limit);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(200, Math.max(1, Math.round(requestedLimit)))
      : 100;
    return { limit };
  }

  const sessionId = typeof args.sessionId === "string" ? args.sessionId : "";
  if (!/^[a-z0-9]{16,64}$/i.test(sessionId)) {
    throw new Error("번역 세션 번호가 올바르지 않습니다.");
  }

  const requestedLimit = Number(args.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(5000, Math.max(1, Math.round(requestedLimit)))
    : 80;

  return { sessionId, limit };
}

async function queryTranslator(path, rawArgs) {
  const args = sanitizeQuery(path, rawArgs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const response = await fetch(QUERY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, args, format: "json" }),
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`번역 서버 응답 오류 (${response.status})`);
    }

    const payload = await response.json();
    if (!payload || payload.status !== "success") {
      throw new Error("번역 서버가 요청을 처리하지 못했습니다.");
    }
    return payload.value;
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("번역 서버 응답 시간이 초과되었습니다.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isAllowedContentSender(sender) {
  const senderUrl = String(sender?.tab?.url || sender?.url || "");
  try {
    return ALLOWED_CONTENT_ORIGINS.has(new URL(senderUrl).origin);
  } catch (_error) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || request.type !== "cutiestreet-query") {
    return false;
  }
  if (!isAllowedContentSender(sender)) {
    return false;
  }

  queryTranslator(request.path, request.args)
    .then((value) => sendResponse({ ok: true, value }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "번역 데이터를 읽지 못했습니다."
      });
    });
  return true;
});

async function toggleOverlayInTab(tab) {
  if (!tab || !Number.isInteger(tab.id)) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggle-cutiestreet-overlay" });
  } catch (_error) {
    // 지원 사이트가 아니거나 아직 콘텐츠 스크립트가 준비되지 않은 경우입니다.
  }
}

chrome.action.onClicked.addListener((tab) => {
  void toggleOverlayInTab(tab);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-overlay") {
    return;
  }
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await toggleOverlayInTab(activeTab);
});
