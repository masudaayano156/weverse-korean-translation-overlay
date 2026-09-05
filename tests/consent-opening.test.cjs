"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8")
  .replace(/\r\n?/g, "\n");

function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

function harness(mode = "pending") {
  const state = {
    privacyConsent: false, privacyOpenRequestId: 0, privacyOpenPending: false,
    privacyOpenFailed: false, privacyOpenTimer: null
  };
  const dom = {};
  for (const key of ["privacyFeedback", "privacyOpenStatus", "privacyRecovery",
    "privacyOpenButton", "privacySettingsButton", "privacyRetryButton", "privacyReloadButton"]) {
    dom[key] = { hidden: true, disabled: false, textContent: "",
      attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  }
  const callbacks = [], timers = new Map();
  let nextTimer = 0, calls = 0, reloads = 0, lastError = null, errorReads = 0;
  const runtime = {
    get lastError() { errorReads++; return lastError; },
    sendMessage(request, callback) {
      calls++;
      assert.equal(request.type, "cutiestreet-open-privacy");
      callbacks.push(callback);
      if (mode === "invalidated") throw new Error("Extension context invalidated.");
      if (mode === "missing-receiver") {
        lastError = { message: "Receiving end does not exist." };
        callback(undefined);
        lastError = null;
      }
      if (mode === "options-failed") callback({ ok: false, error: "Cannot open options" });
      if (mode === "empty-response") callback(undefined);
      if (mode === "success") callback({ ok: true });
    }
  };
  const ctx = vm.createContext({
    state, dom, chrome: { runtime }, location: { reload() { reloads++; } },
    setTimeout(fn, delay) { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(source.match(/const PRIVACY_OPEN_TIMEOUT_MS = \d+;/)[0], ctx);
  vm.runInContext(section("  function isTrustedUiEvent(", "  async function sendReaction("), ctx);
  vm.runInContext(section("  function setPrivacyOpenFeedback(", "  function isValidReactionClientId("), ctx);
  return {
    state, dom, timers, callbacks,
    get calls() { return calls; }, get reloads() { return reloads; },
    get errorReads() { return errorReads; },
    click(trusted = true) { ctx.openPrivacyOptions({ isTrusted: trusted }); },
    reload(trusted = true) { ctx.reloadBroadcastForPrivacy({ isTrusted: trusted }); },
    reset() { ctx.resetPrivacyOpenFeedback(); },
    expire() {
      const timer = [...timers.values()][0];
      assert.equal(timer.delay, 5000);
      timer.fn();
    },
    respond(index, response, error = null) {
      lastError = error;
      callbacks[index](response);
      lastError = null;
    }
  };
}

for (const mode of ["invalidated", "missing-receiver", "options-failed", "empty-response"]) {
  const h = harness(mode);
  h.click();
  assert.equal(h.dom.privacyFeedback.hidden, false, mode);
  assert.equal(h.dom.privacyRecovery.hidden, false, mode);
  assert.match(h.dom.privacyOpenStatus.textContent, /새로고침/);
  assert.equal(h.state.privacyOpenPending, false);
  assert.equal(h.dom.privacyOpenButton.disabled, false);
  assert.equal(h.dom.privacySettingsButton.disabled, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.reloads, 0, "failure must never automatically reload the broadcast");
  assert.equal(h.state.privacyConsent, false, "opening failure must not grant consent");
}

{
  const h = harness("success");
  h.click(false);
  h.reload();
  assert.equal(h.calls, 0, "synthetic clicks must not open an options tab");
  assert.equal(h.reloads, 0, "reload is available only after an opening failure");
  h.click();
  assert.match(h.dom.privacyOpenStatus.textContent, /새 탭.*동의하고 사용하기/);
  assert.equal(h.dom.privacyRecovery.hidden, true);
  assert.equal(h.state.privacyConsent, false, "opening a tab is not accepting consent");
  assert.equal(h.timers.size, 0);
  h.state.privacyConsent = true;
  h.reset();
  assert.equal(h.dom.privacyFeedback.hidden, true);
  h.click();
  assert.match(h.dom.privacyOpenStatus.textContent, /동의를 관리/);
}

{
  const h = harness();
  h.click();
  h.click();
  assert.equal(h.calls, 1, "repeated input must not send duplicate pending requests");
  assert.equal(h.dom.privacyOpenButton.disabled, true);
  assert.equal(h.dom.privacySettingsButton.disabled, true);
  assert.equal(h.dom.privacyRetryButton.disabled, true);
  assert.equal(h.dom.privacyOpenButton.attributes["aria-busy"], "true");
  h.expire();
  assert.match(h.dom.privacyOpenStatus.textContent, /응답이 없습니다/);
  assert.equal(h.state.privacyOpenFailed, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls, 1, "timeout must not automatically retry");
  h.respond(0, { ok: true });
  assert.equal(h.state.privacyOpenFailed, true, "late success must not hide recovery");
  h.click();
  assert.equal(h.calls, 2, "manual retry must work after timeout");
  h.respond(0, undefined, { message: "Late runtime error" });
  assert.equal(h.errorReads, 2, "stale callback still consumes runtime.lastError");
  assert.equal(h.state.privacyOpenPending, true, "old callback cannot finish a retry");
  h.respond(1, { ok: true });
  assert.equal(h.state.privacyOpenPending, false);
  assert.equal(h.state.privacyOpenFailed, false);
  assert.equal(h.timers.size, 0);
}

{
  const h = harness();
  h.click();
  h.state.privacyConsent = true;
  h.reset();
  h.respond(0, { ok: false });
  assert.equal(h.dom.privacyFeedback.hidden, true, "consent change cancels stale feedback");
  assert.equal(h.timers.size, 0);
  assert.equal(h.dom.privacyOpenButton.disabled, false);
  assert.match(section("  chrome.storage.onChanged.addListener", "  async function initialize("),
    /state\.privacyConsent = privacyConsent;\s*resetPrivacyOpenFeedback\(\);/);
}

{
  const h = harness("invalidated");
  h.click();
  h.reload(false);
  assert.equal(h.reloads, 0);
  h.reload();
  assert.equal(h.reloads, 1, "trusted manual reload works even without extension runtime");
}

// Execute the actual UI class assignment for every consent/settings combination.
const clickPriority = source.match(/dom\.panel\.classList\.toggle\(\s*"video-click-priority",[\s\S]*?\);/)[0];
for (const awaitingConsent of [false, true]) {
  for (const settingsOpen of [false, true]) {
    for (const videoClickPriority of [false, true]) {
      let actual;
      vm.runInNewContext(clickPriority, {
        awaitingConsent, settings: { videoClickPriority }, state: { settingsOpen },
        dom: { panel: { classList: { toggle(_name, enabled) { actual = enabled; } } } }
      });
      assert.equal(actual, !awaitingConsent && !settingsOpen && videoClickPriority);
    }
  }
}
assert.match(section("      .privacy-notice {", "      .privacy-notice[hidden]"), /pointer-events: auto/);
assert.match(section("      .privacy-feedback {", "      .privacy-feedback[hidden]"), /pointer-events: auto/);
const bindings = section("  function bindUiEvents()", "    dom.settingsButton.addEventListener");
assert.match(bindings, /dom\.privacyRetryButton/);
assert.match(bindings, /addEventListener\("click", openPrivacyOptions\)/);
assert.match(bindings, /dom\.privacyReloadButton\.addEventListener\("click", reloadBroadcastForPrivacy\)/);

console.log("consent opening tests: all assertions passed (failure/retry/timeout/trust/consent/click-priority)");
