# 트윈타워 상황대응 앱(twintower-ops) 제작 기록 · 재사용 플레이북

> 실시간 재난 상황대응 협업 앱을 **정적 호스팅(GitHub Pages) + Firebase**로 만든 전체 과정.
> 다음에 비슷한 "여러 명이 실시간 공유하는 앱"을 만들 때 이 순서·함정·패턴을 그대로 참조.

---

## 1. 무엇을 만들었나
재난 발령 → 푸시 알림 → 출동 체크 → 임무 수행/공유 → 공동 상황판(COP)을 50~60명이 실시간 협업.
- 배포: https://atssa-kim.github.io/twintower-ops/ (GitHub Pages, 정적)
- 백엔드: Firebase 프로젝트 `disaster-response-system-f669b`
- 단일 파일 `index.html`(PWA) + `functions/`(Cloud Function 1개) + 보안규칙.

---

## 2. 가장 중요한 아키텍처 결정 (먼저 판단할 것)

**"읽기 전용 참조 앱"과 "실시간 협업 앱"은 분리하라.**
- 기존 매뉴얼 앱(정적 HTML+localStorage)은 그대로 두고, 새 운영 앱을 **별도 저장소**로.
- 이유: 실시간 공유·로그인·푸시는 백엔드가 필수 → 성격이 다른 코드를 한 파일에 섞으면 무너짐.
- 콘텐츠(임무·장구)는 매뉴얼을 **참조/딥링크**하되 운영 앱은 "상태(누가·언제)"만 저장.

**localStorage로는 절대 실시간 공유가 안 된다** (기기별 저장). → 중앙 DB(Firestore) 필수.

**핵심: 데이터 계층을 추상화(`BK` 백엔드 객체)** 해서 데모(localStorage) ↔ Firebase를 토글.
- config 비면 데모 모드(혼자 클릭 테스트), 채우면 LIVE(실시간). 개발·시연이 매우 편해짐.

---

## 3. 기술 스택
| 영역 | 선택 | 메모 |
|---|---|---|
| 실시간 DB | Cloud Firestore | `onSnapshot` 구독 = 자동 실시간 반영 |
| 인증 | Firebase Auth (익명) | 비번 없이 신원확인. **단 역할 잠금은 불가**(아래 함정) |
| 푸시 | FCM + Cloud Function | 꺼진 폰 알림. **Blaze 요금제 필요** |
| 서버로직 | Cloud Functions v2 (nodejs22) | Firestore 트리거 1개로 푸시 발송 |
| 호스팅 | GitHub Pages | 정적, 무료. config의 apiKey 노출 정상 |
| 설치 | PWA (manifest.json) | iOS 푸시는 홈화면 설치 필수 |
| 음성 | Web Speech API (TTS) | 발령 음성멘트. 포그라운드 한정 |

---

## 4. 제작 순서 (실제 진행 흐름)
1. **설계** — 데이터 모델 문서(`DATA_MODEL.md`) 먼저. 컬렉션/스키마/집계규칙 확정.
2. **데모 앱** — `index.html` 단일파일로 전체 흐름(로그인·발령·출동·상황판·승격)을 localStorage로 먼저 동작. 검증.
3. **Firebase 연결** — config 넣으면 LIVE 전환되도록 `BK` 추상화. Firestore 읽기/쓰기 + onSnapshot.
4. **GitHub 배포** — 새 repo `git init` → 빈 GitHub repo 생성(수동) → push → Pages 켜기(수동).
5. **FCM 푸시** — 서비스워커 + 토큰등록(클라) + Cloud Function(서버) + Blaze 업그레이드.
6. **보안규칙 강화** — 열린 규칙 → 구조검증·읽기제한.
7. **콘텐츠 확장** — 재난을 데이터(`DISASTERS`)로 일반화 → 화재·누수·정전… 추가.
8. **알림 고도화** — 사이렌 → 재난별 음성 출동멘트(TTS).

---

## 5. 막혔던 점 & 해결 (★ 다음에 시간 아끼는 부분)

### Firebase 연결
- **named DB vs (default)**: Firestore를 만들 때 이름을 정하면 클라 기본 연결(`getFirestore(app)`)이 `(default)`만 봄.
  - 증상 진단: `(default)`로 보면 `permission-denied`(DB는 있고 규칙이 막음) / 이름DB로 보면 `unavailable/offline`(그 이름 DB 없음).
  - 결론: 대부분 실제 DB는 `(default)`. config에 `databaseId` **넣지 말 것**.
- **보안규칙 미게시**: 콘솔에서 Firestore "테스트 모드"로 안 만들면 기본 잠금 → `permission-denied`.
  개발 초기엔 `allow read, write: if request.auth != null;` 게시.
- **승인된 도메인**: 배포 도메인(github.io)을 Auth → Settings → Authorized domains에 추가(안 하면 로그인 막힐 수 있음).
- **모듈러 SDK + inline onclick 충돌**: `type=module` 쓰면 전역 함수가 안 보여 `onclick="fn()"`이 깨짐.
  → 메인 스크립트는 일반(classic) 유지하고, Firebase는 **동적 `import()`** 로 로드(classic에서도 됨).

### FCM 푸시 (가장 함정 많음)
- **Cloud Functions = Blaze 요금제 필수**(무료 Spark 불가). 카드 등록 필요(소규모는 사실상 무과금).
- **functions/ npm install 먼저**: 안 하면 "Couldn't find firebase-functions" 에러.
- **Node 20 지원종료** 경고 → `package.json` engines + `firebase.json` runtime을 **nodejs22**로.
- **첫 2세대 함수 배포 = IAM/Eventarc 전파 지연**: "Permission denied while using the Eventarc Service Agent / Retry in a few minutes" →
  **2~3분 기다렸다 `firebase deploy --only functions` 재실행**하면 성공. (코드 문제 아님)
- **cleanup policy 경고**(exit 1처럼 보임): "could not set up cleanup policy" 는 **함수 배포는 성공**한 것. 무시 가능(소액 저장소비용 방지하려면 `--force`).
- **알림 권한 자동요청 안 뜸**: 로그인 직후 `Notification.requestPermission()`은 브라우저가 자주 막음.
  → **"🔔 알림 켜기" 버튼(사용자 탭)** 으로 직접 요청. iOS는 **홈화면 설치(PWA) 후**에만 가능.
- **소리 커스텀**: 꺼진 폰 푸시음 = 폰 기본음 고정(웹 한계, 무음 못 뚫음). 앱 켜진 화면만 Web Audio/TTS로 자유.

### 인증/보안의 근본 한계
- **익명 로그인 = 진짜 신원 없음** → "지휘자만 발령" 같은 **역할 잠금을 규칙으로 못 막음**.
  진짜 역할 보안은 **사번+PIN 등 실인증** + custom claim/`users` 매핑 필요.
- 규칙으로 할 수 있는 것: 참조데이터 읽기전용, 토큰 읽기차단, 값/구조 검증, 미정의경로 차단.

### 배포 운영
- **firebase apiKey는 공개돼도 정상**(식별자, 비번 아님). 보안은 규칙으로.
- `git add -A` 주의 — 개인 메모(`*.txt`) 같은 게 딸려 올라감. `.gitignore` 관리.
- 함수 코드 바꾸면 `firebase deploy --only functions`, 규칙 바꾸면 `--only firestore:rules` 재배포.

---

## 6. 데이터 모델 (요지)
```
roster/{사번}                  명부(이름·조·역할) — 콘솔/관리자만 쓰기
incidents/active               현재 상황(disaster·mode·location·status·targetTeams·escalations)
  └ responders/{사번}          출동상태(미응답/출동중/현장/복귀)
  └ tasks/{team-idx}           임무 달성(done·by·byName·at)
fcmTokens/{token}              {사번·조} — 함수가 조별 발송에 사용(클라 읽기 차단)
```
- 재난은 **코드의 `DISASTERS` 객체로 데이터화** → label·color·icon·mention·equip·modes·tasks(조별).
- 새 재난 추가 = `DISASTERS`에 한 블록 + 규칙 mode enum에 새 mode 추가 + 재배포.

---

## 7. 재사용 체크리스트 (다음 앱)
- [ ] 별도 repo로 시작 (성격 다른 앱과 분리)
- [ ] 데이터 모델 문서 먼저
- [ ] 데모(localStorage) 모드로 전체 UX 먼저 동작·검증
- [ ] `BK` 백엔드 추상화 (config로 데모↔Firebase 토글)
- [ ] Firestore는 `(default)` 사용, 테스트 규칙 게시
- [ ] GitHub repo 수동 생성 → push → Pages 수동 ON
- [ ] Auth 승인 도메인에 배포 도메인 추가
- [ ] (푸시 필요시) Blaze 업그레이드 → SW + 토큰등록 + Function → 첫 배포 IAM 지연시 재시도
- [ ] 알림 권한은 **버튼(사용자 탭)** 으로, iOS는 PWA 설치 안내
- [ ] 출시 전 보안규칙 강화 + (역할 필요시) 실인증 추가
- [ ] 콘텐츠는 데이터 객체로 일반화해 확장 쉽게

---

## 8. 핵심 파일
- `index.html` — 앱(로그인·발령·출동·상황판·승격·음성·푸시클라)
- `firebase-config.js` — config + vapidKey (비면 데모)
- `firebase-messaging-sw.js` — FCM 백그라운드 알림
- `functions/index.js` — 발령 시 조별 FCM 발송
- `firestore.rules` — 보안규칙
- `DATA_MODEL.md` / `FCM_DEPLOY.md` — 설계·배포 가이드
