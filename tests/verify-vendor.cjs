"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const PACKAGE_NAME = "convex";
const PACKAGE_VERSION = "1.45.0";
const BUNDLE_PATH = "package/dist/browser.bundle.js";
const LICENSE_PATH = "package/LICENSE";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
}

function tarEntry(archive, wantedPath) {
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = header
      .subarray(0, 100)
      .toString("utf8")
      .replace(/\0.*$/, "");
    const prefix = header
      .subarray(345, 500)
      .toString("utf8")
      .replace(/\0.*$/, "");
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeText = header
      .subarray(124, 136)
      .toString("ascii")
      .replace(/\0.*$/, "")
      .trim();
    const size = Number.parseInt(sizeText || "0", 8);
    assert.ok(Number.isFinite(size) && size >= 0, "npm tar 항목 크기가 잘못됐습니다.");
    const contentStart = offset + 512;
    if (fullName === wantedPath) {
      return archive.subarray(contentStart, contentStart + size);
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return null;
}

async function main() {
  const metadataResponse = await fetch(
    `https://registry.npmjs.org/${PACKAGE_NAME}/${PACKAGE_VERSION}`
  );
  assert.equal(metadataResponse.ok, true, "공식 npm 메타데이터를 읽지 못했습니다.");
  const metadata = await metadataResponse.json();
  assert.equal(metadata.version, PACKAGE_VERSION);
  assert.match(metadata.dist?.integrity || "", /^sha512-/);

  const tarballResponse = await fetch(metadata.dist.tarball);
  assert.equal(tarballResponse.ok, true, "공식 npm 패키지를 읽지 못했습니다.");
  const compressed = Buffer.from(await tarballResponse.arrayBuffer());
  const actualIntegrity = `sha512-${crypto
    .createHash("sha512")
    .update(compressed)
    .digest("base64")}`;
  assert.equal(actualIntegrity, metadata.dist.integrity, "npm 무결성 값이 다릅니다.");

  const archive = zlib.gunzipSync(compressed);
  const officialBundle = tarEntry(archive, BUNDLE_PATH);
  assert.ok(officialBundle, "공식 브라우저 번들을 찾지 못했습니다.");
  const localWithNotice = fs.readFileSync(
    path.resolve(__dirname, "..", "vendor", "convex.js")
  );
  const bundleStart = localWithNotice.indexOf(Buffer.from('"use strict";'));
  assert.ok(bundleStart >= 0, "로컬 브라우저 번들 시작점을 찾지 못했습니다.");
  const localBundle = localWithNotice.subarray(bundleStart);
  assert.deepEqual(localBundle, officialBundle, "로컬 Convex 번들이 공식 배포본과 다릅니다.");
  const officialLicense = tarEntry(archive, LICENSE_PATH);
  assert.ok(officialLicense, "공식 라이선스 파일을 찾지 못했습니다.");
  const localLicense = fs.readFileSync(
    path.resolve(__dirname, "..", "LICENSES", "Apache-2.0.txt")
  );
  assert.equal(
    localLicense.toString("utf8").trim(),
    officialLicense.toString("utf8").trim(),
    "로컬 라이선스 전문이 공식 배포본과 다릅니다."
  );
  console.log(`vendor verification: official match (${sha256(officialBundle)})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
