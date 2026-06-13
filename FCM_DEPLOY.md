# FCM 푸시 알림 배포 가이드 (발령 → 꺼진 폰 잠금화면 팝업)

구성: 받는 쪽(서비스워커·토큰)은 이미 앱에 포함됨. 보내는 쪽(Cloud Function)을 배포하면 완성.

## 1. Blaze 요금제 업그레이드
- 콘솔 → 좌측 하단 **요금제 업그레이드** → **Blaze(종량제)** → 카드 등록
- 이 규모(60명)는 무료 한도 내라 실제 청구는 거의 0. 안심을 위해 예산 알림 설정 권장.

## 2. 웹 푸시 인증서(VAPID 키) 생성
- 콘솔 → **프로젝트 설정(톱니)** → **Cloud Messaging** 탭
- **웹 푸시 인증서(Web Push certificates)** → **키 쌍 생성**
- 생성된 키(긴 문자열)를 복사 → `firebase-config.js`의 `vapidKey: "여기"` 에 붙여넣기

## 3. Firebase CLI 설치 & 로그인 (PC에서 1회)
```
npm install -g firebase-tools
firebase login          # 브라우저로 구글 로그인
```

## 4. Cloud Function 배포
`twintower-ops` 폴더에서:
```
cd functions
npm install
cd ..
firebase deploy --only functions
```
- 처음 배포 시 필요한 API(Cloud Functions, Artifact Registry 등) 자동 활성화 동의.
- 배포 완료 메시지(`onIncident` 함수)가 뜨면 성공.

## 5. 동작 확인
1. 폰에서 https://atssa-kim.github.io/twintower-ops/ 접속 → 로그인 → **알림 허용**
   - (iOS는 Safari '공유 → 홈 화면에 추가'로 PWA 설치 후에만 푸시 가능)
2. PC에서 지휘자 로그인 → 발령
3. 폰 화면을 끄거나 다른 앱으로 전환한 상태에서도 → **잠금화면 알림** 수신

## 동작 원리
```
발령 → incidents/active 쓰기
  → onIncident 함수 트리거(asia-northeast3)
  → fcmTokens 중 대상 조(targetTeams) 토큰 조회
  → FCM 멀티캐스트 발송 → 폰 잠금화면 알림
```

## 참고
- 토큰은 사용자가 로그인+알림허용 시 `fcmTokens/{token}`에 자동 저장(조 정보 포함).
- 만료 토큰은 함수가 자동 정리.
- 보안: 현재 규칙은 개발용(로그인 시 누구나 R/W). 실제 운영 전 권한 분리 필요.
