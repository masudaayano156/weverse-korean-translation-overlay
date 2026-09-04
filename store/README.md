# Chrome 웹 스토어 자료

- `CHROME_WEB_STORE_SUBMISSION_KO.md`: 대시보드 입력 문구와 제출 순서
- `assets/`: 규격에 맞춘 스토어 스크린샷·홍보 이미지
- `generate-assets.cjs`: 동일한 이미지를 다시 만드는 생성 스크립트
- `build-store-package.ps1`: 개발 파일을 제외하고 스토어 업로드 ZIP을 만드는 스크립트

배포 ZIP은 `dist/`에 만들어지며 Git에는 포함하지 않습니다. ZIP을 열었을 때 `manifest.json`이 첫 단계에 바로 보여야 합니다.

이미지를 다시 만들 때는 `store` 폴더에서 `npm install`을 한 번 실행한 뒤 `npm run assets`를 실행합니다. 생성 도구만 설치되며 확장프로그램 배포 ZIP에는 포함되지 않습니다.
