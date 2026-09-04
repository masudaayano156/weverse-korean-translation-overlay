"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs
  .readFileSync(path.join(root, "background.js"), "utf8")
  .replace(/\r\n?/g, "\n");

const storedValues = {
  weverseOverlayReactionClientIdV1: "11111111-1111-4111-8111-111111111111"
};
const mutationCalls = [];
const clientInstances = [];
const intervalCallbacks = new Map();
const timeoutCallbacks = new Map();
let nextTimerId = 1;
let pendingHeartbeat = null;
let failNextHeartbeat = false;

class FakeConvexClient {
  constructor(url) {
    this.url = url;
    this.closed = false;
    this.tokens = new Map();
    clientInstances.push(this);
  }

  mutation(name, args) {
    mutationCalls.push({ name, args });
    if (name === "presence:heartbeat") {
      if (pendingHeartbeat) {
        return pendingHeartbeat.promise;
      }
      if (failNextHeartbeat) {
        failNextHeartbeat = false;
        return Promise.reject(new Error("temporary heartbeat failure"));
      }
      if (!this.tokens.has(args.sessionId)) {
        this.tokens.set(args.sessionId, `token-${this.tokens.size + 1}`);
      }
      return Promise.resolve({
        roomToken: `room-${args.roomId}`,
        sessionToken: this.tokens.get(args.sessionId)
      });
    }
    return Promise.resolve(null);
  }

  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

const listeners = {};
const context = {
  AbortController,
  JSON,
  Map,
  Promise,
  Set,
  String,
  URL,
  chrome: {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) {
          listeners.message = listener;
        }
      }
    },
    storage: {
      local: {
        get(keys, callback) {
          callback(Object.fromEntries(keys.map((key) => [key, storedValues[key]])));
        },
        set(values, callback) {
          Object.assign(storedValues, values);
          callback();
        }
      },
      onChanged: {
        addListener(listener) {
          listeners.storageChanged = listener;
        }
      }
    },
    tabs: {
      onRemoved: {
        addListener(listener) {
          listeners.tabRemoved = listener;
        }
      },
      sendMessage() {
        return Promise.resolve();
      },
      query() {
        return Promise.resolve([]);
      }
    },
    action: {
      onClicked: { addListener() {} }
    },
    commands: {
      onCommand: { addListener() {} }
    }
  },
  console,
  crypto,
  fetch() {
    throw new Error("이 테스트에서는 HTTP 조회를 실행하지 않습니다.");
  },
  setInterval(callback, interval) {
    const id = nextTimerId++;
    intervalCallbacks.set(id, { callback, interval });
    return id;
  },
  clearInterval(id) {
    intervalCallbacks.delete(id);
  },
  setTimeout(callback, delay) {
    const id = nextTimerId++;
    timeoutCallbacks.set(id, { callback, delay });
    return id;
  },
  clearTimeout(id) {
    timeoutCallbacks.delete(id);
  }
};
context.importScripts = (resource) => {
  assert.equal(resource, "vendor/convex.js");
  context.convex = { ConvexClient: FakeConvexClient };
};

vm.runInNewContext(source, context);

function sendPresence(type, roomId, surfaceId, tabId) {
  return new Promise((resolve) => {
    const keepChannelOpen = listeners.message(
      { type, roomId, surfaceId },
      {
        tab: {
          id: tabId,
          url: `https://weverse.io/kawaii_lab/live/1-${tabId}`
        }
      },
      resolve
    );
    assert.equal(keepChannelOpen, true);
  });
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function main() {
  const roomId = "abcdefghijklmnop";
  const firstSurface = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const secondSurface = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  assert.equal(
    (await sendPresence("cutiestreet-presence-start", roomId, firstSurface, 1)).ok,
    true
  );
  await settle();
  assert.equal(clientInstances.length, 1);
  assert.equal(intervalCallbacks.size, 1, "브라우저 하트비트 타이머는 하나여야 합니다.");
  assert.equal(
    [...intervalCallbacks.values()][0].interval,
    60_000,
    "타이머와 서버 interval 값은 모두 정확히 60초여야 합니다."
  );
  assert.equal(mutationCalls.length, 1);
  assert.equal(mutationCalls[0].name, "presence:heartbeat");
  assert.equal(mutationCalls[0].args.roomId, roomId);
  assert.equal(mutationCalls[0].args.userId, storedValues.weverseOverlayReactionClientIdV1);
  assert.equal(mutationCalls[0].args.interval, 60_000);
  const connectionId = JSON.parse(mutationCalls[0].args.sessionId);
  assert.match(
    connectionId[0],
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  assert.equal(connectionId[1], roomId);
  assert.equal(connectionId[2], storedValues.weverseOverlayReactionClientIdV1);
  assert.notEqual(
    mutationCalls[0].args.sessionId,
    roomId,
    "heartbeat sessionId는 방송 ID가 아니라 연결별 ID여야 합니다."
  );

  await sendPresence("cutiestreet-presence-start", roomId, secondSurface, 2);
  await settle();
  assert.equal(
    mutationCalls.filter((call) => call.name === "presence:heartbeat").length,
    1,
    "같은 방송을 두 탭으로 봐도 별도 연결을 만들면 안 됩니다."
  );

  let resolveHeartbeat;
  pendingHeartbeat = {};
  pendingHeartbeat.promise = new Promise((resolve) => {
    resolveHeartbeat = resolve;
  });
  const intervalCallback = [...intervalCallbacks.values()][0].callback;
  intervalCallback();
  await settle();
  const beatsWhilePending = mutationCalls.filter(
    (call) => call.name === "presence:heartbeat"
  ).length;
  intervalCallback();
  await settle();
  assert.equal(
    mutationCalls.filter((call) => call.name === "presence:heartbeat").length,
    beatsWhilePending,
    "이전 하트비트가 진행 중이면 새 하트비트를 쌓으면 안 됩니다."
  );
  pendingHeartbeat = null;
  resolveHeartbeat({ roomToken: `room-${roomId}`, sessionToken: "token-1" });
  await settle();

  const beatsBeforeFailure = mutationCalls.filter(
    (call) => call.name === "presence:heartbeat"
  ).length;
  failNextHeartbeat = true;
  intervalCallback();
  await settle();
  await settle();
  assert.equal(
    mutationCalls.filter((call) => call.name === "presence:heartbeat").length,
    beatsBeforeFailure + 1,
    "실패한 하트비트를 즉시 재전송하면 안 됩니다."
  );

  await sendPresence("cutiestreet-presence-stop", roomId, firstSurface, 1);
  await settle();
  assert.equal(
    mutationCalls.filter((call) => call.name === "presence:disconnect").length,
    0,
    "같은 방송을 보는 다른 탭이 남아 있으면 연결을 끊으면 안 됩니다."
  );
  await sendPresence("cutiestreet-presence-stop", roomId, secondSurface, 2);
  await settle();
  assert.equal(
    mutationCalls.filter((call) => call.name === "presence:disconnect").length,
    1
  );
  assert.equal(intervalCallbacks.size, 0);

  const thirdSurface = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await sendPresence("cutiestreet-presence-start", roomId, thirdSurface, 3);
  await settle();
  const nextUserId = "22222222-2222-4222-8222-222222222222";
  storedValues.weverseOverlayReactionClientIdV1 = nextUserId;
  listeners.storageChanged(
    { weverseOverlayReactionClientIdV1: { newValue: nextUserId } },
    "local"
  );
  await settle();
  await settle();
  assert.equal(
    mutationCalls.filter(
      (call) => call.name === "presence:heartbeat" && call.args.userId === nextUserId
    ).length,
    1,
    "번역 사이트의 client-id가 들어오면 활성 연결도 같은 ID로 바뀌어야 합니다."
  );

  console.log("presence tests: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
