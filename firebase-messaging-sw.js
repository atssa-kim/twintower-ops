// FCM 백그라운드 메시지 처리용 서비스워커 (앱이 꺼져 있을 때 잠금화면 알림)
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAvKPBGm0jHgQb4hsPhARi7AH2stXoyTiA",
  authDomain: "disaster-response-system-f669b.firebaseapp.com",
  projectId: "disaster-response-system-f669b",
  storageBucket: "disaster-response-system-f669b.firebasestorage.app",
  messagingSenderId: "116181765484",
  appId: "1:116181765484:web:d4ec2e24d409da0ef93749"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload){
  const n = payload.notification || {};
  self.registration.showNotification(n.title || '재난 발령', {
    body: n.body || '앱에서 출동 체크하세요.',
    tag: 'twintower-incident',
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 150, 300, 150, 500],
    data: { link: (payload.fcmOptions && payload.fcmOptions.link) || 'https://atssa-kim.github.io/twintower-ops/' }
  });
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  const url = (event.notification.data && event.notification.data.link) || 'https://atssa-kim.github.io/twintower-ops/';
  event.waitUntil(clients.openWindow(url));
});
