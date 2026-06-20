# 트윈타워 상황대응 앱 — 남은 작업 목록

> 작성일: 2026-06-20  
> 목표: disa_app 임무 연동 + 근무표 기반 스마트 알람 완성

---

## 현재까지 완료된 것

| 파일 | 내용 | 상태 |
|------|------|------|
| `extract_tasks.py` | disa_app → tasks.json 추출 (679개 임무) | ✅ |
| `tasks.json` | 9종 재난 × 106개 역할 × 679개 임무 | ✅ |
| `upload_tasks.py` | tasks.json → Firestore taskTemplates 업로드 | ✅ 준비 |
| `gen_orgcharts.py` | orgcharts_skeleton.json + orgcharts_input.xlsx 생성 | ✅ |
| `upload_orgcharts.py` | orgCharts → Firestore 업로드 | ✅ 준비 |
| `functions/index.js` | Cloud Function (온듀티 조회 + FCM + 임무 배분) | ✅ |
| `index.html` | 앱 UI — memberTasks 화면 연동 | ✅ |
| `make_template.py` | Excel 입력표 생성기 (13시트) | ✅ |
| `twintower_template.xlsx` | 명부·근무표·조직도 입력표 | ✅ |
| `upload_shifts.py` | 근무표 → Firestore shifts 업로드 | ✅ 준비 |

---

## 해야 할 일 (순서대로)

---

### STEP A — Firebase 서비스 계정 키 발급

**담당:** 관리자 (Firebase 콘솔 접근 권한 필요)

1. Firebase 콘솔 접속
   ```
   https://console.firebase.google.com/project/disaster-response-system-f669b/settings/serviceaccounts/adminsdk
   ```
2. **"새 비공개 키 생성"** 클릭 → JSON 다운로드
3. 파일명을 `serviceAccount.json` 으로 변경
4. `c:\kcoding\twintower-ops\` 폴더에 저장

> ⚠️ `serviceAccount.json` 은 절대 GitHub에 올리지 말 것 (`.gitignore` 확인)

---

### STEP B — 데이터 입력 (엑셀)

**파일:** `twintower_template.xlsx` + `orgcharts_input.xlsx`

#### B-1. 명부 입력 (`twintower_template.xlsx` → `①명부(roster)` 시트)

| 컬럼 | 내용 | 비고 |
|------|------|------|
| 사번 | B-0001 형식 | 고유값, 변경 금지 |
| 이름 | 실명 | |
| 파트 | 소방파트/전기파트/기계파트/건축파트/운영파트/품질파트/보안파트/주차파트/미화파트 | |
| 직책 | 소방파트장, 대원 등 | |
| 근무유형 | `일근` 또는 `교대` | |
| 교대조 | 소방1조~4조, BMS1조~4조 등 | 교대자만 |
| 연락처 | 010-0000-0000 | |

#### B-2. 근무표 입력 (`twintower_template.xlsx` → `②근무표(shifts)` 시트)

- 교대 근무자만 입력
- 근무 코드: `주`(주간 08~18) / `야`(야간 18~익일08) / `아`(아침) / `비`(비번)
- 매월 시트 복사하여 관리

#### B-3. 조직도 입력 (`orgcharts_input.xlsx` → 재난별 시트)

- `roleKey` 컬럼은 **절대 수정 금지**
- `사번(empNo)`, `이름(name)` 컬럼만 실제 값으로 교체
- 한 역할에 여러 명이면 같은 roleKey로 행 추가

---

### STEP C — Firestore 데이터 업로드

**준비물:** `serviceAccount.json` (STEP A 완료 후)

```bash
# C-1. 임무 템플릿 업로드 (최초 1회)
python upload_tasks.py

# C-2. 조직도 업로드 (엑셀 입력 완료 후)
python upload_orgcharts.py --from-excel

# C-3. disa_app 임무 수정 시 재동기화
python extract_tasks.py
python upload_tasks.py --delete

# C-4. 조직도 변경 시 재업로드
python upload_orgcharts.py --from-excel --delete
```

---

### STEP D — 교대 근무표 Firestore 업로드 스크립트 작성

**아직 없는 스크립트:** `upload_shifts.py`

- `twintower_template.xlsx`의 `②근무표` 시트를 읽어
- Firestore `shifts/{YYYY-MM}/members/{empNo}` 로 업로드
- 매월 실행

```
할 일: upload_shifts.py 작성 및 실행
```

---

### STEP E — Cloud Function 배포

```bash
cd functions
npm install
firebase deploy --only functions
```

**확인 사항:**
- [ ] `firebase login` 완료 상태인지 확인
- [ ] `asia-northeast3` 리전 설정 확인
- [ ] Firebase 콘솔에서 함수 2개 확인
  - `onIncidentCreated`
  - `onIncidentUpdated`

---

### STEP F — Firestore 보안 규칙 업데이트

현재 보안 규칙이 `taskTemplates`, `orgCharts`, `memberTasks`, `shifts` 컬렉션을 허용하지 않을 수 있음.

```javascript
// Firestore Rules 추가 필요
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // 로그인 사용자 공통 읽기
    match /roster/{empNo} {
      allow read: if request.auth != null;
      allow write: if request.auth.token.admin == true;
    }
    match /taskTemplates/{doc=**} {
      allow read: if request.auth != null;
      allow write: if false;  // Functions만 씀
    }
    match /orgCharts/{doc=**} {
      allow read: if request.auth != null;
      allow write: if request.auth.token.admin == true;
    }
    match /shifts/{doc=**} {
      allow read: if request.auth != null;
      allow write: if request.auth.token.admin == true;
    }
    match /incidents/{incId} {
      allow read: if request.auth != null;
      allow create, update: if request.auth != null;  // 지휘자 제한은 추후
    }
    match /incidents/{incId}/memberTasks/{empNo} {
      allow read: if request.auth != null;
      allow update: if request.auth != null
        && request.resource.data.empNo == empNo;  // 본인 임무만 수정
    }
    match /incidents/{incId}/responders/{empNo} {
      allow read, write: if request.auth != null;
    }
    match /incidents/{incId}/log/{logId} {
      allow read: if request.auth != null;
      allow write: if false;  // Functions만 씀
    }
  }
}
```

---

### STEP G — 앱 명부(ROSTER) Firebase 연동

현재 `index.html`의 `ROSTER` 배열이 하드코딩되어 있음.  
Firebase 연결 시 `roster` 컬렉션에서 동적으로 로드하도록 수정 필요.

```javascript
// makeFirebaseBackend() 안에 추가 필요
const rosterSnap = await fs.getDocs(fs.collection(db, 'roster'));
window._ROSTER = rosterSnap.docs.map(d => d.data());
// ROSTER 배열 대체
```

---

### STEP H — 지휘자 상황판 개선 (선택)

현재 지휘자 화면은 팀별 임무율만 표시.  
Firestore `memberTasks` 구독 추가 시 개인별 임무율 표시 가능.

```
할 일: renderCommand() 에 memberTasks 전체 구독 + 개인별 진행률 카드 추가
```

---

### STEP I — 월별 근무표 자동화 (선택)

매월 엑셀 입력 → 업로드가 번거로움.  
향후 관리자 화면에서 직접 근무표 입력 가능하도록 UI 추가 검토.

---

## 파일 구조 최종

```
c:\kcoding\twintower-ops\
│
├── index.html                  ← 앱 본체 (PWA)
├── manifest.json               ← PWA 설치 설정
├── firebase-config.js          ← Firebase 설정 (공개)
├── firebase-messaging-sw.js    ← FCM 서비스워커
│
├── functions/
│   └── index.js                ← Cloud Function (배포 대상)
│
├── [데이터 스크립트]
├── extract_tasks.py            ← disa_app → tasks.json 추출
├── upload_tasks.py             ← tasks.json → Firestore
├── gen_orgcharts.py            ← 조직도 스켈레톤 생성
├── upload_orgcharts.py         ← 조직도 → Firestore
├── upload_shifts.py            ← (미작성) 근무표 → Firestore
│
├── [데이터 파일]
├── tasks.json                  ← 추출된 임무 (679개)
├── orgcharts_skeleton.json     ← 조직도 스켈레톤
├── orgcharts_input.xlsx        ← 조직도 입력표 (담당자 입력)
├── twintower_template.xlsx     ← 명부·근무표 입력표
│
├── serviceAccount.json         ← ⚠️ 비공개 (gitignore 필수)
├── TODO.md                     ← 이 파일
└── DATA_MODEL.md               ← Firestore 설계서
```

---

## 우선순위 요약

```
즉시 할 것
  A → 서비스 계정 키 발급
  B → 명부·근무표·조직도 엑셀 입력
  C → Firestore 데이터 업로드
  E → Cloud Function 배포

이후 할 것
  D → upload_shifts.py 작성
  F → Firestore 보안 규칙 업데이트
  G → 앱 명부 Firebase 동적 로드

선택 사항
  H → 지휘자 상황판 개인별 임무율
  I → 근무표 관리자 UI
```
