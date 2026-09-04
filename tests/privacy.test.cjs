"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const privacySource = fs.readFileSync(path.join(root, "privacy.js"), "utf8");
const identitySource = fs.readFileSync(
  path.join(root, "identity-bridge.js"),
  "utf8"
);

function fakeElement() {
  const listeners = new Map();
  return {
    checked: false,
    disabled: false,
    textContent: "",
    classList: {
      values: new Set(),
      toggle(name, enabled) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
      }
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type, isTrusted = true) {
      listeners.get(type)?.({ isTrusted });
    }
  };
}

function testPrivacyOptions() {
  const elements = new Map([
    ["agreement-check", fakeElement()],
    ["accept-button", fakeElement()],
    ["revoke-button", fakeElement()],
    ["consent-status", fakeElement()]
  ]);
  elements.get("accept-button").disabled = true;
  const storedValues = {};
  const removedKeys = [];
  const context = {
    Date,
    Number,
    String,
    crypto: {
      randomUUID() {
        return "44444444-4444-4444-8444-444444444444";
      }
    },
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: {
          get(keys, callback) {
            callback(Object.fromEntries(keys.map((key) => [key, storedValues[key]])));
          },
          set(values, callback) {
            Object.assign(storedValues, values);
            callback();
          },
          remove(keys, callback) {
            for (const key of keys) {
              removedKeys.push(key);
              delete storedValues[key];
            }
            callback();
          }
        }
      }
    },
    document: {
      getElementById(id) {
        return elements.get(id);
      }
    }
  };

  vm.runInNewContext(privacySource, context);
  const check = elements.get("agreement-check");
  const accept = elements.get("accept-button");
  const revoke = elements.get("revoke-button");
  const status = elements.get("consent-status");
  assert.equal(accept.disabled, true);
  assert.equal(revoke.disabled, true);
  assert.match(status.textContent, /동의하지 않은 상태/);

  check.checked = true;
  check.dispatch("change", false);
  assert.equal(accept.disabled, true, "합성 이벤트로 동의 버튼을 활성화하면 안 됩니다.");
  check.dispatch("change", true);
  assert.equal(accept.disabled, false);
  accept.dispatch("click", false);
  assert.equal(storedValues.weverseOverlayPrivacyConsentV1, undefined);
  accept.dispatch("click", true);
  assert.equal(storedValues.weverseOverlayPrivacyConsentV1, 1);
  assert.match(storedValues.weverseOverlayPrivacyConsentAtV1, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(
    storedValues.weverseOverlayReactionClientIdV1,
    "44444444-4444-4444-8444-444444444444"
  );
  assert.equal(revoke.disabled, false);

  revoke.dispatch("click", true);
  assert.deepEqual(new Set(removedKeys), new Set([
    "weverseOverlayPrivacyConsentV1",
    "weverseOverlayPrivacyConsentAtV1",
    "weverseOverlayReactionClientIdV1"
  ]));
  assert.equal(storedValues.weverseOverlayReactionClientIdV1, undefined);
  assert.match(status.textContent, /동의를 철회/);
}

function testIdentityBridgeConsentGate() {
  const storedValues = {};
  let localStorageReads = 0;
  let localStorageWrites = 0;
  let storageListener = null;
  const context = {
    Number,
    String,
    crypto: {
      randomUUID() {
        return "22222222-2222-4222-8222-222222222222";
      }
    },
    localStorage: {
      getItem() {
        localStorageReads += 1;
        return "33333333-3333-4333-8333-333333333333";
      },
      setItem() {
        localStorageWrites += 1;
      }
    },
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: {
          get(keys, callback) {
            callback(Object.fromEntries(keys.map((key) => [key, storedValues[key]])));
          },
          set(values) {
            Object.assign(storedValues, values);
          }
        },
        onChanged: {
          addListener(listener) {
            storageListener = listener;
          }
        }
      }
    }
  };

  vm.runInNewContext(identitySource, context);
  assert.equal(localStorageReads, 0, "동의 전에는 번역 사이트 저장소를 읽으면 안 됩니다.");
  assert.equal(storedValues.weverseOverlayReactionClientIdV1, undefined);

  storedValues.weverseOverlayPrivacyConsentV1 = 1;
  storageListener(
    { weverseOverlayPrivacyConsentV1: { newValue: 1 } },
    "local"
  );
  assert.equal(localStorageReads, 1);
  assert.equal(localStorageWrites, 0, "사이트에 유효한 번호가 있으면 바꾸지 않아야 합니다.");
  assert.equal(
    storedValues.weverseOverlayReactionClientIdV1,
    "33333333-3333-4333-8333-333333333333"
  );
}

testPrivacyOptions();
testIdentityBridgeConsentGate();
console.log("privacy tests: all assertions passed");
