# 거위캠 — Goose Cam Club

움직이는 GIF 앞에 카메라 속 사람을 합성하는 작은 브라우저 카메라 스튜디오입니다. 기본 배경은 `assets/common.gif`이며, 다른 GIF나 이미지도 직접 불러올 수 있습니다.

## 실행

카메라 접근과 MediaPipe 모듈은 보안 연결(HTTPS) 또는 `localhost`에서 사용하세요. `index.html`을 파일로 직접 열면 페이지에 로컬 서버 안내가 표시됩니다. 프로젝트 폴더에서 다음 명령으로 서버를 시작하세요.

```sh
python3 -m http.server 4173
```

브라우저에서 `http://localhost:4173`을 열고 **카메라 켜기**를 누른 다음 권한을 허용합니다. 앱은 MediaPipe WebAssembly와 DeepLab V3 모델을 CDN에서 불러옵니다. 카메라 영상은 브라우저 안에서 처리하며 서버로 전송하지 않습니다.

## 공개 배포

이 앱은 빌드 단계 없이 정적 파일 그대로 배포할 수 있습니다. 정적 사이트 호스팅의 공개 저장소 연결 기능을 사용하면 HTTPS 사이트 주소가 만들어지고, 카메라 권한도 사용할 수 있습니다. `index.html`, `styles.css`, `app.js`, `assets/common.gif`를 함께 올리세요.

## 구성

- `index.html` — 한국어 스튜디오 화면
- `styles.css` — 반응형 레이아웃과 시각 스타일
- `app.js` — MediaPipe 분할, 카메라 제어, PNG 저장, 배경 선택
- `assets/common.gif` — 사용자가 제공한 배경 GIF
