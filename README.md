# 트윈타워 상황대응 — 단계1 프로토타입

재난 발령 → 출동 체크 → 임무 수행 → 공동 상황판(COP)을 실시간 협업하는 운영 앱.
데이터 모델은 [DATA_MODEL.md](DATA_MODEL.md) 참고.

## 지금 상태: 데모 모드 (단일 기기)

`index.html` 하나로 **전체 흐름을 즉시 클릭**해 볼 수 있습니다.
데이터는 이 기기의 localStorage에만 저장되므로 **여러 명 실시간 공유는 안 됩니다**(그건 Firebase 연결 후).

### 실행
```
# 폴더에서 정적 서버 실행
npx http-server -p 8078 -c-1
# 브라우저로 http://localhost:8078 접속
```

### 데모 시나리오 (1인 2역)
1. **지휘 화면**: 한지휘(B-1001)로 로그인 → 상황 유형 `감지기 동작` 선택 → 발령.
2. 우상단 **대원 화면** 토글 → 다른 사번(예 B-2041 김재난·대응반)으로 바꿔 출동 체크·임무 체크.
   - (데모는 한 기기라 로그아웃 후 다른 사번으로 재로그인하며 확인)
3. 지휘 화면에서 **실제로 승격** → 전 조직 대상으로 확대.
4. 상황판에서 출동 인원·조별 임무율 확인 → **상황 종료**.

## 다음 단계: Firebase 연결 (실시간 다기기)

`index.html`의 `Store` 계층(localStorage)을 Firestore로 교체하면 여러 명이 실시간 공유됩니다.
구체 절차는 [FIREBASE_SETUP.md](FIREBASE_SETUP.md) 참고.

요약:
1. Firebase 콘솔에서 무료 프로젝트 생성 → 웹앱 등록 → `firebaseConfig` 복사.
2. Firestore·Authentication(익명)·Cloud Messaging 활성화.
3. `roster`, `orgCharts/화재` 시드 등록.
4. 발령→푸시용 Cloud Function 1개 배포.
5. `save()`/`load()`/액션을 Firestore read/write + `onSnapshot` 구독으로 교체.

## 파일
- `index.html` — 앱 (로그인·발령·대원뷰·상황판·승격·종료)
- `manifest.json` — PWA 설치용
- `DATA_MODEL.md` — Firestore 데이터 모델 설계서
- `FIREBASE_SETUP.md` — Firebase 연결 가이드
