# Chrome 웹 스토어 등록용 입력 자료

이 문서는 Chrome 웹 스토어 개발자 대시보드의 각 칸에 그대로 옮겨 적을 수 있도록 작성했습니다. 현재 로컬 패키지 버전은 `1.15.7`이며, 심사 중인 패키지는 자동으로 변경되지 않습니다.

## 기본 정보

- 확장프로그램 이름: `Weverse·Instagram 한국어 번역 오버레이`
- 요약 설명: `Weverse와 CUTIE STREET 멤버의 Instagram 라이브에서 공개 인간 번역을 실시간 자막으로 표시합니다.`
- 기본 언어: `한국어`
- 카테고리 권장값: `접근성(Accessibility)`
- 홈페이지: `https://github.com/masudaayano156/weverse-korean-translation-overlay`
- 지원 페이지: `https://github.com/masudaayano156/weverse-korean-translation-overlay/issues`
- 개인정보처리방침: `https://github.com/masudaayano156/weverse-korean-translation-overlay/blob/main/PRIVACY.md`

## 자세한 설명

Weverse·Instagram 한국어 번역 오버레이는 번역자분들이 작성하는 CUTIE STREET 공개 한국어 번역을 지원되는 라이브와 다시보기 화면에 자막처럼 표시하는 비공식 팬 제작 확장프로그램입니다.

주요 기능:

- Weverse 라이브와 다시보기의 공개 한국어 번역 자동 연결
- CUTIE STREET 멤버 8명의 Instagram 라이브 지원
- WebSocket 실시간 자막과 연결 실패 시 안전한 HTTP 대체 연결
- 0.5초·1초·5초 단위 자막 싱크 조절과 방송별 다시보기 싱크 저장
- 번역창 위치·크기·글씨·색상·테두리·투명도 설정
- 위버스 해상도 메뉴를 이용한 가능한 최고 화질 자동 선택
- 과거 번역 스크롤과 최신 자막 바로 이동
- 라이브 익명 접속자 집계와 공개 이모티콘 리액션
- 광고와 플레이어 설정 메뉴를 피해 동작하는 화면 배치

Instagram 라이브 지원 계정: `@kana.sii.i`, `@nagisa_manabe`, `@fuuuuu_ri`, `@m_ayano26`, `@pa___.ru`, `@aika.sano_official`, `@miyu_.0913`, `@_emiru._`

이 확장프로그램은 번역을 직접 생성하지 않으며, 공개 인간 번역을 영상 화면에 연결해서 보여 줍니다. Weverse, Instagram, HYBE, Meta 또는 CUTIE STREET의 공식 제품이 아닙니다.

첫 설치 후 개인정보 안내 화면에서 사용자가 동의해야 번역 서버에 연결됩니다. Weverse·Instagram 로그인 정보, 쿠키, 댓글, DM, 번역 작성 권한은 읽지 않습니다. 개인정보 처리 범위는 공개된 개인정보처리방침에서 확인할 수 있습니다.

## 단일 목적 설명

`지원되는 Weverse 및 Instagram 방송에 공개 인간 번역을 실시간 자막 오버레이로 표시하고, 그 자막의 싱크와 화면 표시를 사용자가 조절할 수 있게 하는 것입니다.`

## 권한 사용 사유

### storage

`자막 표시 여부, 위치·크기·글씨·색상·투명도·싱크, 방송별 다시보기 기준점, 개인정보 안내 동의 여부와 익명 접속자 중복 방지 번호를 저장합니다. 일반 표시 설정은 사용자가 Chrome 동기화를 켠 경우 같은 브라우저 계정에 동기화될 수 있고, 방송별 싱크·동의·익명 번호는 로컬에 저장됩니다.`

### https://weverse.io/*

`Weverse 라이브와 다시보기의 공개 방송 번호·제목·시작 시각·영상 위치를 확인하고 번역 자막을 해당 영상 위에 표시하기 위해 필요합니다. 로그인 정보, 쿠키, 댓글 작성 내용은 읽지 않습니다.`

### https://www.instagram.com/*

`지원되는 CUTIE STREET 멤버의 Instagram 라이브 주소와 공개 계정 이름·영상 위치를 확인하고 번역 자막을 표시하기 위해 필요합니다. 로그인 정보, 쿠키, 댓글, DM은 읽지 않습니다.`

### https://api.cutiestreet.kro.kr/*

`공개 번역 세션과 번역 문장을 HTTPS/WSS로 받아오고, 사용자가 동의한 경우 라이브 익명 접속자 집계와 사용자가 직접 누른 공개 리액션을 전송하기 위해 필요합니다.`

### https://cutiestreet-live-translator.vercel.app/* 콘텐츠 스크립트

`사용자가 번역 사이트와 확장프로그램을 같은 브라우저에서 함께 열었을 때 접속자를 두 명으로 세지 않도록, 동의 후 사이트의 무작위 익명 client-id 하나만 확장프로그램 저장소에 복사합니다. translator-token이나 번역 작성 권한 등 다른 값은 읽지 않습니다.`

## 원격 코드

- 선택: `No, I am not using remote code`
- 설명: `모든 실행 가능한 JavaScript와 Convex 클라이언트 라이브러리는 업로드한 확장프로그램 패키지 안에 포함됩니다. 외부 서버에서 JavaScript나 WebAssembly를 내려받아 실행하지 않습니다. 외부 서버에서는 JSON 번역 데이터와 실시간 이벤트 데이터만 받습니다.`

## 데이터 사용 공개 권장값

대시보드 문구가 바뀔 수 있으므로 아래와 의미가 같은 항목을 선택합니다.

- `Website content(웹사이트 콘텐츠)`: 선택
  - 공개 방송 번호·제목·시작 시각, 공개 번역 문장과 플레이어 배치를 현재 페이지에서 처리합니다.
- `Web history(웹 기록)`: 선택
  - 전체 방문 기록은 읽지 않지만, 현재 열려 있는 지원 방송 URL을 기능에 사용하므로 보수적으로 공개합니다.
- `User activity(사용자 활동)`: 선택
  - 사용자가 리액션 버튼을 눌렀을 때 리액션 종류를 전송하고, 자막 설정 조작을 브라우저에 저장합니다.
- `Personally identifiable information`, `Authentication information`, `Personal communications`, `Location`, `Financial information`, `Health information`: 선택하지 않음

무작위 익명 번호는 실제 이름·이메일·소셜 계정과 연결하지 않지만, 대시보드에서 기기 식별자와 유사한 별도 항목이 제공되면 해당 항목도 보수적으로 선택하고 아래와 같이 설명합니다.

`실제 신원과 연결되지 않는 무작위 UUID를 라이브 접속자 중복 방지와 공개 리액션에만 사용합니다. 광고·판매·사용자 프로파일링에는 사용하지 않습니다.`

## Limited Use 확인

다음 내용을 모두 사실대로 확인할 수 있습니다.

- 데이터를 승인된 단일 목적의 기능 제공에만 사용합니다.
- 데이터를 판매하거나 광고에 사용하지 않습니다.
- 신용 평가 또는 대출과 관련해 사용하지 않습니다.
- 기능 제공, 보안 대응 또는 법률상 의무가 아닌 목적으로 사람이 데이터를 읽도록 이전하지 않습니다.
- 개인정보처리방침과 확장프로그램 내 첫 실행 안내가 실제 동작과 일치합니다.

## 배포 설정

- 공개 범위: 처음에는 `Unlisted(미등록)` 권장, 실제 설치 시험 후 `Public(공개)` 전환
- 지역: 특별한 제한이 없다면 `All regions`
- 가격: `Free`
- 인앱 결제: `없음`
- 공식 관계: Weverse·Instagram 공식 제품이 아니라는 설명 유지

## 심사자 테스트 안내 — 영문 입력 권장

```text
Purpose: This extension overlays public human-written Korean translations on supported Weverse broadcasts and live streams from eight specified CUTIE STREET Instagram accounts.

No test account or credentials are required for the public Weverse replay below.

1. Install the extension. Its privacy/consent page opens automatically.
2. Review the disclosure, select the consent checkbox, and click the blue consent button.
3. Open this public Weverse replay:
   https://weverse.io/kawaii_lab/live/1-179514847
4. Wait a few seconds. A dark Korean translation overlay should appear over or near the video. If automatic matching is unavailable, use the session selector in the overlay.
5. Use the gear button to inspect display, transparency, synchronization, layout lock, video-click priority, and highest-quality settings.
6. Scroll the subtitle history upward to see the “latest subtitle” button.
7. Live presence and reaction buttons are intentionally available only while the matched translation session is live. Instagram overlays are intentionally limited to the eight account handles listed in the store description, and require one of those accounts to be live.
8. Open the extension options page to revoke consent. The overlay immediately disconnects and deletes its locally stored anonymous ID.

The extension never requests or reads Weverse/Instagram passwords, cookies, authentication tokens, comments, DMs, or the translator site's authoring token. All executable code, including the Convex client, is bundled locally; network responses are data only.
```

## 업로드 이미지

- 아이콘: `icons/icon128.png` (128×128)
- 스크린샷 1: `store/assets/screenshot-weverse-subtitles-1280x800.jpg`
- 스크린샷 2: `store/assets/screenshot-weverse-controls-1280x800.jpg`
- 스크린샷 3: `store/assets/screenshot-settings-1280x800.jpg`
- 작은 홍보 이미지: `store/assets/promo-small-440x280.jpg`
- 대형 홍보 이미지(선택): `store/assets/promo-marquee-1400x560.jpg`

## 제출 전에 본인이 해야 하는 항목

1. Chrome 웹 스토어 개발자 계정 등록과 2단계 인증
2. 최초 등록비 결제
3. 실제 상황에 맞는 Trader/Non-Trader 법적 신분 선택
4. 이 문서의 내용을 대시보드 각 탭에 입력
5. `dist/weverse-instagram-korean-overlay-v1.15.7-chrome-web-store.zip` 업로드
6. 생성된 이미지를 등록하고 미리보기에서 잘림 여부 확인
7. 미등록 시험 설치 후 최종 `Submit for Review` 클릭
8. 제공받은 방송 캡처를 스토어 홍보에 사용할 권한이 있는지 게시자가 최종 확인

계정 비밀번호, 결제 정보, 법적 신분 확인과 최종 제출은 저장소 소유자가 직접 해야 합니다.

## 공식 안내 링크

- 등록: https://developer.chrome.com/docs/webstore/register
- 패키지 준비: https://developer.chrome.com/docs/webstore/prepare
- 스토어 설명: https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- 개인정보 탭: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- 배포 설정: https://developer.chrome.com/docs/webstore/cws-dashboard-distribution
- 제출과 심사: https://developer.chrome.com/docs/webstore/publish
