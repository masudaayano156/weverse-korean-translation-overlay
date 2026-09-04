"use strict";

importScripts("vendor/convex.js");

const CONVEX_URL = "https://api.cutiestreet.kro.kr";
const QUERY_URL = `${CONVEX_URL}/api/query`;
const QUERY_TIMEOUT_MS = 10000;
const PRESENCE_HEARTBEAT_MS = 60 * 1000;
const PRESENCE_SURFACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID_PATTERN = /^[a-z0-9]{16,64}$/i;
const ANONYMOUS_CLIENT_ID_KEY = "weverseOverlayReactionClientIdV1";
const PRIVACY_CONSENT_KEY = "weverseOverlayPrivacyConsentV1";
const PRIVACY_CONSENT_VERSION = 1;
const ALLOWED_CONTENT_ORIGINS = new Set([
  "https://weverse.io",
  "https://www.instagram.com"
]);
const ALLOWED_QUERY_PATHS = new Set([
  "sessions:live",
  "sessions:list",
  "messages:list"
]);

const presenceState = {
  client: null,
  clientCloseTimer: null,
  userId: "",
  userIdPromise: null,
  surfaces: new Map(),
  rooms: new Map(),
  disconnectedTokens: new Set(),
  heartbeatTimer: null,
  reconcilePromise: Promise.resolve()
};

let privacyConsentGranted = null;
let privacyConsentRevision = 0;
const activeQueryControllers = new Set();

function isValidUuid(value) {
  return PRESENCE_SURFACE_ID_PATTERN.test(String(value || ""));
}

function isValidSessionId(value) {
  return SESSION_ID_PATTERN.test(String(value || ""));
}

function validPresenceToken(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 2048
    ? value
    : "";
}

function readLocalValue(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      if (chrome.runtime.lastError) {
        resolve("");
        return;
      }
      resolve(result?.[key] || "");
    });
  });
}

function writeLocalValue(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
}

async function hasPrivacyConsent() {
  if (typeof privacyConsentGranted === "boolean") {
    return privacyConsentGranted;
  }
  const revision = privacyConsentRevision;
  const storedConsent = await readLocalValue(PRIVACY_CONSENT_KEY);
  if (revision !== privacyConsentRevision) {
    return privacyConsentGranted === true;
  }
  privacyConsentGranted = Number(storedConsent) === PRIVACY_CONSENT_VERSION;
  return privacyConsentGranted;
}

async function ensureAnonymousClientId() {
  const consentRevision = privacyConsentRevision;
  if (
    !(await hasPrivacyConsent()) ||
    consentRevision !== privacyConsentRevision
  ) {
    throw new Error("개인정보 안내 동의가 필요합니다.");
  }
  if (isValidUuid(presenceState.userId)) {
    return presenceState.userId;
  }
  if (presenceState.userIdPromise) {
    return presenceState.userIdPromise;
  }
  const userIdPromise = (async () => {
    const requestRevision = privacyConsentRevision;
    const storedId = await readLocalValue(ANONYMOUS_CLIENT_ID_KEY);
    if (
      requestRevision !== privacyConsentRevision ||
      privacyConsentGranted !== true
    ) {
      throw new Error("개인정보 안내 동의가 필요합니다.");
    }
    if (isValidUuid(presenceState.userId)) {
      return presenceState.userId;
    }
    const userId = isValidUuid(storedId) ? storedId : crypto.randomUUID();
    if (userId !== storedId) {
      const stored = await writeLocalValue(ANONYMOUS_CLIENT_ID_KEY, userId);
      if (!stored) {
        throw new Error("익명 접속 번호를 저장하지 못했습니다.");
      }
    }
    if (
      requestRevision !== privacyConsentRevision ||
      privacyConsentGranted !== true
    ) {
      if (privacyConsentGranted !== true && userId !== storedId) {
        chrome.storage.local.remove([ANONYMOUS_CLIENT_ID_KEY]);
      }
      throw new Error("개인정보 안내 동의가 필요합니다.");
    }
    presenceState.userId = userId;
    return userId;
  })();
  presenceState.userIdPromise = userIdPromise;
  try {
    return await userIdPromise;
  } finally {
    if (presenceState.userIdPromise === userIdPromise) {
      presenceState.userIdPromise = null;
    }
  }
}

function presenceClient() {
  if (presenceState.clientCloseTimer !== null) {
    clearTimeout(presenceState.clientCloseTimer);
    presenceState.clientCloseTimer = null;
  }
  if (presenceState.client) {
    return presenceState.client;
  }
  const ClientConstructor = globalThis.convex?.ConvexClient;
  if (typeof ClientConstructor !== "function") {
    throw new Error("실시간 접속 집계 모듈을 불러오지 못했습니다.");
  }
  presenceState.client = new ClientConstructor(CONVEX_URL, {
    unsavedChangesWarning: false
  });
  return presenceState.client;
}

async function disconnectPresenceToken(sessionToken, client = presenceState.client) {
  const token = validPresenceToken(sessionToken);
  if (
    !token ||
    presenceState.disconnectedTokens.has(token) ||
    !client ||
    typeof client.mutation !== "function"
  ) {
    return;
  }
  presenceState.disconnectedTokens.add(token);
  while (presenceState.disconnectedTokens.size > 200) {
    presenceState.disconnectedTokens.delete(
      presenceState.disconnectedTokens.values().next().value
    );
  }
  try {
    await client.mutation("presence:disconnect", { sessionToken: token });
  } catch (_error) {
    // 실패한 연결은 서버가 선언된 60초 간격을 기준으로 만료시킵니다.
  }
}

async function beatPresenceRoom(room) {
  if (room.beating || presenceState.rooms.get(room.roomId) !== room) {
    return;
  }
  const consentRevision = privacyConsentRevision;
  room.beating = true;
  try {
    if (
      !(await hasPrivacyConsent()) ||
      consentRevision !== privacyConsentRevision
    ) {
      return;
    }
    const client = presenceClient();
    const result = await client.mutation("presence:heartbeat", {
      roomId: room.roomId,
      userId: room.userId,
      // heartbeat의 sessionId는 공개 방송 ID가 아니라 연결별 ID입니다.
      sessionId: room.connectionId,
      interval: PRESENCE_HEARTBEAT_MS
    });
    const roomToken = validPresenceToken(result?.roomToken);
    const sessionToken = validPresenceToken(result?.sessionToken);
    if (
      consentRevision !== privacyConsentRevision ||
      privacyConsentGranted !== true ||
      presenceState.rooms.get(room.roomId) !== room
    ) {
      await disconnectPresenceToken(sessionToken, client);
      return;
    }
    room.roomToken = roomToken;
    room.sessionToken = sessionToken;
  } catch (_error) {
    // 일시 실패는 다음 하트비트에서 다시 시도합니다.
  } finally {
    room.beating = false;
  }
}

function schedulePresenceClientClose() {
  if (
    presenceState.rooms.size > 0 ||
    !presenceState.client ||
    presenceState.clientCloseTimer !== null
  ) {
    return;
  }
  presenceState.clientCloseTimer = setTimeout(() => {
    presenceState.clientCloseTimer = null;
    if (presenceState.rooms.size > 0) {
      return;
    }
    const client = presenceState.client;
    presenceState.client = null;
    if (client && typeof client.close === "function") {
      try {
        Promise.resolve(client.close()).catch(() => {});
      } catch (_error) {
        // 이미 닫힌 연결은 무시합니다.
      }
    }
  }, 5000);
}

function updatePresenceHeartbeatTimer() {
  if (presenceState.rooms.size > 0 && presenceState.heartbeatTimer === null) {
    if (presenceState.clientCloseTimer !== null) {
      clearTimeout(presenceState.clientCloseTimer);
      presenceState.clientCloseTimer = null;
    }
    presenceState.heartbeatTimer = setInterval(() => {
      for (const room of presenceState.rooms.values()) {
        void beatPresenceRoom(room);
      }
    }, PRESENCE_HEARTBEAT_MS);
  } else if (
    presenceState.rooms.size === 0 &&
    presenceState.heartbeatTimer !== null
  ) {
    clearInterval(presenceState.heartbeatTimer);
    presenceState.heartbeatTimer = null;
  }
  if (presenceState.rooms.size === 0) {
    schedulePresenceClientClose();
  }
}

function activePresenceRoomIds() {
  return new Set(
    [...presenceState.surfaces.values()].map((surface) => surface.roomId)
  );
}

async function reconcilePresenceRooms() {
  const consentRevision = privacyConsentRevision;
  if (
    !(await hasPrivacyConsent()) ||
    consentRevision !== privacyConsentRevision
  ) {
    presenceState.surfaces.clear();
    updatePresenceHeartbeatTimer();
    return;
  }
  let activeRoomIds = activePresenceRoomIds();
  for (const [roomId, room] of [...presenceState.rooms]) {
    if (activeRoomIds.has(roomId)) {
      continue;
    }
    presenceState.rooms.delete(roomId);
    void disconnectPresenceToken(room.sessionToken, presenceState.client);
  }

  if (activeRoomIds.size > 0) {
    const userId = await ensureAnonymousClientId();
    if (
      consentRevision !== privacyConsentRevision ||
      privacyConsentGranted !== true
    ) {
      return;
    }
    activeRoomIds = activePresenceRoomIds();
    for (const roomId of activeRoomIds) {
      if (presenceState.rooms.has(roomId)) {
        continue;
      }
      const room = {
        roomId,
        userId,
        connectionId: JSON.stringify([crypto.randomUUID(), roomId, userId]),
        roomToken: null,
        sessionToken: null,
        beating: false
      };
      presenceState.rooms.set(roomId, room);
      void beatPresenceRoom(room);
    }
  }
  updatePresenceHeartbeatTimer();
}

async function stopAllPresence() {
  presenceState.surfaces.clear();
  const staleRooms = [...presenceState.rooms.values()];
  presenceState.rooms.clear();
  updatePresenceHeartbeatTimer();
  const client = presenceState.client;
  if (presenceState.clientCloseTimer !== null) {
    clearTimeout(presenceState.clientCloseTimer);
    presenceState.clientCloseTimer = null;
  }
  presenceState.client = null;
  presenceState.userId = "";
  presenceState.userIdPromise = null;
  await Promise.allSettled(
    staleRooms.map((room) => disconnectPresenceToken(room.sessionToken, client))
  );
  if (client && typeof client.close === "function") {
    try {
      await Promise.resolve(client.close());
    } catch (_error) {
      // 연결 해제 요청이 실패해도 서버 만료 정책이 남은 접속을 정리합니다.
    }
  }
}

function schedulePresenceReconcile() {
  presenceState.reconcilePromise = presenceState.reconcilePromise
    .then(reconcilePresenceRooms, reconcilePresenceRooms)
    .catch(() => {});
  return presenceState.reconcilePromise;
}

async function rotatePresenceUserId(nextUserId) {
  if (!isValidUuid(nextUserId) || nextUserId === presenceState.userId) {
    return;
  }
  presenceState.userId = nextUserId;
  const staleRooms = [...presenceState.rooms.values()];
  presenceState.rooms.clear();
  updatePresenceHeartbeatTimer();
  for (const room of staleRooms) {
    void disconnectPresenceToken(room.sessionToken, presenceState.client);
  }
  await schedulePresenceReconcile();
}

function registerPresenceSurface(request, sender) {
  const roomId = String(request?.roomId || "");
  const surfaceId = String(request?.surfaceId || "");
  if (!isValidSessionId(roomId) || !isValidUuid(surfaceId)) {
    throw new Error("접속 집계 정보가 올바르지 않습니다.");
  }
  const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
  for (const [registeredId, surface] of presenceState.surfaces) {
    if (surface.tabId === tabId && registeredId !== surfaceId) {
      presenceState.surfaces.delete(registeredId);
    }
  }
  presenceState.surfaces.set(surfaceId, {
    roomId,
    tabId
  });
  return schedulePresenceReconcile();
}

function unregisterPresenceSurface(request, sender) {
  const surfaceId = String(request?.surfaceId || "");
  if (!isValidUuid(surfaceId)) {
    return Promise.resolve();
  }
  const surface = presenceState.surfaces.get(surfaceId);
  const senderTabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
  if (surface && surface.tabId === senderTabId) {
    presenceState.surfaces.delete(surfaceId);
  }
  return schedulePresenceReconcile();
}

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
  if (!isValidSessionId(sessionId)) {
    throw new Error("번역 세션 번호가 올바르지 않습니다.");
  }

  const requestedLimit = Number(args.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(5000, Math.max(1, Math.round(requestedLimit)))
    : 80;

  return { sessionId, limit };
}

async function queryTranslator(path, rawArgs) {
  const consentRevision = privacyConsentRevision;
  if (privacyConsentGranted !== true) {
    throw new Error("개인정보 안내 동의가 필요합니다.");
  }
  const args = sanitizeQuery(path, rawArgs);
  const controller = new AbortController();
  activeQueryControllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    if (
      consentRevision !== privacyConsentRevision ||
      privacyConsentGranted !== true
    ) {
      throw new Error("개인정보 안내 동의가 필요합니다.");
    }
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
    activeQueryControllers.delete(controller);
  }
}

function abortTranslatorQueries() {
  for (const controller of activeQueryControllers) {
    controller.abort();
  }
  activeQueryControllers.clear();
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
  if (!request || !isAllowedContentSender(sender)) {
    return false;
  }

  if (request.type === "cutiestreet-open-privacy") {
    chrome.runtime.openOptionsPage(() => {
      const runtimeError = chrome.runtime.lastError;
      sendResponse({
        ok: !runtimeError,
        error: runtimeError ? runtimeError.message : undefined
      });
    });
    return true;
  }

  if (request.type === "cutiestreet-presence-start") {
    hasPrivacyConsent()
      .then((granted) => {
        if (!granted) {
          throw new Error("개인정보 안내 동의가 필요합니다.");
        }
        return registerPresenceSurface(request, sender);
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "접속 집계를 시작하지 못했습니다."
        });
      });
    return true;
  }

  if (request.type === "cutiestreet-presence-stop") {
    unregisterPresenceSurface(request, sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (request.type !== "cutiestreet-query") {
    return false;
  }

  hasPrivacyConsent()
    .then((granted) => {
      if (!granted) {
        throw new Error("개인정보 안내 동의가 필요합니다.");
      }
      return queryTranslator(request.path, request.args);
    })
    .then((value) => sendResponse({ ok: true, value }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "번역 데이터를 읽지 못했습니다."
      });
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  let changed = false;
  for (const [surfaceId, surface] of presenceState.surfaces) {
    if (surface.tabId !== tabId) {
      continue;
    }
    presenceState.surfaces.delete(surfaceId);
    changed = true;
  }
  if (changed) {
    void schedulePresenceReconcile();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (changes[PRIVACY_CONSENT_KEY]) {
    privacyConsentRevision += 1;
    privacyConsentGranted =
      Number(changes[PRIVACY_CONSENT_KEY].newValue) === PRIVACY_CONSENT_VERSION;
    if (!privacyConsentGranted) {
      abortTranslatorQueries();
      void stopAllPresence();
    }
  }
  if (changes[ANONYMOUS_CLIENT_ID_KEY]) {
    const nextUserId = changes[ANONYMOUS_CLIENT_ID_KEY].newValue;
    if (privacyConsentGranted === true && isValidUuid(nextUserId)) {
      void rotatePresenceUserId(nextUserId);
    }
  }
});

async function toggleOverlayInTab(tab) {
  if (!(await hasPrivacyConsent())) {
    await chrome.runtime.openOptionsPage();
    return;
  }
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

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.runtime.openOptionsPage();
  }
});
