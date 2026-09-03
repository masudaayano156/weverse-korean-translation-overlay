"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8")
);
const contentSource = fs.readFileSync(
  path.join(root, "content.js"),
  "utf8"
);
const hookSource = fs.readFileSync(
  path.join(root, "page-hook.js"),
  "utf8"
);
const backgroundSource = fs.readFileSync(
  path.join(root, "background.js"),
  "utf8"
);
const vendorSource = fs.readFileSync(
  path.join(root, "vendor", "convex.js"),
  "utf8"
);

assert.deepEqual(manifest.permissions, ["storage"]);
assert.deepEqual(manifest.host_permissions, [
  "https://weverse.io/*",
  "https://api.cutiestreet.kro.kr/*"
]);
assert.equal(manifest.content_scripts[0].world, "MAIN");
assert.deepEqual(manifest.content_scripts[0].js, ["page-hook.js"]);
assert.deepEqual(manifest.content_scripts[1].js, [
  "vendor/convex.js",
  "core.js",
  "content.js"
]);

const forbiddenPrivateRequestMarkers = [
  ["WEVERSE", "HMAC", "KEY"].join("_"),
  ["WEVERSE", "APP", "ID"].join("_"),
  ["global", "apis", "naver", "com"].join("."),
  ["crypto", "subtle"].join(".")
];
for (const marker of forbiddenPrivateRequestMarkers) {
  assert.equal(contentSource.includes(marker), false);
}
assert.match(
  backgroundSource,
  /new URL\(senderUrl\)\.origin\s*===\s*["']https:\/\/weverse\.io["']/
);
assert.match(
  backgroundSource,
  /if\s*\(!isAllowedContentSender\(sender\)\)\s*\{\s*return false;/
);
assert.doesNotMatch(vendorSource, /\beval\s*\(|new\s+Function\s*\(/);
assert.doesNotMatch(
  `${contentSource}\n${hookSource}`,
  /createElement\s*\(\s*["']script["']|import\s*\(\s*["']https?:/
);

const mutationTargets = [...contentSource.matchAll(
  /\.mutation\(\s*["']([^"']+)["']/g
)].map((match) => match[1]);
assert.deepEqual(mutationTargets, ["reactions:react"]);
const sendReactionSource = contentSource.slice(
  contentSource.indexOf("async function sendReaction"),
  contentSource.indexOf("function bindUiEvents")
);
assert.match(sendReactionSource, /crypto\.randomUUID\(\)/);
assert.match(sendReactionSource, /sessionId,[\s\S]*key:\s*reactionKey,[\s\S]*clientId,[\s\S]*tapId/);
assert.doesNotMatch(
  sendReactionSource,
  /document\.cookie|localStorage|account|email|memberId|accessToken|authorization/i
);
assert.match(
  contentSource,
  /function ensureReactionClientId\(\)[\s\S]*crypto\.randomUUID\(\)[\s\S]*persistReactionClientId/
);

class FakeXMLHttpRequest {
  constructor() {
    this.responseType = "";
    this.responseText = "";
    this.listeners = new Map();
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      callbacks.filter((item) => item !== callback)
    );
  }

  send() {
    // 실제 응답 완료 시점은 emit()으로 제어합니다.
  }

  abort() {
    this.emit("abort");
    this.emit("loadend");
  }

  emit(type) {
    for (const callback of [...(this.listeners.get(type) || [])]) {
      callback.call(this);
    }
  }
}

async function testPageHook() {
  const messages = [];
  const fetchCalls = [];
  const windowListeners = new Map();
  const onAirStartAt = Date.now() - 60_000;
  const payload = {
    publishedAt: onAirStartAt + 3_000,
    extension: {
      video: { onAirStartAt, liveToVod: true, type: "VOD" }
    }
  };
  const wrappedOnAirStartAt = onAirStartAt + 10_000;
  const wrappedPayload = {
    data: {
      publishedAt: wrappedOnAirStartAt + 4_000,
      extension: {
        video: {
          onAirStartAt: wrappedOnAirStartAt,
          liveToVod: false,
          type: "LIVE"
        }
      }
    }
  };
  const originalFetch = function originalFetch(input, ...args) {
    const url = typeof input === "string" ? input : input?.url;
    fetchCalls.push(args);
    const responsePayload = String(url).includes("1-54321")
      ? wrappedPayload
      : payload;
    return Promise.resolve({
      clone() {
        return {
          text() {
            return Promise.resolve(JSON.stringify(responsePayload));
          }
        };
      }
    });
  };
  const fakeWindow = {
    fetch: originalFetch,
    location: {
      origin: "https://weverse.io",
      href: "https://weverse.io/kawaii_lab/live/1-12345"
    },
    postMessage(value, targetOrigin) {
      messages.push({ value, targetOrigin });
    },
    addEventListener(type, callback) {
      const callbacks = windowListeners.get(type) || [];
      callbacks.push(callback);
      windowListeners.set(type, callbacks);
    },
    dispatchMessage(data, origin = this.location.origin) {
      for (const callback of windowListeners.get("message") || []) {
        callback({ source: this, origin, data });
      }
    }
  };
  fakeWindow.top = fakeWindow;

  vm.runInNewContext(hookSource, {
    window: fakeWindow,
    XMLHttpRequest: FakeXMLHttpRequest,
    Date,
    JSON,
    Number,
    Promise,
    Reflect,
    String,
    Symbol,
    URL
  });

  await fakeWindow.fetch(
    "https://weverse.io/post/v1.0/post-1-12345?fieldSet=postV1"
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCalls.length, 1, "페이지의 원래 요청 외 요청이 없어야 합니다.");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].targetOrigin, "https://weverse.io");
  assert.deepEqual(
    JSON.parse(JSON.stringify(messages[0].value)),
    {
      source: "weverse-korean-overlay-page-hook",
      postId: "1-12345",
      onAirStartAt,
      publishedAt: onAirStartAt + 3_000,
      liveToVod: true,
      videoType: "VOD"
    }
  );

  await fakeWindow.fetch({
    url: "https://global.apis.naver.com/post/v1.0/post-1-54321?fieldSet=postV1"
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCalls.length, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(messages.at(-1).value)),
    {
      source: "weverse-korean-overlay-page-hook",
      postId: "1-54321",
      onAirStartAt: wrappedOnAirStartAt,
      publishedAt: wrappedOnAirStartAt + 4_000,
      liveToVod: false,
      videoType: "LIVE"
    }
  );

  const beforeReplay = messages.length;
  fakeWindow.dispatchMessage({
    source: "weverse-korean-overlay-content",
    type: "request-timing",
    postId: "1-12345"
  });
  assert.equal(messages.length, beforeReplay + 1);
  assert.equal(messages.at(-1).value.postId, "1-12345");
  assert.equal(messages.at(-1).value.onAirStartAt, onAirStartAt);

  const xhr = new FakeXMLHttpRequest();
  xhr.open("GET", "/post/v1.0/post-1-67890?fieldSet=postV1");
  xhr.responseText = JSON.stringify(payload);
  xhr.send();
  xhr.emit("load");
  xhr.emit("loadend");
  assert.equal(messages.at(-1).value.postId, "1-67890");

  const reusedXhr = new FakeXMLHttpRequest();
  reusedXhr.open("GET", "/post/v1.0/post-1-11111?fieldSet=postV1");
  reusedXhr.send();
  const staleLoadListener = reusedXhr.listeners.get("load")[0];
  reusedXhr.abort();
  reusedXhr.open("GET", "/post/v1.0/post-1-22222?fieldSet=postV1");
  reusedXhr.responseText = JSON.stringify(wrappedPayload);
  reusedXhr.send();
  const beforeReusedLoad = messages.length;
  staleLoadListener.call(reusedXhr);
  assert.equal(
    messages.length,
    beforeReusedLoad,
    "재사용 전에 캡처된 load 콜백도 현재 방송 번호가 다르면 무시해야 합니다."
  );
  reusedXhr.emit("load");
  reusedXhr.emit("loadend");
  assert.equal(messages.length, beforeReusedLoad + 1);
  assert.equal(messages.at(-1).value.postId, "1-22222");
  assert.equal(messages.at(-1).value.onAirStartAt, wrappedOnAirStartAt);
  assert.equal(
    messages.some((message) => message.value.postId === "1-11111"),
    false,
    "중단된 XHR의 이전 방송 번호로 시각을 게시하면 안 됩니다."
  );
  for (const eventType of ["load", "abort", "error", "timeout", "loadend"]) {
    assert.equal(
      reusedXhr.listeners.get(eventType)?.length || 0,
      0,
      `${eventType} 관찰 리스너는 완료 뒤 남으면 안 됩니다.`
    );
  }

  await fakeWindow.fetch(
    "https://untrusted.example/post/v1.0/post-1-99999"
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCalls.length, 3);
  assert.equal(
    messages.some((message) => message.value.postId === "1-99999"),
    false,
    "허용되지 않은 출처 응답은 무시해야 합니다."
  );
}

testPageHook()
  .then(() => console.log("security tests: all assertions passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
