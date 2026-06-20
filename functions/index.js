/**
 * twintower-ops Cloud Functions
 *
 * Trigger A — onIncidentCreated  : 상황 발령 → 온듀티 조회 → FCM → 임무 배분
 * Trigger B — onIncidentUpdated  : 승격(감지기→실제) → 추가 대상 FCM + 임무 배분
 * Trigger C — onIncidentClosed   : 상황 종료 → 종료 알림
 *
 * Firestore 읽기 경로
 *   roster/{empNo}                   → 명부 (fcmTokens, workType, shiftGroup 등)
 *   shifts/{YYYY-MM}/{empNo}         → 월별 교대 근무표
 *   orgCharts/{disasterType}         → 재난별 조직도 (roleKey 매핑)
 *   taskTemplates/{disasterType}/roles/{roleDocId} → 역할별 임무 목록
 *
 * Firestore 쓰기 경로
 *   incidents/{id}/memberTasks/{empNo} → 개인 임무 인스턴스
 *   incidents/{id}/log/{logId}         → 타임라인
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp }  = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging }   = require('firebase-admin/messaging');

initializeApp();

const REGION = 'asia-northeast3';
const APP_URL = 'https://atssa-kim.github.io/twintower-ops/';

// ── 근무 코드 → 해당 시간대 판별 ─────────────────────────────────────────
const SHIFT_HOURS = {
  주: { start: 8,  end: 18 },   // 08:00 ~ 18:00
  야: { start: 18, end: 32 },   // 18:00 ~ 익일 08:00  (hour + 24 if < 18)
  아: { start: 6,  end: 10 },   // 06:00 ~ 10:00  (별도 정의 필요시 수정)
};

function isOnDuty(shiftCode, hour) {
  const s = SHIFT_HOURS[shiftCode];
  if (!s) return false;
  const h = shiftCode === '야' && hour < 18 ? hour + 24 : hour;
  return h >= s.start && h < s.end;
}

// ── YYYY-MM  /  YYYY-MM-DD  문자열 생성 ──────────────────────────────────
function toYearMonth(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function toDateStr(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isWeekday(ts) {
  const dow = new Date(ts).getDay();
  return dow >= 1 && dow <= 5;
}

// ══════════════════════════════════════════════════════════════════════
// 핵심 헬퍼 함수들
// ══════════════════════════════════════════════════════════════════════

/**
 * 현재 온듀티 근무자 목록 반환
 * @returns {Array<{empNo, name, workType, shiftGroup, fcmTokens[], dept}>}
 */
async function getOnDutyMembers(incidentTs) {
  const db     = getFirestore();
  const hour   = new Date(incidentTs).getHours();
  const dateStr = toDateStr(incidentTs);
  const ym      = toYearMonth(incidentTs);
  const weekday = isWeekday(incidentTs);
  const isDayHour = hour >= 8 && hour < 17.5;

  // 1. 전체 명부 로드
  const rosterSnap = await db.collection('roster').where('active', '==', true).get();
  const roster = {};
  rosterSnap.docs.forEach(d => { roster[d.id] = d.data(); });

  // 2. 이번 달 교대 근무표 로드
  const shiftSnap = await db.collection('shifts').doc(ym).collection('members').get();
  const shiftMap = {};   // empNo → shiftCode (오늘 날짜 기준)
  shiftSnap.docs.forEach(d => {
    const schedule = d.data().schedule || {};
    shiftMap[d.id] = schedule[dateStr] || '비';
  });

  const onDuty = [];

  for (const [empNo, member] of Object.entries(roster)) {
    const { workType, fcmTokens = [] } = member;

    if (workType === '일근') {
      // 일근자: 평일 주간(08:30~17:30)만 포함
      if (weekday && isDayHour) {
        onDuty.push({ empNo, ...member, fcmTokens });
      }
    } else {
      // 교대자: 근무표 확인
      const code = shiftMap[empNo] || '비';
      if (code !== '비' && isOnDuty(code, hour)) {
        onDuty.push({ empNo, ...member, fcmTokens, shiftCode: code });
      }
    }
  }

  // shifts 데이터가 없으면 교대자 전원 포함 (초기 세팅 전 fallback)
  if (shiftSnap.empty) {
    console.warn('shifts 데이터 없음 — active 전원 대상으로 대체');
    return Object.entries(roster).map(([empNo, m]) => ({ empNo, ...m }));
  }

  return onDuty;
}

/**
 * targetScope 에 따라 대상 필터링
 * - all     : 전원
 * - confirm : orgChart 에서 확인조(특정 badge 목록) 역할자만
 * - onduty  : 현재 온듀티(기본값)
 * - drill   : targetTeams 에 포함된 shiftGroup 만
 */
function filterByScope(onDutyMembers, incident) {
  const { targetScope, targetTeams = [] } = incident;
  if (targetScope === 'all' || targetScope === 'onduty' || !targetScope) {
    return onDutyMembers;
  }
  if (targetScope === 'drill') {
    return onDutyMembers.filter(m => targetTeams.includes(m.shiftGroup));
  }
  // confirm: 상황실근무자(교대자)만 — 추후 확인조 뱃지 기반으로 정밀화 가능
  return onDutyMembers.filter(m => m.workType === '교대');
}

/**
 * orgCharts/{type} 에서 각 멤버의 roleKey 를 확인하여 반환
 * @returns {Map<empNo, {roleKey, roleLabel, group}>}
 */
async function getMemberRoles(disasterType, members) {
  const db = getFirestore();
  const orgDoc = await db.collection('orgCharts').doc(disasterType).get();
  if (!orgDoc.exists) {
    console.warn(`orgCharts/${disasterType} 없음`);
    return new Map();
  }

  // empNo → roleKey 역방향 인덱스 구축
  const empRoleMap = new Map();
  const groups = orgDoc.data().groups || [];
  for (const grp of groups) {
    for (const role of (grp.roles || [])) {
      for (const assignee of (role.assignees || [])) {
        empRoleMap.set(assignee.empNo, {
          roleKey:   role.roleKey,
          roleLabel: role.roleLabel,
          group:     grp.group,
          badge:     role.badge,
        });
      }
    }
  }

  const result = new Map();
  for (const m of members) {
    const roleInfo = empRoleMap.get(m.empNo);
    if (roleInfo) result.set(m.empNo, roleInfo);
  }
  return result;
}

/**
 * taskTemplates/{type}/roles/{roleDocId} 에서 임무 목록 로드
 * @returns {Map<roleKey, tasks[]>}
 */
async function loadTaskTemplates(disasterType, roleKeys) {
  const db = getFirestore();
  const taskMap = new Map();

  const uniqueKeys = [...new Set(roleKeys)];
  await Promise.all(
    uniqueKeys.map(async (rk) => {
      const docId = rk.replace(/\//g, '_');
      const snap  = await db
        .collection('taskTemplates').doc(disasterType)
        .collection('roles').doc(docId).get();
      if (snap.exists) {
        taskMap.set(rk, snap.data().tasks || []);
      }
    })
  );
  return taskMap;
}

/**
 * incidents/{id}/memberTasks/{empNo} 에 개인 임무 인스턴스 생성
 */
async function createMemberTasks(incidentId, disasterType, members, memberRoleMap, taskTemplateMap, ts) {
  const db    = getFirestore();
  const batch = db.batch();
  const col   = db.collection('incidents').doc(incidentId).collection('memberTasks');

  for (const member of members) {
    const roleInfo = memberRoleMap.get(member.empNo);
    if (!roleInfo) continue;

    const tasks = (taskTemplateMap.get(roleInfo.roleKey) || []).map((label, i) => ({
      seq:    i + 1,
      label,
      done:   false,
      doneAt: null,
      doneBy: null,
    }));

    batch.set(col.doc(member.empNo), {
      empNo:      member.empNo,
      name:       member.name || '',
      dept:       member.dept || '',
      roleKey:    roleInfo.roleKey,
      roleLabel:  roleInfo.roleLabel,
      group:      roleInfo.group,
      badge:      roleInfo.badge,
      tasks,
      taskCount:  tasks.length,
      doneCount:  0,
      assignedAt: ts,
    });
  }

  await batch.commit();
  console.log(`memberTasks 생성: ${members.length}명`);
}

/**
 * 타임라인 로그 기록
 */
async function writeLog(incidentId, action, detail, actor) {
  const db = getFirestore();
  await db.collection('incidents').doc(incidentId)
    .collection('log').add({
      ts:     FieldValue.serverTimestamp(),
      action,
      detail,
      actor:  actor || 'system',
    });
}

/**
 * FCM 멀티캐스트 발송 + 만료 토큰 정리
 */
async function sendFCM(members, incident, incidentId) {
  const db     = getFirestore();
  const tokens = members.flatMap(m => m.fcmTokens || []).filter(Boolean);
  if (!tokens.length) {
    console.warn('FCM 토큰 없음 — 발송 건너뜀');
    return;
  }

  const modeLabel = incident.mode === '실제'  ? '🔴 실제 발령' :
                    incident.mode === '감지기' ? '🟠 감지기 동작' :
                    incident.mode === '훈련'   ? '🔵 훈련' : '⚠️ 발령';
  const typeLabel = incident.type || '';

  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: {
      title: `${modeLabel} — ${typeLabel}`,
      body:  `위치: ${incident.location || '미상'} | 앱을 열어 임무를 확인하세요.`,
    },
    data: {
      incidentId,
      type: typeLabel,
      mode: incident.mode || '',
    },
    webpush: {
      fcmOptions: { link: `${APP_URL}?incident=${incidentId}` },
      notification: {
        requireInteraction: true,
        renotify: true,
        tag: `twintower-${incidentId}`,
        vibrate: [300, 150, 300, 150, 500],
      },
    },
    apns: {
      payload: { aps: { sound: 'default', badge: 1 } },
    },
  });

  // 만료 토큰 정리
  const dead = [];
  res.responses.forEach((r, i) => { if (!r.success) dead.push(tokens[i]); });
  if (dead.length) {
    const rosterSnap = await db.collection('roster')
      .where('fcmTokens', 'array-contains-any', dead.slice(0, 10)).get();
    // 간단 정리: 해당 empNo 문서에서 dead 토큰 제거는 클라이언트에 위임
    console.warn(`만료 토큰 ${dead.length}개 감지`);
  }

  console.log(`FCM: ${res.successCount}/${tokens.length} 성공`);
  return res;
}


// ══════════════════════════════════════════════════════════════════════
// Trigger A — 새 상황 발령 (onCreate)
// ══════════════════════════════════════════════════════════════════════
exports.onIncidentCreated = onDocumentCreated(
  { document: 'incidents/{incidentId}', region: REGION },
  async (event) => {
    const incident   = event.data.data();
    const incidentId = event.params.incidentId;
    const ts         = incident.declaredAt || Date.now();

    console.log(`[onIncidentCreated] id=${incidentId} type=${incident.type} mode=${incident.mode}`);

    try {
      // 1. 온듀티 근무자 조회
      const onDuty  = await getOnDutyMembers(ts);
      const targets = filterByScope(onDuty, incident);
      console.log(`온듀티: ${onDuty.length}명 → 대상: ${targets.length}명`);

      // 2. orgCharts 에서 역할 매핑
      const memberRoleMap = await getMemberRoles(incident.type, targets);

      // 3. taskTemplates 로드
      const roleKeys = [...memberRoleMap.values()].map(r => r.roleKey);
      const taskMap  = await loadTaskTemplates(incident.type, roleKeys);

      // 4. FCM 발송
      await sendFCM(targets, incident, incidentId);

      // 5. 개인 임무 생성
      await createMemberTasks(incidentId, incident.type, targets, memberRoleMap, taskMap, ts);

      // 6. 타임라인 로그
      await writeLog(incidentId, 'declared', {
        type:    incident.type,
        mode:    incident.mode,
        location: incident.location,
        targetCount: targets.length,
      }, incident.declaredBy);

    } catch (err) {
      console.error('[onIncidentCreated] 오류:', err);
    }
  }
);


// ══════════════════════════════════════════════════════════════════════
// Trigger B — 승격 / targetScope 변경 (onUpdate)
// ══════════════════════════════════════════════════════════════════════
exports.onIncidentUpdated = onDocumentUpdated(
  { document: 'incidents/{incidentId}', region: REGION },
  async (event) => {
    const before     = event.data.before.data();
    const after      = event.data.after.data();
    const incidentId = event.params.incidentId;

    // 종료 처리
    if (after.status === 'closed' && before.status !== 'closed') {
      await sendFCM([], after, incidentId);   // 종료 알림은 별도 구현
      await writeLog(incidentId, 'closed', { closedBy: after.closedBy }, after.closedBy);
      console.log(`[onIncidentUpdated] 상황 종료: ${incidentId}`);
      return;
    }

    // mode 또는 targetScope 변경(승격)이 아니면 무시
    const modeChanged  = before.mode        !== after.mode;
    const scopeChanged = before.targetScope !== after.targetScope;
    if (!modeChanged && !scopeChanged) return;

    console.log(`[onIncidentUpdated] 승격: ${before.mode}→${after.mode} scope:${after.targetScope}`);

    const ts = Date.now();

    try {
      // 승격 후 새 대상자 구하기 (이미 임무 배분된 사람 제외)
      const alreadySnap = await getFirestore()
        .collection('incidents').doc(incidentId)
        .collection('memberTasks').get();
      const alreadyAssigned = new Set(alreadySnap.docs.map(d => d.id));

      const onDuty   = await getOnDutyMembers(ts);
      const targets  = filterByScope(onDuty, after)
        .filter(m => !alreadyAssigned.has(m.empNo));   // 신규 대상만

      if (targets.length) {
        const memberRoleMap = await getMemberRoles(after.type, targets);
        const roleKeys      = [...memberRoleMap.values()].map(r => r.roleKey);
        const taskMap       = await loadTaskTemplates(after.type, roleKeys);

        await sendFCM(targets, after, incidentId);
        await createMemberTasks(incidentId, after.type, targets, memberRoleMap, taskMap, ts);
      }

      // 기존 배정자에게도 승격 알림 재발송
      const allOnDuty = await getOnDutyMembers(ts);
      const allTargets = filterByScope(allOnDuty, after);
      await sendFCM(allTargets, after, incidentId);

      // 승격 로그
      if (modeChanged) {
        await writeLog(incidentId, 'escalate', {
          from: before.mode,
          to:   after.mode,
          newTargets: targets.length,
        }, after.escalations?.slice(-1)[0]?.by);
      }

    } catch (err) {
      console.error('[onIncidentUpdated] 오류:', err);
    }
  }
);
