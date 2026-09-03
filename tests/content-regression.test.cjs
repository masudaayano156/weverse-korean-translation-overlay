"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const contentSource = fs
  .readFileSync(path.join(root, "content.js"), "utf8")
  .replace(/\r\n?/g, "\n");
const hookSource = fs
  .readFileSync(path.join(root, "page-hook.js"), "utf8")
  .replace(/\r\n?/g, "\n");
const core = require(path.join(root, "core.js"));

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringConstant(source, name) {
  const match = source.match(
    new RegExp(`\\bconst\\s+${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1\\s*;`)
  );
  assert.ok(match, `${name} 문자열 상수를 찾지 못했습니다.`);
  return match[2];
}

// 줄번호 대신 이름이 붙은 함수의 중괄호 범위를 찾아 검사합니다.
function namedFunctionSource(source, name) {
  const declaration = new RegExp(
    `\\b(?:async\\s+)?function\\s+${escapeRegExp(name)}\\s*\\(`
  ).exec(source);
  assert.ok(declaration, `${name} 함수를 찾지 못했습니다.`);
  const openingParenthesis = source.indexOf("(", declaration.index);
  let parenthesisDepth = 0;
  let closingParenthesis = -1;
  for (let index = openingParenthesis; index < source.length; index += 1) {
    if (source[index] === "(") parenthesisDepth += 1;
    if (source[index] === ")") {
      parenthesisDepth -= 1;
      if (parenthesisDepth === 0) {
        closingParenthesis = index;
        break;
      }
    }
  }
  assert.notEqual(
    closingParenthesis,
    -1,
    `${name} 함수의 매개변수 끝을 찾지 못했습니다.`
  );
  const openingBrace = source.indexOf("{", closingParenthesis);
  assert.notEqual(openingBrace, -1, `${name} 함수 본문을 찾지 못했습니다.`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(declaration.index, index + 1);
      }
    }
  }
  assert.fail(`${name} 함수의 닫는 중괄호를 찾지 못했습니다.`);
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} 시작 표식을 찾지 못했습니다.`);
  assert.notEqual(end, -1, `${endMarker} 종료 표식을 찾지 못했습니다.`);
  return source.slice(start, end);
}

// page-hook이 먼저 응답을 읽어도 content script가 같은 source/type으로
// 재전송을 요청할 수 있어야 합니다.
assert.equal(
  stringConstant(contentSource, "HOOK_MESSAGE_SOURCE"),
  stringConstant(hookSource, "MESSAGE_SOURCE")
);
assert.equal(
  stringConstant(contentSource, "HOOK_REQUEST_SOURCE"),
  stringConstant(hookSource, "REQUEST_SOURCE")
);
assert.equal(
  stringConstant(contentSource, "HOOK_REQUEST_TYPE"),
  stringConstant(hookSource, "REQUEST_TYPE")
);
const requestHookedTiming = namedFunctionSource(contentSource, "requestHookedTiming");
assert.match(requestHookedTiming, /source\s*:\s*HOOK_REQUEST_SOURCE/);
assert.match(requestHookedTiming, /type\s*:\s*HOOK_REQUEST_TYPE/);
const hookHandshake = sourceBetween(
  hookSource,
  "// 콘텐츠 스크립트가 준비되기 전에 응답을 읽었을 수 있으므로",
  "const originalFetch"
);
assert.match(hookHandshake, /data\.source\s*!==\s*REQUEST_SOURCE/);
assert.match(hookHandshake, /data\.type\s*!==\s*REQUEST_TYPE/);
assert.match(hookHandshake, /recentTimings\.get\(data\.postId\)/);
assert.match(hookHandshake, /postTiming\(data\.postId,\s*timing\)/);
assert.match(namedFunctionSource(hookSource, "postTiming"), /source\s*:\s*MESSAGE_SOURCE/);
assert.match(namedFunctionSource(hookSource, "postTiming"), /videoType/);
assert.match(namedFunctionSource(hookSource, "publish"), /video\?\.type/);
assert.match(
  namedFunctionSource(contentSource, "currentBroadcastInfo"),
  /timing\.videoType\s*===\s*"LIVE"[\s\S]*timing\.videoType\s*===\s*"VOD"/
);
assert.match(
  namedFunctionSource(contentSource, "readBroadcastInfo"),
  /hasLiveLabel[\s\S]*duration\s*===\s*Infinity[\s\S]*Number\.isFinite\(duration\)[\s\S]*:\s*null/
);

// 위버스의 지난 라이브는 /media/ 주소로도 열립니다. 일반 미디어까지
// 오인하지 않도록 liveToVod 또는 LIVE 채팅 목록이 있을 때만 허용합니다.
const broadcastRouteMatch = namedFunctionSource(
  contentSource,
  "broadcastRouteMatch"
);
assert.match(broadcastRouteMatch, /\(live\|media\)/);
assert.match(
  namedFunctionSource(contentSource, "postIdFromRoute"),
  /broadcastRouteMatch\(route\)\?\.\[2\]/
);
const isLiveRoute = namedFunctionSource(contentSource, "isLiveRoute");
assert.match(isLiveRoute, /match\[1\]\s*===\s*"live"/);
assert.match(isLiveRoute, /liveToVod\s*===\s*true/);
assert.match(isLiveRoute, /live-chat-list/);
assert.match(
  namedFunctionSource(contentSource, "normalizeReplayAnchors"),
  /\(\?:live\|media\)/
);
assert.match(
  namedFunctionSource(contentSource, "handleRouteOrVisibilityTick"),
  /dom\.panel\.hidden\s*!==\s*shouldHidePanel[\s\S]*applySettingsToUi\(\)/
);
let hasLiveChatList = false;
const routeContext = {
  location: { pathname: "/kawaii_lab/media/3-240169475" },
  hookedTimings: new Map(),
  state: { recognizedLiveReplayPostIds: new Set() },
  document: {
    querySelector(selector) {
      assert.equal(selector, '[class*="live-chat-list"]');
      return hasLiveChatList ? {} : null;
    }
  }
};
vm.runInNewContext(
  `${broadcastRouteMatch}\n${isLiveRoute}\nthis.isLiveRoute = isLiveRoute;`,
  routeContext
);
assert.equal(routeContext.isLiveRoute(), false, "일반 /media/ 영상은 제외해야 합니다.");
hasLiveChatList = true;
assert.equal(routeContext.isLiveRoute(), true, "LIVE 채팅 다시보기는 허용해야 합니다.");
hasLiveChatList = false;
assert.equal(
  routeContext.isLiveRoute(),
  true,
  "확인된 지난 라이브는 DOM 재렌더 중에도 사라지면 안 됩니다."
);
routeContext.location.pathname = "/kawaii_lab/live/1-179514847";
assert.equal(routeContext.isLiveRoute(), true, "/live/ 방송은 계속 허용해야 합니다.");

// 구독 제한은 메시지 한 건마다 바뀌지 않고 단계적으로 커져야 하며,
// WebSocket과 HTTP 전체 조회가 같은 계산 함수를 사용해야 합니다.
assert.equal(core.messageSubscriptionLimit(0), 250);
assert.equal(core.messageSubscriptionLimit(200), 250);
assert.equal(core.messageSubscriptionLimit(201), 500);
assert.equal(core.messageSubscriptionLimit(449), 500);
assert.equal(core.messageSubscriptionLimit(451), 750);
assert.equal(core.messageSubscriptionLimit(4_950), 5_000);
assert.equal(core.messageSubscriptionLimit(50_000), 5_000);
const syncMessagesSubscription = namedFunctionSource(
  contentSource,
  "syncMessagesSubscription"
);
assert.match(
  syncMessagesSubscription,
  /core\.messageSubscriptionLimit\(session\.messageCount\)/
);
const pollMessages = namedFunctionSource(contentSource, "pollMessages");
assert.match(
  pollMessages,
  /core\.messageSubscriptionLimit\(\s*state\.selectedSession\.messageCount\s*\)/
);

// WebSocket 결과 뒤에 도착한 오래된 HTTP 스냅숏은 적용하지 않아야 합니다.
const applyMessages = namedFunctionSource(contentSource, "applyMessages");
assert.match(applyMessages, /state\.messageApplyRevision\s*\+=\s*1/);
const revisionCapture = pollMessages.indexOf("const messageRevisionAtStart");
const httpQuery = pollMessages.indexOf('queryTranslator("messages:list"');
const revisionGuard = pollMessages.indexOf(
  "state.messageApplyRevision !== messageRevisionAtStart"
);
const httpApply = pollMessages.indexOf("applyMessages(value");
assert.ok(
  revisionCapture >= 0 &&
    revisionCapture < httpQuery &&
    httpQuery < revisionGuard &&
    revisionGuard < httpApply,
  "HTTP 조회는 시작 revision을 캡처하고 적용 직전에 다시 확인해야 합니다."
);
assert.match(pollMessages, /hasReadyMessagesSubscription\(\)/);
assert.match(
  pollMessages,
  /state\.messageRequestRunning[\s\S]*state\.messageForcePending\s*\|\|=\s*force/
);
assert.match(
  pollMessages,
  /if\s*\(state\.messageForcePending\)[\s\S]*state\.messageForcePending\s*=\s*false[\s\S]*pollMessages\(\{\s*force\s*:\s*true\s*\}\)/
);

// 세션 목록에도 WS revision 보호와 실행 중 강제 요청의 재실행 큐가 있어야 합니다.
const handleSessionsPush = namedFunctionSource(contentSource, "handleSessionsPush");
assert.match(handleSessionsPush, /liveSync\.sessionsRevision\s*\+=\s*1/);
assert.match(
  handleSessionsPush,
  /if\s*\(fromSubscription\)[\s\S]*markLiveSyncHealthy\(\)[\s\S]*liveSync\.sessionsRevision\s*\+=\s*1/
);
const refreshSessions = namedFunctionSource(contentSource, "refreshSessions");
assert.match(refreshSessions, /const sessionsRevisionAtStart\s*=\s*liveSync\.sessionsRevision/);
assert.match(
  refreshSessions,
  /liveSync\.sessionsRevision\s*!==\s*sessionsRevisionAtStart/
);
assert.match(
  refreshSessions,
  /state\.sessionForceMessagesPending\s*\|\|=\s*forceMessages/
);
assert.match(
  refreshSessions,
  /state\.sessionForceHttpPending\s*\|\|=\s*forceHttp/
);
assert.match(
  refreshSessions,
  /if\s*\(state\.sessionRefreshPending\)[\s\S]*refreshSessions\(\{[\s\S]*forceMessages\s*:\s*pendingForceMessages[\s\S]*forceHttp\s*:\s*pendingForceHttp/
);
assert.ok(
  (refreshSessions.match(
    /liveSync\.sessionsRevision\s*!==\s*sessionsRevisionAtStart/g
  ) || []).length >= 2,
  "세션 HTTP 성공과 실패 모두 최신 WebSocket revision을 보호해야 합니다."
);
assert.ok(
  (pollMessages.match(
    /state\.messageApplyRevision\s*!==\s*messageRevisionAtStart/g
  ) || []).length >= 2,
  "메시지 HTTP 성공과 실패 모두 최신 WebSocket revision을 보호해야 합니다."
);

// 자동 세션 변경은 이전 세션 자막을 즉시 비우고 강제 렌더해야 합니다.
const applySessions = namedFunctionSource(contentSource, "applySessions");
const sessionChangedBranch = sourceBetween(
  applySessions,
  "if (sessionChanged)",
  "if (\n      state.selectedSession"
);
assert.match(sessionChangedBranch, /state\.messages\s*=\s*\[\]/);
assert.match(sessionChangedBranch, /state\.seenMessageIds\.clear\(\)/);
assert.match(sessionChangedBranch, /state\.hasLoadedMessages\s*=\s*false/);
assert.match(sessionChangedBranch, /forceRender\s*:\s*true/);
assert.ok(
  applySessions.indexOf("state.messages = []", applySessions.indexOf("if (sessionChanged)")) <
    applySessions.indexOf("updateSettings({ selectedSessionId"),
  "이전 자막 초기화는 선택 세션 설정을 다시 그리기 전에 실행돼야 합니다."
);

// 설정창을 조작하는 동안 자막 DOM 전체를 계속 다시 만들지 않고,
// 닫을 때 보류된 렌더를 한 번 수행해야 합니다.
const renderMessages = namedFunctionSource(contentSource, "renderMessages");
assert.match(
  renderMessages,
  /state\.settingsOpen\s*&&\s*!forceRender[\s\S]*state\.messageRenderPending\s*=\s*true[\s\S]*return/
);
assert.match(renderMessages, /state\.messagePendingNewIds\.add\(messageId\)/);
assert.ok(
  renderMessages.indexOf("state.messagePendingNewIds.delete(messageId)") <
    renderMessages.indexOf("state.settingsOpen && !forceRender"),
  "설정창 조기 반환 전에도 rollover로 빠진 신규 ID를 정리해야 합니다."
);
assert.match(renderMessages, /state\.messageForceBottomPending\s*\|\|=\s*forceBottom/);
assert.match(renderMessages, /visibleNewMessageIds/);
assert.match(renderMessages, /previousRenderedMessageIds/);
assert.match(renderMessages, /state\.messageFollowLatest/);
assert.match(
  namedFunctionSource(contentSource, "captureMessageScrollAnchor"),
  /nextMessageIds\.has\(element\.dataset\.messageId\)/
);
const immediateReconcile = renderMessages.indexOf("reconcileMessageElements(");
const immediateScrollRestore = renderMessages.indexOf(
  "dom.messages.scrollTop = dom.messages.scrollHeight"
);
const renderFrame = renderMessages.indexOf("requestAnimationFrame(");
assert.ok(
  immediateReconcile >= 0 &&
    immediateReconcile < immediateScrollRestore &&
    immediateScrollRestore < renderFrame,
  "DOM 변경 직후 같은 호출에서 하단/앵커 위치를 복원해야 합니다."
);
const reconcileMessages = namedFunctionSource(
  contentSource,
  "reconcileMessageElements"
);
assert.ok(
  reconcileMessages.indexOf("item.remove()") <
    reconcileMessages.indexOf("visibleMessages.forEach"),
  "rolling 목록의 오래된 행은 생존 노드를 정렬하기 전에 제거해야 합니다."
);
assert.match(contentSource, /id="messages"[^>]*aria-live="off"/);
assert.match(contentSource, /id="subtitle-announcer"[^>]*aria-live="polite"/);
assert.match(
  namedFunctionSource(contentSource, "updateMessageElement"),
  /__weverseOverlayNewMessageTimer[\s\S]*classList\.remove\("new-message"\)/
);
const applySettingsToUi = namedFunctionSource(contentSource, "applySettingsToUi");
assert.match(
  applySettingsToUi,
  /if\s*\(renderContent\s*\|\|\s*state\.messageRenderPending\)[\s\S]*renderMessages\(\)/
);
const bindUiEvents = namedFunctionSource(contentSource, "bindUiEvents");
assert.match(
  bindUiEvents,
  /settingsButton\.addEventListener\("click"[\s\S]*state\.settingsOpen\s*=\s*!state\.settingsOpen[\s\S]*applySettingsToUi\(\)/
);
assert.match(
  bindUiEvents,
  /prefers-reduced-motion:\s*reduce[\s\S]*\?\s*"auto"\s*:\s*"smooth"/
);

// 라이브에서도 빠른 싱크 바를 제공하고, 사용자에게 보이는 싱크값은
// 다시보기와 같이 음수=늦게/양수=빠르게여야 합니다.
const renderReplayOffsetControls = namedFunctionSource(
  contentSource,
  "renderReplayOffsetControls"
);
assert.match(renderReplayOffsetControls, /const isLive\s*=\s*isLiveTranslationMode\(\)/);
assert.match(
  renderReplayOffsetControls,
  /quickSyncBar\.hidden\s*=\s*!isReplay\s*&&\s*!isLive/
);
assert.match(renderReplayOffsetControls, /liveDelayMs\s*<=\s*0/);
assert.match(renderReplayOffsetControls, /liveDelayMs\s*>=\s*120000/);
assert.match(
  bindUiEvents,
  /if\s*\(isLiveTranslationMode\(\)\)[\s\S]*setLiveDelayMs\([\s\S]*liveDelayMs[\s\S]*-\s*deltaMs/
);
assert.match(contentSource, /−는 더 늦게, \+는 더 빠르게/);

// 라이브 리액션은 hover 메뉴가 아니라 채팅 하단에 항상 보이는 버튼이며,
// 보관 번역·설정 화면에서는 숨습니다. 첫 구독 스냅숏은 과거 반응을
// 재생하지 않고 ID만 기억해야 합니다.
assert.equal(
  (contentSource.match(/data-reaction-key=/g) || []).length,
  6
);
assert.doesNotMatch(contentSource, /\.panel:hover\s+\.reaction-bar/);
assert.match(
  contentSource,
  /\.panel\.video-click-priority \.reaction-bar,[\s\S]*pointer-events:\s*auto/
);
assert.match(contentSource, /\.panel\.settings-open \.reaction-bar/);
const liveReactionsEnabled = namedFunctionSource(
  contentSource,
  "liveReactionsEnabled"
);
assert.match(liveReactionsEnabled, /state\.settings\.visible/);
assert.match(liveReactionsEnabled, /!state\.settingsOpen/);
assert.match(liveReactionsEnabled, /isLiveTranslationMode\(\)/);
const renderReactionControls = namedFunctionSource(
  contentSource,
  "renderReactionControls"
);
assert.match(renderReactionControls, /reactionBar\.hidden\s*=\s*!enabled/);
const syncReactionsSubscription = namedFunctionSource(
  contentSource,
  "syncReactionsSubscription"
);
assert.match(syncReactionsSubscription, /!isLiveTranslationMode\(\)/);
assert.match(syncReactionsSubscription, /"reactions:recent"/);
assert.match(syncReactionsSubscription, /\{\s*sessionId:\s*session\._id\s*\}/);
const applyReactionSnapshot = namedFunctionSource(
  contentSource,
  "applyReactionSnapshot"
);
assert.ok(
  applyReactionSnapshot.indexOf("rememberReactionId(reactionId(reaction))") <
    applyReactionSnapshot.indexOf("showReaction(reaction.key)"),
  "최초 반응 목록은 기억만 하고 과거 이모티콘을 다시 띄우지 않아야 합니다."
);
const reactionShows = [];
const reactionContext = {
  liveSync: {
    reactionsReadyKey: null,
    seenReactionIds: new Set()
  },
  REACTION_BY_KEY: new Map([
    ["heart", {}],
    ["wow", {}]
  ]),
  MAX_SEEN_REACTION_IDS: 500,
  MAX_REACTION_SNAPSHOT: 100,
  showReaction(key) {
    reactionShows.push(key);
  }
};
vm.runInNewContext(
  `${namedFunctionSource(contentSource, "reactionId")}\n` +
    `${namedFunctionSource(contentSource, "rememberReactionId")}\n` +
    `${applyReactionSnapshot}\n` +
    "this.applyReactionSnapshot = applyReactionSnapshot;",
  reactionContext
);
reactionContext.applyReactionSnapshot(
  [{ tapId: "reaction_old_1", key: "heart" }],
  "route:session"
);
assert.deepEqual(reactionShows, [], "최초 과거 반응은 띄우면 안 됩니다.");
reactionContext.applyReactionSnapshot(
  [
    { tapId: "reaction_new_1", key: "wow" },
    { tapId: "reaction_old_1", key: "heart" }
  ],
  "route:session"
);
assert.deepEqual(reactionShows, ["wow"], "새 반응만 한 번 띄워야 합니다.");
reactionContext.applyReactionSnapshot(
  [{ tapId: "reaction_new_1", key: "wow" }],
  "route:session"
);
assert.deepEqual(reactionShows, ["wow"], "같은 반응을 중복 재생하면 안 됩니다.");
const sendReaction = namedFunctionSource(contentSource, "sendReaction");
assert.match(sendReaction, /client\.mutation\("reactions:react"/);
assert.match(
  sendReaction,
  /sessionId,[\s\S]*key:\s*reactionKey,[\s\S]*clientId,[\s\S]*tapId/
);
assert.match(sendReaction, /showReaction\(reactionKey,\s*button\)/);

// 사용자에게 보이는 배경 슬라이더는 일반적인 투명도 의미를 사용하되
// 기존 저장값(불투명도)은 변환해 화면 모양을 그대로 보존해야 합니다.
assert.match(contentSource, /<span>배경 투명도<\/span>/);
assert.match(contentSource, /0%는 불투명, 100%는 완전히 투명/);
assert.match(
  applySettingsToUi,
  /backgroundTransparency\s*=\s*100\s*-\s*settings\.backgroundOpacity/
);
assert.match(
  bindUiEvents,
  /backgroundOpacity:\s*100\s*-\s*Number\(dom\.backgroundOpacity\.value\)/
);
assert.match(
  namedFunctionSource(contentSource, "beginDrag"),
  /state\.drag[\s\S]*state\.resize[\s\S]*event\.isPrimary\s*===\s*false/
);
assert.match(
  namedFunctionSource(contentSource, "beginResize"),
  /state\.drag[\s\S]*state\.resize[\s\S]*event\.isPrimary\s*===\s*false/
);

// 사용자 지정 위치의 크기 제한은 영상 크기가 아니라 viewport를 사용해야 합니다.
const placeOverlay = namedFunctionSource(contentSource, "placeOverlay");
assert.match(placeOverlay, /const customPosition\s*=\s*state\.settings\.position\s*===\s*"custom"/);
assert.match(
  placeOverlay,
  /customPosition\s*\?\s*window\.innerWidth\s*-\s*16\s*:\s*playerRect\.width\s*-\s*24/
);
assert.match(
  placeOverlay,
  /customPosition\s*\?\s*window\.innerHeight\s*-\s*16\s*:\s*playerRect\.height\s*-\s*66/
);
assert.match(placeOverlay, /viewportWidth\s*:\s*window\.innerWidth/);
assert.match(placeOverlay, /viewportHeight\s*:\s*window\.innerHeight/);

// 실제 isVisibleVideo 함수를 VM에서 실행해 viewport 밖 영상이 제외되는지 확인합니다.
const visibilityContext = {
  window: {
    innerWidth: 1_000,
    innerHeight: 800,
    getComputedStyle(video) {
      return {
        display: "block",
        visibility: "visible",
        opacity: "1",
        ...(video.computedStyle || {})
      };
    }
  }
};
vm.runInNewContext(
  `${namedFunctionSource(contentSource, "isVisibleVideo")}\nthis.isVisibleVideo = isVisibleVideo;`,
  visibilityContext
);
function fakeVideo(rect, computedStyle) {
  return {
    computedStyle,
    getBoundingClientRect() {
      return rect;
    }
  };
}
assert.equal(
  visibilityContext.isVisibleVideo(
    fakeVideo({ left: 10, top: 10, right: 410, bottom: 310, width: 400, height: 300 })
  ),
  true
);
for (const rect of [
  { left: -500, top: 10, right: 0, bottom: 310, width: 500, height: 300 },
  { left: 10, top: -400, right: 410, bottom: 0, width: 400, height: 400 },
  { left: 1_000, top: 10, right: 1_400, bottom: 310, width: 400, height: 300 },
  { left: 10, top: 800, right: 410, bottom: 1_100, width: 400, height: 300 }
]) {
  assert.equal(visibilityContext.isVisibleVideo(fakeVideo(rect)), false);
}
assert.equal(
  visibilityContext.isVisibleVideo(
    fakeVideo(
      { left: 10, top: 10, right: 410, bottom: 310, width: 400, height: 300 },
      { visibility: "hidden" }
    )
  ),
  false
);

// 플레이어 하위 메뉴가 비동기로 바뀌어도 오버레이 회피를 다시 계산해야 합니다.
const bindPlayerMenuObserver = namedFunctionSource(
  contentSource,
  "bindPlayerMenuObserver"
);
assert.match(bindPlayerMenuObserver, /new MutationObserver\(handlePlayerMenuMutations\)/);
assert.match(bindPlayerMenuObserver, /\.observe\(root,\s*\{/);
assert.match(bindPlayerMenuObserver, /subtree\s*:\s*true/);
assert.match(bindPlayerMenuObserver, /childList\s*:\s*true/);
assert.doesNotMatch(bindPlayerMenuObserver, /attributes\s*:\s*true/);
assert.doesNotMatch(
  namedFunctionSource(contentSource, "schedulePlayerMenuAvoidance"),
  /enforceHighestQuality/
);
assert.match(
  namedFunctionSource(contentSource, "bindPlaybackVideo"),
  /bindPlayerMenuObserver\(\)/
);

// 최고 화질은 주기 observer와 싸우지 않고 방송/설정 epoch당 한 번만
// 설정 → 해상도 → 최고 수치를 선택하며 사용자 조작 시 중단해야 합니다.
const qualityRunner = namedFunctionSource(contentSource, "runQualityStep");
assert.match(qualityRunner, /state\.qualityUserActivityAt\s*>\s*state\.qualityOperationStartedAt/);
assert.match(qualityRunner, /visiblePlayerMenus\(root\)\.length\s*>\s*0/);
assert.match(qualityRunner, /state\.qualityGearClicked\s*=\s*true/);
assert.match(qualityRunner, /state\.qualityEntryClicked\s*=\s*true/);
assert.match(qualityRunner, /state\.qualityTargetClicked\s*=\s*true/);
assert.match(
  namedFunctionSource(contentSource, "enforceHighestQuality"),
  /state\.routeGeneration.*state\.qualityEnableEpoch/
);
assert.match(
  namedFunctionSource(contentSource, "noteQualityUserActivity"),
  /event\.isTrusted[\s\S]*result:\s*"user-owned"/
);
assert.match(
  namedFunctionSource(contentSource, "resetQualityAutomation"),
  /retryableRun[\s\S]*firstPlayerArrival[\s\S]*state\.qualityRetryCount\s*<\s*1[\s\S]*"retry-exhausted"/
);
assert.match(
  namedFunctionSource(contentSource, "resetQualityAutomation"),
  /closeOwnedQualityMenuIfSafe\(\)/
);
assert.match(
  namedFunctionSource(contentSource, "enforceHighestQuality"),
  /!state\.boundVideo\s*&&\s*!state\.boundPlayerRoot/
);
assert.match(
  namedFunctionSource(contentSource, "syncMessagesToPlayback"),
  /!nextAdPlaying[\s\S]*document\.visibilityState\s*!==\s*"hidden"[\s\S]*state\.qualityRunState\s*===\s*"ad-wait"[\s\S]*resetQualityAutomation\(\)[\s\S]*enforceHighestQuality\(\)/
);
assert.match(qualityRunner, /isAdPlaying\(\)[\s\S]*result:\s*"ad-wait"/);
assert.match(contentSource, /previousHighestQuality\s*!==\s*state\.settings\.preferHighestQuality/);
assert.match(contentSource, /previousHighestQuality\s*!==\s*nextHighestQuality/);

// 주 영상과 광고는 같은 PZP 플레이어 범위에서 판단하고, 광고는 실제
// 재생 또는 광고 UI라는 양성 증거가 있어야 합니다.
const playbackContext = namedFunctionSource(contentSource, "playbackContext");
assert.match(playbackContext, /choosePlayerRoot\(videos\)/);
assert.match(playbackContext, /videoPlayerRoot\(video\)\s*===\s*root/);
assert.match(playbackContext, /adVideos\.find\(isVideoPlaybackActive\)/);
assert.match(playbackContext, /hasVisibleAdIndicator\(root\)/);
assert.match(
  playbackContext,
  /indicator\s*&&[\s\S]*isVideoPlaybackActive\(video\)[\s\S]*scopedVideos\.length\s*===\s*1/
);
assert.match(playbackContext, /state\.adEvidenceUntil\s*=\s*now\s*\+\s*750/);
assert.doesNotMatch(
  namedFunctionSource(contentSource, "isAdPlaying"),
  /currentTime/
);
assert.match(
  namedFunctionSource(contentSource, "activeShortAdVideos"),
  /videoRoot\s*&&\s*videoRoot\s*===\s*mainRoot/
);
assert.match(
  namedFunctionSource(contentSource, "choosePlayerRoot"),
  /root\s*!==\s*boundRoot[\s\S]*isVideoPlaybackActive\(video\)[\s\S]*videosSharePlayerArea\(video,\s*boundVideo\)/
);
assert.match(
  namedFunctionSource(contentSource, "bindPlaybackVideo"),
  /location\.pathname\s*!==\s*state\.lastPathname[\s\S]*nextPlayerRoot\s*===\s*state\.boundPlayerRoot/
);
assert.match(
  namedFunctionSource(contentSource, "eligibleVisibleVideos"),
  /for\s*\(const\s*\[video,\s*source\]\s*of\s*state\.staleRouteVideos\)[\s\S]*state\.staleRouteVideos\.delete\(video\)[\s\S]*!state\.staleRouteVideos\.has\(video\)/
);
assert.match(
  namedFunctionSource(contentSource, "handleRouteOrVisibilityTick"),
  /for\s*\(const\s*\[video,\s*source\]\s*of\s*state\.boundRouteVideos\)[\s\S]*staleRouteVideos\.set\(video,\s*source\)[\s\S]*state\.boundRouteVideos\s*=\s*new Map\(\)/
);
assert.match(
  namedFunctionSource(contentSource, "rememberBoundRouteVideos"),
  /context\?\.main[\s\S]*context\?\.ad[\s\S]*root\.querySelectorAll\("video"\)[\s\S]*state\.boundRouteVideos\.set/
);

// 구독 한도가 늘어 과거 기록이 뒤늦게 보충돼도 새 자막 알림이나
// 스크롤 중 새 자막 개수로 잘못 계산하지 않아야 합니다.
assert.match(
  namedFunctionSource(contentSource, "applyMessages"),
  /previousLatestTimestamp[\s\S]*Number\(message\._creationTime\)\s*>=\s*previousLatestTimestamp/
);
assert.match(
  namedFunctionSource(contentSource, "renderMessages"),
  /previousLatestRenderedTimestamp[\s\S]*Number\(message\._creationTime\)\s*<\s*previousLatestRenderedTimestamp/
);

console.log("content regression tests: all assertions passed");
