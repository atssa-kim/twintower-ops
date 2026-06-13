# Firebase 연결 가이드 (데모 → 실시간 다기기)

데모 모드의 `Store`(localStorage)를 Firestore로 교체하면 50~60명이 실시간 공유합니다.

## 1. 콘솔 준비
1. https://console.firebase.google.com → 프로젝트 생성(무료 Spark 플랜).
2. 웹앱 등록 → `firebaseConfig` 객체 복사.
3. 좌측 메뉴에서 활성화:
   - **Firestore Database** (프로덕션 모드)
   - **Authentication** → 로그인 방법 → **익명** 사용 설정
   - **Cloud Messaging** (푸시)

## 2. SDK 추가 (index.html `<head>`)
```html
<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import { getFirestore, doc, setDoc, onSnapshot, collection }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
  import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
  const firebaseConfig = { /* 콘솔에서 복사 */ };
  const fb = initializeApp(firebaseConfig);
  window.db = getFirestore(fb);
  signInAnonymously(getAuth(fb));
</script>
```

## 3. Store 교체 매핑
| 데모(localStorage) | Firestore |
|---|---|
| `state.incident` 저장 | `setDoc(doc(db,'incidents','active'), inc)` |
| `setMyStatus` | `setDoc(doc(db,'incidents/active/responders', empNo), {...})` |
| `toggleTask` | `setDoc(doc(db,'incidents/active/tasks', id), {...})` |
| `render()` 수동 호출 | `onSnapshot(...)` 구독 → 자동 render |

핵심: **쓰기는 setDoc, 읽기는 onSnapshot 구독**으로 바꾸면 모든 기기가 실시간 동기화됩니다.

## 4. 발령 → 푸시 (Cloud Function 1개)
```js
exports.onIncident = functions.firestore
  .document('incidents/active')
  .onWrite(async (change) => {
    const inc = change.after.data();
    if (!inc || inc.status !== 'active') return;
    const roster = await db.collection('roster')
      .where('team','in', inc.targetTeams).get();
    const tokens = roster.docs.flatMap(d => d.data().fcmTokens || []);
    if (tokens.length) await admin.messaging().sendEachForMulticast({
      tokens, notification: { title:`🔴 화재 발령 — ${inc.location}`, body:`[${inc.mode}] 즉시 확인` }
    });
  });
```

## 5. 보안 규칙 (요지)
- `responders/{empNo}`: 본인 사번 문서만 쓰기
- `incidents`: 생성/승격/종료는 role==지휘자
- `roster`,`orgCharts`: 관리자(admin claim)만 쓰기

상세 스키마는 [DATA_MODEL.md](DATA_MODEL.md) 참고.
