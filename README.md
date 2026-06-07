# Sing A Song

React + Vite 기반 모바일 웹 보컬 튜너 MVP입니다. 사용자가 공식 YouTube iframe embed 영상에 맞춰 노래하면, 웹앱은 사용자의 마이크 입력만 Web Audio API로 분석해 현재 음정, 주파수, cents 오차, 높음/낮음/정확함 상태를 실시간으로 표시합니다.

## 실행 방법

```bash
npm install
npm run dev
```

개발 서버가 표시하는 localhost 주소를 브라우저에서 열면 됩니다.

## 모바일 테스트 방법

1. 같은 네트워크의 모바일 기기에서 Vite dev server 주소로 접속합니다.
2. 유튜브 URL을 입력하고 `영상 불러오기`를 누릅니다.
3. `음정 분석 시작`을 누른 뒤 마이크 권한을 허용합니다.
4. 노래를 부르면 현재 감지 음정과 튜너 게이지가 갱신됩니다.

모바일 브라우저에서 마이크 권한은 HTTPS 또는 localhost 같은 보안 컨텍스트에서 동작합니다. 실제 기기로 테스트할 때는 HTTPS 환경을 권장합니다.

## YouTube 및 오디오 정책

- 유튜브 영상은 공식 iframe embed URL로만 표시합니다.
- 유튜브 음원이나 오디오를 추출, 다운로드, 저장하지 않습니다.
- 유튜브 iframe에서 재생되는 오디오는 Web Audio API로 직접 분석하지 않습니다.
- 광고 제거, 백그라운드 우회 재생, 음원 캐싱 기능은 포함하지 않습니다.
- 이 앱은 오직 사용자의 마이크 입력만 분석합니다.

## 마이크 옵션

마이크 입력 옵션은 [src/utils/pitch.js](./src/utils/pitch.js)의 `MIC_AUDIO_CONSTRAINTS`에서 쉽게 바꿔 테스트할 수 있습니다.

```js
{
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}
```
