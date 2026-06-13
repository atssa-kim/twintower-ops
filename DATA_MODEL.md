# 트윈타워 상황대응 앱 — Firebase 데이터 모델 설계서

> 목적: 재난 발령 → 푸시 알림 → 출동 체크 → 임무 수행/공유 → 공동 상황판(COP)을
> 50~60명이 실시간으로 협업하도록 하는 운영(operations) 앱.
> 기존 정적 매뉴얼 앱(`disa_app`)은 지식·참조 레이어로 그대로 두고 딥링크로 연결한다.

- 기준 시나리오: **화재**
- 로그인: **이름 + 사번 선택**
- 예상 인원: 50~60명

---

## 1. 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 실시간 DB | **Cloud Firestore** | 문서 구독(onSnapshot)으로 실시간 반영, 무료 한도 충분 |
| 푸시 알림 | **FCM (Cloud Messaging)** | 잠금화면 팝업, 발령/승격 시 즉시 전파 |
| 인증 | **Firebase Auth (익명) + 사번 매칭** | 별도 비밀번호 없이 명부로 신원 확인 |
| 서버 로직 | **Cloud Functions** (1~2개) | 발령 시 FCM 발송, 집계 갱신 |
| 클라이언트 | **PWA** (설치형 웹앱) | 안드로이드/iOS 16.4+ 웹푸시·홈화면 설치 |

> 직접 서버를 운영하지 않는다. Functions 1~2개만 작성하면 끝.

---

## 2. 컬렉션 구조 (한눈에)

```
roster/{empNo}                     명부(사번·이름·조·역할·FCM토큰)   ← 관리자 편집
orgCharts/{disasterType}           재난별 대응 조직도               ← 관리자 편집(삽입/편집)
incidents/{incidentId}             상황(유형·모드·위치·상태·승격이력)
  └ responders/{empNo}             출동 체크(상태·시각)
  └ tasks/{taskId}                 임무 달성(완료자·시각)
  └ log/{logId}                    자동 타임라인(감사·사후분석)
summaries/{incidentId}             집계 스냅샷(출동수·임무율) ← 선택, Function 갱신
users/{uid}                        로그인 세션 ↔ 사번 매핑
```

설계 원칙
- **임무 목록·비상장구 원본은 기존 매뉴얼 앱**에 둔다. 여기엔 "달성 여부/누가/언제"만 저장한다(중복 관리 금지).
- 서브컬렉션은 상황(incident)당 최대 ~60문서 → 클라이언트에서 직접 집계해도 가볍다.

---

## 3. 문서 스키마

### 3.1 `roster/{empNo}` — 명부 (관리자 편집)
```json
{
  "empNo": "B-2041",
  "name": "김재난",
  "team": "대응반",              // 지휘반 | 대응반 | 유도반 | 상황실
  "role": "통제자",              // 통제자 | 대응조 | 대피조 | 지원조 ...
  "phone": "010-1234-5678",
  "fcmTokens": ["fcm_abc..."],   // 다중 기기 허용
  "active": true
}
```

### 3.2 `orgCharts/{disasterType}` — 재난별 조직도 (입력 1: 삽입/편집)
```json
{
  "type": "화재",
  "groups": [
    { "group": "지휘반", "color": "#185FA5",
      "members": [{ "empNo": "B-1001", "role": "지휘자" }] },
    { "group": "대응반", "color": "#A32D2D",
      "members": [
        { "empNo": "B-2041", "role": "통제자" },
        { "empNo": "B-2042", "role": "대응조" }
      ] }
  ],
  "updatedAt": 1718500000000
}
```
> 조직도 편집 화면에서 인원을 드래그·삽입·삭제 → 이 문서를 갱신 → 모든 기기 동기화.

### 3.3 `incidents/{incidentId}` — 상황
```json
{
  "type": "화재",
  "mode": "실제",                 // 훈련 | 감지기 | 실제
  "location": "동관 E27F",
  "status": "active",            // active | closed
  "targetScope": "all",          // all(전체) | confirm(확인조) | drill(지정)
  "targetTeams": ["대응반"],      // 감지기/훈련일 때 대상 조 제한
  "declaredBy": "B-1001",
  "declaredAt": 1718500000000,
  "escalations": [               // 제안 반영: 감지기 → 실제 승격 이력
    { "from": "감지기", "to": "실제", "by": "B-2041", "at": 1718500300000 }
  ],
  "closedAt": null
}
```

### 3.4 `incidents/{id}/responders/{empNo}` — 출동 체크 (입력 3)
```json
{
  "empNo": "B-2041", "name": "김재난",
  "team": "대응반", "role": "통제자",
  "status": "현장",              // 미응답 | 출동중 | 현장 | 복귀
  "updatedAt": 1718500120000
}
```

### 3.5 `incidents/{id}/tasks/{taskId}` — 임무 달성 (입력 3)
```json
{
  "team": "대응반",
  "taskRef": "화재/대응반/3",     // 기존 매뉴얼 앱 임무 식별자
  "label": "대피유도 지시·출입통제",
  "done": true,
  "doneBy": "B-2041", "doneByName": "김재난",
  "doneAt": 1718500200000
}
```

### 3.6 `incidents/{id}/log/{logId}` — 자동 타임라인
```json
{ "ts": 1718500300000, "actor": "B-2041",
  "action": "escalate", "detail": "감지기 → 실제 승격" }
```
> 발령·출동상태변경·임무완료·승격·종료를 모두 자동 기록 → 사후 보고서 자동 생성용.

---

## 4. 상황 유형(mode) & 승격(escalation) 로직  ← 제안 반영

| mode | 색상 | targetScope | 동작 |
|---|---|---|---|
| 훈련 | 파랑 | drill (지정 조) | 연습. 기록은 별도 보관(실제 통계와 분리) |
| 감지기 동작 | 주황 | confirm (확인조) | 확인조만 출동 → 오작동 헛출동 방지 |
| 실제 화재 | 빨강 | all (전 조직) | 전원 즉시 출동 |

**승격 흐름 (감지기 → 실제):**
1. 감지기 동작으로 발령 → 확인조만 푸시.
2. 확인조가 현장에서 실제 화재 판단 → 지휘자가 **"실제로 승격"** 1탭.
3. `incident.mode = "실제"`, `targetScope = "all"`, `escalations[]`에 기록 추가.
4. Cloud Function이 변경 감지 → **전 조직에 재푸시**.
5. `log`에 승격 자동 기록.
> 실제 소방의 "출동 → 상황보고 → 증대(2차) 발령" 흐름과 동일.

---

## 5. 집계 규칙 (출동수·임무율)

상황당 ~60문서이므로 **클라이언트 집계(MVP)** 를 기본으로 한다.

```
출동률   = (status ≠ 미응답 인원) / (targetScope 대상 인원)
현장수   = count(status == 현장)
조별 임무율 = (해당 조 done==true 임무) / (해당 조 전체 임무)
```
- 대상 인원(분모)은 `mode`/`targetScope`에 따라 달라진다(감지기=확인조만).
- 확장 시: Cloud Function이 `summaries/{incidentId}`에 스냅샷을 써서 읽기 비용을 줄인다(선택).

---

## 6. 실시간 구독 패턴 (뷰별)

| 화면 | 구독 대상 |
|---|---|
| 대원 뷰 | `incidents`(active 1건) + 본인 `responders/{empNo}` + 본인 조 `tasks` |
| 지휘자 상황판 | `incidents`(active) + `responders/*` 전체 + `tasks/*` 전체 + `log` |
| 조직도 편집 | `orgCharts/{type}`, `roster` |

> `onSnapshot`으로 구독 → 누가 출동 체크/임무 완료하면 모든 화면 자동 갱신.

---

## 7. 인증 — 이름 + 사번 (MVP)

1. 앱 첫 실행 → **익명 로그인**(Firebase Anonymous Auth).
2. 로그인 화면에서 **이름 입력 + 사번 선택** → `roster/{empNo}` 이름과 대조.
3. 일치하면 `users/{uid} = { empNo, name, team, role }` 저장 + 사번을 세션에 보관.
4. 기기의 **FCM 토큰을 `roster/{empNo}.fcmTokens`에 등록**.

> 사내 PS망·60명 규모에선 충분. 추후 보안 강화는 Custom Token / 관리자 승인으로 업그레이드.

---

## 8. 보안 규칙 (Firestore Rules 개요)

```
roster, orgCharts   : 읽기 = 로그인 사용자, 쓰기 = 관리자(admin claim)만
incidents           : 읽기 = 로그인, 생성/승격/종료 = 지휘자(role==지휘자)만
responders/{empNo}  : 본인 사번 문서만 쓰기 가능(출동상태 변경)
tasks               : 로그인 사용자 쓰기(완료자 자동 기록), 변조 방지 검증
log, summaries      : 읽기 = 로그인, 쓰기 = 서버(Functions)만
```
> 핵심: "대원은 **자기 출동상태**만 바꾸고, **발령/승격은 지휘자**만." 권한 분리.

---

## 9. 푸시(FCM) 흐름

```
[발령/승격] → incidents 문서 생성·변경
   → Cloud Function(onWrite) 트리거
   → targetScope 대상 roster의 fcmTokens 수집
   → FCM 멀티캐스트 발송(제목: "🔴 화재 발령 — 동관 E27F")
   → 대원 폰: 잠금화면 팝업 → 탭하면 대원 뷰로 진입
```

---

## 10. 기존 매뉴얼 앱 연동 (딥링크)

- 대원 뷰의 "비상장구/내 임무"는 기존 매뉴얼의 화재 데이터를 표시.
- 연결: `https://atssa-kim.github.io/disa_app/#화재` 형태 딥링크 또는
  임무 JSON을 양쪽이 **같은 원본**(예: 공용 `tasks.json`)으로 참조.
- 운영 앱은 "달성 여부"만, 매뉴얼 앱은 "내용"만 — 역할 분리.

---

## 11. 단계별 구현 순서 (MVP 우선)

1. Firebase 프로젝트 생성 + `roster`/`orgCharts/화재` 시드 등록.
2. 로그인(이름+사번) → 익명 인증 + FCM 토큰 등록.
3. 발령(유형 선택) → `incidents` 생성 → Function이 푸시.
4. 대원 출동 체크 → `responders` 갱신 → 상황판 실시간 반영.
5. 임무 체크 → `tasks` → 조별 임무율.
6. 감지기 → 실제 **승격** + 재푸시.
7. 자동 로그 → 사후 보고서.

> 1~4단계까지가 "동작하는 협업" MVP. 화재 1종으로 실증 후 타 재난 확장.
