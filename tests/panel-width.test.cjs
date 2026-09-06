"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../core.js");
const source = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8")
  .replace(/\r\n?/g, "\n");
function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}
function rectangle(left, right) {
  return { left, right, width: right - left, top: 0, bottom: 800, height: 800 };
}
function harness(viewport, rect, settings = {}) {
  let currentRect = rect;
  let saves = 0;
  const state = { settings: core.normalizeSettings({ panelWidth: 4000, ...settings }),
    drag: null, resize: null };
  const style = new Map();
  const dom = {
    panelWidth: { min: "220", max: "390", value: "390", disabled: false,
      setAttribute(name, value) { this[name] = value; } },
    panelWidthValue: { textContent: "" },
    restoreButton: { hidden: true },
    panel: { hidden: false,
      style: { setProperty(name, value) { style.set(name, value); } },
      getBoundingClientRect() { return { width: parseFloat(style.get("--panel-width")), height: 360 }; }
    }
  };
  const ctx = vm.createContext({
    state, dom, core, window: { innerWidth: viewport, innerHeight: 900 },
    currentPlayerRect: () => currentRect,
    ensureHostParent() {}, updatePlayerMenuAvoidance() {},
    persistSettingsSoon() { saves++; },
    applySettingsToUi() { ctx.renderPanelWidthControls(); ctx.placeOverlay(); }
  });
  vm.runInContext(section("  function panelWidthLimits(", "  function requestPlacement("), ctx);
  vm.runInContext(section("  function placeOverlay(", "  function beginDrag("), ctx);
  vm.runInContext(section("  function updateSettings(", "  function positionLabel("), ctx);
  return {
    state, dom, style, ctx, get saves() { return saves; },
    changeGeometry(nextViewport, nextRect) { ctx.window.innerWidth = nextViewport; currentRect = nextRect; },
    render() { ctx.placeOverlay(); return ctx.panelWidthLimits(); },
    input(value) { dom.panelWidth.value = String(value); ctx.setPanelWidthFromInput(); }
  };
}

const cases = [
  ["FHD full player", 1920, rectangle(0, 1920), 1896],
  ["QHD with sidebar", 2560, rectangle(100, 2000), 1876],
  ["QHD half window", 1280, rectangle(14, 932), 894],
  ["portrait player", 1920, rectangle(400, 990), 566],
  ["Instagram left blank area", 1920, rectangle(0, 552), 528],
  ["partly outside left", 1280, rectangle(-300, 700), 680],
  ["partly outside right", 1280, rectangle(800, 1600), 460],
  ["fractional CSS bounds", 1280, rectangle(14.4, 949.9), 911],
  ["small window", 240, rectangle(0, 240), 216],
  ["global safety limit", 6000, rectangle(0, 6000), 4096]
];
for (const [name, viewport, rect, maximum] of cases) {
  const h = harness(viewport, rect);
  const limits = h.render();
  assert.equal(limits.maximum, maximum, name);
  assert.equal(h.dom.panelWidth.max, String(maximum), name);
  assert.equal(h.dom.panelWidth.min, String(Math.min(220, maximum)), name);
  assert.equal(h.dom.panelWidth.value, String(Math.min(4000, maximum)), name);
  assert.equal(h.style.get("--panel-width"), `${Math.min(4000, maximum)}px`, name);
  assert.equal(h.dom.panelWidthValue.textContent, `${Math.min(4000, maximum)}px / 최대 ${maximum}px`, name);
  assert.equal(h.dom.panelWidth.disabled, maximum <= 220, name);
  assert.equal(h.saves, 0, "automatic geometry changes do not overwrite the saved preferred width");
}

for (const [position, customPlacement, expected] of [
  ["bottom-right", null, 894],
  ["custom", { x: 1, y: 1 }, 894],
  ["custom", { x: 1.1, y: 0.5 }, 1264],
  ["custom", { x: 0.5, y: 1.1 }, 1264]
]) {
  const h = harness(1280, rectangle(14, 932), { position, customPlacement });
  assert.equal(h.render().maximum, expected);
}

{
  const h = harness(2560, rectangle(100, 2000), { panelWidth: 1500 });
  h.render();
  h.changeGeometry(1280, rectangle(14, 932));
  h.render();
  assert.equal(h.dom.panelWidth.value, "894");
  assert.equal(h.state.settings.panelWidth, 1500);
  h.changeGeometry(2560, rectangle(100, 2000));
  h.render();
  assert.equal(h.dom.panelWidth.value, "1500", "larger screen restores the user's preferred width");
  assert.equal(h.saves, 0);

  // Input may arrive after a geometry change but before the next placement tick.
  h.changeGeometry(1280, rectangle(14, 932));
  h.input(4000);
  assert.equal(h.state.settings.panelWidth, 894, "input is clamped to the latest real limit");
  assert.equal(h.style.get("--panel-width"), "894px");
  assert.equal(h.saves, 1);
  h.input(893);
  assert.equal(h.state.settings.panelWidth, 893);
  h.input(894);
  assert.equal(h.state.settings.panelWidth, 894, "the exact maximum remains reachable");
  h.input(1);
  assert.equal(h.state.settings.panelWidth, 220);
}

assert.match(source, /id="panel-width"[^>]*step="1"/);
assert.match(source, /dom\.panelWidth\.addEventListener\("input", setPanelWidthFromInput\)/);
assert.match(section("  function applySettingsToUi(", "  function queryTranslator("), /renderPanelWidthControls\(\)/);
assert.match(source, /window\.addEventListener\("resize", requestPlacement/);
console.log("panel width tests: all assertions passed (10 geometries, custom positions, resize, display/input limits)");
