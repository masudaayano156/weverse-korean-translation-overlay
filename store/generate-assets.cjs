"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const repoRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(__dirname, "source-images");
const outputRoot = path.join(__dirname, "assets");
const iconPath = path.join(repoRoot, "icons", "icon128.png");
const sourcePaths = [1, 2, 3].map((index) =>
  path.join(sourceRoot, `store-source-${index}.png`)
);

for (const sourcePath of [...sourcePaths, iconPath]) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`필요한 이미지가 없습니다: ${sourcePath}`);
  }
}
fs.mkdirSync(outputRoot, { recursive: true });

const font = `'Malgun Gothic','Noto Sans KR','Segoe UI',sans-serif`;

function textLayer(width, height, body) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#05070c" stop-opacity=".97"/>
          <stop offset=".62" stop-color="#05070c" stop-opacity=".72"/>
          <stop offset="1" stop-color="#05070c" stop-opacity=".08"/>
        </linearGradient>
      </defs>
      ${body}
    </svg>`
  );
}

async function screenshotFromSource(sourcePath, outputName) {
  const outputPath = path.join(outputRoot, outputName);
  await sharp(sourcePath)
    .resize(1280, 800, { fit: "cover", position: "centre" })
    .flatten({ background: "#080a0f" })
    .jpeg({ quality: 91, mozjpeg: true })
    .toFile(outputPath);
  return outputPath;
}

async function settingsScreenshot() {
  const outputPath = path.join(
    outputRoot,
    "screenshot-settings-1280x800.jpg"
  );
  const settingsPanel = await sharp(sourcePaths[2])
    .resize({ height: 760, fit: "inside", withoutEnlargement: false })
    .flatten({ background: "#080a0f" })
    .png()
    .toBuffer();
  const panelMetadata = await sharp(settingsPanel).metadata();
  const background = {
    create: {
      width: 1280,
      height: 800,
      channels: 4,
      background: "#080a0f"
    }
  };
  const copy = textLayer(1280, 800, `
    <circle cx="80" cy="760" r="330" fill="#1ebcf0" fill-opacity=".10"/>
    <circle cx="1210" cy="30" r="250" fill="#ff3270" fill-opacity=".10"/>
    <text x="74" y="112" fill="#65d5ff" font-family="${font}" font-size="20" font-weight="800">자막을 내 화면에 맞게</text>
    <text x="74" y="176" fill="#fff" font-family="${font}" font-size="44" font-weight="900">한곳에서 쉽게 조절</text>
    <g fill="#d9e0ea" font-family="${font}" font-size="23">
      <text x="78" y="259">• 0.5초 · 1초 · 5초 단위 싱크</text>
      <text x="78" y="310">• 글씨 크기 · 색상 · 테두리</text>
      <text x="78" y="361">• 배경 투명도와 창 너비</text>
      <text x="78" y="412">• 위치 · 크기 잠금과 영상 클릭 우선</text>
      <text x="78" y="463">• 위버스 최고 화질 자동 선택</text>
    </g>
    <rect x="74" y="520" width="520" height="104" rx="20" fill="#111823" stroke="#344152"/>
    <text x="102" y="559" fill="#8bdfff" font-family="${font}" font-size="15" font-weight="800">개인정보 보호</text>
    <text x="102" y="591" fill="#e4e9f0" font-family="${font}" font-size="17">동의한 뒤에만 공개 번역 서버에 연결합니다.</text>
    <text x="76" y="707" fill="#8a94a3" font-family="${font}" font-size="14">실제 확장프로그램 설정 화면</text>
  `);
  await sharp(background)
    .composite([
      { input: copy, left: 0, top: 0 },
      {
        input: settingsPanel,
        left: 1280 - panelMetadata.width - 52,
        top: 20
      }
    ])
    .flatten({ background: "#080a0f" })
    .jpeg({ quality: 91, mozjpeg: true })
    .toFile(outputPath);
  return outputPath;
}

async function promoSmall() {
  const width = 440;
  const height = 280;
  const background = await sharp(sourcePaths[1])
    .resize(width, height, { fit: "cover", position: "centre" })
    .modulate({ brightness: 0.52, saturation: 0.82 })
    .blur(0.3)
    .toBuffer();
  const copy = textLayer(width, height, `
    <rect width="440" height="280" fill="url(#shade)"/>
    <text x="28" y="116" fill="#76dcff" font-family="${font}" font-size="15" font-weight="800">실시간 인간 번역</text>
    <text x="28" y="158" fill="#fff" font-family="${font}" font-size="29" font-weight="900">한국어 자막을</text>
    <text x="28" y="194" fill="#fff" font-family="${font}" font-size="29" font-weight="900">영상 위에 바로</text>
    <text x="29" y="229" fill="#d5dbe5" font-family="${font}" font-size="13">Weverse · Instagram 라이브 지원</text>
  `);
  const icon = await sharp(iconPath).resize(70, 70).png().toBuffer();
  await sharp(background)
    .composite([
      { input: copy, left: 0, top: 0 },
      { input: icon, left: 28, top: 24, blend: "over" }
    ])
    .flatten({ background: "#080a0f" })
    .jpeg({ quality: 91, mozjpeg: true })
    .toFile(path.join(outputRoot, "promo-small-440x280.jpg"));
}

async function promoMarquee() {
  const width = 1400;
  const height = 560;
  const background = await sharp(sourcePaths[1])
    .resize(width, height, { fit: "cover", position: "centre" })
    .modulate({ brightness: 0.5, saturation: 0.82 })
    .toBuffer();
  const copy = textLayer(width, height, `
    <rect width="1400" height="560" fill="url(#shade)"/>
    <text x="90" y="225" fill="#79ddff" font-family="${font}" font-size="26" font-weight="800">실시간 인간 번역</text>
    <text x="90" y="307" fill="#fff" font-family="${font}" font-size="62" font-weight="900">한국어 자막을 영상 위에 바로</text>
    <text x="94" y="371" fill="#e1e6ee" font-family="${font}" font-size="25">Weverse · Instagram 한국어 번역 오버레이</text>
    <rect x="92" y="409" width="344" height="48" rx="24" fill="#121b28" stroke="#4bd2ff"/>
    <text x="264" y="441" text-anchor="middle" fill="#9ce7ff" font-family="${font}" font-size="17" font-weight="800">싱크 · 화면 배치 · 라이브 리액션</text>
  `);
  const icon = await sharp(iconPath).resize(112, 112).png().toBuffer();
  await sharp(background)
    .composite([
      { input: copy, left: 0, top: 0 },
      { input: icon, left: 92, top: 76 }
    ])
    .flatten({ background: "#080a0f" })
    .jpeg({ quality: 91, mozjpeg: true })
    .toFile(path.join(outputRoot, "promo-marquee-1400x560.jpg"));
}

async function validateOutput(fileName, width, height) {
  const metadata = await sharp(path.join(outputRoot, fileName)).metadata();
  if (metadata.format !== "jpeg" || metadata.width !== width || metadata.height !== height) {
    throw new Error(`출력 규격이 잘못되었습니다: ${fileName}`);
  }
  console.log(`${fileName}: ${metadata.width}x${metadata.height}`);
}

async function main() {
  await screenshotFromSource(
    sourcePaths[0],
    "screenshot-weverse-subtitles-1280x800.jpg"
  );
  await screenshotFromSource(
    sourcePaths[1],
    "screenshot-weverse-controls-1280x800.jpg"
  );
  await settingsScreenshot();
  await promoSmall();
  await promoMarquee();

  await validateOutput("screenshot-weverse-subtitles-1280x800.jpg", 1280, 800);
  await validateOutput("screenshot-weverse-controls-1280x800.jpg", 1280, 800);
  await validateOutput("screenshot-settings-1280x800.jpg", 1280, 800);
  await validateOutput("promo-small-440x280.jpg", 440, 280);
  await validateOutput("promo-marquee-1400x560.jpg", 1400, 560);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
