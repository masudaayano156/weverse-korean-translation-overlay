(function startWeverseTranslationOverlay() {
  "use strict";

  if (window.top !== window || globalThis.__weverseKoreanOverlayLoaded) {
    return;
  }
  globalThis.__weverseKoreanOverlayLoaded = true;

  const core = globalThis.WeverseTranslationOverlayCore;
  if (!core) {
    return;
  }

  const WEVERSE_ORIGIN = "https://weverse.io";
  const INSTAGRAM_ORIGIN = "https://www.instagram.com";
  const INSTAGRAM_MEMBER_HANDLES = new Set([
    "aika.sano_official",
    "nagisa_manabe",
    "fuuuuu_ri",
    "m_ayano26",
    "pa___.ru",
    "kana.sii.i",
    "miyu_.0913",
    "_emiru._"
  ]);
  const STORAGE_KEY = "weverseKoreanOverlaySettingsV1";
  // V2 저장소는 이전 영상별 수동 조정과 기준점을 적용하지 않아 새 영점에서
  // 모든 다시보기가 0.0초로 시작하게 합니다. V1 데이터는 삭제하지 않습니다.
  const REPLAY_ANCHORS_KEY = "weverseReplaySyncAnchorsV2";
  const TRANSLATOR_HOME = "https://cutiestreet-live-translator.vercel.app/";
  const CONVEX_URL = "https://api.cutiestreet.kro.kr";
  const SESSION_REFRESH_MS = 10000;
  const POLL_MS = 1300;
  const POSITION_TICK_MS = 700;
  const ARCHIVE_REFRESH_MS = 30000;
  const REPLAY_OFFSET_LIMIT_MS = 10 * 60 * 1000;
  const REPLAY_CLOCK_VERSION = 4;
  const REACTION_CLIENT_ID_KEY = "weverseOverlayReactionClientIdV1";
  const CUTE_REACTION_ICON_URL = chrome.runtime.getURL(
    "icons/reaction-cute-noto.svg"
  );
  const REACTION_KEYS = Object.freeze([
    {
      key: "clap",
      emoji: "🥹",
      iconUrl: CUTE_REACTION_ICON_URL,
      label: "귀여워"
    },
    { key: "heart", emoji: "❤️", label: "사랑해요" },
    { key: "lol", emoji: "😂", label: "ㅋㅋㅋㅋ" },
    { key: "sob", emoji: "😭", label: "슬퍼요" },
    { key: "fire", emoji: "🔥", label: "개쩐다" },
    { key: "wow", emoji: "😮", label: "헐" }
  ]);
  const REACTION_BY_KEY = new Map(
    REACTION_KEYS.map((reaction) => [reaction.key, reaction])
  );
  const MAX_SEEN_REACTION_IDS = 500;
  const MAX_REACTION_SNAPSHOT = 8;
  const REACTION_MAX_AGE_MS = 15 * 1000;
  const MAX_FLOATING_REACTIONS = 24;
  const PRESENCE_SURFACE_REFRESH_MS = 30 * 1000;

  const state = {
    settings: core.normalizeSettings(),
    sessions: [],
    selectedSession: null,
    messages: [],
    seenMessageIds: new Set(),
    hasLoadedMessages: false,
    sessionRequestRunning: false,
    sessionRefreshPending: false,
    sessionForceMessagesPending: false,
    sessionForceHttpPending: false,
    messageRequestRunning: false,
    messageForcePending: false,
    messageApplyRevision: 0,
    lastArchiveMessageRefreshAt: 0,
    lastSessionRefreshAt: 0,
    lastPathname: location.pathname,
    routeGeneration: 0,
    broadcastInfo: null,
    replayAnchors: {},
    recognizedLiveReplayPostIds: new Set(),
    anchorOptionsKey: null,
    adPlaying: false,
    manualSessionPath: null,
    displayedHistoryCount: 0,
    unseenSubtitleCount: 0,
    connectionState: null,
    settingsOpen: false,
    drag: null,
    resize: null,
    boundVideo: null,
    boundVideoRoute: null,
    boundPlayerRoot: null,
    boundRouteVideos: new Map(),
    staleRouteVideos: new Map(),
    adEvidenceUntil: 0,
    saveTimer: null,
    placementFrame: null,
    messageRenderFrame: null,
    messageRenderPending: false,
    messagePendingNewIds: new Set(),
    messageForceBottomPending: false,
    messageFollowLatest: true,
    messageAutoScrollPending: false,
    liveReleaseTimer: null,
    liveReleasedThrough: null,
    reactionClientId: "",
    qualityEnableEpoch: 0,
    qualityRunKey: null,
    qualityRunState: "idle",
    qualityRetryCount: 0,
    qualityStartedWithoutPlayer: false,
    qualityOperationToken: 0,
    qualityOperationStartedAt: 0,
    qualityDeadline: 0,
    qualityTimer: null,
    qualityRoot: null,
    qualityGear: null,
    qualityOpenedByUs: false,
    qualityGearClicked: false,
    qualityEntryClicked: false,
    qualityTargetClicked: false,
    qualityUserActivityAt: 0,
    playerMenuFrame: null,
    playerMenuSettleTimer: null,
    playerMenuObserver: null,
    playerMenuObserverRoot: null
  };

  const host = document.createElement("div");
  host.id = "weverse-korean-translation-overlay-host";
  // 페이지 스크립트가 오버레이 내부 컨트롤을 찾아 합성 이벤트를
  // 발생시키지 못하도록 확장프로그램 내부 DOM은 외부에 노출하지 않습니다.
  const shadow = host.attachShadow({ mode: "closed" });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: dark;
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      #overlay-root {
        position: fixed;
        inset: 0 auto auto 0;
        width: 0;
        height: 0;
        z-index: 2147483647;
        pointer-events: none;
        font-family: Pretendard, Inter, -apple-system, BlinkMacSystemFont,
          "Segoe UI", "Noto Sans KR", Arial, sans-serif;
      }

      .panel {
        --panel-width: 390px;
        --panel-height: auto;
        --panel-max-height: 420px;
        --message-font-size: 17px;
        --message-text-color: #fff;
        --message-outline-width: 2px;
        --panel-background: rgba(8, 10, 15, 0.78);
        position: fixed;
        left: 20px;
        top: 20px;
        display: flex;
        flex-direction: column;
        width: var(--panel-width);
        height: var(--panel-height);
        max-height: var(--panel-max-height);
        min-width: 180px;
        min-height: 150px;
        overflow: hidden;
        color: #f8fafc;
        background: var(--panel-background);
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 14px;
        box-shadow: 0 16px 44px rgba(0, 0, 0, 0.48);
        backdrop-filter: blur(9px) saturate(120%);
        -webkit-backdrop-filter: blur(9px) saturate(120%);
        pointer-events: auto;
        isolation: isolate;
        transition: opacity 100ms ease;
        z-index: 2;
      }

      .reaction-layer {
        position: fixed;
        z-index: 1;
        inset: 0;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        pointer-events: none;
      }

      .reaction-layer[hidden] {
        display: none !important;
      }

      .reaction-float {
        position: fixed;
        left: var(--reaction-x);
        top: var(--reaction-y);
        display: block;
        filter: drop-shadow(0 4px 7px rgba(0, 0, 0, 0.55));
        font-family: "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
        font-size: clamp(30px, 4vw, 48px);
        line-height: 1;
        pointer-events: none;
        transform: translate(-50%, -50%);
        animation: reaction-float var(--reaction-duration, 1700ms) ease-out forwards;
        will-change: transform, opacity;
      }

      .reaction-float-icon {
        display: block;
        width: 1em;
        height: 1em;
      }

      @keyframes reaction-float {
        0% {
          opacity: 0;
          transform: translate(-50%, -20%) scale(0.62) rotate(-7deg);
        }
        16% {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1.08) rotate(4deg);
        }
        100% {
          opacity: 0;
          transform: translate(
            calc(-50% + var(--reaction-drift, 0px)),
            calc(-50% - var(--reaction-lift, 170px))
          ) scale(1.18) rotate(-4deg);
        }
      }

      .panel[hidden] {
        display: none !important;
      }

      .panel.player-menu-overlap {
        opacity: 0;
        pointer-events: none;
        visibility: hidden;
      }

      .panel.borderless {
        border-color: transparent;
      }

      .panel.minimal {
        overflow: visible;
        background: transparent;
        border-color: transparent;
        border-radius: 0;
        box-shadow: none;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
      }

      .panel.minimal .header {
        position: absolute;
        z-index: 18;
        top: 0;
        right: 0;
        left: 0;
        min-height: 38px;
        padding: 4px 6px 4px 9px;
        opacity: 0;
        background: rgba(8, 10, 15, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 10px;
        box-shadow: 0 8px 26px rgba(0, 0, 0, 0.42);
        pointer-events: none;
        transition: opacity 140ms ease;
      }

      .panel.minimal:hover:not(:has(.reaction-bar:hover)) .header,
      .panel.minimal:not(:hover):focus-within:not(:has(.reaction-bar:focus-within)) .header {
        opacity: 1;
        pointer-events: auto;
      }

      .panel.minimal .quick-sync-bar {
        top: 38px;
      }

      .panel.minimal .session-bar,
      .panel.minimal .status-bar {
        display: none;
      }

      .panel.minimal .translator-credit {
        padding: 3px 6px 5px;
        background: transparent;
        border: 0;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95);
      }

      .panel.minimal .messages {
        padding: 2px 0;
        scrollbar-color: rgba(255, 255, 255, 0.34) transparent;
      }

      .panel.minimal .message {
        padding-right: 2px;
        padding-left: 2px;
      }

      .panel.minimal .message:hover {
        background: transparent;
      }

      .panel.settings-open {
        overflow: hidden;
        background: rgba(8, 10, 15, 0.96);
        box-shadow: 0 16px 44px rgba(0, 0, 0, 0.48);
        backdrop-filter: blur(9px) saturate(120%);
        -webkit-backdrop-filter: blur(9px) saturate(120%);
      }

      .panel.layout-locked .header,
      .panel.layout-locked .header:active {
        cursor: default;
      }

      .panel.layout-locked .resize-handle {
        display: none;
      }

      .panel.video-click-priority {
        pointer-events: none;
      }

      .panel.video-click-priority .header {
        pointer-events: auto;
      }

      .panel.video-click-priority .body,
      .panel.video-click-priority .resize-handle {
        pointer-events: none;
      }

      .panel.video-click-priority .quick-sync-bar {
        display: none !important;
      }

      .panel.video-click-priority .reaction-bar,
      .panel.video-click-priority .reaction-button {
        pointer-events: auto;
      }

      .resize-handle {
        position: absolute;
        z-index: 20;
        display: block;
        touch-action: none;
        user-select: none;
      }

      .resize-n,
      .resize-s {
        left: 12px;
        right: 12px;
        height: 8px;
      }

      .resize-n { top: 0; cursor: n-resize; }
      .resize-s { bottom: 0; cursor: s-resize; }

      .resize-e,
      .resize-w {
        top: 12px;
        bottom: 12px;
        width: 8px;
      }

      .resize-e { right: 0; cursor: e-resize; }
      .resize-w { left: 0; cursor: w-resize; }

      .resize-ne,
      .resize-nw,
      .resize-se,
      .resize-sw {
        width: 14px;
        height: 14px;
      }

      .resize-ne { top: 0; right: 0; cursor: ne-resize; }
      .resize-nw { top: 0; left: 0; cursor: nw-resize; }
      .resize-se { right: 0; bottom: 0; cursor: se-resize; }
      .resize-sw { left: 0; bottom: 0; cursor: sw-resize; }

      .restore-button {
        position: fixed;
        left: 20px;
        top: 20px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 142px;
        min-height: 38px;
        padding: 0 13px;
        color: #fff;
        background: rgba(2, 132, 199, 0.92);
        border: 1px solid #7dd3fc;
        border-radius: 999px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.42);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        pointer-events: auto;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
      }

      .restore-button:hover,
      .restore-button:focus-visible {
        background: #0ea5e9;
        border-color: #e0f2fe;
        outline: none;
        transform: translateY(-1px);
      }

      .restore-button[hidden] {
        display: none !important;
      }

      .header {
        display: flex;
        align-items: center;
        gap: 9px;
        min-height: 48px;
        padding: 8px 8px 8px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.11);
        cursor: grab;
        user-select: none;
        touch-action: none;
      }

      .header:active {
        cursor: grabbing;
      }

      .connection-dot {
        flex: 0 0 auto;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #f59e0b;
        box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.14);
      }

      .connection-dot.live {
        background: #ff3565;
        box-shadow: 0 0 0 4px rgba(255, 53, 101, 0.17);
        animation: live-pulse 1.8s ease-out infinite;
      }

      .connection-dot.error {
        background: #ef4444;
        box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.16);
        animation: none;
      }

      .connection-dot.archive {
        background: #38bdf8;
        box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.16);
        animation: none;
      }

      @keyframes live-pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(0.82); opacity: 0.72; }
      }

      .header-copy {
        flex: 1 1 auto;
        min-width: 0;
      }

      .header-title {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font-size: 13px;
        font-weight: 800;
        line-height: 1.25;
        letter-spacing: -0.01em;
      }

      .live-label {
        flex: 0 0 auto;
        padding: 2px 5px;
        color: #fff;
        background: #e92055;
        border-radius: 999px;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.04em;
      }

      .live-label.offline {
        color: #cbd5e1;
        background: rgba(148, 163, 184, 0.2);
      }

      .session-title {
        margin-top: 2px;
        overflow: hidden;
        color: #cbd5e1;
        font-size: 11px;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .header-actions {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 2px;
      }

      .quick-sync-bar {
        position: absolute;
        z-index: 17;
        top: 93px;
        right: 0;
        left: 0;
        padding: 6px 8px 8px;
        opacity: 0;
        background: rgba(8, 10, 15, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-top: 0;
        border-radius: 0 0 10px 10px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
        pointer-events: none;
        transform: translateY(-4px);
        transition: opacity 140ms ease, transform 140ms ease;
      }

      .quick-sync-bar[hidden],
      .panel.settings-open .quick-sync-bar {
        display: none !important;
      }

      .panel:hover:not(:has(.reaction-bar:hover)) .quick-sync-bar:not([hidden]),
      .panel:not(:hover):focus-within:not(:has(.reaction-bar:focus-within)) .quick-sync-bar:not([hidden]) {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }

      .quick-sync-heading {
        display: flex;
        margin-bottom: 5px;
        align-items: center;
        justify-content: space-between;
        color: #dbeafe;
        font-size: 10px;
        font-weight: 800;
      }

      .quick-sync-heading-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .quick-sync-value {
        color: #7dd3fc;
        font-variant-numeric: tabular-nums;
      }

      .quick-sync-controls {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 3px;
      }

      .quick-sync-button {
        min-width: 0;
        height: 27px;
        padding: 0 2px;
        color: #dbeafe;
        background: rgba(255, 255, 255, 0.065);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 6px;
        font-size: 9px;
        font-weight: 800;
        cursor: pointer;
      }

      .quick-sync-button:hover,
      .quick-sync-button:focus-visible {
        color: #fff;
        background: rgba(14, 165, 233, 0.26);
        border-color: rgba(56, 189, 248, 0.74);
        outline: none;
      }

      .quick-sync-button[data-quick-sync-ms="0"] {
        background: rgba(14, 165, 233, 0.18);
      }

      .quick-sync-button:disabled {
        opacity: 0.38;
        cursor: default;
      }

      button, select, input, a {
        font: inherit;
      }

      .position-icon,
      .lock-icon,
      .close-icon {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      #lock-button[aria-pressed="true"] .lock-open,
      #lock-button[aria-pressed="false"] .lock-closed {
        display: none;
      }

      .icon-button,
      .source-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        padding: 0;
        color: #e2e8f0;
        background: transparent;
        border: 0;
        border-radius: 8px;
        cursor: pointer;
        text-decoration: none;
      }

      .icon-button:hover,
      .source-link:hover,
      .icon-button:focus-visible,
      .source-link:focus-visible {
        color: #fff;
        background: rgba(255, 255, 255, 0.12);
        outline: none;
      }

      .icon-button[aria-pressed="true"] {
        color: #fff;
        background: rgba(14, 165, 233, 0.28);
        box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.48);
      }

      .body {
        position: relative;
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
        flex-direction: column;
      }

      .session-bar {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 6px;
        padding: 7px 9px;
        background: rgba(255, 255, 255, 0.035);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }

      .session-select {
        flex: 1 1 auto;
        min-width: 0;
        height: 30px;
        padding: 0 28px 0 9px;
        overflow: hidden;
        color: #f1f5f9;
        background: rgba(17, 24, 39, 0.82);
        border: 1px solid rgba(255, 255, 255, 0.13);
        border-radius: 8px;
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }

      .session-select:focus-visible {
        border-color: #60a5fa;
        outline: 2px solid rgba(96, 165, 250, 0.22);
      }

      .refresh-button {
        width: 30px;
        height: 30px;
        border: 1px solid rgba(255, 255, 255, 0.12);
      }

      .messages {
        display: flex;
        flex: 1 1 auto;
        min-height: 62px;
        margin: 0;
        padding: 7px 8px 5px;
        overflow-x: hidden;
        overflow-y: auto;
        flex-direction: column;
        gap: 2px;
        list-style: none;
        overscroll-behavior: contain;
        scrollbar-color: rgba(255, 255, 255, 0.28) transparent;
        scrollbar-width: thin;
      }

      .messages::-webkit-scrollbar {
        width: 7px;
      }

      .messages::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.24);
        border: 2px solid transparent;
        border-radius: 99px;
        background-clip: padding-box;
      }

      .message {
        display: grid;
        grid-template-columns: 58px minmax(0, 1fr);
        gap: 7px;
        align-items: start;
        padding: 5px 6px;
        border-radius: 8px;
      }

      .message:hover {
        background: rgba(255, 255, 255, 0.055);
      }

      .message.without-time {
        grid-template-columns: minmax(0, 1fr);
      }

      .message.new-message {
        animation: message-arrive 320ms ease-out;
        background: rgba(56, 189, 248, 0.11);
      }

      @keyframes message-arrive {
        from { opacity: 0; transform: translateY(7px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .message-time {
        padding-top: 3px;
        color: #7dd3fc;
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        line-height: 1.2;
        white-space: nowrap;
      }

      .message-content {
        min-width: 0;
      }

      .translator-credit {
        flex: 0 0 auto;
        padding: 6px 12px;
        overflow: hidden;
        color: #fbbf24;
        background: rgba(251, 191, 36, 0.07);
        border-bottom: 1px solid rgba(251, 191, 36, 0.15);
        font-size: 11px;
        font-weight: 700;
        line-height: 1.3;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .message-text {
        margin: 0;
        overflow-wrap: anywhere;
        color: var(--message-text-color);
        font-size: var(--message-font-size);
        font-weight: 650;
        line-height: 1.42;
        letter-spacing: -0.018em;
        white-space: pre-wrap;
        -webkit-text-stroke: var(--message-outline-width) rgba(0, 0, 0, 0.92);
        paint-order: stroke fill;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.86);
      }

      .empty-state {
        display: flex;
        flex: 1 1 auto;
        min-height: 90px;
        padding: 16px;
        align-items: center;
        justify-content: center;
        color: #cbd5e1;
        font-size: 12px;
        line-height: 1.55;
        text-align: center;
      }

      .empty-state[hidden],
      .messages[hidden],
      .translator-credit[hidden],
      .settings[hidden],
      .latest-message-button[hidden] {
        display: none !important;
      }

      .latest-message-button {
        position: absolute;
        z-index: 16;
        left: 50%;
        bottom: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 30px;
        padding: 0 12px;
        color: #fff;
        background: rgba(2, 132, 199, 0.94);
        border: 1px solid rgba(125, 211, 252, 0.88);
        border-radius: 999px;
        box-shadow: 0 7px 20px rgba(0, 0, 0, 0.48);
        font-size: 10px;
        font-weight: 800;
        white-space: nowrap;
        cursor: pointer;
        transform: translateX(-50%);
      }

      .latest-message-button:hover,
      .latest-message-button:focus-visible {
        background: #0ea5e9;
        border-color: #e0f2fe;
        outline: none;
        transform: translate(-50%, -1px);
      }

      .panel.minimal .latest-message-button {
        bottom: 8px;
        background: rgba(2, 132, 199, 0.9);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
      }

      .panel.reactions-enabled .latest-message-button {
        bottom: 72px;
      }

      .panel.minimal.reactions-enabled .latest-message-button {
        bottom: 48px;
      }

      .reaction-bar {
        display: grid;
        flex: 0 0 auto;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 4px;
        padding: 5px 8px 6px;
        background: rgba(255, 255, 255, 0.035);
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        pointer-events: auto;
      }

      .reaction-bar[hidden] {
        display: none !important;
      }

      .reaction-button {
        min-width: 0;
        height: 31px;
        padding: 0;
        color: #fff;
        background: rgba(255, 255, 255, 0.07);
        border: 1px solid rgba(255, 255, 255, 0.11);
        border-radius: 8px;
        font-family: "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        transition: background 100ms ease, border-color 100ms ease,
          transform 100ms ease;
      }

      .reaction-button:hover,
      .reaction-button:focus-visible {
        background: rgba(56, 189, 248, 0.2);
        border-color: rgba(125, 211, 252, 0.72);
        outline: none;
        transform: translateY(-1px);
      }

      .reaction-button:active,
      .reaction-button.sent {
        transform: scale(0.9);
      }

      .reaction-button:disabled {
        opacity: 0.42;
        cursor: default;
      }

      .reaction-icon {
        display: inline-block;
        width: 20px;
        height: 20px;
        vertical-align: middle;
        pointer-events: none;
      }

      .panel.minimal .reaction-bar {
        align-self: center;
        width: min(100%, 320px);
        padding: 4px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 10px;
        box-shadow: none;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
      }

      .panel.minimal .reaction-button {
        height: 30px;
        background: transparent;
        border-color: transparent;
      }

      .status-bar {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: space-between;
        min-height: 27px;
        gap: 8px;
        padding: 5px 10px 6px;
        color: #94a3b8;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        font-size: 9px;
        line-height: 1.25;
      }

      .status-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .drag-hint {
        flex: 0 0 auto;
        color: #64748b;
      }

      .settings {
        flex: 1 1 auto;
        min-height: 0;
        padding: 10px;
        overflow-y: auto;
      }

      .panel.settings-open .messages,
      .panel.settings-open .translator-credit,
      .panel.settings-open .empty-state,
      .panel.settings-open .status-bar,
      .panel.settings-open .reaction-bar,
      .panel.settings-open .latest-message-button {
        display: none !important;
      }

      .setting-section + .setting-section {
        margin-top: 12px;
      }

      .setting-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
        color: #dbeafe;
        font-size: 11px;
        font-weight: 700;
      }

      .setting-value {
        color: #7dd3fc;
        font-variant-numeric: tabular-nums;
        font-weight: 800;
      }

      .position-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 5px;
      }

      .position-button {
        height: 32px;
        padding: 0 8px;
        color: #cbd5e1;
        background: rgba(255, 255, 255, 0.055);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        font-size: 11px;
        cursor: pointer;
      }

      .position-button:hover,
      .position-button.active {
        color: #fff;
        background: rgba(14, 165, 233, 0.22);
        border-color: rgba(56, 189, 248, 0.72);
      }

      .custom-position-note {
        margin-top: 5px;
        color: #93c5fd;
        font-size: 9px;
        text-align: center;
      }

      .range-input {
        width: 100%;
        height: 18px;
        margin: 0;
        accent-color: #38bdf8;
        cursor: pointer;
      }

      #text-color {
        width: 100%;
        height: 34px;
        padding: 2px 5px;
        background: rgba(255, 255, 255, 0.055);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        cursor: pointer;
      }

      .sync-controls {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 5px;
      }

      .sync-button {
        min-height: 32px;
        padding: 4px 6px;
        color: #dbeafe;
        background: rgba(255, 255, 255, 0.055);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
      }

      .sync-button small {
        display: block;
        margin-top: 1px;
        color: #94a3b8;
        font-size: 8px;
        font-weight: 700;
        line-height: 1;
      }

      .sync-button:hover,
      .sync-button:focus-visible {
        color: #fff;
        background: rgba(14, 165, 233, 0.22);
        border-color: rgba(56, 189, 248, 0.72);
        outline: none;
      }

      .sync-button:disabled {
        opacity: 0.4;
        cursor: default;
      }

      .sync-button.sync-primary {
        color: #fff;
        background: #0284c7;
        border-color: #38bdf8;
      }

      .sync-help {
        margin: 5px 1px 0;
        color: #94a3b8;
        font-size: 9px;
        line-height: 1.4;
      }

      .anchor-select {
        width: 100%;
        height: 32px;
        padding: 0 8px;
        overflow: hidden;
        color: #e2e8f0;
        background: rgba(15, 23, 42, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.13);
        border-radius: 8px;
        font-size: 10px;
        text-overflow: ellipsis;
      }

      .anchor-actions {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        margin-top: 6px;
        gap: 5px;
      }

      .check-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
      }

      .check-label {
        display: flex;
        min-height: 32px;
        padding: 6px 8px;
        align-items: center;
        gap: 7px;
        color: #dbeafe;
        background: rgba(255, 255, 255, 0.045);
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 8px;
        font-size: 10px;
        cursor: pointer;
      }

      .check-label input {
        width: 14px;
        height: 14px;
        margin: 0;
        accent-color: #38bdf8;
      }

      .quality-help {
        margin-top: 5px;
        color: #94a3b8;
        font-size: 9px;
        line-height: 1.45;
      }

      .settings-footer {
        display: flex;
        margin-top: 12px;
        align-items: stretch;
        gap: 7px;
      }

      .settings-save-note {
        margin-top: 11px;
        color: #94a3b8;
        font-size: 9px;
        line-height: 1.45;
        text-align: center;
      }

      .reset-button,
      .save-view-button {
        min-height: 34px;
        padding: 0 10px;
        color: #dbeafe;
        background: rgba(255, 255, 255, 0.07);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        font-size: 10px;
        cursor: pointer;
      }

      .reset-button:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.13);
      }

      .reset-button {
        flex: 0 0 auto;
      }

      .save-view-button {
        flex: 1 1 auto;
        color: #fff;
        background: #0284c7;
        border-color: #38bdf8;
        font-size: 11px;
        font-weight: 800;
        box-shadow: 0 5px 14px rgba(2, 132, 199, 0.25);
      }

      .save-view-button:hover,
      .save-view-button:focus-visible {
        background: #0ea5e9;
        border-color: #7dd3fc;
        outline: none;
      }

      .visually-hidden {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        padding: 0 !important;
        margin: -1px !important;
        overflow: hidden !important;
        clip: rect(0 0 0 0) !important;
        white-space: nowrap !important;
        border: 0 !important;
      }

      @media (prefers-reduced-motion: reduce) {
        .connection-dot.live,
        .message.new-message {
          animation: none;
        }

        .reaction-float {
          animation-duration: 650ms;
        }
      }
    </style>

    <div id="overlay-root">
      <div id="reaction-layer" class="reaction-layer" aria-hidden="true"></div>
      <section id="panel" class="panel" role="region" aria-label="한국어 실시간 번역" hidden>
        <header id="drag-handle" class="header" title="끌어서 위치 이동">
          <span id="connection-dot" class="connection-dot" aria-hidden="true"></span>
          <div class="header-copy">
            <div class="header-title">
              <span>한국어 실시간 번역</span>
              <span id="live-label" class="live-label offline">대기</span>
            </div>
            <div id="session-title" class="session-title">번역 세션을 찾는 중…</div>
          </div>
          <div class="header-actions">
            <a id="source-link" class="source-link" href="${TRANSLATOR_HOME}" target="_blank" rel="noopener noreferrer" title="원본 번역 사이트 열기" aria-label="원본 번역 사이트 열기">↗</a>
            <button id="position-cycle-button" class="icon-button" type="button" title="채팅창 위치 순환" aria-label="채팅창 위치 순환"><svg class="position-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 4h10.5A4.5 4.5 0 0 1 20 8.5V16"/><path d="m17 13 3 3 3-3"/><path d="M19 20H8.5A4.5 4.5 0 0 1 4 15.5V8"/><path d="m1 11 3-3 3 3"/></svg></button>
            <button id="lock-button" class="icon-button" type="button" title="위치·크기 잠금" aria-label="위치와 크기 잠금" aria-pressed="false"><svg class="lock-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4.75" y="10.75" width="14.5" height="9.5" rx="2.4"/><path class="lock-closed" d="M8.2 10.75V7.6a3.8 3.8 0 0 1 7.6 0v3.15"/><path class="lock-open" d="M8.2 10.75V7.4a3.8 3.8 0 0 1 7.3-1.4"/></svg></button>
            <button id="settings-button" class="icon-button" type="button" title="표시 설정" aria-label="표시 설정">⚙</button>
            <button id="close-button" class="icon-button" type="button" title="숨기기 (영상에 다시 열기 버튼이 남습니다)" aria-label="번역창 숨기기"><svg class="close-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.75 6.75 17.25 17.25M17.25 6.75 6.75 17.25"/></svg></button>
          </div>
        </header>

        <div id="quick-sync-bar" class="quick-sync-bar" hidden>
          <div class="quick-sync-heading">
            <span id="quick-sync-heading-label" class="quick-sync-heading-label">자막 싱크 빠른 조절</span>
            <output id="quick-sync-value" class="quick-sync-value">0.0초</output>
          </div>
          <div class="quick-sync-controls" aria-label="자막 싱크 빠른 조절">
            <button class="quick-sync-button" type="button" data-quick-sync-ms="-5000" title="자막을 5초 늦게">−5초</button>
            <button class="quick-sync-button" type="button" data-quick-sync-ms="-1000" title="자막을 1초 늦게">−1초</button>
            <button class="quick-sync-button" type="button" data-quick-sync-ms="-500" title="자막을 0.5초 늦게">−0.5초</button>
            <button class="quick-sync-button" type="button" data-quick-sync-ms="0" title="이 영상 싱크를 0초로 초기화">0초</button>
            <button class="quick-sync-button" type="button" data-quick-sync-ms="500" title="자막을 0.5초 빠르게">+0.5초</button>
            <button class="quick-sync-button" type="button" data-quick-sync-ms="1000" title="자막을 1초 빠르게">+1초</button>
            <button class="quick-sync-button" type="button" data-quick-sync-ms="5000" title="자막을 5초 빠르게">+5초</button>
          </div>
        </div>

        <div class="body">
          <div class="session-bar">
            <select id="session-select" class="session-select" aria-label="진행 중인 번역 선택">
              <option value="">진행 중인 번역을 찾는 중…</option>
            </select>
            <button id="refresh-button" class="icon-button refresh-button" type="button" title="지금 새로고침" aria-label="지금 새로고침">↻</button>
          </div>

          <div id="settings" class="settings" hidden>
            <div id="live-delay-section" class="setting-section" hidden>
              <div class="setting-label">
                <span>라이브 자막 싱크</span>
                <output id="live-delay-value" class="setting-value">0.0초 · 즉시</output>
              </div>
              <div class="sync-controls">
                <button id="live-delay-much-less-button" class="sync-button" type="button">−5초<small>늦게</small></button>
                <button id="live-delay-one-less-button" class="sync-button" type="button">−1초<small>늦게</small></button>
                <button id="live-delay-less-button" class="sync-button" type="button">−0.5초<small>늦게</small></button>
                <button id="live-delay-zero-button" class="sync-button" type="button">0초<small>즉시</small></button>
                <button id="live-delay-more-button" class="sync-button" type="button">+0.5초<small>빠르게</small></button>
                <button id="live-delay-one-more-button" class="sync-button" type="button">+1초<small>빠르게</small></button>
                <button id="live-delay-much-more-button" class="sync-button" type="button">+5초<small>빠르게</small></button>
              </div>
              <div class="sync-help">현재 상태를 기준으로 −는 더 늦게, +는 더 빠르게 표시합니다. 라이브는 도착 즉시인 0초보다 앞당길 수 없으며 −120초까지 늦출 수 있습니다.</div>
            </div>

            <div id="subtitle-sync-section" class="setting-section" hidden>
              <div class="setting-label">
                <span>이 영상 미세 싱크</span>
                <output id="subtitle-offset-value" class="setting-value">0.0초</output>
              </div>
              <div class="sync-controls">
                <button id="sync-much-slower-button" class="sync-button" type="button">−5초</button>
                <button id="sync-one-slower-button" class="sync-button" type="button">−1초</button>
                <button id="sync-slower-button" class="sync-button" type="button">−0.5초</button>
                <button id="sync-zero-button" class="sync-button" type="button">0초</button>
                <button id="sync-faster-button" class="sync-button" type="button">+0.5초</button>
                <button id="sync-one-faster-button" class="sync-button" type="button">+1초</button>
                <button id="sync-much-faster-button" class="sync-button" type="button">+5초</button>
              </div>
              <div class="sync-help">0초가 다시보기의 보정된 기본 영점입니다. 이 방송에만 저장되며, +는 더 일찍, −는 더 늦게 표시합니다.</div>
            </div>

            <div id="replay-sync-section" class="setting-section" hidden>
              <div class="setting-label">
                <span>다시보기 기준 자막 맞춤</span>
                <output id="replay-sync-value" class="setting-value">자동 · 라이브 시작 시각</output>
              </div>
              <select id="replay-anchor-select" class="anchor-select" aria-label="기준으로 사용할 번역 선택">
                <option value="">번역을 불러오는 중…</option>
              </select>
              <div class="anchor-actions">
                <button id="save-replay-anchor-button" class="sync-button sync-primary" type="button">선택 자막을 현재 영상 시각에 맞추기</button>
                <button id="reset-replay-anchor-button" class="sync-button" type="button">자동 기준</button>
              </div>
              <div id="replay-sync-help" class="sync-help">위버스 원본의 초 단위 라이브 시작 시각을 자동 기준으로 사용합니다. 어긋나는 예외 방송은 대사 하나를 직접 맞출 수 있습니다.</div>
            </div>

            <div class="setting-section">
              <div class="setting-label">
                <span>자막창 위치</span>
                <span id="position-value" class="setting-value">오른쪽 아래</span>
              </div>
              <div class="position-grid">
                <button class="position-button" type="button" data-position="top-left">↖ 왼쪽 위</button>
                <button class="position-button" type="button" data-position="top-right">↗ 오른쪽 위</button>
                <button class="position-button" type="button" data-position="bottom-left">↙ 왼쪽 아래</button>
                <button class="position-button" type="button" data-position="bottom-right">↘ 오른쪽 아래</button>
              </div>
              <div id="custom-position-note" class="custom-position-note" hidden>제목을 끌어 직접 이동한 위치입니다.</div>
            </div>

            <div class="setting-section">
              <label class="setting-label" for="font-size">
                <span>채팅 글씨 크기</span>
                <output id="font-size-value" class="setting-value">17px</output>
              </label>
              <input id="font-size" class="range-input" type="range" min="12" max="28" step="1" value="17">
            </div>

            <div class="setting-section">
              <label class="setting-label" for="background-opacity">
                <span>배경 투명도</span>
                <output id="background-opacity-value" class="setting-value">22%</output>
              </label>
              <input id="background-opacity" class="range-input" type="range" min="0" max="100" step="1" value="22">
              <div class="sync-help">0%는 불투명, 100%는 완전히 투명합니다.</div>
            </div>

            <div class="setting-section">
              <label class="setting-label" for="panel-width">
                <span>채팅창 너비</span>
                <output id="panel-width-value" class="setting-value">390px</output>
              </label>
              <input id="panel-width" class="range-input" type="range" min="220" max="4096" step="10" value="390">
            </div>

            <div class="setting-section">
              <label class="setting-label" for="text-color">
                <span>채팅 글씨 색상</span>
                <output id="text-color-value" class="setting-value">#FFFFFF</output>
              </label>
              <input id="text-color" type="color" value="#ffffff" aria-label="채팅 글씨 색상">
            </div>

            <div class="setting-section">
              <label class="setting-label" for="text-outline-width">
                <span>글자 테두리 굵기</span>
                <output id="text-outline-width-value" class="setting-value">2px</output>
              </label>
              <input id="text-outline-width" class="range-input" type="range" min="1" max="4" step="1" value="2">
            </div>

            <div id="highest-quality-section" class="setting-section">
              <label class="check-label">
                <input id="prefer-highest-quality" type="checkbox">
                <span>항상 가능한 최고 화질</span>
              </label>
              <div class="quality-help">켜면 방송마다 1080p처럼 제공되는 해상도 중 가장 높은 값을 자동 선택합니다. 데이터 사용량이 늘 수 있습니다.</div>
            </div>

            <div class="setting-section check-grid">
              <label class="check-label">
                <input id="layout-locked" type="checkbox">
                <span>위치·크기 잠금</span>
              </label>
              <label class="check-label">
                <input id="video-click-priority" type="checkbox">
                <span>영상 클릭 우선</span>
              </label>
              <label class="check-label">
                <input id="show-time" type="checkbox" checked>
                <span>시간(초) 표시</span>
              </label>
              <label class="check-label">
                <input id="show-translator" type="checkbox" checked>
                <span>번역자 1회 표시</span>
              </label>
              <label class="check-label">
                <input id="show-border" type="checkbox" checked>
                <span>창 테두리 표시</span>
              </label>
              <label class="check-label">
                <input id="show-text-outline" type="checkbox" checked>
                <span>글자 검은 테두리</span>
              </label>
            </div>

            <div class="settings-save-note">영상 클릭 우선은 자막 본문이 마우스를 가로채지 않게 하며 상단 버튼은 계속 사용할 수 있습니다. 배경 투명도 100%와 테두리 끔을 함께 쓰면 글자만 남습니다. 라이브 번역 중에는 익명 접속 신호를 보내 인간 번역기 사이트의 현재 시청자 수에 포함됩니다.</div>
            <div class="settings-footer">
              <button id="reset-button" class="reset-button" type="button">표시 설정 초기화</button>
              <button id="save-view-button" class="save-view-button" type="button">저장하고 번역 보기</button>
            </div>
          </div>

          <div id="translator-credit" class="translator-credit" hidden></div>
          <ol id="messages" class="messages" aria-live="off" aria-label="한국어 번역 자막" hidden></ol>
          <div id="subtitle-announcer" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"></div>
          <button id="latest-message-button" class="latest-message-button" type="button" title="가장 최근 자막으로 이동" aria-label="가장 최근 자막으로 이동" hidden>↓ 최신 자막</button>
          <div id="empty-state" class="empty-state">진행 중인 한국어 번역을 찾고 있습니다.</div>
          <div id="reaction-bar" class="reaction-bar" role="group" aria-label="인간 번역기 라이브 리액션" title="누르면 현재 공개 번역 세션에 익명 리액션이 전송됩니다." hidden>
            <button class="reaction-button" type="button" data-reaction-key="clap" title="귀여워" aria-label="귀여워"><img class="reaction-icon" src="${CUTE_REACTION_ICON_URL}" alt="" draggable="false"></button>
            <button class="reaction-button" type="button" data-reaction-key="heart" title="사랑해요" aria-label="사랑해요">❤️</button>
            <button class="reaction-button" type="button" data-reaction-key="lol" title="ㅋㅋㅋㅋ" aria-label="ㅋㅋㅋㅋ">😂</button>
            <button class="reaction-button" type="button" data-reaction-key="sob" title="슬퍼요" aria-label="슬퍼요">😭</button>
            <button class="reaction-button" type="button" data-reaction-key="fire" title="개쩐다" aria-label="개쩐다">🔥</button>
            <button class="reaction-button" type="button" data-reaction-key="wow" title="헐" aria-label="헐">😮</button>
          </div>
          <footer class="status-bar">
            <span id="status-text" class="status-text">연결 준비 중…</span>
            <span id="drag-hint" class="drag-hint">제목: 이동 · 테두리: 크기</span>
          </footer>
        </div>
        <span class="resize-handle resize-n" data-resize="n" aria-hidden="true"></span>
        <span class="resize-handle resize-ne" data-resize="ne" aria-hidden="true"></span>
        <span class="resize-handle resize-e" data-resize="e" aria-hidden="true"></span>
        <span class="resize-handle resize-se" data-resize="se" aria-hidden="true"></span>
        <span class="resize-handle resize-s" data-resize="s" aria-hidden="true"></span>
        <span class="resize-handle resize-sw" data-resize="sw" aria-hidden="true"></span>
        <span class="resize-handle resize-w" data-resize="w" aria-hidden="true"></span>
        <span class="resize-handle resize-nw" data-resize="nw" aria-hidden="true"></span>
      </section>
      <button id="restore-button" class="restore-button" type="button" hidden>🌐 한국어 번역 열기</button>
    </div>
  `;

  const dom = {
    panel: shadow.getElementById("panel"),
    reactionLayer: shadow.getElementById("reaction-layer"),
    restoreButton: shadow.getElementById("restore-button"),
    dragHandle: shadow.getElementById("drag-handle"),
    connectionDot: shadow.getElementById("connection-dot"),
    liveLabel: shadow.getElementById("live-label"),
    sessionTitle: shadow.getElementById("session-title"),
    sourceLink: shadow.getElementById("source-link"),
    positionCycleButton: shadow.getElementById("position-cycle-button"),
    lockButton: shadow.getElementById("lock-button"),
    settingsButton: shadow.getElementById("settings-button"),
    closeButton: shadow.getElementById("close-button"),
    quickSyncBar: shadow.getElementById("quick-sync-bar"),
    quickSyncHeadingLabel: shadow.getElementById("quick-sync-heading-label"),
    quickSyncValue: shadow.getElementById("quick-sync-value"),
    quickSyncButtons: [...shadow.querySelectorAll("[data-quick-sync-ms]")],
    sessionSelect: shadow.getElementById("session-select"),
    refreshButton: shadow.getElementById("refresh-button"),
    settingsPanel: shadow.getElementById("settings"),
    positionValue: shadow.getElementById("position-value"),
    positionButtons: [...shadow.querySelectorAll("[data-position]")],
    customPositionNote: shadow.getElementById("custom-position-note"),
    fontSize: shadow.getElementById("font-size"),
    fontSizeValue: shadow.getElementById("font-size-value"),
    backgroundOpacity: shadow.getElementById("background-opacity"),
    backgroundOpacityValue: shadow.getElementById("background-opacity-value"),
    panelWidth: shadow.getElementById("panel-width"),
    panelWidthValue: shadow.getElementById("panel-width-value"),
    textColor: shadow.getElementById("text-color"),
    textColorValue: shadow.getElementById("text-color-value"),
    textOutlineWidth: shadow.getElementById("text-outline-width"),
    textOutlineWidthValue: shadow.getElementById("text-outline-width-value"),
    liveDelaySection: shadow.getElementById("live-delay-section"),
    liveDelayValue: shadow.getElementById("live-delay-value"),
    liveDelayMuchLessButton: shadow.getElementById("live-delay-much-less-button"),
    liveDelayOneLessButton: shadow.getElementById("live-delay-one-less-button"),
    liveDelayLessButton: shadow.getElementById("live-delay-less-button"),
    liveDelayZeroButton: shadow.getElementById("live-delay-zero-button"),
    liveDelayMoreButton: shadow.getElementById("live-delay-more-button"),
    liveDelayOneMoreButton: shadow.getElementById("live-delay-one-more-button"),
    liveDelayMuchMoreButton: shadow.getElementById("live-delay-much-more-button"),
    subtitleSyncSection: shadow.getElementById("subtitle-sync-section"),
    subtitleOffsetValue: shadow.getElementById("subtitle-offset-value"),
    syncMuchSlowerButton: shadow.getElementById("sync-much-slower-button"),
    syncOneSlowerButton: shadow.getElementById("sync-one-slower-button"),
    syncSlowerButton: shadow.getElementById("sync-slower-button"),
    syncZeroButton: shadow.getElementById("sync-zero-button"),
    syncFasterButton: shadow.getElementById("sync-faster-button"),
    syncOneFasterButton: shadow.getElementById("sync-one-faster-button"),
    syncMuchFasterButton: shadow.getElementById("sync-much-faster-button"),
    replaySyncSection: shadow.getElementById("replay-sync-section"),
    replaySyncValue: shadow.getElementById("replay-sync-value"),
    replayAnchorSelect: shadow.getElementById("replay-anchor-select"),
    saveReplayAnchorButton: shadow.getElementById("save-replay-anchor-button"),
    resetReplayAnchorButton: shadow.getElementById("reset-replay-anchor-button"),
    replaySyncHelp: shadow.getElementById("replay-sync-help"),
    showTime: shadow.getElementById("show-time"),
    showTranslator: shadow.getElementById("show-translator"),
    showBorder: shadow.getElementById("show-border"),
    showTextOutline: shadow.getElementById("show-text-outline"),
    highestQualitySection: shadow.getElementById("highest-quality-section"),
    preferHighestQuality: shadow.getElementById("prefer-highest-quality"),
    layoutLocked: shadow.getElementById("layout-locked"),
    videoClickPriority: shadow.getElementById("video-click-priority"),
    resetButton: shadow.getElementById("reset-button"),
    saveViewButton: shadow.getElementById("save-view-button"),
    translatorCredit: shadow.getElementById("translator-credit"),
    subtitleAnnouncer: shadow.getElementById("subtitle-announcer"),
    resizeHandles: [...shadow.querySelectorAll("[data-resize]")],
    messages: shadow.getElementById("messages"),
    latestMessageButton: shadow.getElementById("latest-message-button"),
    reactionBar: shadow.getElementById("reaction-bar"),
    reactionButtons: [...shadow.querySelectorAll("[data-reaction-key]")],
    emptyState: shadow.getElementById("empty-state"),
    statusText: shadow.getElementById("status-text"),
    dragHint: shadow.getElementById("drag-hint")
  };

  function broadcastRouteMatch(route = location.pathname) {
    return /^\/[^/]+\/(live|media)\/([0-9]+-[0-9]+)\/?$/.exec(
      String(route || "")
    );
  }

  function isWeversePage() {
    return location.origin === WEVERSE_ORIGIN;
  }

  function isInstagramPage() {
    return location.origin === INSTAGRAM_ORIGIN;
  }

  function instagramLiveRouteMatch(route = location.pathname) {
    const match = /^\/([a-z0-9._]{1,30})\/live\/?$/i.exec(
      String(route || "")
    );
    return match && INSTAGRAM_MEMBER_HANDLES.has(match[1].toLocaleLowerCase())
      ? match
      : null;
  }

  function isLiveRoute() {
    if (isInstagramPage()) {
      return Boolean(instagramLiveRouteMatch());
    }
    const match = broadcastRouteMatch();
    if (!match) {
      return false;
    }
    if (match[1] === "live") {
      return true;
    }
    const postId = match[2];
    const hasLiveReplayEvidence = Boolean(
      hookedTimings.get(match[2])?.liveToVod === true ||
      document.querySelector('[class*="live-chat-list"]')
    );
    if (hasLiveReplayEvidence) {
      state.recognizedLiveReplayPostIds.add(postId);
      while (state.recognizedLiveReplayPostIds.size > 20) {
        state.recognizedLiveReplayPostIds.delete(
          state.recognizedLiveReplayPostIds.values().next().value
        );
      }
    }
    return hasLiveReplayEvidence || state.recognizedLiveReplayPostIds.has(postId);
  }

  function waitForInitialPageContent() {
    if (document.readyState !== "loading") {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      document.addEventListener("DOMContentLoaded", resolve, { once: true });
    });
  }

  function readBroadcastInfo() {
    if (isInstagramPage()) {
      const username = instagramLiveRouteMatch()?.[1] || "Instagram";
      return {
        startedAt: null,
        publishedAt: null,
        onAirStartAt: null,
        exactOnAirStart: false,
        liveToVod: false,
        videoType: "LIVE",
        title: `${username} Instagram 라이브`,
        author: username,
        live: true,
        route: location.pathname,
        platform: "instagram"
      };
    }
    const rawLines = String(document.body?.innerText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const replayIndex = rawLines.findIndex((line) => line === "LIVE Replay");
    const detailLines = replayIndex >= 0 ? rawLines.slice(0, replayIndex) : rawLines;
    const createdLabelIndex = detailLines.findIndex(
      (line) => line.toLocaleLowerCase() === "created at"
    );
    const datePattern = /^(?:(\d{4})\.\s*)?(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{1,2}):(\d{2})$/;
    let dateLine = createdLabelIndex >= 0 ? detailLines[createdLabelIndex + 1] : "";
    let dateMatch = datePattern.exec(dateLine || "");
    if (!dateMatch) {
      dateLine = detailLines.find((line) => datePattern.test(line)) || "";
      dateMatch = datePattern.exec(dateLine);
    }

    // 화면 표시는 초가 생략되므로 세션 선택용 근사 시각으로만 보관합니다.
    // 실제 라이브 시작 초는 공식 게시물 데이터의 onAirStartAt으로 보완합니다.
    let publishedAt = null;
    if (dateMatch) {
      const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
      let year = dateMatch[1] ? Number(dateMatch[1]) : now.getUTCFullYear();
      const month = Number(dateMatch[2]);
      const day = Number(dateMatch[3]);
      const hour = Number(dateMatch[4]);
      const minute = Number(dateMatch[5]);
      let candidate = Date.UTC(year, month - 1, day, hour - 9, minute);
      if (!dateMatch[1] && candidate - Date.now() > 7 * 24 * 60 * 60 * 1000) {
        year -= 1;
        candidate = Date.UTC(year, month - 1, day, hour - 9, minute);
      }
      publishedAt = candidate;
    }

    const playCountIndex = detailLines.findIndex(
      (line) => line.toLocaleLowerCase() === "play count"
    );
    const semanticTitle = document.querySelector(
      'h3[class*="media-post-header"][class*="title"]'
    )?.textContent?.trim() || "";
    const title = semanticTitle ||
      (playCountIndex > 0 ? detailLines[playCountIndex - 1] : "");
    const officialIndex = detailLines.findIndex(
      (line) => line.toLocaleLowerCase() === "official"
    );
    let author = officialIndex > 0 ? detailLines[officialIndex - 1] : "";
    if (!author) {
      const shareIndex = detailLines.findIndex((line) => line === "공유");
      author = shareIndex >= 0 ? detailLines[shareIndex + 1] || "" : "";
    }

    const video = findVideoElement();
    const duration = Number(video?.duration);
    const hasLiveLabel = detailLines.some((line) =>
      /^(?:live|실시간|ライブ)$/i.test(line)
    );
    const live = hasLiveLabel || duration === Infinity
      ? true
      : Number.isFinite(duration) && duration > 0
        ? false
        : null;
    return {
      startedAt: publishedAt,
      publishedAt,
      onAirStartAt: publishedAt,
      exactOnAirStart: false,
      liveToVod: false,
      videoType: "",
      title,
      author,
      live,
      route: location.pathname,
      platform: "weverse"
    };
  }

  const HOOK_MESSAGE_SOURCE = "weverse-korean-overlay-page-hook";
  const HOOK_REQUEST_SOURCE = "weverse-korean-overlay-content";
  const HOOK_REQUEST_TYPE = "request-timing";
  const hookedTimings = new Map();

  function postIdFromRoute(route) {
    return broadcastRouteMatch(route)?.[2] || null;
  }

  function requestHookedTiming() {
    const postId = postIdFromRoute(location.pathname);
    if (!postId) {
      return;
    }
    window.postMessage(
      {
        source: HOOK_REQUEST_SOURCE,
        type: HOOK_REQUEST_TYPE,
        postId
      },
      location.origin
    );
  }

  function currentBroadcastInfo() {
    const info = readBroadcastInfo();
    const postId = postIdFromRoute(location.pathname);
    const timing = postId ? hookedTimings.get(postId) : null;
    if (!timing) {
      return info;
    }
    return {
      ...info,
      startedAt: timing.onAirStartAt,
      publishedAt: timing.publishedAt,
      onAirStartAt: timing.onAirStartAt,
      exactOnAirStart: true,
      liveToVod: timing.liveToVod,
      videoType: timing.videoType,
      live: timing.videoType === "LIVE"
        ? true
        : timing.videoType === "VOD" || timing.liveToVod === true
          ? false
          : info.live
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== HOOK_MESSAGE_SOURCE) {
      return;
    }
    const postId = typeof data.postId === "string" ? data.postId : "";
    const onAirStartAt = Number(data.onAirStartAt);
    const earliest = Date.UTC(2018, 0, 1);
    if (
      !/^[0-9]+-[0-9]+$/.test(postId) ||
      !Number.isFinite(onAirStartAt) ||
      onAirStartAt < earliest ||
      onAirStartAt > Date.now() + 24 * 60 * 60 * 1000
    ) {
      return;
    }
    const publishedAt = Number(data.publishedAt);
    const videoType = String(data.videoType || "").toUpperCase();
    hookedTimings.set(postId, {
      onAirStartAt,
      publishedAt:
        Number.isFinite(publishedAt) && publishedAt >= earliest
          ? publishedAt
          : onAirStartAt,
      liveToVod: data.liveToVod === true,
      videoType: videoType === "LIVE" || videoType === "VOD"
        ? videoType
        : ""
    });
    if (hookedTimings.size > 20) {
      hookedTimings.delete(hookedTimings.keys().next().value);
    }
    if (postId !== postIdFromRoute(location.pathname)) {
      return;
    }

    state.broadcastInfo = currentBroadcastInfo();
    if (liveSync.lastSessions) {
      void handleSessionsPush(liveSync.lastSessions, {
        forceMessages: true
      });
    }
    applySettingsToUi();
    if (state.settings.visible && isLiveRoute()) {
      void refreshSessions({ forceMessages: true });
    }
    renderReplaySyncControls();
    syncMessagesToPlayback({ force: true, forceBottom: false });
  });
  requestHookedTiming();

  function ensureHostParent() {
    const targetParent = document.fullscreenElement || document.documentElement;
    if (!targetParent) {
      requestAnimationFrame(ensureHostParent);
      return;
    }
    if (targetParent && host.parentNode !== targetParent) {
      targetParent.appendChild(host);
    }
  }

  function readStoredSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(result ? result[STORAGE_KEY] : null);
      });
    });
  }

  function isValidReactionClientId(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(value || "")
    );
  }

  function readReactionClientId() {
    return new Promise((resolve) => {
      chrome.storage.local.get([REACTION_CLIENT_ID_KEY], (result) => {
        if (chrome.runtime.lastError) {
          resolve("");
          return;
        }
        const storedId = result?.[REACTION_CLIENT_ID_KEY];
        resolve(isValidReactionClientId(storedId) ? storedId : "");
      });
    });
  }

  function persistReactionClientId(clientId) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        { [REACTION_CLIENT_ID_KEY]: clientId },
        () => resolve(!chrome.runtime.lastError)
      );
    });
  }

  async function ensureReactionClientId() {
    if (isValidReactionClientId(state.reactionClientId)) {
      return state.reactionClientId;
    }
    const clientId = crypto.randomUUID();
    state.reactionClientId = clientId;
    await persistReactionClientId(clientId);
    return clientId;
  }

  function normalizeReplayAnchors(rawAnchors) {
    const raw = rawAnchors && typeof rawAnchors === "object" ? rawAnchors : {};
    const normalized = {};
    for (const [route, anchor] of Object.entries(raw)) {
      if (
        !/^\/[^/]+\/(?:live|media)\/[0-9]+-[0-9]+\/?$/.test(route) ||
        !anchor ||
        typeof anchor !== "object" ||
        typeof anchor.sessionId !== "string" ||
        !anchor.sessionId
      ) {
        continue;
      }
      const storedClockVersion = Number(anchor.clockVersion);
      const usesSupportedClock =
        storedClockVersion === 2 ||
        storedClockVersion === 3 ||
        storedClockVersion === REPLAY_CLOCK_VERSION;
      const hasManualBase =
        usesSupportedClock &&
        anchor.baseTimestamp !== null &&
        anchor.baseTimestamp !== undefined &&
        Number.isFinite(Number(anchor.baseTimestamp)) &&
        typeof anchor.messageId === "string" &&
        Boolean(anchor.messageId);
      const rawOffset = usesSupportedClock ? Number(anchor.offsetMs) : 0;
      const offsetMs = Number.isFinite(rawOffset)
        ? Math.round(
            Math.min(
              REPLAY_OFFSET_LIMIT_MS,
              Math.max(-REPLAY_OFFSET_LIMIT_MS, rawOffset)
            ) / 500
          ) * 500
        : 0;
      normalized[route] = {
        clockVersion:
          storedClockVersion === 2 || storedClockVersion === 3
            ? storedClockVersion
            : REPLAY_CLOCK_VERSION,
        sessionId: anchor.sessionId,
        messageId: hasManualBase ? anchor.messageId : "",
        messageText: hasManualBase
          ? String(anchor.messageText || "").slice(0, 120)
          : "",
        baseTimestamp: hasManualBase ? Number(anchor.baseTimestamp) : null,
        offsetMs,
        videoTime: Math.max(0, Number(anchor.videoTime) || 0),
        calibratedAt: Number(anchor.calibratedAt) || 0
      };
    }
    return normalized;
  }

  function readReplayAnchors() {
    return new Promise((resolve) => {
      chrome.storage.local.get([REPLAY_ANCHORS_KEY], (result) => {
        if (chrome.runtime.lastError) {
          resolve({});
          return;
        }
        resolve(normalizeReplayAnchors(result?.[REPLAY_ANCHORS_KEY]));
      });
    });
  }

  function persistReplayAnchors() {
    const recentEntries = Object.entries(state.replayAnchors)
      .sort(
        (left, right) =>
          Number(right[1]?.calibratedAt || 0) - Number(left[1]?.calibratedAt || 0)
      )
      .slice(0, 100);
    state.replayAnchors = Object.fromEntries(recentEntries);
    chrome.storage.local.set({ [REPLAY_ANCHORS_KEY]: state.replayAnchors });
  }

  function persistSettingsSoon() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      chrome.storage.sync.set({ [STORAGE_KEY]: state.settings });
    }, 100);
  }

  function persistSettingsNow() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    chrome.storage.sync.set({ [STORAGE_KEY]: state.settings });
  }

  function updateSettings(patch, { persist = true } = {}) {
    const previousSettings = state.settings;
    state.settings = core.normalizeSettings({ ...state.settings, ...patch });
    const contentStructureChanged =
      previousSettings.showTime !== state.settings.showTime ||
      previousSettings.showTranslator !== state.settings.showTranslator;
    applySettingsToUi({ renderContent: contentStructureChanged });
    if (persist) {
      persistSettingsSoon();
    }
  }

  function positionLabel(position) {
    const labels = {
      "top-left": "왼쪽 위",
      "top-right": "오른쪽 위",
      "bottom-left": "왼쪽 아래",
      "bottom-right": "오른쪽 아래",
      custom: "직접 이동"
    };
    return labels[position] || labels["bottom-right"];
  }

  function subtitleOffsetLabel(offsetMs) {
    const seconds = Number(offsetMs) / 1000;
    if (!Number.isFinite(seconds) || seconds === 0) {
      return "0.0초";
    }
    return seconds > 0
      ? `+${seconds.toFixed(1)}초 빠르게`
      : `${seconds.toFixed(1)}초 느리게`;
  }

  function isLiveTranslationMode() {
    if (!state.selectedSession) {
      return false;
    }
    if (
      state.broadcastInfo?.liveToVod === true ||
      state.broadcastInfo?.live === false
    ) {
      return false;
    }
    return Boolean(
      state.selectedSession.live || state.broadcastInfo?.live === true
    );
  }

  function isReplayTranslationMode() {
    if (!state.selectedSession) {
      return false;
    }
    return Boolean(
      state.broadcastInfo?.liveToVod === true ||
      (!state.selectedSession.live && state.broadcastInfo?.live !== true) ||
      state.broadcastInfo?.live === false
    );
  }

  function liveReactionsEnabled() {
    return Boolean(
      state.settings.visible &&
      !state.settingsOpen &&
      !dom.panel.hidden &&
      isLiveRoute() &&
      isLiveTranslationMode()
    );
  }

  function renderReactionControls() {
    const enabled = liveReactionsEnabled();
    dom.reactionLayer.hidden =
      !enabled || dom.panel.classList.contains("player-menu-overlap");
    dom.reactionBar.hidden = !enabled;
    dom.panel.classList.toggle("reactions-enabled", enabled);
    if (!enabled) {
      dom.reactionLayer.replaceChildren();
    }
    for (const button of dom.reactionButtons) {
      button.disabled = !enabled;
    }
  }

  function reactionOrigin(sourceButton) {
    const sourceRect = sourceButton?.getBoundingClientRect?.();
    const playerRect = state.boundPlayerRoot?.getBoundingClientRect?.() ||
      state.boundVideo?.getBoundingClientRect?.();
    const sourceCenter = sourceRect
      ? {
          x: sourceRect.left + sourceRect.width / 2,
          y: sourceRect.top + sourceRect.height / 2
        }
      : null;
    if (
      sourceCenter &&
      playerRect &&
      sourceCenter.x >= playerRect.left &&
      sourceCenter.x <= playerRect.right &&
      sourceCenter.y >= playerRect.top &&
      sourceCenter.y <= playerRect.bottom
    ) {
      return sourceCenter;
    }
    if (playerRect?.width > 0 && playerRect?.height > 0) {
      return {
        x: playerRect.right - Math.min(54, playerRect.width * 0.12),
        y: playerRect.bottom - Math.min(76, playerRect.height * 0.18)
      };
    }
    if (sourceCenter) {
      return sourceCenter;
    }
    return {
      x: window.innerWidth * 0.82,
      y: window.innerHeight * 0.78
    };
  }

  function showReaction(reactionKey, sourceButton = null) {
    const reaction = REACTION_BY_KEY.get(reactionKey);
    if (
      !reaction ||
      !liveReactionsEnabled() ||
      dom.panel.classList.contains("player-menu-overlap")
    ) {
      return;
    }
    const origin = reactionOrigin(sourceButton);
    const float = document.createElement("span");
    float.className = "reaction-float";
    if (reaction.iconUrl) {
      const icon = document.createElement("img");
      icon.className = "reaction-float-icon";
      icon.src = reaction.iconUrl;
      icon.alt = "";
      icon.draggable = false;
      float.appendChild(icon);
    } else {
      float.textContent = reaction.emoji;
    }
    float.style.setProperty("--reaction-x", `${Math.round(origin.x)}px`);
    float.style.setProperty("--reaction-y", `${Math.round(origin.y)}px`);
    float.style.setProperty(
      "--reaction-drift",
      `${Math.round((Math.random() - 0.5) * 72)}px`
    );
    float.style.setProperty(
      "--reaction-lift",
      `${Math.round(145 + Math.random() * 55)}px`
    );
    float.style.setProperty(
      "--reaction-duration",
      `${Math.round(1450 + Math.random() * 420)}ms`
    );
    while (dom.reactionLayer.childElementCount >= MAX_FLOATING_REACTIONS) {
      dom.reactionLayer.firstElementChild?.remove();
    }
    dom.reactionLayer.appendChild(float);
    const remove = () => float.remove();
    float.addEventListener("animationend", remove, { once: true });
    setTimeout(remove, 2400);
  }

  function liveDelayLabel(delayMs) {
    const seconds = Math.max(0, Number(delayMs) || 0) / 1000;
    return seconds === 0
      ? "0.0초 · 즉시"
      : `−${seconds.toFixed(1)}초 늦게`;
  }

  function renderLiveDelayControls() {
    const isLive = isLiveTranslationMode();
    const delayMs = Number(state.settings.liveDelayMs) || 0;
    dom.liveDelaySection.hidden = !isLive;
    dom.liveDelayValue.textContent = liveDelayLabel(delayMs);
    dom.liveDelayMuchLessButton.disabled = !isLive || delayMs >= 120000;
    dom.liveDelayOneLessButton.disabled = !isLive || delayMs >= 120000;
    dom.liveDelayLessButton.disabled = !isLive || delayMs >= 120000;
    dom.liveDelayZeroButton.disabled = !isLive || delayMs === 0;
    dom.liveDelayMoreButton.disabled = !isLive || delayMs <= 0;
    dom.liveDelayOneMoreButton.disabled = !isLive || delayMs <= 0;
    dom.liveDelayMuchMoreButton.disabled = !isLive || delayMs <= 0;
  }

  function currentReplaySyncRecord() {
    const record = state.replayAnchors[location.pathname];
    if (
      !record ||
      record.sessionId !== state.selectedSession?._id
    ) {
      return null;
    }
    return record;
  }

  function activeReplayClockVersion() {
    return state.broadcastInfo?.exactOnAirStart === true &&
      Number.isFinite(Number(state.broadcastInfo?.onAirStartAt))
      ? REPLAY_CLOCK_VERSION
      : 2;
  }

  function migrateReplayClockToOnAir() {
    const route = location.pathname;
    const record = state.replayAnchors[route];
    const broadcastStart = Number(state.broadcastInfo?.onAirStartAt);
    const sessionStart = Number(
      state.selectedSession?.startedAt || state.selectedSession?._creationTime
    );
    if (
      !record ||
      Number(record.clockVersion) >= REPLAY_CLOCK_VERSION ||
      record.sessionId !== state.selectedSession?._id ||
      state.broadcastInfo?.exactOnAirStart !== true ||
      !Number.isFinite(broadcastStart)
    ) {
      return;
    }

    const hasManualBase =
      record.baseTimestamp !== null &&
      record.baseTimestamp !== undefined &&
      Number.isFinite(Number(record.baseTimestamp));
    const offsetMs = core.migrateReplayOffset({
      offsetMs: record.offsetMs,
      sessionStartedAt: sessionStart,
      broadcastStartedAt: broadcastStart,
      hasManualBase,
      limitMs: REPLAY_OFFSET_LIMIT_MS
    });
    state.replayAnchors = {
      ...state.replayAnchors,
      [route]: {
        ...record,
        clockVersion: REPLAY_CLOCK_VERSION,
        offsetMs,
        calibratedAt: Date.now()
      }
    };
    persistReplayAnchors();
  }

  function currentReplayAnchor() {
    const record = currentReplaySyncRecord();
    return record &&
      record.baseTimestamp !== null &&
      Number.isFinite(Number(record.baseTimestamp))
      ? record
      : null;
  }

  function currentReplayOffsetMs() {
    const offset = Number(currentReplaySyncRecord()?.offsetMs);
    return Number.isFinite(offset) ? offset : 0;
  }

  function renderReplayOffsetControls() {
    const isReplay = isReplayTranslationMode();
    const isLive = isLiveTranslationMode();
    const replayOffsetMs = currentReplayOffsetMs();
    const liveDelayMs = Number(state.settings.liveDelayMs) || 0;
    dom.subtitleSyncSection.hidden = !isReplay;
    dom.quickSyncBar.hidden = !isReplay && !isLive;
    dom.subtitleOffsetValue.textContent = subtitleOffsetLabel(replayOffsetMs);
    dom.quickSyncHeadingLabel.textContent = isLive
      ? "라이브 싱크 · − 늦게 / + 빠르게"
      : "다시보기 조절 · − 늦게 / + 빠르게";
    dom.quickSyncValue.textContent = isLive
      ? liveDelayLabel(liveDelayMs)
      : subtitleOffsetLabel(replayOffsetMs);
    dom.syncMuchSlowerButton.disabled =
      !isReplay || state.adPlaying || replayOffsetMs <= -REPLAY_OFFSET_LIMIT_MS;
    dom.syncOneSlowerButton.disabled =
      !isReplay || state.adPlaying || replayOffsetMs <= -REPLAY_OFFSET_LIMIT_MS;
    dom.syncSlowerButton.disabled =
      !isReplay || state.adPlaying || replayOffsetMs <= -REPLAY_OFFSET_LIMIT_MS;
    dom.syncZeroButton.disabled =
      !isReplay || state.adPlaying || replayOffsetMs === 0;
    dom.syncFasterButton.disabled =
      !isReplay || state.adPlaying || replayOffsetMs >= REPLAY_OFFSET_LIMIT_MS;
    dom.syncOneFasterButton.disabled =
      !isReplay || state.adPlaying || replayOffsetMs >= REPLAY_OFFSET_LIMIT_MS;
    dom.syncMuchFasterButton.disabled =
      !isReplay || state.adPlaying || replayOffsetMs >= REPLAY_OFFSET_LIMIT_MS;
    for (const button of dom.quickSyncButtons) {
      const deltaMs = Number(button.dataset.quickSyncMs) || 0;
      if (isLive) {
        const seconds = Math.abs(deltaMs) / 1000;
        button.title = deltaMs === 0
          ? "라이브 자막을 도착 즉시 표시"
          : `현재보다 ${seconds}초 ${deltaMs < 0 ? "늦게" : "빠르게"} 표시`;
        button.setAttribute("aria-label", button.title);
        button.disabled =
          state.adPlaying ||
          (deltaMs === 0 && liveDelayMs === 0) ||
          (deltaMs < 0 && liveDelayMs >= 120000) ||
          (deltaMs > 0 && liveDelayMs <= 0);
      } else {
        const seconds = Math.abs(deltaMs) / 1000;
        button.title = deltaMs === 0
          ? "이 영상 싱크를 0초로 초기화"
          : `현재보다 ${seconds}초 ${deltaMs < 0 ? "늦게" : "빠르게"} 표시`;
        button.setAttribute("aria-label", button.title);
        button.disabled =
          !isReplay ||
          state.adPlaying ||
          (deltaMs === 0 && replayOffsetMs === 0) ||
          (deltaMs < 0 && replayOffsetMs <= -REPLAY_OFFSET_LIMIT_MS) ||
          (deltaMs > 0 && replayOffsetMs >= REPLAY_OFFSET_LIMIT_MS);
      }
    }
  }

  function renderReplaySyncControls() {
    const isReplay = isReplayTranslationMode();
    renderReplayOffsetControls();
    dom.replaySyncSection.hidden = !isReplay;
    if (!isReplay) {
      return;
    }

    const sortedMessages = [...state.messages]
      .filter(
        (message) =>
          message &&
          typeof message._id === "string" &&
          typeof message.text === "string" &&
          Number.isFinite(Number(message._creationTime))
      )
      .sort(
        (left, right) =>
          Number(left._creationTime) - Number(right._creationTime)
      );
    const anchor = currentReplayAnchor();
    const optionsKey = [
      state.selectedSession._id,
      sortedMessages.length,
      sortedMessages[0]?._id || "",
      sortedMessages.at(-1)?._id || ""
    ].join(":");

    if (optionsKey !== state.anchorOptionsKey) {
      const previousValue = dom.replayAnchorSelect.value;
      dom.replayAnchorSelect.replaceChildren();
      if (sortedMessages.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "번역을 불러오는 중…";
        dom.replayAnchorSelect.appendChild(option);
      } else {
        const fragment = document.createDocumentFragment();
        for (const message of sortedMessages) {
          const option = document.createElement("option");
          option.value = message._id;
          const compactText = message.text.replace(/\s+/g, " ").trim().slice(0, 70);
          option.textContent = `${core.formatKoreanTime(message._creationTime)} · ${compactText}`;
          fragment.appendChild(option);
        }
        dom.replayAnchorSelect.appendChild(fragment);
        const preferredValue = anchor?.messageId || previousValue;
        dom.replayAnchorSelect.value = sortedMessages.some(
          (message) => message._id === preferredValue
        ) ? preferredValue : sortedMessages[0]._id;
      }
      state.anchorOptionsKey = optionsKey;
    } else if (anchor?.messageId) {
      dom.replayAnchorSelect.value = anchor.messageId;
    }

    const hasMessages = sortedMessages.length > 0;
    dom.replayAnchorSelect.disabled = !hasMessages;
    dom.saveReplayAnchorButton.disabled = !hasMessages || state.adPlaying;
    dom.resetReplayAnchorButton.disabled = !anchor;
    const hasBroadcastStart = Number.isFinite(
      Number(state.broadcastInfo?.onAirStartAt)
    );
    const hasExactOnAirStart =
      hasBroadcastStart && state.broadcastInfo?.exactOnAirStart === true;
    dom.replaySyncValue.textContent = anchor
      ? "이 방송 수동 맞춤"
      : hasExactOnAirStart
        ? "자동 · 라이브 시작 시각"
        : hasBroadcastStart
          ? "자동 · 화면 시작 시각"
          : "자동 · 번역 세션 시각";
    dom.replaySyncHelp.textContent = state.adPlaying
      ? "광고가 끝나고 본편이 보일 때 정확한 싱크를 맞출 수 있습니다."
      : anchor
        ? `영상 ${formatPlaybackTime(anchor.videoTime)}에 “${anchor.messageText || "선택한 번역"}” 기준으로 저장됨`
        : hasExactOnAirStart
          ? `위버스의 초 단위 라이브 시작 시각 ${core.formatKoreanTime(state.broadcastInfo.onAirStartAt)}을 자동 기준으로 사용합니다. 어긋나는 예외 방송은 대사 하나를 직접 맞출 수 있습니다.`
          : hasBroadcastStart
            ? `위버스 화면의 분 단위 시작 시각 ${core.formatKoreanTime(state.broadcastInfo.onAirStartAt)}을 임시 기준으로 사용합니다. 초 단위 시각이 도착하면 자동으로 전환됩니다.`
            : "정확한 시작 시각을 확인할 수 없어 번역 세션 시각을 임시 기준으로 사용합니다.";
  }

  function applySettingsToUi({ renderContent = false } = {}) {
    const settings = state.settings;
    const opacity = settings.backgroundOpacity / 100;
    dom.panel.style.setProperty("--panel-width", `${settings.panelWidth}px`);
    dom.panel.style.setProperty(
      "--panel-height",
      settings.panelHeight === null ? "auto" : `${settings.panelHeight}px`
    );
    dom.panel.style.setProperty("--message-font-size", `${settings.fontSize}px`);
    dom.panel.style.setProperty("--message-text-color", settings.textColor);
    dom.panel.style.setProperty(
      "--message-outline-width",
      settings.showTextOutline ? `${settings.textOutlineWidth}px` : "0px"
    );
    dom.panel.style.setProperty(
      "--panel-background",
      `rgba(8, 10, 15, ${opacity.toFixed(2)})`
    );

    dom.panel.classList.toggle("settings-open", state.settingsOpen);
    dom.panel.classList.toggle("borderless", !settings.showBorder);
    dom.panel.classList.toggle("layout-locked", settings.layoutLocked);
    dom.panel.classList.toggle(
      "video-click-priority",
      settings.videoClickPriority && !state.settingsOpen
    );
    dom.panel.classList.toggle(
      "minimal",
      settings.backgroundOpacity === 0 &&
        !settings.showBorder &&
        !state.settingsOpen
    );
    dom.settingsPanel.hidden = !state.settingsOpen;
    const liveRoute = isLiveRoute();
    dom.panel.hidden = !settings.visible || !liveRoute;
    dom.restoreButton.hidden = settings.visible || !liveRoute;
    const nextPosition = core.nextPresetPosition(settings.position);
    const nextPositionLabel = positionLabel(nextPosition);
    dom.positionCycleButton.title = `채팅창 위치 순환 · 다음: ${nextPositionLabel}`;
    dom.positionCycleButton.setAttribute(
      "aria-label",
      `채팅창 위치를 ${nextPositionLabel}로 이동`
    );
    dom.settingsButton.setAttribute("aria-pressed", String(state.settingsOpen));
    dom.lockButton.title = settings.layoutLocked
      ? "위치·크기 잠금 해제"
      : "위치·크기 잠금";
    dom.lockButton.setAttribute(
      "aria-label",
      settings.layoutLocked ? "위치와 크기 잠금 해제" : "위치와 크기 잠금"
    );
    dom.lockButton.setAttribute("aria-pressed", String(settings.layoutLocked));
    dom.dragHandle.title = settings.layoutLocked
      ? "위치와 크기가 잠겨 있습니다"
      : "끌어서 위치 이동";
    dom.dragHint.textContent = settings.layoutLocked
      ? "위치·크기 잠김"
      : settings.videoClickPriority
        ? "영상 클릭 우선"
        : "제목: 이동 · 테두리: 크기";

    dom.fontSize.value = String(settings.fontSize);
    dom.fontSizeValue.textContent = `${settings.fontSize}px`;
    const backgroundTransparency = 100 - settings.backgroundOpacity;
    dom.backgroundOpacity.value = String(backgroundTransparency);
    dom.backgroundOpacityValue.textContent = `${backgroundTransparency}%`;
    dom.panelWidth.value = String(settings.panelWidth);
    dom.panelWidthValue.textContent = `${settings.panelWidth}px`;
    dom.textColor.value = settings.textColor;
    dom.textColorValue.textContent = settings.textColor.toUpperCase();
    dom.textOutlineWidth.value = String(settings.textOutlineWidth);
    dom.textOutlineWidthValue.textContent = `${settings.textOutlineWidth}px`;
    dom.textOutlineWidth.disabled = !settings.showTextOutline;
    renderLiveDelayControls();
    renderReplayOffsetControls();
    dom.showTime.checked = settings.showTime;
    dom.showTranslator.checked = settings.showTranslator;
    dom.showBorder.checked = settings.showBorder;
    dom.showTextOutline.checked = settings.showTextOutline;
    dom.preferHighestQuality.checked = settings.preferHighestQuality;
    dom.highestQualitySection.hidden = !isWeversePage();
    dom.layoutLocked.checked = settings.layoutLocked;
    dom.videoClickPriority.checked = settings.videoClickPriority;
    dom.positionValue.textContent = positionLabel(settings.position);
    dom.customPositionNote.hidden = settings.position !== "custom";
    for (const button of dom.positionButtons) {
      button.classList.toggle("active", button.dataset.position === settings.position);
    }

    if (renderContent || state.messageRenderPending) {
      renderMessages();
    }
    scheduleLiveRelease();
    renderReplaySyncControls();
    renderReactionControls();
    requestPlacement();
  }

  function queryTranslator(path, args) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "cutiestreet-query", path, args },
        (response) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error("확장프로그램 연결을 확인해 주세요."));
            return;
          }
          if (!response || !response.ok) {
            reject(new Error(response?.error || "번역 데이터를 읽지 못했습니다."));
            return;
          }
          resolve(response.value);
        }
      );
    });
  }

  function setConnectionState(kind) {
    if (state.connectionState === kind) {
      return;
    }
    state.connectionState = kind;
    dom.connectionDot.classList.toggle("live", kind === "live");
    dom.connectionDot.classList.toggle("archive", kind === "archive");
    dom.connectionDot.classList.toggle("error", kind === "error");
  }

  function setStatus(text) {
    dom.statusText.textContent = text;
  }

  function renderSessions() {
    const previousValue = state.selectedSession?._id || "";
    dom.sessionSelect.replaceChildren();

    if (state.sessions.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "사용 가능한 번역이 없습니다";
      dom.sessionSelect.appendChild(option);
      dom.sessionSelect.disabled = true;
    } else {
      if (!state.selectedSession) {
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "자동 일치 없음 · 직접 선택";
        dom.sessionSelect.appendChild(placeholder);
      }
      for (const session of state.sessions) {
        const option = document.createElement("option");
        option.value = session._id;
        option.textContent = `${session.live ? "LIVE" : "보관"} · ${
          session.title || "제목 없는 번역"
        }`;
        dom.sessionSelect.appendChild(option);
      }
      dom.sessionSelect.disabled = false;
      dom.sessionSelect.value = previousValue;
    }

    if (state.selectedSession) {
      const isLiveSession = isLiveTranslationMode();
      dom.sessionTitle.textContent = state.selectedSession.title || "한국어 번역";
      dom.liveLabel.textContent = isLiveSession
        ? "LIVE"
        : state.broadcastInfo?.live
          ? "번역 종료"
          : "다시보기";
      dom.liveLabel.classList.toggle("offline", !isLiveSession);
      dom.sourceLink.href = core.isValidSessionId(state.selectedSession._id)
        ? `${TRANSLATOR_HOME}s/${encodeURIComponent(state.selectedSession._id)}`
        : `${TRANSLATOR_HOME}archive`;
      setConnectionState(isLiveSession ? "live" : "archive");
    } else {
      dom.sessionTitle.textContent = state.sessions.length
        ? "이 방송과 일치하는 번역을 선택해 주세요"
        : "한국어 번역을 기다리는 중";
      dom.liveLabel.textContent = state.sessions.length ? "선택" : "대기";
      dom.liveLabel.classList.add("offline");
      dom.sourceLink.href = `${TRANSLATOR_HOME}archive`;
      setConnectionState("idle");
    }
    renderLiveDelayControls();
    renderReplaySyncControls();
    renderReactionControls();
  }

  const LIVE_SYNC_INITIAL_RETRY_MS = 2000;
  const LIVE_SYNC_MAX_RETRY_MS = 30000;
  const liveSync = {
    client: null,
    libraryUnavailable: false,
    connectionUnsubscribe: null,
    connected: false,
    sessionsUnsubscribe: null,
    messagesUnsubscribe: null,
    messagesKey: null,
    messagesReadyKey: null,
    reactionsUnsubscribe: null,
    reactionsKey: null,
    reactionsReadyKey: null,
    seenReactionIds: new Set(),
    lastSessions: null,
    sessionsRevision: 0,
    appliedGeneration: null,
    appliedPath: null,
    appliedBroadcastKey: null,
    broadcastCheckedAt: 0,
    retryAt: 0,
    retryDelayMs: LIVE_SYNC_INITIAL_RETRY_MS,
    retryTimer: null,
    fallingBack: false
  };

  const livePresence = {
    surfaceId: crypto.randomUUID(),
    key: null,
    roomId: null,
    refreshTimer: null,
    leaveSent: false
  };

  function clearLiveSyncRetryTimer() {
    if (liveSync.retryTimer !== null) {
      clearTimeout(liveSync.retryTimer);
      liveSync.retryTimer = null;
    }
  }

  function stopMessagesSubscription() {
    const unsubscribe = liveSync.messagesUnsubscribe;
    liveSync.messagesUnsubscribe = null;
    liveSync.messagesKey = null;
    liveSync.messagesReadyKey = null;
    if (typeof unsubscribe === "function") {
      try {
        unsubscribe();
      } catch (_error) {
        // 이미 닫힌 구독은 무시합니다.
      }
    }
  }

  function stopReactionsSubscription() {
    const unsubscribe = liveSync.reactionsUnsubscribe;
    liveSync.reactionsUnsubscribe = null;
    liveSync.reactionsKey = null;
    liveSync.reactionsReadyKey = null;
    liveSync.seenReactionIds.clear();
    if (typeof unsubscribe === "function") {
      try {
        unsubscribe();
      } catch (_error) {
        // 이미 닫힌 구독은 무시합니다.
      }
    }
  }

  function sendPresenceSignal(type, roomId) {
    try {
      chrome.runtime.sendMessage(
        {
          type,
          roomId,
          surfaceId: livePresence.surfaceId
        },
        () => void chrome.runtime.lastError
      );
    } catch (_error) {
      // 백그라운드가 다시 시작되면 다음 등록 신호에서 복구합니다.
    }
  }

  function stopLivePresence() {
    if (livePresence.refreshTimer !== null) {
      clearInterval(livePresence.refreshTimer);
      livePresence.refreshTimer = null;
    }
    const roomId = livePresence.roomId;
    const shouldSendLeave = Boolean(livePresence.key && !livePresence.leaveSent);
    livePresence.key = null;
    livePresence.roomId = null;
    if (shouldSendLeave) {
      livePresence.leaveSent = true;
      sendPresenceSignal("cutiestreet-presence-stop", roomId);
    }
  }

  function startLivePresence(roomId) {
    const key = `${state.routeGeneration}:${roomId}`;
    if (livePresence.key === key) {
      return;
    }
    stopLivePresence();
    livePresence.key = key;
    livePresence.roomId = roomId;
    livePresence.leaveSent = false;
    sendPresenceSignal("cutiestreet-presence-start", roomId);
    livePresence.refreshTimer = setInterval(() => {
      if (livePresence.key === key) {
        sendPresenceSignal("cutiestreet-presence-start", roomId);
      }
    }, PRESENCE_SURFACE_REFRESH_MS);
  }

  function syncLivePresence() {
    const roomId = state.selectedSession?._id || "";
    if (
      !core.isValidSessionId(roomId) ||
      !state.settings.visible ||
      !isLiveRoute() ||
      !isLiveTranslationMode()
    ) {
      stopLivePresence();
      return;
    }
    startLivePresence(roomId);
  }

  function closeLiveSyncClient() {
    stopMessagesSubscription();
    stopReactionsSubscription();
    const connectionUnsubscribe = liveSync.connectionUnsubscribe;
    liveSync.connectionUnsubscribe = null;
    if (typeof connectionUnsubscribe === "function") {
      try {
        connectionUnsubscribe();
      } catch (_error) {
        // 이미 닫힌 연결 상태 구독은 무시합니다.
      }
    }
    const sessionsUnsubscribe = liveSync.sessionsUnsubscribe;
    liveSync.sessionsUnsubscribe = null;
    if (typeof sessionsUnsubscribe === "function") {
      try {
        sessionsUnsubscribe();
      } catch (_error) {
        // 이미 닫힌 구독은 무시합니다.
      }
    }
    const client = liveSync.client;
    liveSync.client = null;
    liveSync.connected = false;
    if (client && typeof client.close === "function") {
      try {
        Promise.resolve(client.close()).catch(() => {});
      } catch (_error) {
        // 종료 오류가 HTTP 대체 경로를 막지 않게 합니다.
      }
    }
  }

  function stopLiveSync({ clearSessions = false, cancelRetry = true } = {}) {
    if (cancelRetry) {
      clearLiveSyncRetryTimer();
      liveSync.retryAt = 0;
    }
    closeLiveSyncClient();
    liveSync.appliedGeneration = null;
    liveSync.appliedPath = null;
    liveSync.appliedBroadcastKey = null;
    liveSync.broadcastCheckedAt = 0;
    if (clearSessions) {
      liveSync.lastSessions = null;
    }
  }

  function markLiveSyncHealthy() {
    clearLiveSyncRetryTimer();
    liveSync.retryAt = 0;
    liveSync.retryDelayMs = LIVE_SYNC_INITIAL_RETRY_MS;
  }

  function scheduleLiveSyncRetry() {
    clearLiveSyncRetryTimer();
    const delayMs = liveSync.retryDelayMs;
    liveSync.retryAt = Date.now() + delayMs;
    liveSync.retryDelayMs = Math.min(
      LIVE_SYNC_MAX_RETRY_MS,
      delayMs * 2
    );
    liveSync.retryTimer = setTimeout(() => {
      liveSync.retryTimer = null;
      liveSync.retryAt = 0;
      if (
        state.settings.visible &&
        isLiveRoute() &&
        document.visibilityState !== "hidden"
      ) {
        startLiveSync({ forceMessages: true });
      }
    }, delayMs);
  }

  function convexClient() {
    if (liveSync.client) {
      return liveSync.client;
    }
    if (
      liveSync.libraryUnavailable ||
      (liveSync.retryAt > 0 && Date.now() < liveSync.retryAt)
    ) {
      return null;
    }
    const ClientConstructor = globalThis.convex?.ConvexClient;
    if (typeof ClientConstructor !== "function") {
      liveSync.libraryUnavailable = true;
      return null;
    }
    try {
      const client = new ClientConstructor(CONVEX_URL, {
        unsavedChangesWarning: false
      });
      liveSync.client = client;
      if (typeof client.subscribeToConnectionState === "function") {
        liveSync.connectionUnsubscribe =
          client.subscribeToConnectionState((connection) => {
            if (liveSync.client !== client) {
              return;
            }
            liveSync.connected = connection?.isWebSocketConnected === true;
            if (liveSync.connected) {
              markLiveSyncHealthy();
            } else {
              liveSync.messagesReadyKey = null;
              state.lastSessionRefreshAt = 0;
            }
          });
      }
      if (typeof client.connectionState === "function") {
        liveSync.connected =
          client.connectionState()?.isWebSocketConnected === true;
      }
      return client;
    } catch (_error) {
      scheduleLiveSyncRetry();
      return null;
    }
  }

  function isLiveSyncConnected() {
    const client = liveSync.client;
    if (!client) {
      return false;
    }
    if (typeof client.connectionState === "function") {
      try {
        liveSync.connected =
          client.connectionState()?.isWebSocketConnected === true;
      } catch (_error) {
        liveSync.connected = false;
      }
    }
    return liveSync.connected;
  }

  function hasReadyMessagesSubscription() {
    return Boolean(
      isLiveSyncConnected() &&
      liveSync.messagesUnsubscribe &&
      liveSync.messagesKey &&
      liveSync.messagesReadyKey === liveSync.messagesKey
    );
  }

  function fallBackToPolling(error) {
    if (liveSync.fallingBack) {
      return;
    }
    liveSync.fallingBack = true;
    closeLiveSyncClient();
    liveSync.appliedGeneration = null;
    liveSync.appliedPath = null;
    liveSync.appliedBroadcastKey = null;
    scheduleLiveSyncRetry();
    setConnectionState("error");
    setStatus(
      error instanceof Error
        ? `실시간 연결 실패 · 일반 연결로 전환 (${error.message})`
        : "실시간 연결 실패 · 일반 연결로 전환"
    );
    Promise.resolve()
      .then(async () => {
        await refreshSessions({ forceMessages: true, forceHttp: true });
      })
      .finally(() => {
        liveSync.fallingBack = false;
      });
  }

  function broadcastInfoKey(info) {
    return [
      info?.live === true ? "live" : info?.live === false ? "vod" : "unknown",
      Number(info?.startedAt) || 0,
      info?.exactOnAirStart === true ? "exact" : "approximate",
      String(info?.title || "").trim().slice(0, 200),
      String(info?.author || "").trim().slice(0, 200)
    ].join("|");
  }

  async function handleSessionsPush(
    value,
    { forceMessages = false, fromSubscription = false } = {}
  ) {
    if (fromSubscription) {
      markLiveSyncHealthy();
      liveSync.sessionsRevision += 1;
    }
    liveSync.lastSessions = value;
    if (!state.settings.visible || !isLiveRoute()) {
      return;
    }
    const requestGeneration = state.routeGeneration;
    const requestPath = location.pathname;
    liveSync.appliedGeneration = requestGeneration;
    liveSync.appliedPath = requestPath;
    state.lastSessionRefreshAt = Date.now();
    state.broadcastInfo = currentBroadcastInfo();
    liveSync.appliedBroadcastKey = broadcastInfoKey(state.broadcastInfo);
    const sessions = Array.isArray(value)
      ? value.filter((session) => session && core.isValidSessionId(session._id))
      : [];
    await applySessions(sessions, { forceMessages });
  }

  function subscribeSessions() {
    const client = convexClient();
    if (!client || liveSync.sessionsUnsubscribe) {
      return;
    }
    const requestGeneration = state.routeGeneration;
    liveSync.sessionsUnsubscribe = client.onUpdate(
      "sessions:list",
      { limit: 200 },
      (value) => {
        if (
          liveSync.client !== client ||
          requestGeneration !== state.routeGeneration
        ) {
          return;
        }
        void handleSessionsPush(value, { fromSubscription: true });
      },
      (error) => {
        if (
          liveSync.client === client &&
          requestGeneration === state.routeGeneration
        ) {
          fallBackToPolling(error);
        }
      }
    );
  }

  function reactionId(reaction) {
    const value = String(reaction?.tapId || reaction?._id || "");
    return /^[a-z0-9_-]{8,128}$/i.test(value) ? value : "";
  }

  function rememberReactionId(id) {
    if (!id) {
      return;
    }
    liveSync.seenReactionIds.add(id);
    while (liveSync.seenReactionIds.size > MAX_SEEN_REACTION_IDS) {
      liveSync.seenReactionIds.delete(liveSync.seenReactionIds.values().next().value);
    }
  }

  function applyReactionSnapshot(value, key) {
    const reactions = Array.isArray(value)
      ? value.filter(
          (reaction) =>
            reactionId(reaction) && REACTION_BY_KEY.has(reaction?.key)
        ).slice(0, MAX_REACTION_SNAPSHOT)
      : [];
    if (liveSync.reactionsReadyKey !== key) {
      for (const reaction of reactions) {
        rememberReactionId(reactionId(reaction));
      }
      liveSync.reactionsReadyKey = key;
      return;
    }
    const newestAllowedAt = Date.now() - REACTION_MAX_AGE_MS;
    for (const reaction of [...reactions].reverse()) {
      const id = reactionId(reaction);
      if (liveSync.seenReactionIds.has(id)) {
        continue;
      }
      rememberReactionId(id);
      const createdAt = Number(reaction?._creationTime);
      if (!Number.isFinite(createdAt) || createdAt < newestAllowedAt) {
        continue;
      }
      showReaction(reaction.key);
    }
  }

  function syncReactionsSubscription() {
    const client = liveSync.client;
    const session = state.selectedSession;
    const broadcastId = session?._id || "";
    if (
      !client ||
      !session ||
      !core.isValidSessionId(broadcastId) ||
      !state.settings.visible ||
      !isLiveRoute() ||
      !isLiveTranslationMode()
    ) {
      stopReactionsSubscription();
      return;
    }
    const key = `${state.routeGeneration}:${broadcastId}`;
    if (key === liveSync.reactionsKey) {
      return;
    }
    stopReactionsSubscription();
    liveSync.reactionsKey = key;
    const requestGeneration = state.routeGeneration;
    liveSync.reactionsUnsubscribe = client.onUpdate(
      "reactions:recent",
      { sessionId: broadcastId },
      (value) => {
        if (
          liveSync.client !== client ||
          requestGeneration !== state.routeGeneration ||
          state.selectedSession?._id !== broadcastId ||
          liveSync.reactionsKey !== key
        ) {
          return;
        }
        markLiveSyncHealthy();
        applyReactionSnapshot(value, key);
      },
      () => {
        if (
          liveSync.client === client &&
          requestGeneration === state.routeGeneration &&
          state.selectedSession?._id === broadcastId
        ) {
          stopReactionsSubscription();
        }
      }
    );
  }

  function syncMessagesSubscription({ force = false } = {}) {
    syncLivePresence();
    const client = convexClient();
    const session = state.selectedSession;
    if (
      !client ||
      !session ||
      !core.isValidSessionId(session._id) ||
      !state.settings.visible ||
      !isLiveRoute()
    ) {
      stopMessagesSubscription();
      stopReactionsSubscription();
      return;
    }
    syncReactionsSubscription();
    const limit = core.messageSubscriptionLimit(session.messageCount);
    const key = `${state.routeGeneration}:${session._id}:${limit}`;
    if (!force && key === liveSync.messagesKey) {
      return;
    }
    stopMessagesSubscription();
    liveSync.messagesKey = key;
    const requestGeneration = state.routeGeneration;
    liveSync.messagesUnsubscribe = client.onUpdate(
      "messages:list",
      { sessionId: session._id, limit },
      (value) => {
        if (
          liveSync.client !== client ||
          requestGeneration !== state.routeGeneration ||
          state.selectedSession?._id !== session._id ||
          liveSync.messagesKey !== key
        ) {
          return;
        }
        markLiveSyncHealthy();
        liveSync.messagesReadyKey = key;
        applyMessages(value, {
          authoritative: true,
          source: "websocket"
        });
      },
      (error) => {
        if (
          liveSync.client === client &&
          requestGeneration === state.routeGeneration &&
          state.selectedSession?._id === session._id
        ) {
          fallBackToPolling(error);
        }
      }
    );
  }

  function startLiveSync({ forceMessages = false } = {}) {
    if (
      !state.settings.visible ||
      !isLiveRoute() ||
      document.visibilityState === "hidden"
    ) {
      stopLiveSync({ clearSessions: true });
      return false;
    }
    const client = convexClient();
    if (!client) {
      return false;
    }
    subscribeSessions();
    const routeChanged =
      liveSync.appliedGeneration !== state.routeGeneration ||
      liveSync.appliedPath !== location.pathname;
    let broadcastChanged = false;
    if (Date.now() - liveSync.broadcastCheckedAt >= 2000) {
      liveSync.broadcastCheckedAt = Date.now();
      broadcastChanged =
        liveSync.appliedBroadcastKey !== null &&
        liveSync.appliedBroadcastKey !== broadcastInfoKey(currentBroadcastInfo());
    }
    if (
      liveSync.lastSessions &&
      (forceMessages || routeChanged || broadcastChanged)
    ) {
      void handleSessionsPush(liveSync.lastSessions, { forceMessages });
    } else {
      syncMessagesSubscription({ force: forceMessages });
    }
    return Boolean(
      isLiveSyncConnected() &&
      liveSync.lastSessions &&
      (!state.selectedSession || hasReadyMessagesSubscription())
    );
  }

  async function requestMessagesForSelection({
    force = false,
    forceHttp = false
  } = {}) {
    if (!forceHttp && isLiveSyncConnected()) {
      syncMessagesSubscription({ force });
      if (hasReadyMessagesSubscription()) {
        return;
      }
    }
    await pollMessages({ force });
  }

  function sessionActivityRevision(session) {
    if (!session || typeof session !== "object") {
      return "";
    }
    return [
      session.live === true ? "live" : "archive",
      Number(session.messageCount) || 0,
      String(session.lastActivityAt ?? ""),
      String(session.lastMessageAt ?? ""),
      String(session.updatedAt ?? ""),
      String(session._updatedAt ?? "")
    ].join("|");
  }

  async function applySessions(
    sessions,
    { forceMessages = false, forceHttpMessages = false } = {}
  ) {
    const previousSession = state.selectedSession;
    const previousSessionId = previousSession?._id || null;
    state.sessions = sessions;
    const manualSession = state.manualSessionPath === location.pathname
      ? sessions.find(
          (session) => session._id === state.settings.selectedSessionId
        ) || null
      : null;
    state.selectedSession = manualSession || core.chooseSessionForBroadcast(
      sessions,
      state.broadcastInfo,
      state.settings.selectedSessionId
    );
    migrateReplayClockToOnAir();
    const selectedSessionId = state.selectedSession?._id || null;
    syncLivePresence();
    const sessionChanged = previousSessionId !== selectedSessionId;
    const sameSession = Boolean(
      selectedSessionId && previousSessionId === selectedSessionId
    );
    const sessionBecameArchive = Boolean(
      sameSession && previousSession?.live && !state.selectedSession?.live
    );
    const archiveMetadataChanged = Boolean(
      sameSession &&
      !isLiveTranslationMode() &&
      sessionActivityRevision(previousSession) !==
        sessionActivityRevision(state.selectedSession)
    );
    const shouldRefreshMessages =
      forceMessages ||
      sessionChanged ||
      sessionBecameArchive ||
      archiveMetadataChanged;

    if (!isLiveTranslationMode()) {
      stopReactionsSubscription();
    }

    if (sessionChanged) {
      clearLiveReleaseTimer();
      state.liveReleasedThrough = null;
      stopMessagesSubscription();
      stopReactionsSubscription();
      state.messageApplyRevision += 1;
      state.messageForcePending = false;
      state.lastArchiveMessageRefreshAt = 0;
      state.messages = [];
      state.seenMessageIds.clear();
      state.hasLoadedMessages = false;
      state.displayedHistoryCount = 0;
      state.unseenSubtitleCount = 0;
      state.anchorOptionsKey = null;
      resetMessageViewportState();
      renderMessages(new Set(), {
        forceBottom: true,
        forceRender: true
      });
    }

    if (
      state.selectedSession &&
      core.isValidSessionId(state.selectedSession._id) &&
      state.selectedSession._id !== state.settings.selectedSessionId
    ) {
      updateSettings({ selectedSessionId: state.selectedSession._id });
    }

    if (!state.selectedSession) {
      stopMessagesSubscription();
      stopReactionsSubscription();
      clearLiveReleaseTimer();
      state.liveReleasedThrough = null;
      state.messages = [];
      state.seenMessageIds.clear();
      state.hasLoadedMessages = false;
      state.displayedHistoryCount = 0;
      state.unseenSubtitleCount = 0;
      resetMessageViewportState();
      renderMessages(new Set(), {
        forceBottom: true,
        forceRender: true
      });
      setStatus(
        state.broadcastInfo?.live === true
          ? "진행 중인 공개 번역을 기다리는 중"
          : "일치하는 보관 번역이 없으면 목록에서 직접 선택해 주세요."
      );
    }

    renderSessions();
    if (
      state.selectedSession &&
      shouldRefreshMessages
    ) {
      // 같은 세션의 강제 갱신은 기존 자막을 유지한 채 교체하여 화면이
      // 잠깐 비었다가 다시 나타나는 깜빡임을 만들지 않습니다.
      await requestMessagesForSelection({
        force: true,
        forceHttp: forceHttpMessages
      });
    } else if (state.selectedSession) {
      syncMessagesSubscription();
    }
  }

  async function refreshSessions({
    forceMessages = false,
    forceHttp = false
  } = {}) {
    if (
      !state.settings.visible ||
      !isLiveRoute() ||
      document.visibilityState === "hidden"
    ) {
      stopLiveSync({ clearSessions: true });
      return;
    }
    const liveActive = startLiveSync({ forceMessages });
    if (liveActive && liveSync.lastSessions && !forceHttp) {
      return;
    }
    if (state.sessionRequestRunning) {
      state.sessionRefreshPending = true;
      state.sessionForceMessagesPending ||= forceMessages;
      state.sessionForceHttpPending ||= forceHttp;
      return;
    }

    const requestGeneration = state.routeGeneration;
    const requestPath = location.pathname;
    const sessionsRevisionAtStart = liveSync.sessionsRevision;
    state.sessionRequestRunning = true;
    state.lastSessionRefreshAt = Date.now();
    try {
      state.broadcastInfo = currentBroadcastInfo();
      const value = await queryTranslator("sessions:list", { limit: 200 });
      if (
        requestGeneration !== state.routeGeneration ||
        requestPath !== location.pathname
      ) {
        return;
      }
      if (liveSync.sessionsRevision !== sessionsRevisionAtStart) {
        return;
      }
      const sessions = Array.isArray(value)
        ? value.filter(
            (session) => session && core.isValidSessionId(session._id)
          )
        : [];
      liveSync.lastSessions = sessions;
      await applySessions(sessions, {
        forceMessages,
        forceHttpMessages: forceHttp
      });
    } catch (error) {
      if (
        requestGeneration !== state.routeGeneration ||
        requestPath !== location.pathname
      ) {
        return;
      }
      if (
        liveSync.sessionsRevision !== sessionsRevisionAtStart ||
        (isLiveSyncConnected() && liveSync.lastSessions)
      ) {
        return;
      }
      setConnectionState("error");
      setStatus(error instanceof Error ? error.message : "번역 서버 연결 오류");
    } finally {
      if (requestGeneration === state.routeGeneration) {
        state.sessionRequestRunning = false;
        if (state.sessionRefreshPending) {
          const pendingForceMessages = state.sessionForceMessagesPending;
          const pendingForceHttp = state.sessionForceHttpPending;
          state.sessionRefreshPending = false;
          state.sessionForceMessagesPending = false;
          state.sessionForceHttpPending = false;
          Promise.resolve().then(() => {
            void refreshSessions({
              forceMessages: pendingForceMessages,
              forceHttp: pendingForceHttp
            });
          });
        }
      }
    }
  }

  function formatTranslatorName(name) {
    const value = String(name || "").trim();
    if (!value) {
      return "";
    }
    return /님$/.test(value) ? value : `${value}님`;
  }

  function setTranslatorCredit(name) {
    if (!state.settings.showTranslator || !state.selectedSession) {
      dom.translatorCredit.hidden = true;
      dom.translatorCredit.textContent = "";
      return;
    }
    const translator = formatTranslatorName(
      name || state.selectedSession.startedBy
    );
    if (!translator) {
      dom.translatorCredit.hidden = true;
      dom.translatorCredit.textContent = "";
      return;
    }
    dom.translatorCredit.textContent = `번역: ${translator}`;
    dom.translatorCredit.hidden = false;
  }

  function distanceFromLatestMessage() {
    return Math.max(
      0,
      dom.messages.scrollHeight - dom.messages.scrollTop - dom.messages.clientHeight
    );
  }

  function updateLatestMessageButton() {
    const hasScrollableHistory =
      !dom.messages.hidden &&
      dom.messages.scrollHeight > dom.messages.clientHeight + 1;
    const isAwayFromLatest = distanceFromLatestMessage() > 40;
    if (!hasScrollableHistory || !isAwayFromLatest) {
      state.unseenSubtitleCount = 0;
    }
    const unseenCount = state.unseenSubtitleCount;
    const label = unseenCount > 0
      ? `↓ 최신 자막 · 새 자막 ${unseenCount}개`
      : "↓ 최신 자막";
    dom.latestMessageButton.textContent = label;
    dom.latestMessageButton.title = unseenCount > 0
      ? `새 자막 ${unseenCount}개 · 가장 최근 자막으로 이동`
      : "가장 최근 자막으로 이동";
    dom.latestMessageButton.setAttribute(
      "aria-label",
      unseenCount > 0
        ? `새 자막 ${unseenCount}개가 있습니다. 가장 최근 자막으로 이동`
        : "가장 최근 자막으로 이동"
    );
    dom.latestMessageButton.hidden = !(
      hasScrollableHistory &&
      !state.settingsOpen &&
      isAwayFromLatest
    );
  }

  function updateTranslatorCreditFromScroll() {
    updateLatestMessageButton();
    const items = [...dom.messages.children];
    if (items.length === 0) {
      setTranslatorCredit(state.selectedSession?.startedBy);
      return;
    }
    const distanceFromBottom = distanceFromLatestMessage();
    let activeItem = items[items.length - 1];
    if (distanceFromBottom > 40) {
      const visibleTop = dom.messages.getBoundingClientRect().top + 2;
      activeItem = items.find(
        (item) => item.getBoundingClientRect().bottom > visibleTop
      ) || activeItem;
    }
    setTranslatorCredit(
      activeItem.dataset.translator || state.selectedSession?.startedBy
    );
  }

  function handleMessagesScroll() {
    if (!state.messageAutoScrollPending) {
      state.messageFollowLatest = distanceFromLatestMessage() <= 40;
    }
    updateTranslatorCreditFromScroll();
  }

  function currentSubtitleCutoff() {
    if (!state.selectedSession) {
      return null;
    }
    if (isLiveTranslationMode()) {
      const delayMs = Number(state.settings.liveDelayMs) || 0;
      if (delayMs <= 0) {
        return null;
      }
      const delayedNow = Date.now() - delayMs;
      const releasedThrough = Number(state.liveReleasedThrough);
      return Number.isFinite(releasedThrough)
        ? Math.max(delayedNow, releasedThrough)
        : delayedNow;
    }
    const offsetMs = currentReplayOffsetMs();
    const video = findVideoElement();
    const currentTime = Number(video?.currentTime);
    const rawBroadcastStartedAt = state.broadcastInfo?.onAirStartAt;
    const broadcastStartedAt = rawBroadcastStartedAt === null || rawBroadcastStartedAt === undefined
      ? Number.NaN
      : Number(rawBroadcastStartedAt);
    const sessionStartedAt = Number(
      state.selectedSession.startedAt || state.selectedSession._creationTime
    );
    return core.calculateReplayCutoff({
      sessionStartedAt,
      broadcastStartedAt,
      manualBaseTimestamp: currentReplayAnchor()?.baseTimestamp,
      currentTime,
      subtitleOffsetMs: offsetMs,
      replayBaselineMs: core.REPLAY_LATENCY_BASELINE_MS
    });
  }

  function clearLiveReleaseTimer() {
    if (state.liveReleaseTimer !== null) {
      clearTimeout(state.liveReleaseTimer);
      state.liveReleaseTimer = null;
    }
  }

  function scheduleLiveRelease() {
    clearLiveReleaseTimer();
    const delayMs = Number(state.settings.liveDelayMs) || 0;
    if (
      delayMs <= 0 ||
      !state.settings.visible ||
      !isLiveRoute() ||
      !isLiveTranslationMode() ||
      !state.hasLoadedMessages
    ) {
      return;
    }

    const cutoff = currentSubtitleCutoff();
    let nextMessageTimestamp = Number.POSITIVE_INFINITY;
    for (const message of state.messages) {
      const timestamp = Number(message?._creationTime);
      if (
        Number.isFinite(timestamp) &&
        timestamp > cutoff &&
        timestamp < nextMessageTimestamp
      ) {
        nextMessageTimestamp = timestamp;
      }
    }
    if (!Number.isFinite(nextMessageTimestamp)) {
      return;
    }

    const waitMs = Math.min(
      60000,
      Math.max(25, nextMessageTimestamp + delayMs - Date.now() + 25)
    );
    state.liveReleaseTimer = setTimeout(() => {
      state.liveReleaseTimer = null;
      syncMessagesToPlayback({ force: true });
      scheduleLiveRelease();
    }, waitMs);
  }

  function formatPlaybackTime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const remainder = safeSeconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function updateMessageStatus() {
    if (state.adPlaying) {
      setStatus("광고 재생 중 · 자막 일시정지");
      return;
    }
    const isReplay = isReplayTranslationMode();
    if (isReplay) {
      const video = findVideoElement();
      setStatus(
        `다시보기 ${formatPlaybackTime(video?.currentTime)} · 싱크 ${subtitleOffsetLabel(currentReplayOffsetMs())} · ${state.displayedHistoryCount}개`
      );
      return;
    }
    const delayMs = Number(state.settings.liveDelayMs) || 0;
    setStatus(
      delayMs > 0
        ? `라이브 ${liveDelayLabel(delayMs)} · 전체 ${state.displayedHistoryCount}개`
        : `라이브 즉시 표시 · 전체 ${state.displayedHistoryCount}개`
    );
  }

  function cancelPendingMessageRender() {
    if (state.messageRenderFrame !== null) {
      cancelAnimationFrame(state.messageRenderFrame);
      state.messageRenderFrame = null;
    }
    state.messageAutoScrollPending = false;
  }

  function resetMessageViewportState() {
    cancelPendingMessageRender();
    state.messageRenderPending = false;
    state.messagePendingNewIds.clear();
    state.messageForceBottomPending = false;
    state.messageFollowLatest = true;
    state.messageAutoScrollPending = false;
    if (dom.subtitleAnnouncer) {
      dom.subtitleAnnouncer.textContent = "";
    }
  }

  function captureMessageScrollAnchor(nextMessageIds) {
    const containerRect = dom.messages.getBoundingClientRect();
    const items = [...dom.messages.children];
    let reachedViewport = false;
    for (const element of items) {
      const rect = element.getBoundingClientRect();
      if (!reachedViewport && rect.bottom > containerRect.top) {
        reachedViewport = true;
      }
      if (
        reachedViewport &&
        nextMessageIds.has(element.dataset.messageId)
      ) {
        return {
          element,
          offset: rect.top - containerRect.top
        };
      }
    }
    return null;
  }

  function updateMessageElement(
    item,
    message,
    translator,
    isNewMessage
  ) {
    if (isNewMessage) {
      item.classList.add("new-message");
      clearTimeout(item.__weverseOverlayNewMessageTimer);
      item.__weverseOverlayNewMessageTimer = setTimeout(() => {
        item.classList.remove("new-message");
        item.__weverseOverlayNewMessageTimer = null;
      }, 420);
    }
    const renderSignature = [
      state.settings.showTime ? "1" : "0",
      message._creationTime,
      translator,
      message.text
    ].join("\u0000");
    if (item.__weverseOverlayRenderSignature === renderSignature) {
      return;
    }
    item.__weverseOverlayRenderSignature = renderSignature;
    item.classList.add("message");
    item.dataset.messageId = message._id;
    item.dataset.translator = translator;
    item.dataset.creationTime = String(Number(message._creationTime));
    item.classList.toggle("without-time", !state.settings.showTime);

    let time = item.querySelector(":scope > .message-time");
    if (state.settings.showTime) {
      if (!time) {
        time = document.createElement("time");
        time.className = "message-time";
        item.prepend(time);
      }
      time.dateTime = new Date(Number(message._creationTime)).toISOString();
      time.textContent = core.formatKoreanTime(message._creationTime);
    } else if (time) {
      time.remove();
    }

    let content = item.querySelector(":scope > .message-content");
    if (!content) {
      content = document.createElement("div");
      content.className = "message-content";
      item.appendChild(content);
    }
    let text = content.querySelector(":scope > .message-text");
    if (!text) {
      text = document.createElement("p");
      text.className = "message-text";
      content.appendChild(text);
    }
    if (text.textContent !== message.text) {
      text.textContent = message.text;
    }
  }

  function reconcileMessageElements(visibleMessages, newMessageIds) {
    const existingItems = new Map(
      [...dom.messages.children]
        .filter((item) => item.dataset.messageId)
        .map((item) => [item.dataset.messageId, item])
    );
    const nextMessageIds = new Set(
      visibleMessages.map((message) => message._id)
    );
    // 고정 길이 구독에서 맨 앞 항목이 빠질 때 먼저 제거해야 나머지
    // 수천 개 노드를 매번 한 칸씩 다시 이동시키지 않습니다.
    for (const [messageId, item] of existingItems) {
      if (!nextMessageIds.has(messageId)) {
        item.remove();
        existingItems.delete(messageId);
      }
    }
    let currentTranslator = state.selectedSession?.startedBy || "";

    visibleMessages.forEach((message, index) => {
      if (typeof message.nick === "string" && message.nick.trim()) {
        currentTranslator = message.nick.trim();
      }
      const item = existingItems.get(message._id) || document.createElement("li");
      existingItems.delete(message._id);
      updateMessageElement(
        item,
        message,
        currentTranslator,
        newMessageIds.has(message._id)
      );
      const expectedItem = dom.messages.children[index] || null;
      if (expectedItem !== item) {
        dom.messages.insertBefore(item, expectedItem);
      }
    });

    for (const item of existingItems.values()) {
      item.remove();
    }
  }

  function renderMessages(
    newMessageIds = new Set(),
    { forceBottom = false, forceRender = false } = {}
  ) {
    for (const messageId of newMessageIds) {
      state.messagePendingNewIds.add(messageId);
    }
    const currentMessageIdsAtRender = new Set(
      state.messages.map((message) => message._id)
    );
    for (const messageId of state.messagePendingNewIds) {
      if (!currentMessageIdsAtRender.has(messageId)) {
        state.messagePendingNewIds.delete(messageId);
      }
    }
    state.messageForceBottomPending ||= forceBottom;
    if (state.settingsOpen && !forceRender) {
      state.messageRenderPending = true;
      return;
    }
    const effectiveNewMessageIds = new Set(state.messagePendingNewIds);
    forceBottom ||= state.messageForceBottomPending;
    state.messageRenderPending = false;
    state.messageForceBottomPending = false;
    cancelPendingMessageRender();
    state.adPlaying = isAdPlaying();
    if (state.adPlaying) {
      state.messagePendingNewIds.clear();
      state.messageFollowLatest = true;
      state.unseenSubtitleCount = 0;
      dom.translatorCredit.hidden = true;
      dom.messages.replaceChildren();
      dom.messages.hidden = true;
      updateLatestMessageButton();
      dom.emptyState.hidden = false;
      dom.emptyState.textContent = "광고 재생 중 · 번역은 본편과 함께 잠시 멈춥니다.";
      updateMessageStatus();
      requestPlacement();
      return;
    }
    const cutoffTimestamp = currentSubtitleCutoff();
    const visibleMessages = core.messagesThroughPlayback(
      state.messages,
      cutoffTimestamp
    );
    if (isLiveTranslationMode() && visibleMessages.length > 0) {
      const latestVisibleTimestamp = Math.max(
        ...visibleMessages.map((message) => Number(message._creationTime) || 0)
      );
      state.liveReleasedThrough = Math.max(
        Number(state.liveReleasedThrough) || 0,
        latestVisibleTimestamp
      );
    }
    const previousScrollTop = dom.messages.scrollTop;
    const previousRenderedMessageIds = new Set(
      [...dom.messages.children]
        .map((item) => item.dataset.messageId)
        .filter(Boolean)
    );
    const previousRenderedTimestamps = [...dom.messages.children]
      .map((item) => Number(item.dataset.creationTime))
      .filter(Number.isFinite);
    const previousLatestRenderedTimestamp = previousRenderedTimestamps.length > 0
      ? Math.max(...previousRenderedTimestamps)
      : Number.NEGATIVE_INFINITY;
    const wasAtBottom = forceBottom ||
      state.messageFollowLatest ||
      dom.messages.hidden ||
      distanceFromLatestMessage() <= 40;
    const visibleMessageIds = new Set(
      visibleMessages.map((message) => message._id)
    );
    const previousAnchor = wasAtBottom
      ? null
      : captureMessageScrollAnchor(visibleMessageIds);
    const visibleNewMessageIds = new Set(
      [...effectiveNewMessageIds].filter((messageId) =>
        visibleMessageIds.has(messageId)
      )
    );
    const currentMessageIds = new Set(
      state.messages.map((message) => message._id)
    );
    state.messagePendingNewIds = new Set(
      [...effectiveNewMessageIds].filter((messageId) =>
        currentMessageIds.has(messageId) && !visibleMessageIds.has(messageId)
      )
    );
    const newlyAvailableCount = visibleMessages.reduce(
      (count, message) =>
        count + (
          previousRenderedMessageIds.has(message._id) ||
          Number(message._creationTime) < previousLatestRenderedTimestamp
            ? 0
            : 1
        ),
      0
    );
    state.displayedHistoryCount = visibleMessages.length;
    state.messageFollowLatest = wasAtBottom;
    if (wasAtBottom) {
      state.unseenSubtitleCount = 0;
    } else if (newlyAvailableCount > 0) {
      state.unseenSubtitleCount += newlyAvailableCount;
    }

    if (visibleMessages.length === 0) {
      state.messageAutoScrollPending = false;
      state.unseenSubtitleCount = 0;
      dom.messages.replaceChildren();
      setTranslatorCredit(state.selectedSession?.startedBy);
      dom.messages.hidden = true;
      updateLatestMessageButton();
      dom.emptyState.hidden = false;
      dom.emptyState.textContent = state.selectedSession
        ? isLiveTranslationMode()
          ? "첫 번째 한국어 번역을 기다리고 있습니다."
          : "현재 재생 시점에는 아직 번역이 없습니다."
        : "이 방송과 일치하는 한국어 번역이 없습니다.";
      updateMessageStatus();
      requestPlacement();
      return;
    }

    dom.emptyState.hidden = true;
    dom.messages.hidden = false;
    state.messageAutoScrollPending = true;
    reconcileMessageElements(visibleMessages, visibleNewMessageIds);
    if (visibleNewMessageIds.size > 0) {
      const newestMessage = [...visibleMessages]
        .reverse()
        .find((message) => visibleNewMessageIds.has(message._id));
      if (newestMessage) {
        dom.subtitleAnnouncer.textContent = newestMessage.text;
      }
    }
    if (wasAtBottom) {
      dom.messages.scrollTop = dom.messages.scrollHeight;
    } else if (previousAnchor?.element.parentNode === dom.messages) {
      const nextContainerTop = dom.messages.getBoundingClientRect().top;
      const nextOffset =
        previousAnchor.element.getBoundingClientRect().top - nextContainerTop;
      dom.messages.scrollTop += nextOffset - previousAnchor.offset;
    } else {
      dom.messages.scrollTop = Math.min(
        previousScrollTop,
        dom.messages.scrollHeight
      );
    }
    state.messageRenderFrame = requestAnimationFrame(() => {
      state.messageRenderFrame = null;
      state.messageAutoScrollPending = false;
      handleMessagesScroll();
      requestPlacement();
    });
    updateMessageStatus();
  }

  function isValidTranslatorMessage(message) {
    if (!message || typeof message !== "object") {
      return false;
    }
    const timestamp = Number(message._creationTime);
    const earliest = Date.UTC(2018, 0, 1);
    return (
      typeof message._id === "string" &&
      /^[a-z0-9_-]{1,128}$/i.test(message._id) &&
      typeof message.text === "string" &&
      message.text.length <= 20000 &&
      (message.nick === undefined ||
        (typeof message.nick === "string" && message.nick.length <= 200)) &&
      Number.isFinite(timestamp) &&
      timestamp >= earliest &&
      timestamp <= Date.now() + 24 * 60 * 60 * 1000
    );
  }

  // WebSocket 구독과 HTTP 대체 경로가 같은 방식으로 메시지를 반영합니다.
  // 구독 결과는 현재 목록 전체이므로 삭제도 반영하고, 짧은 HTTP 폴링 결과는
  // 기존 기록에 합쳐 오래된 번역이 사라지지 않게 합니다.
  function applyMessages(
    value,
    { force = false, authoritative = false, source = "unknown" } = {}
  ) {
    if (!state.selectedSession) {
      return;
    }
    state.messageApplyRevision += 1;

    const replaceHistory =
      force || authoritative || !state.hasLoadedMessages;
    const messages = Array.isArray(value)
      ? value.filter(isValidTranslatorMessage)
      : [];
    const previousMessages = new Map(
      state.messages.map((message) => [message._id, message])
    );
    const previousTimestamps = state.messages
      .map((message) => Number(message._creationTime))
      .filter(Number.isFinite);
    const previousLatestTimestamp = previousTimestamps.length > 0
      ? Math.max(...previousTimestamps)
      : Number.NEGATIVE_INFINITY;
    const newMessageIds = new Set();
    let hasMessageChanges =
      !state.hasLoadedMessages ||
      (replaceHistory && messages.length !== state.messages.length);

    for (const message of messages) {
      if (
        state.hasLoadedMessages &&
        !state.seenMessageIds.has(message._id) &&
        Number(message._creationTime) >= previousLatestTimestamp
      ) {
        newMessageIds.add(message._id);
      }
      const previous = previousMessages.get(message._id);
      if (
        !previous ||
        previous.text !== message.text ||
        previous.nick !== message.nick ||
        Number(previous._creationTime) !== Number(message._creationTime)
      ) {
        hasMessageChanges = true;
      }
    }

    if (replaceHistory) {
      state.messages = messages;
    } else {
      const mergedMessages = new Map(previousMessages);
      for (const message of messages) {
        mergedMessages.set(message._id, message);
      }
      state.messages = [...mergedMessages.values()];
    }
    state.seenMessageIds = new Set(
      state.messages.map((message) => message._id)
    );
    state.hasLoadedMessages = true;
    if (!isLiveTranslationMode() && authoritative) {
      state.lastArchiveMessageRefreshAt = Date.now();
    }
    scheduleLiveRelease();
    renderLiveDelayControls();
    renderReplaySyncControls();
    if (hasMessageChanges) {
      renderMessages(newMessageIds);
    }
    setConnectionState(isLiveTranslationMode() ? "live" : "archive");
    updateMessageStatus();
  }

  async function pollMessages({ force = false } = {}) {
    if (
      !state.selectedSession ||
      !state.settings.visible ||
      !isLiveRoute() ||
      document.visibilityState === "hidden"
    ) {
      return;
    }
    if (state.messageRequestRunning) {
      state.messageForcePending ||= force;
      return;
    }

    const liveMode = isLiveTranslationMode();
    if (!liveMode && state.hasLoadedMessages && !force) {
      const nextDisplayedCount = core.messagesThroughPlayback(
        state.messages,
        currentSubtitleCutoff()
      ).length;
      if (nextDisplayedCount !== state.displayedHistoryCount) {
        renderMessages();
      }
      setConnectionState("archive");
      updateMessageStatus();
      if (
        Date.now() - state.lastArchiveMessageRefreshAt <
          ARCHIVE_REFRESH_MS
      ) {
        return;
      }
    }

    const requestGeneration = state.routeGeneration;
    const requestedSessionId = state.selectedSession._id;
    const messageRevisionAtStart = state.messageApplyRevision;
    state.messageRequestRunning = true;
    try {
      const shouldFetchFullHistory =
        force || !state.hasLoadedMessages || !liveMode;
      const fullHistoryLimit = core.messageSubscriptionLimit(
        state.selectedSession.messageCount
      );
      const fetchLimit = liveMode && !shouldFetchFullHistory
        ? 250
        : fullHistoryLimit;
      const value = await queryTranslator("messages:list", {
        sessionId: requestedSessionId,
        limit: fetchLimit
      });
      if (
        requestGeneration !== state.routeGeneration ||
        requestedSessionId !== state.selectedSession?._id
      ) {
        return;
      }
      if (
        state.messageApplyRevision !== messageRevisionAtStart ||
        hasReadyMessagesSubscription()
      ) {
        return;
      }
      applyMessages(value, {
        force: shouldFetchFullHistory,
        authoritative: shouldFetchFullHistory,
        source: "http"
      });
    } catch (error) {
      if (
        requestGeneration !== state.routeGeneration ||
        requestedSessionId !== state.selectedSession?._id
      ) {
        return;
      }
      if (
        state.messageApplyRevision !== messageRevisionAtStart ||
        hasReadyMessagesSubscription()
      ) {
        return;
      }
      setConnectionState("error");
      setStatus(error instanceof Error ? error.message : "번역 메시지 연결 오류");
    } finally {
      if (requestGeneration === state.routeGeneration) {
        state.messageRequestRunning = false;
        if (state.messageForcePending) {
          state.messageForcePending = false;
          Promise.resolve().then(() => {
            void pollMessages({ force: true });
          });
        }
      }
    }
  }

  function isVisibleVideo(video) {
    const rect = video.getBoundingClientRect();
    if (
      rect.width <= 160 ||
      rect.height <= 90 ||
      rect.right <= 0 ||
      rect.bottom <= 0 ||
      rect.left >= window.innerWidth ||
      rect.top >= window.innerHeight
    ) {
      return false;
    }
    const style = window.getComputedStyle(video);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0.01
    );
  }

  function isAdVideo(video) {
    return core.isLikelyAdVideoSource(video.currentSrc || video.src);
  }

  function visibleVideos() {
    return [...document.querySelectorAll("video")].filter(isVisibleVideo);
  }

  function eligibleVisibleVideos() {
    const videos = visibleVideos();
    for (const [video, source] of state.staleRouteVideos) {
      const currentSource = video.currentSrc || video.src || "";
      if (!video.isConnected || currentSource !== source) {
        state.staleRouteVideos.delete(video);
      }
    }
    return videos.filter((video) => !state.staleRouteVideos.has(video));
  }

  function videoPlayerRoot(video) {
    return video?.closest?.(".pzp-pc") || null;
  }

  function rememberBoundRouteVideos(context) {
    const videos = new Set([
      context?.main,
      context?.ad,
      state.boundVideo
    ].filter(Boolean));
    const roots = new Set([
      context?.root,
      state.boundPlayerRoot
    ].filter(Boolean));
    for (const root of roots) {
      for (const video of root.querySelectorAll("video")) {
        videos.add(video);
      }
    }
    for (const [video] of state.boundRouteVideos) {
      if (!video.isConnected) {
        state.boundRouteVideos.delete(video);
      } else {
        state.boundRouteVideos.set(
          video,
          video.currentSrc || video.src || ""
        );
      }
    }
    for (const video of videos) {
      state.boundRouteVideos.set(
        video,
        video.currentSrc || video.src || ""
      );
    }
  }

  function isVideoPlaybackActive(video) {
    return Boolean(
      video &&
      !video.ended &&
      !video.paused &&
      Number(video.readyState) >= 2
    );
  }

  function visibleRectangleArea(rect) {
    const width = Math.max(
      0,
      Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)
    );
    const height = Math.max(
      0,
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
    );
    return width * height;
  }

  function visibleVideoArea(video) {
    return visibleRectangleArea(video.getBoundingClientRect());
  }

  function rectangleIntersectionArea(left, right) {
    const width = Math.max(
      0,
      Math.min(left.right, right.right) - Math.max(left.left, right.left)
    );
    const height = Math.max(
      0,
      Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)
    );
    return width * height;
  }

  function videosSharePlayerArea(left, right) {
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    const smallerArea = Math.min(
      leftRect.width * leftRect.height,
      rightRect.width * rightRect.height
    );
    return smallerArea > 0 &&
      rectangleIntersectionArea(leftRect, rightRect) >= smallerArea * 0.35;
  }

  function activeShortAdVideos(videos) {
    const finiteVideos = videos.filter(
      (video) =>
        Number.isFinite(video.duration) &&
        video.duration > 0
    );
    const longestDuration = Math.max(
      0,
      ...finiteVideos.map((video) => Number(video.duration))
    );
    if (finiteVideos.length < 2 || longestDuration <= 180) {
      return new Set();
    }
    const likelyMainVideos = finiteVideos.filter(
      (video) => Number(video.duration) >= longestDuration * 0.9
    );
    return new Set(finiteVideos
      .filter(
        (video) =>
          isVideoPlaybackActive(video) &&
          video.duration <= 180 &&
          video.duration < longestDuration * 0.75 &&
          likelyMainVideos.some(
            (mainVideo) => {
              const videoRoot = videoPlayerRoot(video);
              const mainRoot = videoPlayerRoot(mainVideo);
              return mainVideo !== video &&
                (
                  (videoRoot && videoRoot === mainRoot) ||
                  videosSharePlayerArea(video, mainVideo)
                );
            }
          )
      )
    );
  }

  function hasVisibleAdIndicator(root) {
    if (!root) {
      return false;
    }
    const candidates = [
      ...root.querySelectorAll(
        'button, [role="button"], [class*="videoAdUi"], [class*="video-ad-ui"]'
      )
    ];
    return candidates.some((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }
      const style = window.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity || 1) <= 0.01
      ) {
        return false;
      }
      const label = `${element.getAttribute("aria-label") || ""} ${
        element.textContent || ""
      }`.replace(/\s+/g, " ").trim();
      return /^(?:skip ad|skip ads|광고 건너뛰기|광고를 건너뛰기)(?:\s|$)/i.test(
        label
      ) || /(?:^|\s)video\s*ad\s*ui(?:\s|$)/i.test(element.className);
    });
  }

  function mainVideoScore(video) {
    let score = visibleVideoArea(video);
    if (isVideoPlaybackActive(video)) {
      score += 1_000_000_000_000_000;
    }
    if (!video.ended) {
      score += 100_000_000_000_000;
    }
    if (Number(video.readyState) >= 2) {
      score += 10_000_000_000_000;
    }
    if (
      video === state.boundVideo &&
      state.boundVideoRoute === location.pathname
    ) {
      score += 1_000_000_000_000;
    }
    if (Number(video.currentTime) > 0) {
      score += 100_000_000_000;
    }
    return score;
  }

  function choosePlayerRoot(videos) {
    const boundVideo =
      state.boundVideoRoute === location.pathname &&
      state.boundVideo?.isConnected &&
      isVisibleVideo(state.boundVideo)
        ? state.boundVideo
        : null;
    const boundRoot = videoPlayerRoot(boundVideo);
    if (boundRoot) {
      const overlappingActiveVideo = videos
        .filter((video) => {
          const root = videoPlayerRoot(video);
          return video !== boundVideo &&
            root &&
            root !== boundRoot &&
            isVideoPlaybackActive(video) &&
            videosSharePlayerArea(video, boundVideo);
        })
        .sort((left, right) => visibleVideoArea(right) - visibleVideoArea(left))[0];
      if (overlappingActiveVideo) {
        return videoPlayerRoot(overlappingActiveVideo);
      }
      return boundRoot;
    }
    const roots = [...new Set(videos.map(videoPlayerRoot).filter(Boolean))];
    return roots.sort((left, right) => {
      const areaDifference =
        visibleRectangleArea(right.getBoundingClientRect()) -
        visibleRectangleArea(left.getBoundingClientRect());
      if (areaDifference !== 0) {
        return areaDifference;
      }
      const leftVideos = videos.filter((video) => videoPlayerRoot(video) === left);
      const rightVideos = videos.filter((video) => videoPlayerRoot(video) === right);
      const activeDifference =
        Number(rightVideos.some(isVideoPlaybackActive)) -
        Number(leftVideos.some(isVideoPlaybackActive));
      if (activeDifference !== 0) {
        return activeDifference;
      }
      return Number(rightVideos.some((video) => !isAdVideo(video))) -
        Number(leftVideos.some((video) => !isAdVideo(video)));
    })[0] || null;
  }

  function playbackContext() {
    const videos = eligibleVisibleVideos();
    const root = choosePlayerRoot(videos);
    const scopedVideos = root
      ? videos.filter((video) => videoPlayerRoot(video) === root)
      : videos;
    const fallbackAds = activeShortAdVideos(scopedVideos);
    const indicator = hasVisibleAdIndicator(root);
    const adVideos = scopedVideos.filter(
      (video) =>
        isAdVideo(video) ||
        fallbackAds.has(video) ||
        (indicator &&
          (isVideoPlaybackActive(video) || scopedVideos.length === 1))
    );
    const main = scopedVideos
      .filter((video) => !adVideos.includes(video))
      .sort((left, right) => mainVideoScore(right) - mainVideoScore(left))[0] || null;
    const activeAd = adVideos.find(isVideoPlaybackActive) || null;
    const positiveAdEvidence = indicator || Boolean(activeAd);
    const now = Date.now();
    if (positiveAdEvidence) {
      state.adEvidenceUntil = now + 750;
    } else if (isVideoPlaybackActive(main)) {
      state.adEvidenceUntil = 0;
    }
    return {
      root: root || videoPlayerRoot(main),
      main,
      ad: activeAd || adVideos[0] || null,
      adPlaying: positiveAdEvidence || now < state.adEvidenceUntil
    };
  }

  function findAdVideoElement() {
    return playbackContext().ad;
  }

  function isAdPlaying() {
    return playbackContext().adPlaying;
  }

  function findVideoElement() {
    return playbackContext().main;
  }

  function findPlayerElement() {
    const context = playbackContext();
    if (context.root) {
      return context.root;
    }
    const video = context.main;
    if (!video) {
      return null;
    }
    const player = video.closest(
      '.pzp-pc, [aria-label="비디오 플레이어"], [aria-label="Video player"]'
    );
    if (player) {
      const rect = player.getBoundingClientRect();
      if (visibleRectangleArea(rect) > 160 * 90) {
        return player;
      }
    }
    return video;
  }

  function playerUiRoot() {
    const player = findPlayerElement();
    if (!player) {
      return null;
    }
    if (player.matches?.("video")) {
      return player.closest(
        '.pzp-pc, [aria-label="비디오 플레이어"], [aria-label="Video player"]'
      ) || player.parentElement;
    }
    return player;
  }

  function isVisiblePlayerControl(element) {
    if (!element || !element.isConnected) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0.01;
  }

  function visiblePlayerMenus(root) {
    if (!root) {
      return [];
    }
    return [...root.querySelectorAll(
      '[role="menu"].pzp-settings, [role="menu"][class*="pzp-setting-"], [role="menu"][class*="pzp-ui-setting"]'
    )].filter(isVisiblePlayerControl);
  }

  function qualityCandidates(root) {
    return [...root.querySelectorAll(".pzp-ui-setting-quality-item")]
      .filter(isVisiblePlayerControl)
      .map((item) => ({
        item,
        height: core.resolutionHeight(item.textContent)
      }))
      .filter(({ item, height }) =>
        height > 0 &&
        item.getAttribute("aria-disabled") !== "true" &&
        !item.classList.contains("pzp-ui-setting-pane-item--disabled")
      )
      .sort((left, right) => right.height - left.height);
  }

  function qualityItemChecked(item) {
    return item.getAttribute("aria-checked") === "true" ||
      item.classList.contains("pzp-ui-setting-pane-item--checked") ||
      Boolean(item.querySelector(
        '[aria-checked="true"], .pzp-ui-setting-pane-item--checked'
      ));
  }

  function finishQualityAutomation(
    token,
    { closeOwnedMenu = false, result = "done" } = {}
  ) {
    if (token !== state.qualityOperationToken) {
      return;
    }
    clearTimeout(state.qualityTimer);
    state.qualityTimer = null;
    state.qualityRunState = result;
    const shouldClose = closeOwnedMenu &&
      state.qualityOpenedByUs &&
      state.qualityUserActivityAt <= state.qualityOperationStartedAt &&
      state.qualityRoot?.isConnected &&
      state.qualityGear?.isConnected;
    if (!shouldClose) {
      return;
    }
    state.qualityTimer = setTimeout(() => {
      state.qualityTimer = null;
      if (
        token === state.qualityOperationToken &&
        state.qualityUserActivityAt <= state.qualityOperationStartedAt &&
        visiblePlayerMenus(state.qualityRoot).length > 0
      ) {
        state.qualityGear.click();
      }
    }, 160);
  }

  function closeOwnedQualityMenuIfSafe() {
    if (
      state.qualityOpenedByUs &&
      state.qualityUserActivityAt <= state.qualityOperationStartedAt &&
      state.qualityRoot?.isConnected &&
      state.qualityGear?.isConnected &&
      visiblePlayerMenus(state.qualityRoot).length > 0
    ) {
      state.qualityGear.click();
    }
  }

  function resetQualityAutomation({ clearRunKey = false } = {}) {
    const retryableRun =
      !state.qualityTargetClicked &&
      ["running", "player-changed", "aborted", "timeout", "ad-wait"].includes(
        state.qualityRunState
      );
    const waitingForAd = state.qualityRunState === "ad-wait";
    const firstPlayerArrival =
      retryableRun &&
      state.qualityStartedWithoutPlayer &&
      !state.qualityRoot &&
      !state.qualityGearClicked;
    closeOwnedQualityMenuIfSafe();
    clearTimeout(state.qualityTimer);
    state.qualityTimer = null;
    state.qualityOperationToken += 1;
    if (clearRunKey) {
      state.qualityRunKey = null;
      state.qualityRunState = "idle";
      state.qualityRetryCount = 0;
      state.qualityStartedWithoutPlayer = false;
    } else if (retryableRun) {
      if (firstPlayerArrival || waitingForAd || state.qualityRetryCount < 1) {
        // 처음 플레이어가 없었거나 광고를 기다린 경우는 횟수를 소모하지
        // 않고, 선택 전 플레이어 교체만 방송당 최대 한 번 재시도합니다.
        if (!firstPlayerArrival && !waitingForAd) {
          state.qualityRetryCount += 1;
        }
        state.qualityRunKey = null;
        state.qualityRunState = "idle";
        state.qualityStartedWithoutPlayer = false;
      } else {
        state.qualityRunState = "retry-exhausted";
        state.qualityStartedWithoutPlayer = false;
      }
    } else if (state.qualityRunState === "running") {
      // 화질 변경으로 video가 교체돼도 같은 방송에서 다시 클릭하지 않습니다.
      state.qualityRunState = "done";
    }
    state.qualityRoot = null;
    state.qualityGear = null;
    state.qualityOpenedByUs = false;
    state.qualityGearClicked = false;
    state.qualityEntryClicked = false;
    state.qualityTargetClicked = false;
  }

  function scheduleQualityStep(token, delay = 100) {
    clearTimeout(state.qualityTimer);
    state.qualityTimer = setTimeout(() => {
      state.qualityTimer = null;
      runQualityStep(token);
    }, delay);
  }

  function runQualityStep(token) {
    if (
      token !== state.qualityOperationToken ||
      state.qualityRunState !== "running"
    ) {
      return;
    }
    if (
      !state.settings.preferHighestQuality ||
      !state.settings.visible ||
      !isLiveRoute() ||
      document.visibilityState === "hidden"
    ) {
      finishQualityAutomation(token, {
        closeOwnedMenu: true,
        result: "aborted"
      });
      return;
    }
    if (isAdPlaying()) {
      finishQualityAutomation(token, {
        closeOwnedMenu: true,
        result: "ad-wait"
      });
      return;
    }
    if (state.qualityUserActivityAt > state.qualityOperationStartedAt) {
      finishQualityAutomation(token, { result: "user-owned" });
      return;
    }
    if (Date.now() >= state.qualityDeadline) {
      finishQualityAutomation(token, {
        closeOwnedMenu: true,
        result: "timeout"
      });
      return;
    }
    if (Date.now() - state.qualityUserActivityAt < 900) {
      scheduleQualityStep(token, 150);
      return;
    }

    const root = playerUiRoot();
    if (!root?.matches?.(".pzp-pc")) {
      scheduleQualityStep(token, 120);
      return;
    }
    if (state.qualityRoot && state.qualityRoot !== root) {
      finishQualityAutomation(token, {
        closeOwnedMenu: true,
        result: "player-changed"
      });
      return;
    }
    state.qualityRoot = root;

    if (
      !state.qualityGearClicked &&
      visiblePlayerMenus(root).length > 0
    ) {
      scheduleQualityStep(token, 150);
      return;
    }
    const candidates = qualityCandidates(root);
    if (candidates.length > 0) {
      const highest = candidates[0].item;
      if (!qualityItemChecked(highest) && !state.qualityTargetClicked) {
        state.qualityTargetClicked = true;
        highest.click();
      }
      finishQualityAutomation(token, {
        closeOwnedMenu: true,
        result: qualityItemChecked(highest) ? "already-highest" : "selected"
      });
      return;
    }

    if (!state.qualityGearClicked) {
      const gear = [...root.querySelectorAll(
        '.pzp-setting-button, .pzp-pc-setting-button, button[aria-label="설정"], button[aria-label="Settings"]'
      )].find((element) =>
        isVisiblePlayerControl(element) &&
        element.getAttribute("aria-disabled") !== "true" &&
        !element.disabled
      );
      if (!gear) {
        scheduleQualityStep(token, 120);
        return;
      }
      state.qualityGear = gear;
      state.qualityGearClicked = true;
      state.qualityOpenedByUs = true;
      gear.click();
      scheduleQualityStep(token, 120);
      return;
    }

    if (!state.qualityEntryClicked) {
      const qualityEntry = [...root.querySelectorAll(
        '.pzp-setting-intro-quality, button, [role="menuitem"]'
      )].find((element) => {
        if (
          element.classList.contains("pzp-ui-setting-quality-item") ||
          !isVisiblePlayerControl(element)
        ) {
          return false;
        }
        const label = `${element.getAttribute("aria-label") || ""} ${
          element.textContent || ""
        }`.replace(/\s+/g, " ").trim();
        return /^(?:해상도|quality)(?:\s|$)/i.test(label);
      });
      if (qualityEntry) {
        state.qualityEntryClicked = true;
        qualityEntry.click();
      }
    }
    scheduleQualityStep(token, 120);
  }

  function enforceHighestQuality({ restart = false } = {}) {
    if (
      !isWeversePage() ||
      !state.settings.preferHighestQuality ||
      !isLiveRoute()
    ) {
      return false;
    }
    const runKey = `${state.routeGeneration}:${state.qualityEnableEpoch}`;
    if (
      !restart &&
      state.qualityRunKey === runKey &&
      state.qualityRunState !== "idle"
    ) {
      return false;
    }
    resetQualityAutomation({ clearRunKey: restart });
    state.qualityRunKey = runKey;
    state.qualityRunState = "running";
    state.qualityOperationToken += 1;
    const token = state.qualityOperationToken;
    state.qualityOperationStartedAt = Date.now();
    state.qualityDeadline = state.qualityOperationStartedAt + 5000;
    state.qualityStartedWithoutPlayer =
      !state.boundVideo && !state.boundPlayerRoot;
    scheduleQualityStep(token, 80);
    return true;
  }

  function pauseHighestQualityAutomation() {
    const needsRetry =
      !state.qualityRunKey ||
      (
        !state.qualityTargetClicked &&
        ["running", "aborted", "player-changed", "timeout", "ad-wait"].includes(
          state.qualityRunState
        )
      );
    resetQualityAutomation({ clearRunKey: needsRetry });
  }

  function resumeHighestQualityAutomation() {
    if (!state.settings.preferHighestQuality || !state.settings.visible) {
      return;
    }
    if (
      !state.qualityRunKey ||
      ["idle", "aborted", "player-changed", "timeout", "ad-wait"].includes(
        state.qualityRunState
      )
    ) {
      enforceHighestQuality({ restart: true });
    }
  }

  function noteQualityUserActivity(event) {
    if (!event.isTrusted) {
      return;
    }
    const root = playerUiRoot();
    if (
      event.type !== "keydown" &&
      !root?.contains(event.target)
    ) {
      return;
    }
    state.qualityUserActivityAt = Date.now();
    if (state.qualityRunState === "running") {
      finishQualityAutomation(state.qualityOperationToken, {
        result: "user-owned"
      });
    }
  }

  function rectanglesOverlap(left, right) {
    return (
      left.left < right.right &&
      left.right > right.left &&
      left.top < right.bottom &&
      left.bottom > right.top
    );
  }

  function updatePlayerMenuAvoidance() {
    if (dom.panel.hidden) {
      dom.panel.classList.remove("player-menu-overlap");
      dom.reactionLayer.hidden = true;
      return;
    }
    const root = playerUiRoot();
    if (!root) {
      dom.panel.classList.remove("player-menu-overlap");
      dom.reactionLayer.hidden = !liveReactionsEnabled();
      return;
    }
    const panelRect = dom.panel.getBoundingClientRect();
    const menuSelector = [
      '[role="menu"].pzp-settings',
      '[role="menu"][class*="pzp-setting-"]',
      '[role="menu"][class*="pzp-ui-setting"]'
    ].join(",");
    const menuOverlaps = [...root.querySelectorAll(menuSelector)]
      .some((menu) => {
          const style = window.getComputedStyle(menu);
          const menuRect = menu.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0" &&
            menuRect.width > 0 &&
            menuRect.height > 0 &&
            rectanglesOverlap(panelRect, menuRect)
          );
        });
    dom.panel.classList.toggle("player-menu-overlap", menuOverlaps);
    dom.reactionLayer.hidden = !liveReactionsEnabled() || menuOverlaps;
  }

  function schedulePlayerMenuAvoidance() {
    if (state.playerMenuFrame !== null) {
      cancelAnimationFrame(state.playerMenuFrame);
    }
    state.playerMenuFrame = requestAnimationFrame(() => {
      state.playerMenuFrame = null;
      updatePlayerMenuAvoidance();
    });
    clearTimeout(state.playerMenuSettleTimer);
    state.playerMenuSettleTimer = setTimeout(() => {
      state.playerMenuSettleTimer = null;
      updatePlayerMenuAvoidance();
    }, 120);
  }

  function playerMenuMutationRelevant(records) {
    const selector = [
      '[role="menu"]',
      ".pzp-settings",
      '[class*="pzp-setting-"]',
      '[class*="pzp-ui-setting"]'
    ].join(",");
    return records.some((record) => {
      if (record.target?.closest?.(selector)) {
        return true;
      }
      return [...record.addedNodes, ...record.removedNodes].some((node) =>
        node.nodeType === 1 &&
        (node.matches?.(selector) || node.querySelector?.(selector))
      );
    });
  }

  function handlePlayerMenuMutations(records) {
    if (playerMenuMutationRelevant(records)) {
      schedulePlayerMenuAvoidance();
    }
  }

  function bindPlayerMenuObserver() {
    const root = playerUiRoot();
    if (root === state.playerMenuObserverRoot) {
      return;
    }
    state.playerMenuObserver?.disconnect();
    state.playerMenuObserver = null;
    state.playerMenuObserverRoot = root;
    if (!root || typeof MutationObserver !== "function") {
      return;
    }
    state.playerMenuObserver = new MutationObserver(handlePlayerMenuMutations);
    state.playerMenuObserver.observe(root, {
      subtree: true,
      childList: true
    });
  }

  function syncMessagesToPlayback({ force = false, forceBottom = false } = {}) {
    if (
      !state.settings.visible ||
      !isLiveRoute()
    ) {
      return;
    }
    const nextAdPlaying = isAdPlaying();
    const adStateChanged = nextAdPlaying !== state.adPlaying;
    if (adStateChanged) {
      state.adPlaying = nextAdPlaying;
    }
    if (
      !nextAdPlaying &&
      state.settings.preferHighestQuality &&
      document.visibilityState !== "hidden" &&
      !state.qualityTargetClicked &&
      state.qualityRunState === "ad-wait"
    ) {
      // 광고와 본편 video가 동시에 유지되거나 전환이 매우 짧아도,
      // 광고 대기 상태를 한 번만 깨워 최고 화질 선택을 이어갑니다.
      resetQualityAutomation();
      enforceHighestQuality();
    }
    if (!state.selectedSession || !state.hasLoadedMessages) {
      return;
    }
    if (adStateChanged) {
      renderMessages(new Set(), { forceBottom: true });
      renderReplaySyncControls();
      return;
    }
    if (nextAdPlaying) {
      updateMessageStatus();
      return;
    }
    const nextDisplayedCount = core.messagesThroughPlayback(
      state.messages,
      currentSubtitleCutoff()
    ).length;
    if (force || nextDisplayedCount !== state.displayedHistoryCount) {
      renderMessages(new Set(), { forceBottom });
      return;
    }
    updateMessageStatus();
  }

  function handlePlaybackSeeking() {
    syncMessagesToPlayback({ force: true, forceBottom: true });
  }

  function handlePlaybackTimeUpdate() {
    syncMessagesToPlayback({
      force: Boolean(state.boundVideo?.seeking),
      forceBottom: Boolean(state.boundVideo?.seeking)
    });
  }

  function bindPlaybackVideo() {
    if (location.pathname !== state.lastPathname) {
      return;
    }
    const context = playbackContext();
    const video = context.main;
    const nextPlayerRoot = context.root || videoPlayerRoot(video);
    rememberBoundRouteVideos(context);
    bindPlayerMenuObserver();
    if (
      video === state.boundVideo &&
      state.boundVideoRoute === location.pathname &&
      nextPlayerRoot === state.boundPlayerRoot
    ) {
      return;
    }
    if (
      !video &&
      context.adPlaying &&
      state.boundVideoRoute === location.pathname
    ) {
      return;
    }
    if (!video && !state.boundVideo) {
      state.boundPlayerRoot = null;
      return;
    }
    if (state.boundVideo && video !== state.boundVideo) {
      state.boundVideo.removeEventListener("seeking", handlePlaybackSeeking);
      state.boundVideo.removeEventListener("seeked", handlePlaybackSeeking);
      state.boundVideo.removeEventListener("timeupdate", handlePlaybackTimeUpdate);
      state.boundVideo.removeEventListener("loadedmetadata", handlePlaybackSeeking);
      state.boundVideo.removeEventListener("durationchange", handlePlaybackSeeking);
    }
    const sameVideoOnNewRoute = video && video === state.boundVideo;
    state.boundVideo = video;
    state.boundVideoRoute = video ? location.pathname : null;
    state.boundPlayerRoot = video ? nextPlayerRoot : null;
    resetQualityAutomation();
    if (!video) {
      return;
    }
    if (!sameVideoOnNewRoute) {
      video.addEventListener("seeking", handlePlaybackSeeking);
      video.addEventListener("seeked", handlePlaybackSeeking);
      video.addEventListener("timeupdate", handlePlaybackTimeUpdate);
      video.addEventListener("loadedmetadata", handlePlaybackSeeking);
      video.addEventListener("durationchange", handlePlaybackSeeking);
    }
    syncMessagesToPlayback({ force: true, forceBottom: true });
    enforceHighestQuality();
  }

  function currentPlayerRect() {
    const player = findPlayerElement();
    if (player) {
      const rect = player.getBoundingClientRect();
      const playerRect = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
      if (isInstagramPage()) {
        const videoRect = findVideoElement()?.getBoundingClientRect?.() || rect;
        const blankRight = Math.min(
          window.innerWidth,
          Math.floor(videoRect.left) - 8
        );
        const blankTop = Math.max(0, Math.floor(videoRect.top));
        const blankBottom = Math.min(
          window.innerHeight,
          Math.ceil(videoRect.bottom)
        );
        if (blankRight >= 260 && blankBottom - blankTop >= 150) {
          return {
            left: 0,
            top: blankTop,
            right: blankRight,
            bottom: blankBottom,
            width: blankRight,
            height: blankBottom - blankTop
          };
        }
      }
      return playerRect;
    }
    return {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight
    };
  }

  function requestPlacement() {
    if (state.placementFrame !== null) {
      cancelAnimationFrame(state.placementFrame);
    }
    state.placementFrame = requestAnimationFrame(() => {
      state.placementFrame = null;
      placeOverlay();
    });
  }

  function placeOverlay() {
    ensureHostParent();
    const playerRect = currentPlayerRect();

    if (!dom.restoreButton.hidden) {
      const restoreRect = dom.restoreButton.getBoundingClientRect();
      const restorePlacement = core.calculatePlacement({
        playerRect,
        panelRect: restoreRect,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        position: state.settings.position,
        customPlacement: state.settings.customPlacement
      });
      dom.restoreButton.style.left = `${restorePlacement.left}px`;
      dom.restoreButton.style.top = `${restorePlacement.top}px`;
    }

    if (dom.panel.hidden || state.drag || state.resize) {
      return;
    }

    const customPosition = state.settings.position === "custom";
    const customInsidePlayer = customPosition &&
      core.customPlacementInsidePlayer(state.settings.customPlacement);
    const keepInsidePlayer = !customPosition || customInsidePlayer;
    const availableWidth = Math.max(
      180,
      keepInsidePlayer ? playerRect.width - 24 : window.innerWidth - 16
    );
    const effectiveWidth = Math.min(state.settings.panelWidth, availableWidth);
    const maximumHeight = Math.max(
      150,
      Math.floor(
        keepInsidePlayer ? playerRect.height - 66 : window.innerHeight - 16
      )
    );
    dom.panel.style.setProperty("--panel-width", `${Math.round(effectiveWidth)}px`);
    dom.panel.style.setProperty(
      "--panel-height",
      state.settings.panelHeight === null
        ? "auto"
        : `${Math.min(state.settings.panelHeight, maximumHeight)}px`
    );
    dom.panel.style.setProperty(
      "--panel-max-height",
      `${maximumHeight}px`
    );

    const panelRect = dom.panel.getBoundingClientRect();
    const placement = core.calculatePlacement({
      playerRect,
      panelRect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      position: state.settings.position,
      customPlacement: state.settings.customPlacement
    });
    dom.panel.style.left = `${placement.left}px`;
    dom.panel.style.top = `${placement.top}px`;
    dom.panel.style.setProperty(
      "--panel-max-height",
      `${placement.maxPanelHeight}px`
    );
    updatePlayerMenuAvoidance();
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
  }

  function beginDrag(event) {
    if (
      state.settings.layoutLocked ||
      state.drag ||
      state.resize ||
      event.isPrimary === false ||
      event.button !== 0 ||
      event.target.closest("button, a, select, input, label")
    ) {
      return;
    }
    const rect = dom.panel.getBoundingClientRect();
    state.drag = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (_error) {
      // 포인터 캡처를 지원하지 않아도 창 범위 이벤트로 이동을 계속합니다.
    }
    event.preventDefault();
  }

  function moveDrag(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) {
      return;
    }
    const panelRect = dom.panel.getBoundingClientRect();
    const minimumLeft = 8;
    const maximumLeft = Math.max(8, window.innerWidth - panelRect.width - 8);
    const minimumTop = 8;
    const maximumTop = Math.max(8, window.innerHeight - panelRect.height - 8);
    const nextLeft = state.drag.startLeft + event.clientX - state.drag.startX;
    const nextTop = state.drag.startTop + event.clientY - state.drag.startY;
    dom.panel.style.left = `${Math.round(clamp(nextLeft, minimumLeft, maximumLeft))}px`;
    dom.panel.style.top = `${Math.round(clamp(nextTop, minimumTop, maximumTop))}px`;
  }

  function releaseInteractionPointer(interaction) {
    const target = interaction?.captureTarget;
    const pointerId = interaction?.pointerId;
    if (!target || !Number.isFinite(Number(pointerId))) {
      return;
    }
    try {
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch (_error) {
      // 이미 해제된 포인터 캡처는 무시합니다.
    }
  }

  function endDrag(event) {
    if (
      !state.drag ||
      (event?.pointerId !== undefined &&
        event.pointerId !== state.drag.pointerId)
    ) {
      return;
    }
    const drag = state.drag;
    state.drag = null;
    releaseInteractionPointer(drag);
    const playerRect = currentPlayerRect();
    const panelRect = dom.panel.getBoundingClientRect();
    const customPlacement = core.placementFromCoordinates({
      left: panelRect.left,
      top: panelRect.top,
      playerRect,
      panelRect
    });
    updateSettings({ position: "custom", customPlacement });
  }

  function beginResize(event) {
    if (
      state.settings.layoutLocked ||
      state.drag ||
      state.resize ||
      event.isPrimary === false ||
      event.button !== 0
    ) {
      return;
    }
    const direction = event.currentTarget.dataset.resize;
    if (!direction) {
      return;
    }
    const rect = dom.panel.getBoundingClientRect();
    state.resize = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      startRight: rect.right,
      startBottom: rect.bottom,
      startWidth: rect.width,
      startHeight: rect.height
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (_error) {
      // 포인터 캡처를 지원하지 않아도 창 범위 이벤트로 크기를 조정합니다.
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function moveResize(event) {
    if (!state.resize || event.pointerId !== state.resize.pointerId) {
      return;
    }
    const resize = state.resize;
    const playerRect = currentPlayerRect();
    const direction = resize.direction;
    const deltaX = event.clientX - resize.startX;
    const deltaY = event.clientY - resize.startY;
    const minimumWidth = Math.min(220, Math.max(180, playerRect.width - 24));
    const minimumHeight = Math.min(150, Math.max(110, playerRect.height - 66));
    const maximumWidth = Math.min(4096, Math.max(minimumWidth, window.innerWidth - 16));
    const maximumHeight = Math.min(4096, Math.max(minimumHeight, window.innerHeight - 16));
    let left = resize.startLeft;
    let top = resize.startTop;
    let width = resize.startWidth;
    let height = resize.startHeight;

    if (direction.includes("e")) {
      width = clamp(
        resize.startWidth + deltaX,
        minimumWidth,
        Math.min(maximumWidth, window.innerWidth - resize.startLeft - 8)
      );
    }
    if (direction.includes("w")) {
      left = clamp(
        resize.startLeft + deltaX,
        Math.max(8, resize.startRight - maximumWidth),
        resize.startRight - minimumWidth
      );
      width = resize.startRight - left;
    }
    if (direction.includes("s")) {
      height = clamp(
        resize.startHeight + deltaY,
        minimumHeight,
        Math.min(maximumHeight, window.innerHeight - resize.startTop - 8)
      );
    }
    if (direction.includes("n")) {
      top = clamp(
        resize.startTop + deltaY,
        Math.max(8, resize.startBottom - maximumHeight),
        resize.startBottom - minimumHeight
      );
      height = resize.startBottom - top;
    }

    dom.panel.style.left = `${Math.round(left)}px`;
    dom.panel.style.top = `${Math.round(top)}px`;
    dom.panel.style.setProperty("--panel-width", `${Math.round(width)}px`);
    dom.panel.style.setProperty("--panel-height", `${Math.round(height)}px`);
  }

  function endResize(event) {
    if (
      !state.resize ||
      (event?.pointerId !== undefined &&
        event.pointerId !== state.resize.pointerId)
    ) {
      return;
    }
    const resize = state.resize;
    state.resize = null;
    releaseInteractionPointer(resize);
    const playerRect = currentPlayerRect();
    const panelRect = dom.panel.getBoundingClientRect();
    const customPlacement = core.placementFromCoordinates({
      left: panelRect.left,
      top: panelRect.top,
      playerRect,
      panelRect
    });
    updateSettings({
      panelWidth: Math.round(panelRect.width),
      panelHeight: Math.round(panelRect.height),
      position: "custom",
      customPlacement
    });
  }

  function saveReplayAnchorFromSelection() {
    const video = findVideoElement();
    const message = state.messages.find(
      (item) => item?._id === dom.replayAnchorSelect.value
    );
    const currentTime = Number(video?.currentTime);
    const messageTimestamp = Number(message?._creationTime);
    if (
      !state.selectedSession ||
      !isReplayTranslationMode() ||
      isAdPlaying() ||
      !Number.isFinite(currentTime) ||
      !Number.isFinite(messageTimestamp)
    ) {
      setStatus("영상과 기준 번역을 확인해 주세요.");
      return;
    }

    const offsetMs = currentReplayOffsetMs();
    const effectiveOffsetMs = core.REPLAY_LATENCY_BASELINE_MS + offsetMs;
    const baseTimestamp =
      messageTimestamp -
      currentTime * 1000 -
      effectiveOffsetMs;
    state.replayAnchors = {
      ...state.replayAnchors,
      [location.pathname]: {
        clockVersion: activeReplayClockVersion(),
        sessionId: state.selectedSession._id,
        messageId: message._id,
        messageText: message.text.replace(/\s+/g, " ").trim().slice(0, 120),
        baseTimestamp,
        offsetMs,
        videoTime: currentTime,
        calibratedAt: Date.now()
      }
    };
    persistReplayAnchors();
    renderReplaySyncControls();
    syncMessagesToPlayback({ force: true, forceBottom: true });
    setStatus(
      `정확한 싱크 저장 · 영상 ${formatPlaybackTime(currentTime)}에 선택 자막 맞춤`
    );
  }

  function resetReplayAnchor() {
    if (!state.replayAnchors[location.pathname]) {
      return;
    }
    const nextAnchors = { ...state.replayAnchors };
    delete nextAnchors[location.pathname];
    state.replayAnchors = nextAnchors;
    persistReplayAnchors();
    renderReplaySyncControls();
    syncMessagesToPlayback({ force: true, forceBottom: true });
    setStatus("이 방송의 수동 싱크를 지우고 보정된 0초 기준으로 돌아왔습니다.");
  }

  function setReplayOffsetMs(nextOffsetMs) {
    if (
      !state.selectedSession ||
      !isReplayTranslationMode()
    ) {
      return;
    }
    const normalizedOffset = Math.round(
      Math.min(
        REPLAY_OFFSET_LIMIT_MS,
        Math.max(-REPLAY_OFFSET_LIMIT_MS, Number(nextOffsetMs) || 0)
      ) / 500
    ) * 500;
    const existingRecord = currentReplaySyncRecord();
    state.replayAnchors = {
      ...state.replayAnchors,
      [location.pathname]: {
        clockVersion: activeReplayClockVersion(),
        sessionId: state.selectedSession._id,
        messageId: existingRecord?.messageId || "",
        messageText: existingRecord?.messageText || "",
        baseTimestamp: existingRecord?.baseTimestamp ?? null,
        offsetMs: normalizedOffset,
        videoTime: existingRecord?.videoTime || 0,
        calibratedAt: Date.now()
      }
    };
    persistReplayAnchors();
    renderReplaySyncControls();
    syncMessagesToPlayback({ force: true, forceBottom: true });
    setStatus(`이 영상 싱크 ${subtitleOffsetLabel(normalizedOffset)} · 저장됨`);
  }

  function setLiveDelayMs(nextDelayMs) {
    if (!isLiveTranslationMode()) {
      return;
    }
    const normalizedDelay = core.normalizeSettings({
      ...state.settings,
      liveDelayMs: nextDelayMs
    }).liveDelayMs;
    updateSettings({ liveDelayMs: normalizedDelay });
    syncMessagesToPlayback({ force: true, forceBottom: true });
    scheduleLiveRelease();
    setStatus(
      normalizedDelay > 0
        ? `라이브 자막 ${liveDelayLabel(normalizedDelay)} · 자동 저장됨`
        : "라이브 자막 도착 즉시 표시 · 자동 저장됨"
    );
  }

  function isTrustedUiEvent(event) {
    return event?.isTrusted === true;
  }

  async function sendReaction(reactionKey, button, event) {
    if (!isTrustedUiEvent(event)) {
      return;
    }
    const reaction = REACTION_BY_KEY.get(reactionKey);
    const broadcastId = state.selectedSession?._id || "";
    if (
      !reaction ||
      !liveReactionsEnabled() ||
      !core.isValidSessionId(broadcastId)
    ) {
      return;
    }

    const tapId = crypto.randomUUID();
    rememberReactionId(tapId);
    showReaction(reactionKey, button);
    button.classList.add("sent");
    setTimeout(() => button.classList.remove("sent"), 150);

    try {
      const client = convexClient();
      if (!client || typeof client.mutation !== "function") {
        throw new Error("실시간 연결을 준비하지 못했습니다.");
      }
      const clientId = await ensureReactionClientId();
      await client.mutation("reactions:react", {
        // reactions API의 sessionId는 연결 ID가 아니라 공개 방송 ID입니다.
        sessionId: broadcastId,
        key: reactionKey,
        clientId,
        tapId
      });
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `리액션 전송 실패 · ${error.message}`
          : "리액션을 전송하지 못했습니다."
      );
    }
  }

  function bindUiEvents() {
    dom.settingsButton.addEventListener("click", () => {
      state.settingsOpen = !state.settingsOpen;
      if (state.settingsOpen && state.messageRenderFrame !== null) {
        state.messageRenderPending = true;
        state.messageForceBottomPending ||= state.messageFollowLatest;
        cancelPendingMessageRender();
      }
      applySettingsToUi();
      if (!state.settingsOpen) {
        dom.settingsButton.focus({ preventScroll: true });
      }
    });

    dom.positionCycleButton.addEventListener("click", () => {
      state.settingsOpen = false;
      const nextPosition = core.nextPresetPosition(state.settings.position);
      updateSettings({
        position: nextPosition,
        customPlacement: null
      });
      setStatus(`채팅창을 ${positionLabel(nextPosition)}로 옮겼습니다.`);
    });

    dom.lockButton.addEventListener("click", () => {
      const layoutLocked = !state.settings.layoutLocked;
      updateSettings({ layoutLocked });
      setStatus(
        layoutLocked
          ? "채팅창 위치와 크기를 잠갔습니다."
          : "채팅창 위치와 크기 잠금을 풀었습니다."
      );
    });

    dom.closeButton.addEventListener("click", () => {
      state.settingsOpen = false;
      updateSettings({ visible: false });
      pauseHighestQualityAutomation();
      stopLivePresence();
      stopLiveSync();
      dom.restoreButton.focus({ preventScroll: true });
    });

    dom.restoreButton.addEventListener("click", (event) => {
      if (!isTrustedUiEvent(event)) {
        return;
      }
      updateSettings({ visible: true });
      resumeHighestQualityAutomation();
      dom.settingsButton.focus({ preventScroll: true });
      void refreshSessions({ forceMessages: true });
    });

    dom.refreshButton.addEventListener("click", (event) => {
      if (!isTrustedUiEvent(event)) {
        return;
      }
      void refreshSessions({ forceMessages: true, forceHttp: true });
    });

    dom.sessionSelect.addEventListener("change", (event) => {
      if (!isTrustedUiEvent(event)) {
        return;
      }
      const selected = state.sessions.find(
        (session) => session._id === dom.sessionSelect.value
      );
      if (!selected) {
        return;
      }
      state.manualSessionPath = location.pathname;
      state.selectedSession = selected;
      syncLivePresence();
      clearLiveReleaseTimer();
      state.liveReleasedThrough = null;
      stopMessagesSubscription();
      stopReactionsSubscription();
      state.messageApplyRevision += 1;
      state.messageForcePending = false;
      state.lastArchiveMessageRefreshAt = 0;
      state.messages = [];
      state.seenMessageIds.clear();
      state.hasLoadedMessages = false;
      state.displayedHistoryCount = 0;
      state.unseenSubtitleCount = 0;
      state.anchorOptionsKey = null;
      resetMessageViewportState();
      updateSettings({ selectedSessionId: selected._id });
      renderSessions();
      renderMessages(new Set(), {
        forceBottom: true,
        forceRender: true
      });
      void requestMessagesForSelection({ force: true });
    });

    for (const button of dom.positionButtons) {
      button.addEventListener("click", () => {
        updateSettings({
          position: button.dataset.position,
          customPlacement: null
        });
      });
    }

    dom.fontSize.addEventListener("input", () => {
      updateSettings({ fontSize: Number(dom.fontSize.value) });
    });
    dom.backgroundOpacity.addEventListener("input", () => {
      updateSettings({
        backgroundOpacity: 100 - Number(dom.backgroundOpacity.value)
      });
    });
    dom.panelWidth.addEventListener("input", () => {
      updateSettings({ panelWidth: Number(dom.panelWidth.value) });
    });
    dom.textColor.addEventListener("input", () => {
      updateSettings({ textColor: dom.textColor.value });
    });
    dom.textOutlineWidth.addEventListener("input", () => {
      updateSettings({ textOutlineWidth: Number(dom.textOutlineWidth.value) });
    });
    dom.liveDelayMuchLessButton.addEventListener("click", () => {
      setLiveDelayMs((Number(state.settings.liveDelayMs) || 0) + 5000);
    });
    dom.liveDelayOneLessButton.addEventListener("click", () => {
      setLiveDelayMs((Number(state.settings.liveDelayMs) || 0) + 1000);
    });
    dom.liveDelayLessButton.addEventListener("click", () => {
      setLiveDelayMs((Number(state.settings.liveDelayMs) || 0) + 500);
    });
    dom.liveDelayZeroButton.addEventListener("click", () => {
      setLiveDelayMs(0);
    });
    dom.liveDelayMoreButton.addEventListener("click", () => {
      setLiveDelayMs((Number(state.settings.liveDelayMs) || 0) - 500);
    });
    dom.liveDelayOneMoreButton.addEventListener("click", () => {
      setLiveDelayMs((Number(state.settings.liveDelayMs) || 0) - 1000);
    });
    dom.liveDelayMuchMoreButton.addEventListener("click", () => {
      setLiveDelayMs((Number(state.settings.liveDelayMs) || 0) - 5000);
    });
    dom.syncMuchSlowerButton.addEventListener("click", () => {
      setReplayOffsetMs(currentReplayOffsetMs() - 5000);
    });
    dom.syncOneSlowerButton.addEventListener("click", () => {
      setReplayOffsetMs(currentReplayOffsetMs() - 1000);
    });
    dom.syncSlowerButton.addEventListener("click", () => {
      setReplayOffsetMs(currentReplayOffsetMs() - 500);
    });
    dom.syncZeroButton.addEventListener("click", () => {
      setReplayOffsetMs(0);
    });
    dom.syncFasterButton.addEventListener("click", () => {
      setReplayOffsetMs(currentReplayOffsetMs() + 500);
    });
    dom.syncOneFasterButton.addEventListener("click", () => {
      setReplayOffsetMs(currentReplayOffsetMs() + 1000);
    });
    dom.syncMuchFasterButton.addEventListener("click", () => {
      setReplayOffsetMs(currentReplayOffsetMs() + 5000);
    });
    for (const button of dom.quickSyncButtons) {
      button.addEventListener("click", () => {
        const deltaMs = Number(button.dataset.quickSyncMs) || 0;
        if (isLiveTranslationMode()) {
          setLiveDelayMs(
            deltaMs === 0
              ? 0
              : (Number(state.settings.liveDelayMs) || 0) - deltaMs
          );
        } else {
          setReplayOffsetMs(
            deltaMs === 0 ? 0 : currentReplayOffsetMs() + deltaMs
          );
        }
      });
    }
    for (const button of dom.reactionButtons) {
      button.addEventListener("click", (event) => {
        void sendReaction(button.dataset.reactionKey, button, event);
      });
    }
    dom.saveReplayAnchorButton.addEventListener(
      "click",
      saveReplayAnchorFromSelection
    );
    dom.resetReplayAnchorButton.addEventListener("click", resetReplayAnchor);
    dom.showTime.addEventListener("change", () => {
      updateSettings({ showTime: dom.showTime.checked });
    });
    dom.showTranslator.addEventListener("change", () => {
      updateSettings({ showTranslator: dom.showTranslator.checked });
    });
    dom.showBorder.addEventListener("change", () => {
      updateSettings({ showBorder: dom.showBorder.checked });
    });
    dom.showTextOutline.addEventListener("change", () => {
      updateSettings({ showTextOutline: dom.showTextOutline.checked });
    });
    dom.preferHighestQuality.addEventListener("change", () => {
      const enabled = dom.preferHighestQuality.checked;
      updateSettings({
        preferHighestQuality: enabled
      });
      state.qualityEnableEpoch += 1;
      resetQualityAutomation({ clearRunKey: true });
      if (enabled) {
        enforceHighestQuality({ restart: true });
      }
    });
    dom.layoutLocked.addEventListener("change", () => {
      updateSettings({ layoutLocked: dom.layoutLocked.checked });
    });
    dom.videoClickPriority.addEventListener("change", () => {
      updateSettings({ videoClickPriority: dom.videoClickPriority.checked });
    });

    dom.resetButton.addEventListener("click", () => {
      const previousHighestQuality = state.settings.preferHighestQuality;
      const nextHighestQuality = core.DEFAULT_SETTINGS.preferHighestQuality;
      updateSettings({
        ...core.DEFAULT_SETTINGS,
        visible: state.settings.visible,
        selectedSessionId: state.settings.selectedSessionId
      });
      if (previousHighestQuality !== nextHighestQuality) {
        state.qualityEnableEpoch += 1;
        resetQualityAutomation({ clearRunKey: true });
        if (nextHighestQuality) {
          enforceHighestQuality({ restart: true });
        }
      }
    });

    dom.saveViewButton.addEventListener("click", () => {
      state.settingsOpen = false;
      persistSettingsNow();
      applySettingsToUi();
      dom.settingsButton.focus({ preventScroll: true });
      setStatus("표시 설정을 저장했습니다.");
    });

    dom.latestMessageButton.addEventListener("click", () => {
      state.messageFollowLatest = true;
      dom.messages.scrollTo({
        top: dom.messages.scrollHeight,
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth"
      });
    });

    dom.dragHandle.addEventListener("pointerdown", beginDrag);
    dom.dragHandle.addEventListener("lostpointercapture", endDrag);
    for (const handle of dom.resizeHandles) {
      handle.addEventListener("pointerdown", beginResize);
      handle.addEventListener("lostpointercapture", endResize);
    }
    dom.messages.addEventListener("scroll", handleMessagesScroll, {
      passive: true
    });
    document.addEventListener("click", schedulePlayerMenuAvoidance, true);
    document.addEventListener("keyup", schedulePlayerMenuAvoidance, true);
    document.addEventListener("pointerdown", noteQualityUserActivity, true);
    document.addEventListener("keydown", noteQualityUserActivity, true);
    document.addEventListener("wheel", noteQualityUserActivity, {
      capture: true,
      passive: true
    });
    document.addEventListener("touchstart", noteQualityUserActivity, {
      capture: true,
      passive: true
    });
    window.addEventListener("pointermove", moveDrag, { passive: true });
    window.addEventListener("pointermove", moveResize, { passive: true });
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("pointercancel", endResize);
    window.addEventListener("blur", () => {
      endDrag();
      endResize();
    });
  }

  function handleRouteOrVisibilityTick() {
    bindPlaybackVideo();
    if (location.pathname !== state.lastPathname) {
      stopLivePresence();
      stopLiveSync({ clearSessions: true });
      state.lastPathname = location.pathname;
      state.routeGeneration += 1;
      const staleRouteVideos = new Map(state.staleRouteVideos);
      for (const [video, source] of state.boundRouteVideos) {
        staleRouteVideos.set(video, source);
      }
      state.staleRouteVideos = staleRouteVideos;
      state.boundRouteVideos = new Map();
      if (state.boundVideo) {
        state.boundVideo.removeEventListener("seeking", handlePlaybackSeeking);
        state.boundVideo.removeEventListener("seeked", handlePlaybackSeeking);
        state.boundVideo.removeEventListener("timeupdate", handlePlaybackTimeUpdate);
        state.boundVideo.removeEventListener("loadedmetadata", handlePlaybackSeeking);
        state.boundVideo.removeEventListener("durationchange", handlePlaybackSeeking);
      }
      state.boundVideo = null;
      state.boundVideoRoute = null;
      state.boundPlayerRoot = null;
      state.sessions = [];
      state.anchorOptionsKey = null;
      state.adPlaying = false;
      clearLiveReleaseTimer();
      state.liveReleasedThrough = null;
      state.sessionRequestRunning = false;
      state.sessionRefreshPending = false;
      state.sessionForceMessagesPending = false;
      state.sessionForceHttpPending = false;
      state.messageRequestRunning = false;
      state.messageForcePending = false;
      state.messageApplyRevision += 1;
      state.lastArchiveMessageRefreshAt = 0;
      state.lastSessionRefreshAt = 0;
      state.adEvidenceUntil = 0;
      resetQualityAutomation({ clearRunKey: true });
      state.selectedSession = null;
      state.broadcastInfo = null;
      state.manualSessionPath = null;
      state.settingsOpen = false;
      state.messages = [];
      state.displayedHistoryCount = 0;
      state.unseenSubtitleCount = 0;
      state.seenMessageIds.clear();
      state.hasLoadedMessages = false;
      resetMessageViewportState();
      requestHookedTiming();
      applySettingsToUi({ renderContent: true });
      renderSessions();
      if (isLiveRoute() && state.settings.visible) {
        bindPlaybackVideo();
        enforceHighestQuality();
        void refreshSessions({ forceMessages: true });
      }
    }

    const liveRoute = isLiveRoute();
    const shouldHidePanel = !state.settings.visible || !liveRoute;
    const shouldHideRestore = state.settings.visible || !liveRoute;
    if (
      dom.panel.hidden !== shouldHidePanel ||
      dom.restoreButton.hidden !== shouldHideRestore
    ) {
      applySettingsToUi();
    }

    if (!state.settings.visible || !liveRoute) {
      clearLiveReleaseTimer();
      stopLivePresence();
      stopLiveSync({ clearSessions: true });
      return;
    }
    if (startLiveSync()) {
      // 구독이 연결된 동안 새 세션과 번역은 서버가 즉시 밀어줍니다.
    } else {
      if (Date.now() - state.lastSessionRefreshAt >= SESSION_REFRESH_MS) {
        void refreshSessions();
      }
      void pollMessages();
    }
    syncMessagesToPlayback();
    updatePlayerMenuAvoidance();
  }

  chrome.runtime.onMessage.addListener((request) => {
    if (!request || request.type !== "toggle-cutiestreet-overlay") {
      return false;
    }
    const nextVisible = !state.settings.visible;
    updateSettings({ visible: nextVisible });
    if (nextVisible) {
      resumeHighestQualityAutomation();
      void refreshSessions({ forceMessages: true });
    } else {
      pauseHighestQualityAutomation();
      stopLivePresence();
      stopLiveSync();
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes[STORAGE_KEY]) {
      const wasVisible = state.settings.visible;
      const previousHighestQuality = state.settings.preferHighestQuality;
      const previousShowTime = state.settings.showTime;
      const previousShowTranslator = state.settings.showTranslator;
      state.settings = core.normalizeSettings(changes[STORAGE_KEY].newValue);
      if (previousHighestQuality !== state.settings.preferHighestQuality) {
        state.qualityEnableEpoch += 1;
        resetQualityAutomation({ clearRunKey: true });
        if (state.settings.preferHighestQuality && state.settings.visible) {
          enforceHighestQuality({ restart: true });
        }
      }
      applySettingsToUi({
        renderContent:
          previousShowTime !== state.settings.showTime ||
          previousShowTranslator !== state.settings.showTranslator
      });
      scheduleLiveRelease();
      if (!state.settings.visible) {
        pauseHighestQualityAutomation();
        stopLivePresence();
        stopLiveSync();
      } else if (!wasVisible && isLiveRoute()) {
        resumeHighestQualityAutomation();
        void refreshSessions({ forceMessages: true });
      }
    }
    if (areaName === "local" && changes[REPLAY_ANCHORS_KEY]) {
      state.replayAnchors = normalizeReplayAnchors(
        changes[REPLAY_ANCHORS_KEY].newValue
      );
      renderReplaySyncControls();
      syncMessagesToPlayback({ force: true, forceBottom: true });
    }
    if (areaName === "local" && changes[REACTION_CLIENT_ID_KEY]) {
      const nextClientId = changes[REACTION_CLIENT_ID_KEY].newValue;
      state.reactionClientId = isValidReactionClientId(nextClientId)
        ? nextClientId
        : "";
    }
  });

  async function initialize() {
    ensureHostParent();
    bindUiEvents();
    const [storedSettings, replayAnchors, reactionClientId] = await Promise.all([
      readStoredSettings(),
      readReplayAnchors(),
      readReactionClientId()
    ]);
    state.settings = core.normalizeSettings(storedSettings);
    state.replayAnchors = replayAnchors;
    state.reactionClientId = reactionClientId;
    persistReplayAnchors();
    if (
      !storedSettings ||
      Number(storedSettings.schemaVersion) < core.DEFAULT_SETTINGS.schemaVersion
    ) {
      persistSettingsNow();
    }
    applySettingsToUi({ renderContent: true });
    renderSessions();

    window.addEventListener("resize", requestPlacement, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        stopLiveSync({ clearSessions: true });
        clearLiveReleaseTimer();
        pauseHighestQualityAutomation();
        return;
      }
      if (state.settings.visible && isLiveRoute()) {
        state.lastSessionRefreshAt = 0;
        requestHookedTiming();
        resumeHighestQualityAutomation();
        void refreshSessions({ forceMessages: true });
      }
    });
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) {
        stopLivePresence();
      }
      stopLiveSync({ clearSessions: true });
      clearLiveReleaseTimer();
      cancelPendingMessageRender();
      resetQualityAutomation({ clearRunKey: true });
      clearTimeout(state.playerMenuSettleTimer);
      state.playerMenuSettleTimer = null;
      state.playerMenuObserver?.disconnect();
      state.playerMenuObserver = null;
      state.playerMenuObserverRoot = null;
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted && state.settings.visible && isLiveRoute()) {
        livePresence.key = null;
        syncLivePresence();
      }
    });
    document.addEventListener("fullscreenchange", () => {
      ensureHostParent();
      bindPlayerMenuObserver();
      requestPlacement();
    });

    setInterval(() => {
      bindPlaybackVideo();
      requestPlacement();
    }, POSITION_TICK_MS);
    setInterval(handleRouteOrVisibilityTick, POLL_MS);

    if (isLiveRoute() && state.settings.visible) {
      await waitForInitialPageContent();
      if (!isLiveRoute() || !state.settings.visible) {
        return;
      }
      bindPlaybackVideo();
      await refreshSessions({ forceMessages: true });
    }
  }

  void initialize();
})();
