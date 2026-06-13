// ── Firebase 설정 ──────────────────────────────────────────────
// 값이 채워지면 자동으로 '실시간 모드(LIVE)'로 동작합니다.
// (apiKey는 웹앱에 노출되는 게 정상 — 실제 보안은 Firestore 보안규칙으로 처리)
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAvKPBGm0jHgQb4hsPhARi7AH2stXoyTiA",
  authDomain: "disaster-response-system-f669b.firebaseapp.com",
  projectId: "disaster-response-system-f669b",
  storageBucket: "disaster-response-system-f669b.firebasestorage.app",
  messagingSenderId: "116181765484",
  appId: "1:116181765484:web:d4ec2e24d409da0ef93749",
  // ── 푸시(FCM)용 웹 푸시 인증서 키 ──
  // 콘솔 → 프로젝트 설정 → Cloud Messaging → '웹 푸시 인증서' → 키 쌍 생성 → 여기 붙여넣기
  vapidKey: "BCI7Cq0_RF_CMu35QL7xUSHBYr06VUVRFtz2vE1QryL_M-kAiwpQqSlKkspIhHKmYBVKNAl-J0PhfdmYzocjubU"
};
