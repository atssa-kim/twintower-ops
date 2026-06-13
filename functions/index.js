// 발령(incidents/active 쓰기) 시 → 대상 조의 FCM 토큰으로 푸시 발송
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

exports.onIncident = onDocumentWritten(
  { document: 'incidents/active', region: 'asia-northeast3' },
  async (event) => {
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    if (!after || after.status !== 'active') return;        // 종료(closed)는 발송 안 함

    const teams = (after.targetTeams || []).slice(0, 10);    // Firestore 'in' 최대 10개
    if (!teams.length) return;

    const snap = await getFirestore().collection('fcmTokens').where('team', 'in', teams).get();
    const tokens = snap.docs.map(d => d.id);
    if (!tokens.length) return;

    const label = after.mode === '실제' ? '🔴 실제 화재'
                : after.mode === '감지기' ? '🟠 감지기 동작'
                : '🔵 훈련';

    const res = await getMessaging().sendEachForMulticast({
      tokens,
      notification: {
        title: `${label} 발령 — ${after.location || ''}`,
        body: '앱을 열어 출동 체크하세요.'
      },
      webpush: {
        fcmOptions: { link: 'https://atssa-kim.github.io/twintower-ops/' },
        notification: { requireInteraction: true }
      }
    });

    // 만료된 토큰 정리
    const dead = [];
    res.responses.forEach((r, i) => { if (!r.success) dead.push(tokens[i]); });
    await Promise.all(dead.map(t => getFirestore().collection('fcmTokens').doc(t).delete().catch(() => {})));

    console.log(`푸시 발송: ${res.successCount}/${tokens.length} 성공, ${dead.length} 정리`);
  }
);
