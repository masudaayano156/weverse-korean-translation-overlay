"use strict";

const assert = require("node:assert/strict");
const core = require("../core.js");

const normalized = core.normalizeSettings({
  position: "wrong",
  messageLimit: 999,
  fontSize: 2,
  backgroundOpacity: "55",
  panelWidth: 900,
  showTime: false
});
assert.equal(normalized.position, "bottom-right");
assert.equal("messageLimit" in normalized, false);
assert.equal(normalized.fontSize, 12);
assert.equal(normalized.backgroundOpacity, 55);
assert.equal(normalized.panelWidth, 900);
assert.equal(core.normalizeSettings({ panelWidth: 99999 }).panelWidth, 4096);
assert.equal(core.normalizeSettings({ panelHeight: 99999 }).panelHeight, 4096);
assert.equal(normalized.showTime, false);
assert.equal(normalized.showTranslator, true);
assert.equal(normalized.showBorder, true);
assert.equal(normalized.textColor, "#ffffff");
assert.equal(normalized.showTextOutline, true);
assert.equal(normalized.textOutlineWidth, 2);
assert.equal(normalized.schemaVersion, 12);
assert.equal(normalized.preferHighestQuality, false);
assert.equal(normalized.layoutLocked, false);
assert.equal(normalized.videoClickPriority, false);
assert.equal("collapsed" in normalized, false);
assert.equal(core.normalizeSettings({ backgroundOpacity: -10 }).backgroundOpacity, 0);
assert.equal(core.normalizeSettings({ textColor: "#39A0FF" }).textColor, "#39a0ff");
assert.equal(core.normalizeSettings({ textColor: "white" }).textColor, "#ffffff");
assert.equal(core.normalizeSettings({ textOutlineWidth: 99 }).textOutlineWidth, 4);

const currentSchema = core.normalizeSettings({
  schemaVersion: 2,
  showTranslator: false,
  showBorder: false,
  panelHeight: 444
});
assert.equal(currentSchema.showTranslator, false);
assert.equal(currentSchema.showBorder, false);
assert.equal(currentSchema.panelHeight, 444);
assert.equal(currentSchema.subtitleOffsetMs, 0);
assert.equal(currentSchema.liveDelayMs, 0);
assert.equal(
  core.normalizeSettings({ preferHighestQuality: true }).preferHighestQuality,
  true
);
assert.equal(core.normalizeSettings({ layoutLocked: true }).layoutLocked, true);
assert.equal(
  core.normalizeSettings({ videoClickPriority: true }).videoClickPriority,
  true
);
assert.equal(core.resolutionHeight("1080p HD"), 1080);
assert.equal(core.resolutionHeight("4K UHD"), 2160);
assert.equal(core.resolutionHeight("자동"), 0);
assert.equal(core.REPLAY_LATENCY_BASELINE_MS, 8000);
assert.equal(core.normalizeSettings({ subtitleOffsetMs: -7500 }).subtitleOffsetMs, -7500);
assert.equal(core.normalizeSettings({ subtitleOffsetMs: 999999 }).subtitleOffsetMs, 600000);
assert.equal(core.normalizeSettings({ liveDelayMs: 1250 }).liveDelayMs, 1500);
assert.equal(core.normalizeSettings({ liveDelayMs: -500 }).liveDelayMs, 0);
assert.equal(core.normalizeSettings({ liveDelayMs: 999999 }).liveDelayMs, 120000);
assert.equal(core.isValidSessionId("abc123def456ghi7"), true);
assert.equal(core.isValidSessionId("ABC123DEF456GHI7890"), true);
assert.equal(core.isValidSessionId("short"), false);
assert.equal(core.isValidSessionId("../../unsafe-session"), false);
assert.equal(
  core.normalizeSettings({ selectedSessionId: "abc123def456ghi7" })
    .selectedSessionId,
  "abc123def456ghi7"
);
assert.equal(
  core.normalizeSettings({ selectedSessionId: "../../unsafe-session" })
    .selectedSessionId,
  null
);
assert.deepEqual(
  core.normalizeSettings({
    position: "custom",
    customPlacement: { x: 3.25, y: -2.5 }
  }).customPlacement,
  { x: 3.25, y: -2.5 }
);

assert.deepEqual(core.POSITION_CYCLE, [
  "bottom-right",
  "bottom-left",
  "top-left",
  "top-right"
]);
assert.equal(core.nextPresetPosition("bottom-right"), "bottom-left");
assert.equal(core.nextPresetPosition("bottom-left"), "top-left");
assert.equal(core.nextPresetPosition("top-left"), "top-right");
assert.equal(core.nextPresetPosition("top-right"), "bottom-right");
assert.equal(core.nextPresetPosition("custom"), "bottom-right");
assert.equal(core.messageSubscriptionLimit(undefined), 250);
assert.equal(core.messageSubscriptionLimit(-100), 250);
assert.equal(core.messageSubscriptionLimit(0), 250);
assert.equal(core.messageSubscriptionLimit(200), 250);
assert.equal(core.messageSubscriptionLimit(201), 500);
assert.equal(core.messageSubscriptionLimit(450), 500);
assert.equal(core.messageSubscriptionLimit(451), 750);
assert.equal(core.messageSubscriptionLimit(4950), 5000);
assert.equal(core.messageSubscriptionLimit(5000), 5000);
assert.equal(core.messageSubscriptionLimit(999999), 5000);
assert.equal(core.messageSubscriptionLimit(250, 0), 250);
assert.equal(core.messageSubscriptionLimit(251, 0), 500);
assert.equal(
  core.migrateReplayOffset({
    offsetMs: -40500,
    sessionStartedAt: 1_000_000,
    broadcastStartedAt: 942_670
  }),
  17000
);
assert.equal(
  core.migrateReplayOffset({
    offsetMs: -40500,
    sessionStartedAt: 1_000_000,
    broadcastStartedAt: 942_670,
    hasManualBase: true
  }),
  -40500
);
assert.equal(
  core.migrateReplayOffset({
    offsetMs: -40500,
    sessionStartedAt: 1_000_000,
    broadcastStartedAt: null
  }),
  -40500
);

const placementInput = {
  playerRect: { left: 100, top: 50, right: 900, bottom: 500, height: 450 },
  panelRect: { width: 300, height: 180 },
  viewportWidth: 1200,
  viewportHeight: 800
};

assert.deepEqual(
  core.calculatePlacement({ ...placementInput, position: "top-left" }),
  { left: 112, top: 62, maxPanelHeight: 366 }
);
assert.deepEqual(
  core.calculatePlacement({ ...placementInput, position: "top-right" }),
  { left: 588, top: 62, maxPanelHeight: 366 }
);
assert.deepEqual(
  core.calculatePlacement({ ...placementInput, position: "bottom-left" }),
  { left: 112, top: 248, maxPanelHeight: 366 }
);
assert.deepEqual(
  core.calculatePlacement({ ...placementInput, position: "bottom-right" }),
  { left: 588, top: 248, maxPanelHeight: 366 }
);

const custom = core.placementFromCoordinates({
  left: 350,
  top: 164,
  playerRect: placementInput.playerRect,
  panelRect: placementInput.panelRect
});
const customResult = core.calculatePlacement({
  ...placementInput,
  position: "custom",
  customPlacement: custom
});
assert.equal(customResult.left, 350);
assert.equal(customResult.top, 164);
assert.equal(customResult.maxPanelHeight, 366);
assert.equal(core.customPlacementInsidePlayer(custom), true);

const outsideCustom = core.placementFromCoordinates({
  left: 50,
  top: 20,
  playerRect: placementInput.playerRect,
  panelRect: placementInput.panelRect
});
assert.ok(outsideCustom.x < 0);
assert.ok(outsideCustom.y < 0);
assert.equal(core.customPlacementInsidePlayer(outsideCustom), false);
assert.deepEqual(
  core.calculatePlacement({
    ...placementInput,
    position: "custom",
    customPlacement: outsideCustom
  }),
  { left: 50, top: 20, maxPanelHeight: 784 }
);

const oversizedPanelInput = {
  playerRect: {
    left: 100,
    top: 50,
    right: 400,
    bottom: 350,
    width: 300,
    height: 300
  },
  panelRect: { width: 390, height: 234 },
  viewportWidth: 1200,
  viewportHeight: 800
};
const oversizedCoordinates = { left: 700, top: 500 };
const oversizedCustom = core.placementFromCoordinates({
  ...oversizedCoordinates,
  playerRect: oversizedPanelInput.playerRect,
  panelRect: oversizedPanelInput.panelRect
});
assert.deepEqual(
  core.calculatePlacement({
    ...oversizedPanelInput,
    position: "custom",
    customPlacement: oversizedCustom
  }),
  { ...oversizedCoordinates, maxPanelHeight: 784 }
);

const zeroSpanInput = {
  ...placementInput,
  panelRect: { width: 776, height: 366 }
};
const zeroSpanCoordinates = { left: 200, top: 100 };
const zeroSpanCustom = core.placementFromCoordinates({
  ...zeroSpanCoordinates,
  playerRect: zeroSpanInput.playerRect,
  panelRect: zeroSpanInput.panelRect
});
assert.deepEqual(
  core.calculatePlacement({
    ...zeroSpanInput,
    position: "custom",
    customPlacement: zeroSpanCustom
  }),
  { left: 112, top: 62, maxPanelHeight: 366 }
);

const halfWidthPlayerInput = {
  playerRect: {
    left: 12,
    top: 11,
    right: 932,
    bottom: 539,
    width: 920,
    height: 528
  },
  panelRect: { width: 390, height: 444 },
  viewportWidth: 1259,
  viewportHeight: 1033,
  position: "custom",
  customPlacement: { x: 1, y: 1 }
};
assert.deepEqual(
  core.calculatePlacement(halfWidthPlayerInput),
  { left: 530, top: 23, maxPanelHeight: 444 }
);

const sessions = [
  { _id: "old", lastActivityAt: 100 },
  { _id: "new", lastActivityAt: 300 },
  { _id: "middle", lastActivityAt: 200 }
];
assert.equal(core.chooseLiveSession(sessions, null)._id, "new");
assert.equal(core.chooseLiveSession(sessions, "old")._id, "old");
assert.equal(core.chooseLiveSession([], null), null);

const sampleSessionStart = 1_000_000;
const sampleFirstMessage = 1_022_581;
const sampleBroadcastStart = 900_000;
const sampleCutoffAtVideoStart = core.calculateReplayCutoff({
  sessionStartedAt: sampleSessionStart,
  broadcastStartedAt: sampleBroadcastStart,
  currentTime: 0,
  subtitleOffsetMs: 0
});
assert.equal(sampleCutoffAtVideoStart, sampleBroadcastStart);
assert.equal(
  core.calculateReplayCutoff({
    sessionStartedAt: sampleSessionStart,
    broadcastStartedAt: sampleBroadcastStart,
    currentTime: 0,
    subtitleOffsetMs: 0,
    replayBaselineMs: core.REPLAY_LATENCY_BASELINE_MS
  }),
  sampleBroadcastStart + 8000
);
const sampleCutoffAtGreeting = core.calculateReplayCutoff({
  sessionStartedAt: sampleSessionStart,
  broadcastStartedAt: sampleBroadcastStart,
  currentTime: 122.581,
  subtitleOffsetMs: 0
});
assert.equal(sampleCutoffAtGreeting, sampleFirstMessage);
assert.equal(
  core.calculateReplayCutoff({
    sessionStartedAt: sampleSessionStart,
    broadcastStartedAt: null,
    currentTime: 22.581,
    subtitleOffsetMs: 0
  }),
  sampleFirstMessage
);
const manualVideoTime = 74.5;
const manualOffset = 1500;
const manualBase = sampleFirstMessage - manualVideoTime * 1000 - manualOffset;
assert.equal(
  core.calculateReplayCutoff({
    sessionStartedAt: sampleSessionStart,
    broadcastStartedAt: 900_000,
    manualBaseTimestamp: manualBase,
    currentTime: manualVideoTime,
    subtitleOffsetMs: manualOffset
  }),
  sampleFirstMessage
);
assert.equal(
  core.isLikelyAdVideoSource(
    "https://redirector.gvt1.com/videoplayback/source/dclk_video_ads/file.mp4"
  ),
  true
);
assert.equal(
  core.isLikelyAdVideoSource("blob:https://weverse.io/example-main-video"),
  false
);

const broadcastStart = Date.UTC(2026, 7, 22, 12, 53);
const archiveSessions = [
  {
    _id: "wrong-live",
    live: true,
    startedAt: broadcastStart - 4 * 60 * 60 * 1000,
    title: "리사 위버스 라이브",
    messageCount: 900
  },
  {
    _id: "aika-archive",
    live: false,
    startedAt: broadcastStart + 60 * 1000,
    title: "260822_아이카 라이브",
    messageCount: 437
  }
];
assert.equal(
  core.chooseSessionForBroadcast(
    archiveSessions,
    { startedAt: broadcastStart, live: false, author: "CS Aika Sano" },
    null
  )._id,
  "aika-archive"
);
assert.equal(
  core.chooseSessionForBroadcast(
    archiveSessions,
    { startedAt: Date.UTC(2025, 0, 1), live: false, author: "unknown" },
    null
  ),
  null
);

const memberAliasSessions = [
  {
    _id: "ayano-session",
    live: true,
    startedAt: broadcastStart,
    title: "아야노 라이브",
    messageCount: 900
  },
  {
    _id: "furi-session",
    live: true,
    startedAt: broadcastStart,
    title: "후리 위버스 라이브",
    messageCount: 100
  }
];
assert.equal(
  core.chooseSessionForBroadcast(
    memberAliasSessions,
    { startedAt: broadcastStart, live: true, author: "CS Risa Furusawa" },
    null
  )._id,
  "furi-session"
);

const instagramMemberCases = [
  ["aika.sano_official", "아이카"],
  ["nagisa_manabe", "나기사"],
  ["m_ayano26", "아야노"],
  ["kana.sii.i", "카나"],
  ["_emiru._", "에미루"],
  ["miyu_.0913", "미유"],
  ["pa___.ru", "파루땅"],
  ["fuuuuu_ri", "후리"]
];
for (const [handle, memberName] of instagramMemberCases) {
  const matchingId = `${memberName}-instagram-session`;
  const candidates = [
    {
      _id: "other-live-session",
      live: true,
      title: "다른 멤버 라이브",
      lastActivityAt: 200
    },
    {
      _id: matchingId,
      live: true,
      title: `${memberName} 인스타 라이브`,
      lastActivityAt: 100
    }
  ];
  assert.equal(
    core.chooseSessionForBroadcast(
      candidates,
      { startedAt: null, live: true, author: handle },
      null
    )._id,
    matchingId,
    `${handle} 계정은 ${memberName} 번역 세션을 선택해야 합니다.`
  );
}

const messages = Array.from({ length: 12 }, (_value, index) => ({
  _id: String(index),
  _creationTime: index,
  text: `message-${index}`
}));
assert.deepEqual(
  core.takeLatestMessages(messages, 3).map((message) => message._id),
  ["9", "10", "11"]
);
assert.deepEqual(
  core.takeMessagesAtPlayback(messages, 3, 7).map((message) => message._id),
  ["5", "6", "7"]
);
assert.deepEqual(
  core.messagesThroughPlayback(messages, null).map((message) => message._id),
  messages.map((message) => message._id)
);
assert.deepEqual(
  core.messagesThroughPlayback(messages, 4).map((message) => message._id),
  ["0", "1", "2", "3", "4"]
);
assert.match(core.formatKoreanTime(Date.now()), /^\d{2}:\d{2}:\d{2}$/);

console.log("core tests: all assertions passed");
