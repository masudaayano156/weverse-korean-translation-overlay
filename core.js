(function exposeOverlayCore(globalObject) {
  "use strict";

  const VALID_POSITIONS = new Set([
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
    "custom"
  ]);

  const POSITION_CYCLE = Object.freeze([
    "bottom-right",
    "bottom-left",
    "top-left",
    "top-right"
  ]);

  const REPLAY_LATENCY_BASELINE_MS = 8000;
  const MESSAGE_SUBSCRIPTION_MIN = 250;
  const MESSAGE_SUBSCRIPTION_MAX = 5000;
  const MESSAGE_SUBSCRIPTION_STEP = 250;
  const MESSAGE_SUBSCRIPTION_HEADROOM = 50;

  const DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: 12,
    position: "bottom-right",
    fontSize: 17,
    backgroundOpacity: 78,
    panelWidth: 390,
    panelHeight: null,
    showBorder: true,
    showTime: true,
    showTranslator: true,
    textColor: "#ffffff",
    showTextOutline: true,
    textOutlineWidth: 2,
    preferHighestQuality: false,
    layoutLocked: false,
    videoClickPriority: false,
    subtitleOffsetMs: 0,
    liveDelayMs: 0,
    visible: true,
    selectedSessionId: null,
    customPlacement: null
  });

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(maximum, Math.max(minimum, number));
  }

  const SESSION_ID_PATTERN = /^[a-z0-9]{16,64}$/i;

  function isValidSessionId(value) {
    return typeof value === "string" && SESSION_ID_PATTERN.test(value);
  }

  function normalizeHexColor(value, fallback) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
  }

  function normalizeSettings(rawSettings) {
    const raw = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const position = VALID_POSITIONS.has(raw.position)
      ? raw.position
      : DEFAULT_SETTINGS.position;

    let customPlacement = null;
    if (
      raw.customPlacement &&
      typeof raw.customPlacement === "object" &&
      Number.isFinite(Number(raw.customPlacement.x)) &&
      Number.isFinite(Number(raw.customPlacement.y))
    ) {
      // 0~1은 영상 안의 상대 위치이고, 그 밖의 값은 영상 바깥 위치입니다.
      // 실제 표시 위치는 calculatePlacement에서 브라우저 화면 안으로 제한합니다.
      customPlacement = {
        x: clampNumber(raw.customPlacement.x, -20, 20, 0.5),
        y: clampNumber(raw.customPlacement.y, -20, 20, 0.5)
      };
    }

    return {
      schemaVersion: DEFAULT_SETTINGS.schemaVersion,
      position: position === "custom" && !customPlacement
        ? DEFAULT_SETTINGS.position
        : position,
      fontSize: Math.round(
        clampNumber(raw.fontSize, 12, 28, DEFAULT_SETTINGS.fontSize)
      ),
      backgroundOpacity: Math.round(
        clampNumber(
          raw.backgroundOpacity,
          0,
          100,
          DEFAULT_SETTINGS.backgroundOpacity
        )
      ),
      panelWidth: Math.round(
        clampNumber(raw.panelWidth, 220, 4096, DEFAULT_SETTINGS.panelWidth)
      ),
      panelHeight: raw.panelHeight === null || raw.panelHeight === undefined
        ? null
        : Math.round(clampNumber(raw.panelHeight, 150, 4096, 360)),
      showBorder: typeof raw.showBorder === "boolean"
        ? raw.showBorder
        : DEFAULT_SETTINGS.showBorder,
      showTime: typeof raw.showTime === "boolean"
        ? raw.showTime
        : DEFAULT_SETTINGS.showTime,
      textColor: normalizeHexColor(raw.textColor, DEFAULT_SETTINGS.textColor),
      showTextOutline: typeof raw.showTextOutline === "boolean"
        ? raw.showTextOutline
        : DEFAULT_SETTINGS.showTextOutline,
      textOutlineWidth: Math.round(
        clampNumber(
          raw.textOutlineWidth,
          1,
          4,
          DEFAULT_SETTINGS.textOutlineWidth
        )
      ),
      preferHighestQuality:
        typeof raw.preferHighestQuality === "boolean"
          ? raw.preferHighestQuality
          : DEFAULT_SETTINGS.preferHighestQuality,
      layoutLocked:
        typeof raw.layoutLocked === "boolean"
          ? raw.layoutLocked
          : DEFAULT_SETTINGS.layoutLocked,
      videoClickPriority:
        typeof raw.videoClickPriority === "boolean"
          ? raw.videoClickPriority
          : DEFAULT_SETTINGS.videoClickPriority,
      showTranslator:
        Number(raw.schemaVersion) >= 2 &&
        typeof raw.showTranslator === "boolean"
          ? raw.showTranslator
          : DEFAULT_SETTINGS.showTranslator,
      subtitleOffsetMs: Math.round(
        clampNumber(
          raw.subtitleOffsetMs,
          -600000,
          600000,
          DEFAULT_SETTINGS.subtitleOffsetMs
        ) / 500
      ) * 500,
      liveDelayMs: Math.round(
        clampNumber(raw.liveDelayMs, 0, 120000, DEFAULT_SETTINGS.liveDelayMs) / 500
      ) * 500,
      visible: typeof raw.visible === "boolean"
        ? raw.visible
        : DEFAULT_SETTINGS.visible,
      selectedSessionId: isValidSessionId(raw.selectedSessionId)
        ? raw.selectedSessionId
        : null,
      customPlacement
    };
  }

  function clamp(value, minimum, maximum) {
    if (maximum < minimum) {
      return minimum;
    }
    return Math.min(maximum, Math.max(minimum, value));
  }

  function nextPresetPosition(position) {
    const currentIndex = POSITION_CYCLE.indexOf(position);
    return currentIndex < 0
      ? POSITION_CYCLE[0]
      : POSITION_CYCLE[(currentIndex + 1) % POSITION_CYCLE.length];
  }

  function messageSubscriptionLimit(
    messageCount,
    headroom = MESSAGE_SUBSCRIPTION_HEADROOM
  ) {
    const rawCount = Number(messageCount);
    const rawHeadroom = Number(headroom);
    const safeCount = Number.isFinite(rawCount)
      ? Math.max(0, Math.ceil(rawCount))
      : 0;
    const safeHeadroom = Number.isFinite(rawHeadroom)
      ? Math.max(0, Math.ceil(rawHeadroom))
      : MESSAGE_SUBSCRIPTION_HEADROOM;
    const required = safeCount + safeHeadroom;
    const stepped = Math.ceil(required / MESSAGE_SUBSCRIPTION_STEP) *
      MESSAGE_SUBSCRIPTION_STEP;
    return clamp(
      stepped,
      MESSAGE_SUBSCRIPTION_MIN,
      MESSAGE_SUBSCRIPTION_MAX
    );
  }

  function migrateReplayOffset({
    offsetMs,
    sessionStartedAt,
    broadcastStartedAt,
    hasManualBase = false,
    limitMs = 600000
  }) {
    const limit = Math.max(0, Number(limitMs) || 0);
    const offset = Number.isFinite(Number(offsetMs)) ? Number(offsetMs) : 0;
    const sessionStart = sessionStartedAt === null || sessionStartedAt === undefined
      ? Number.NaN
      : Number(sessionStartedAt);
    const broadcastStart = broadcastStartedAt === null || broadcastStartedAt === undefined
      ? Number.NaN
      : Number(broadcastStartedAt);
    const adjusted = !hasManualBase &&
      Number.isFinite(sessionStart) &&
      Number.isFinite(broadcastStart)
      ? offset + sessionStart - broadcastStart
      : offset;
    return Math.round(clamp(adjusted, -limit, limit) / 500) * 500;
  }

  function calculatePlacement({
    playerRect,
    panelRect,
    viewportWidth,
    viewportHeight,
    position,
    customPlacement
  }) {
    const edge = 12;
    const bottomControls = 72;
    const leftMinimum = playerRect.left + edge;
    const leftMaximum = playerRect.right - panelRect.width - edge;
    const topMinimum = playerRect.top + edge;
    const topMaximum = playerRect.bottom - panelRect.height - bottomControls;
    const horizontalSpace = customPlacementSpan(
      leftMaximum - leftMinimum,
      playerRect.right - playerRect.left,
      panelRect.width
    );
    const verticalSpace = customPlacementSpan(
      topMaximum - topMinimum,
      playerRect.bottom - playerRect.top,
      panelRect.height
    );

    let left;
    let top;
    const customInsidePlayer =
      position === "custom" &&
      customPlacementInsidePlayer(customPlacement);

    if (position === "custom" && customPlacement) {
      left = leftMinimum + horizontalSpace * customPlacement.x;
      top = topMinimum + verticalSpace * customPlacement.y;
    } else {
      left = position.endsWith("right") ? leftMaximum : leftMinimum;
      top = position.startsWith("bottom") ? topMaximum : topMinimum;
    }

    const viewportLeftMaximum = Math.max(8, viewportWidth - panelRect.width - 8);
    const viewportTopMaximum = Math.max(8, viewportHeight - panelRect.height - 8);
    const constrainedLeftMinimum = customInsidePlayer
      ? Math.max(8, leftMinimum)
      : 8;
    const constrainedLeftMaximum = customInsidePlayer
      ? Math.min(viewportLeftMaximum, Math.max(constrainedLeftMinimum, leftMaximum))
      : viewportLeftMaximum;
    const constrainedTopMinimum = customInsidePlayer
      ? Math.max(8, topMinimum)
      : 8;
    const constrainedTopMaximum = customInsidePlayer
      ? Math.min(viewportTopMaximum, Math.max(constrainedTopMinimum, topMaximum))
      : viewportTopMaximum;

    return {
      left: Math.round(clamp(left, constrainedLeftMinimum, constrainedLeftMaximum)),
      top: Math.round(clamp(top, constrainedTopMinimum, constrainedTopMaximum)),
      maxPanelHeight: position === "custom" && !customInsidePlayer
        ? Math.max(150, Math.floor(viewportHeight - 16))
        : Math.max(
            150,
            Math.floor(playerRect.height - edge - bottomControls)
          )
    };
  }

  function customPlacementInsidePlayer(customPlacement) {
    if (!customPlacement || typeof customPlacement !== "object") {
      return false;
    }
    const x = Number(customPlacement.x);
    const y = Number(customPlacement.y);
    return Number.isFinite(x) && Number.isFinite(y) &&
      x >= 0 && x <= 1 && y >= 0 && y <= 1;
  }

  function customPlacementSpan(availableSpace, playerSize, panelSize) {
    if (Number.isFinite(availableSpace) && availableSpace > 0) {
      return availableSpace;
    }
    return Math.max(
      1,
      Math.abs(Number(playerSize) || 0),
      Math.abs(Number(panelSize) || 0)
    );
  }

  function placementFromCoordinates({ left, top, playerRect, panelRect }) {
    const edge = 12;
    const bottomControls = 72;
    const leftMinimum = playerRect.left + edge;
    const leftMaximum = playerRect.right - panelRect.width - edge;
    const topMinimum = playerRect.top + edge;
    const topMaximum = playerRect.bottom - panelRect.height - bottomControls;
    const horizontalSpace = customPlacementSpan(
      leftMaximum - leftMinimum,
      playerRect.right - playerRect.left,
      panelRect.width
    );
    const verticalSpace = customPlacementSpan(
      topMaximum - topMinimum,
      playerRect.bottom - playerRect.top,
      panelRect.height
    );

    return {
      x: clamp((left - leftMinimum) / horizontalSpace, -20, 20),
      y: clamp((top - topMinimum) / verticalSpace, -20, 20)
    };
  }

  function chooseLiveSession(sessions, selectedSessionId) {
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return null;
    }

    const selected = sessions.find((session) => session?._id === selectedSessionId);
    if (selected) {
      return selected;
    }

    return [...sessions]
      .filter((session) => session && typeof session._id === "string")
      .sort((left, right) => {
        const rightActivity = Number(right.lastActivityAt || right._creationTime || 0);
        const leftActivity = Number(left.lastActivityAt || left._creationTime || 0);
        return rightActivity - leftActivity;
      })[0] || null;
  }

  const MEMBER_ALIASES = Object.freeze([
    [
      "aika",
      "sano",
      "aika.sano_official",
      "아이카",
      "사노 아이카",
      "佐野愛花",
      "愛花",
      "あいか"
    ],
    [
      "nagisa",
      "manabe",
      "nagisa_manabe",
      "나기사",
      "마나베 나기사",
      "真鍋凪咲",
      "凪咲",
      "なぎさ"
    ],
    [
      "ayano",
      "masuda",
      "m_ayano26",
      "아야노",
      "마스다 아야노",
      "増田彩乃",
      "増田",
      "彩乃",
      "あやの"
    ],
    [
      "kana",
      "itakura",
      "kana.sii.i",
      "카나",
      "이타쿠라 카나",
      "板倉可奈",
      "可奈",
      "かな"
    ],
    [
      "emiru",
      "kawamoto",
      "_emiru._",
      "에미루",
      "카와모토 에미루",
      "川本笑瑠",
      "笑瑠",
      "えみる"
    ],
    [
      "miyu",
      "umeda",
      "miyu_.0913",
      "미유",
      "우메다 미유",
      "梅田みゆ",
      "美優",
      "みゆ"
    ],
    [
      "haruka",
      "paru",
      "parutan",
      "pa___.ru",
      "하루카",
      "파루",
      "파루땅",
      "사쿠라바 하루카",
      "sakuraba",
      "桜庭遥花",
      "遥花",
      "遥香",
      "はるか",
      "ぱる",
      "ぱるたん"
    ],
    [
      "risa",
      "furusawa",
      "furi",
      "fuuuuu_ri",
      "리사",
      "후리",
      "후루사와 리사",
      "古澤里紗",
      "古澤",
      "里紗",
      "りさ",
      "ふーりー"
    ]
  ]);

  function normalizedSearchText(value) {
    return String(value || "").normalize("NFKC").toLocaleLowerCase();
  }

  function memberKeys(value) {
    const text = normalizedSearchText(value);
    const keys = new Set();
    MEMBER_ALIASES.forEach((aliases, index) => {
      if (aliases.some((alias) => text.includes(normalizedSearchText(alias)))) {
        keys.add(index);
      }
    });
    return keys;
  }

  function koreanDayKey(timestamp) {
    const number = Number(timestamp);
    if (!Number.isFinite(number)) {
      return "";
    }
    const shifted = new Date(number + 9 * 60 * 60 * 1000);
    return [
      shifted.getUTCFullYear(),
      String(shifted.getUTCMonth() + 1).padStart(2, "0"),
      String(shifted.getUTCDate()).padStart(2, "0")
    ].join("-");
  }

  function chooseSessionForBroadcast(sessions, broadcast, selectedSessionId) {
    const validSessions = Array.isArray(sessions)
      ? sessions.filter((session) => session && typeof session._id === "string")
      : [];
    if (validSessions.length === 0) {
      return null;
    }

    const info = broadcast && typeof broadcast === "object" ? broadcast : {};
    const startedAt = info.startedAt === null || info.startedAt === undefined
      ? Number.NaN
      : Number(info.startedAt);
    const hasStartedAt = Number.isFinite(startedAt);
    const hasLiveState = typeof info.live === "boolean";
    const pageMembers = memberKeys(`${info.title || ""} ${info.author || ""}`);

    if (hasStartedAt || hasLiveState || pageMembers.size > 0) {
      let best = null;
      for (const session of validSessions) {
        const sessionStartedAt = Number(session.startedAt || session._creationTime);
        let score = 0;

        if (hasStartedAt && Number.isFinite(sessionStartedAt)) {
          const differenceMinutes = Math.abs(sessionStartedAt - startedAt) / 60000;
          if (differenceMinutes <= 3) {
            score += 240 - differenceMinutes;
          } else if (differenceMinutes <= 15) {
            score += 195 - differenceMinutes;
          } else if (differenceMinutes <= 60) {
            score += 135 - differenceMinutes / 2;
          } else if (differenceMinutes <= 180) {
            score += 75 - differenceMinutes / 6;
          } else if (koreanDayKey(sessionStartedAt) === koreanDayKey(startedAt)) {
            score += 32;
          } else {
            score -= 120;
          }
        }

        if (hasLiveState) {
          score += Boolean(session.live) === info.live ? 90 : -80;
        }

        if (pageMembers.size > 0) {
          const sessionMembers = memberKeys(session.title);
          if ([...pageMembers].some((key) => sessionMembers.has(key))) {
            score += 72;
          }
        }

        score += Math.min(12, Number(session.messageCount || 0) / 100);
        const activity = Number(session.lastActivityAt || sessionStartedAt || 0);
        if (
          !best ||
          score > best.score ||
          (score === best.score && activity > best.activity)
        ) {
          best = { session, score, activity };
        }
      }

      if (best && best.score >= 45) {
        return best.session;
      }
      if (info.live === true) {
        return chooseLiveSession(
          validSessions.filter((session) => session.live),
          selectedSessionId
        );
      }
      return null;
    }

    const selected = validSessions.find(
      (session) => session._id === selectedSessionId
    );
    return selected || chooseLiveSession(
      validSessions.filter((session) => session.live),
      null
    );
  }

  function takeLatestMessages(messages, limit) {
    if (!Array.isArray(messages)) {
      return [];
    }
    const safeLimit = Math.round(clampNumber(limit, 1, 30, 10));
    return messages
      .filter((message) => message && typeof message.text === "string")
      .sort((left, right) => Number(left._creationTime) - Number(right._creationTime))
      .slice(-safeLimit);
  }

  function messagesThroughPlayback(messages, cutoffTimestamp) {
    const cutoff = cutoffTimestamp === null || cutoffTimestamp === undefined
      ? Number.NaN
      : Number(cutoffTimestamp);
    const hasCutoff = Number.isFinite(cutoff);
    if (!Array.isArray(messages)) {
      return [];
    }
    return messages
      .filter(
        (message) =>
          message &&
          typeof message.text === "string" &&
          (!hasCutoff || Number(message._creationTime) <= cutoff)
      )
      .sort((left, right) => Number(left._creationTime) - Number(right._creationTime));
  }

  function takeMessagesAtPlayback(messages, limit, cutoffTimestamp) {
    const cutoff = Number(cutoffTimestamp);
    if (!Number.isFinite(cutoff)) {
      return takeLatestMessages(messages, limit);
    }
    return takeLatestMessages(messagesThroughPlayback(messages, cutoff), limit);
  }

  function calculateReplayCutoff({
    sessionStartedAt,
    broadcastStartedAt,
    manualBaseTimestamp,
    currentTime,
    subtitleOffsetMs,
    replayBaselineMs = 0
  }) {
    const sessionStart = sessionStartedAt === null || sessionStartedAt === undefined
      ? Number.NaN
      : Number(sessionStartedAt);
    const broadcastStart = broadcastStartedAt === null || broadcastStartedAt === undefined
      ? Number.NaN
      : Number(broadcastStartedAt);
    const playbackSeconds = Number(currentTime);
    const offset = Number(subtitleOffsetMs);
    const baseline = Number(replayBaselineMs);
    if (!Number.isFinite(playbackSeconds)) {
      return null;
    }
    const safeOffset = Number.isFinite(offset) ? offset : 0;
    const safeBaseline = Number.isFinite(baseline) ? baseline : 0;
    const effectiveOffset = safeBaseline + safeOffset;
    const playbackMs = Math.max(0, playbackSeconds * 1000);
    const manualBase = Number(manualBaseTimestamp);

    if (Number.isFinite(manualBase)) {
      return manualBase + playbackMs + effectiveOffset;
    }

    // 라이브에서 다시보기로 전환된 게시물의 onAirStartAt은 실제 라이브
    // 시작 시각입니다. 정확한 값이 없을 때만 번역 세션 시작 시각을 씁니다.
    const baseTimestamp = Number.isFinite(broadcastStart)
      ? broadcastStart
      : sessionStart;
    if (!Number.isFinite(baseTimestamp)) {
      return null;
    }
    return baseTimestamp + playbackMs + effectiveOffset;
  }

  function isLikelyAdVideoSource(source) {
    const value = String(source || "").toLocaleLowerCase();
    if (!value) {
      return false;
    }
    return (
      /(?:^|[./])(?:gvt1\.com|googlevideo\.com|doubleclick\.net)(?:[/:]|$)/.test(value) ||
      value.includes("dclk_video_ads") ||
      value.includes("googleads") ||
      value.includes("pagead")
    );
  }

  function resolutionHeight(label) {
    const value = String(label || "").trim();
    const pixelMatch = value.match(/(\d{3,4})\s*p\b/i);
    if (pixelMatch) {
      return Number(pixelMatch[1]);
    }
    if (/\b8k\b/i.test(value)) {
      return 4320;
    }
    if (/\b4k\b/i.test(value)) {
      return 2160;
    }
    return 0;
  }

  const koreanTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  function formatKoreanTime(timestamp) {
    const number = Number(timestamp);
    if (!Number.isFinite(number)) {
      return "--:--:--";
    }
    return koreanTimeFormatter.format(new Date(number));
  }

  const api = Object.freeze({
    DEFAULT_SETTINGS,
    REPLAY_LATENCY_BASELINE_MS,
    VALID_POSITIONS,
    POSITION_CYCLE,
    normalizeSettings,
    nextPresetPosition,
    messageSubscriptionLimit,
    migrateReplayOffset,
    calculatePlacement,
    customPlacementInsidePlayer,
    placementFromCoordinates,
    isValidSessionId,
    chooseLiveSession,
    chooseSessionForBroadcast,
    takeLatestMessages,
    messagesThroughPlayback,
    takeMessagesAtPlayback,
    calculateReplayCutoff,
    isLikelyAdVideoSource,
    resolutionHeight,
    formatKoreanTime
  });

  globalObject.WeverseTranslationOverlayCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
