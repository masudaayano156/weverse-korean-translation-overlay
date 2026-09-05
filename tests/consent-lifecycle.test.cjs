"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const settle = () => new Promise(setImmediate);

function section(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

async function testTimingConsentBoundary() {
  const messages = [];
  const pendingFetches = [];
  let clones = 0;
  let listener;
  const payload = JSON.stringify({ data: { extension: { video: {
    onAirStartAt: Date.UTC(2025, 0, 1), type: "VOD", liveToVod: true
  } } } });
  const response = () => ({ clone() {
    clones += 1;
    return { text: () => Promise.resolve(payload) };
  } });
  const win = {
    location: { href: "https://weverse.io/test/live/1-12345", origin: "https://weverse.io" },
    fetch: () => new Promise((resolve) => pendingFetches.push(resolve)),
    postMessage: (data) => messages.push(data),
    addEventListener: (_type, callback) => { listener = callback; }
  };
  win.top = win;
  class Xhr {
    constructor() { this.listeners = new Map(); this.responseType = "text"; }
    open() {}
    send() {}
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    removeEventListener(type) { this.listeners.delete(type); }
    finish() { this.listeners.get("load")?.(); this.listeners.get("loadend")?.(); }
    get responseText() { clones += 1; return payload; }
  }
  vm.runInNewContext(read("page-hook.js"), { window: win, XMLHttpRequest: Xhr, URL });
  const send = (data) => listener({ source: win, origin: win.location.origin,
    data: { source: "weverse-korean-overlay-content", ...data } });
  const consent = (granted) => send({ type: "privacy-consent", granted });
  const url = "https://global.apis.naver.com/post/v1.0/post-1-12345";

  // A fully completed pre-consent response must not be read or retained.
  const before = win.fetch(url);
  pendingFetches.shift()(response());
  await before; await settle();
  assert.equal(clones, 0);
  assert.equal(messages.length, 0);

  // Requests started before consent are usable if their response arrives after it.
  const during = win.fetch(url);
  const xhr = new Xhr(); xhr.open("GET", url); xhr.send();
  consent(true);
  pendingFetches.shift()(response());
  await during; xhr.finish(); await settle();
  assert.equal(clones, 2);
  assert.equal(messages.length, 2);
  send({ type: "request-timing", postId: "1-12345" });
  assert.equal(messages.length, 3);

  // Revocation invalidates old in-flight work even if consent is granted again.
  const stale = win.fetch(url);
  const staleXhr = new Xhr(); staleXhr.open("GET", url); staleXhr.send();
  consent(false); consent(true);
  pendingFetches.shift()(response());
  await stale; staleXhr.finish(); await settle();
  assert.equal(clones, 2);
  assert.equal(messages.length, 3);
  send({ type: "request-timing", postId: "1-12345" });
  assert.equal(messages.length, 3, "revocation clears the timing cache");
}

async function testBoundedPresenceShutdown() {
  const timers = new Map();
  const listeners = {};
  let nextTimer = 0;
  let oldClosed = 0;
  let freshClosed = 0;
  let finishDisconnect;
  const event = (name) => ({ addListener(fn) { listeners[name] = fn; } });
  const oldClient = {
    mutation: () => new Promise((resolve) => { finishDisconnect = resolve; }),
    close() { oldClosed += 1; return Promise.resolve(); }
  };
  const freshClient = { close() { freshClosed += 1; } };
  const context = vm.createContext({
    importScripts() {}, oldClient, freshClient,
    setTimeout(fn, delay) { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); }, clearInterval() {},
    chrome: {
      runtime: { onMessage: event("message"), onInstalled: event("installed") },
      storage: { onChanged: event("storage") }, tabs: { onRemoved: event("removed") },
      action: { onClicked: event("action") }, commands: { onCommand: event("command") }
    }
  });
  vm.runInContext(read("background.js"), context);
  vm.runInContext(`privacyConsentGranted = true;
    presenceState.client = oldClient;
    presenceState.heartbeatTimer = 1;
    presenceState.rooms.set('room', {sessionToken: 'test-session-token'});`, context);
  listeners.storage({ weverseOverlayPrivacyConsentV1: { newValue: undefined } }, "local");
  await settle();
  assert.equal(oldClosed, 0);
  assert.equal(timers.size, 1);
  const deadline = [...timers.values()][0];
  assert.equal(deadline.delay, 1500);
  // A newly granted connection must not be closed by the old shutdown task.
  vm.runInContext("privacyConsentGranted = true; presenceState.client = freshClient;", context);
  deadline.fn(); await settle();
  assert.equal(oldClosed, 1);
  assert.equal(freshClosed, 0);
  assert.equal(timers.size, 0);
  finishDisconnect(null); await settle();
  assert.equal(oldClosed, 1);
}

function testContentConsentLifecycle() {
  const source = read("content.js");
  const state = {
    privacyConsent: false, privacyConsentRevision: 0,
    settings: { visible: true, preferHighestQuality: true },
    qualityOperationToken: 7, qualityRunState: "running",
    qualityUserActivityAt: 0, qualityOperationStartedAt: 1,
    qualityDeadline: Date.now() + 5000, qualityRoot: null,
    qualityGearClicked: true, qualityTargetClicked: false,
    seenMessageIds: new Set(), messageApplyRevision: 0
  };
  let clicks = 0, aborted = 0, paused = 0, resumed = 0, reloads = 0;
  let storageListener;
  const ctx = vm.createContext({
    state, document: { visibilityState: "visible" },
    location: { reload() { reloads += 1; } },
    isLiveRoute: () => true, isWeversePage: () => true,
    isReplayTranslationMode: () => true, currentReplayAnchor: () => null,
    isAdPlaying: () => false, playerUiRoot: () => ({ matches: () => true }),
    visiblePlayerMenus: () => [], qualityItemChecked: () => false,
    qualityCandidates: () => [{ item: { click() { clicks += 1; } } }],
    finishQualityAutomation(_token, options) {
      if (options.result === "aborted") aborted += 1;
    },
    pauseHighestQualityAutomation() { paused += 1; },
    resumeHighestQualityAutomation() { resumed += 1; },
    notifyPageHookPrivacyConsent() {}, stopLivePresence() {}, stopLiveSync() {},
    resetPrivacyOpenFeedback() {},
    clearLiveReleaseTimer() {}, resetMessageViewportState() {},
    applySettingsToUi() {}, renderSessions() {}, requestHookedTiming() {}, refreshSessions() {},
    hookedTimings: new Map([["old", {}]]), isPrivacyConsentGranted: (value) => value === 1,
    STORAGE_KEY: "settings", REPLAY_ANCHORS_KEY: "anchors", REACTION_CLIENT_ID_KEY: "client",
    PRIVACY_CONSENT_KEY: "consent",
    chrome: { storage: { onChanged: { addListener(fn) { storageListener = fn; } } } }
  });
  vm.runInContext(section(source, "  function runQualityStep(", "  function enforceHighestQuality("), ctx);
  vm.runInContext("runQualityStep(7);", ctx);
  assert.equal(clicks, 0);
  assert.equal(aborted, 1);
  state.privacyConsent = true;
  vm.runInContext("runQualityStep(7);", ctx);
  assert.equal(clicks, 1, "normal quality selection remains enabled after consent");

  vm.runInContext(section(source, "  chrome.storage.onChanged.addListener", "  async function initialize("), ctx);
  storageListener({ consent: { newValue: undefined } }, "local");
  assert.equal(paused, 1);
  assert.equal(ctx.hookedTimings.size, 0);
  storageListener({ consent: { newValue: 1 } }, "local");
  assert.equal(resumed, 1);

  vm.runInContext(section(source, "  function isTrustedUiEvent(", "  async function sendReaction("), ctx);
  vm.runInContext(section(source, "  function needsTimingReload(", "  function bindUiEvents("), ctx);
  state.broadcastInfo = { exactOnAirStart: false };
  assert.equal(vm.runInContext("needsTimingReload()", ctx), true);
  vm.runInContext("reloadBroadcastForTiming({isTrusted:false})", ctx);
  assert.equal(reloads, 0);
  vm.runInContext("reloadBroadcastForTiming({isTrusted:true})", ctx);
  assert.equal(reloads, 1);
  state.broadcastInfo.exactOnAirStart = true;
  assert.equal(vm.runInContext("needsTimingReload()", ctx), false);
  state.privacyConsent = false;
  state.broadcastInfo.exactOnAirStart = false;
  assert.equal(vm.runInContext("needsTimingReload()", ctx), false);
}

(async () => {
  await testTimingConsentBoundary();
  await testBoundedPresenceShutdown();
  testContentConsentLifecycle();
  console.log("consent lifecycle tests: all assertions passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
