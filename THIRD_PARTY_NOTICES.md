# 제3자 구성요소 고지

## Convex JavaScript client 1.45.0

- 포함 파일: `vendor/convex.js`
- 포함 파일 SHA-256: `F7B5DDD73B23F980EEDC685BE0D8D2787E56350E58CD315EEE4DF6FA138F2A9A`
- 주석 머리말을 제외한 공식 번들 SHA-256: `3A159DCEF9CC75861FA22C27F0DD533CF5C4AAD6DD2D1D7B4048EED55851E9F5`
- 용도: 공개 번역 세션과 메시지를 WebSocket으로 구독
- 원본 프로젝트: <https://github.com/get-convex/convex-js>
- 라이선스: Apache License 2.0
- 라이선스 전문: [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt)

브라우저 확장프로그램의 원격 코드 실행을 피하기 위해 공식 npm 패키지의
브라우저 번들을 확장프로그램 안에 고정해서 포함했습니다. 실행 중 외부에서
JavaScript 파일을 내려받거나 교체하지 않습니다.
