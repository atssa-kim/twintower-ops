"""
upload_tasks.py
tasks.json → Firestore taskTemplates 업로드

Firestore 구조:
  taskTemplates/{docId}          # 재난 메타
    .key / .label / .color / .updatedAt
    └── roles/{roleDocId}        # 역할별 임무
          .roleKey / .group / .roleLabel / .badge
          .tasks[]  / .taskCount / .updatedAt

docId 규칙:
  기본 재난  →  화재 / 정전 / 홍수 / ...
  화재 시나리오  →  화재_kitchen / 화재_electrical / 화재_ups / 화재_parking
  야간대응  →  화재_야간
  상황실BMS →  화재_BMS

roleDocId 규칙:  roleKey의 "/" → "_"  (예: 지휘/총괄 → 지휘_총괄)

사용법:
  python upload_tasks.py              # 실제 업로드
  python upload_tasks.py --dry-run    # 내용만 확인 (업로드 안 함)
  python upload_tasks.py --delete     # taskTemplates 전체 삭제 후 재업로드

준비물:
  서비스 계정 키 파일(serviceAccount.json)을 이 스크립트와 같은 폴더에 저장.
  발급 방법: Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → Python →
             "새 비공개 키 생성" → 다운로드 → 이름을 serviceAccount.json 으로 변경
"""

import sys, json, time
from pathlib import Path
from datetime import datetime, timezone

# ── 설정 ────────────────────────────────────────────────────────────────
TASKS_JSON   = Path(__file__).parent / "tasks.json"
SA_KEY       = Path(__file__).parent / "serviceAccount.json"
PROJECT_ID   = "disaster-response-system-f669b"
COLLECTION   = "taskTemplates"
BATCH_LIMIT  = 400          # Firestore 배치 한도 500보다 여유있게

DRY_RUN  = "--dry-run"  in sys.argv
DELETE   = "--delete"   in sys.argv


# ── 서비스 계정 키 확인 ──────────────────────────────────────────────────
def check_sa_key():
    if SA_KEY.exists():
        return True
    print()
    print("=" * 60)
    print("  serviceAccount.json 파일이 없습니다.")
    print()
    print("  [발급 방법]")
    print("  1. Firebase 콘솔 열기")
    print(f"     https://console.firebase.google.com/project/{PROJECT_ID}/settings/serviceaccounts/adminsdk")
    print()
    print("  2. '새 비공개 키 생성' 버튼 클릭 → JSON 다운로드")
    print()
    print("  3. 다운로드 파일 이름을 serviceAccount.json 으로 변경 후")
    print(f"     {SA_KEY} 에 저장")
    print()
    print("  4. 스크립트 다시 실행")
    print("=" * 60)
    print()
    return False


# ── docId 목록 생성 ─────────────────────────────────────────────────────
def make_doc_id(role_key: str) -> str:
    """roleKey의 '/' → '_' 변환 (Firestore 문서 ID에 / 불가)"""
    return role_key.replace("/", "_")


def build_upload_plan(data: dict) -> list[dict]:
    """
    업로드할 작업 목록 반환.
    각 항목: { "docId": str, "meta": dict, "roles": list[dict] }
    """
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    plan = []

    for key, disaster in data["disasters"].items():
        # ── 기본 재난 ───────────────────────────────────────────────
        plan.append({
            "docId": key,
            "meta":  {
                "key":       key,
                "label":     disaster["label"],
                "color":     disaster.get("color", ""),
                "updatedAt": now_ms,
                "version":   data["version"],
            },
            "roles": disaster["roles"],
        })

        # ── 화재 전용 추가 ──────────────────────────────────────────
        if key == "화재":
            # 세부 시나리오
            for sc_key, sc_val in disaster.get("scenarios", {}).items():
                sc_roles = sc_val.get("roles")
                if not sc_roles:          # general(None) = 기본과 동일, 건너뜀
                    continue
                plan.append({
                    "docId": f"화재_{sc_key}",
                    "meta":  {
                        "key":       f"화재_{sc_key}",
                        "label":     f"화재 — {sc_val['label']}",
                        "color":     disaster.get("color", ""),
                        "updatedAt": now_ms,
                        "version":   data["version"],
                        "parentKey": "화재",
                        "scenario":  sc_key,
                    },
                    "roles": sc_roles,
                })

            # 야간대응
            if disaster.get("nightRoles"):
                plan.append({
                    "docId": "화재_야간",
                    "meta":  {
                        "key":       "화재_야간",
                        "label":     "화재 — 야간대응",
                        "color":     disaster.get("color", ""),
                        "updatedAt": now_ms,
                        "version":   data["version"],
                        "parentKey": "화재",
                    },
                    "roles": disaster["nightRoles"],
                })

            # 상황실 BMS
            if disaster.get("bmsRoles"):
                plan.append({
                    "docId": "화재_BMS",
                    "meta":  {
                        "key":       "화재_BMS",
                        "label":     "화재 — 상황실 BMS 절차",
                        "color":     disaster.get("color", ""),
                        "updatedAt": now_ms,
                        "version":   data["version"],
                        "parentKey": "화재",
                    },
                    "roles": disaster["bmsRoles"],
                })

    return plan


# ── 미리보기 출력 ────────────────────────────────────────────────────────
def preview(plan: list[dict]):
    total_docs = 0
    total_tasks = 0
    print(f"\n{'docId':25s}  {'역할수':5s}  {'임무수':5s}")
    print("-" * 45)
    for item in plan:
        r_cnt = len(item["roles"])
        t_cnt = sum(len(r["tasks"]) for r in item["roles"])
        total_docs  += r_cnt
        total_tasks += t_cnt
        label = item["meta"]["label"].encode("cp949", "replace").decode("cp949")
        print(f"  {item['docId']:23s}  {r_cnt:3d}   {t_cnt:4d}   {label}")
    print("-" * 45)
    print(f"  합계: {len(plan)}개 재난문서 / {total_docs}개 역할 / {total_tasks}개 임무")
    print()


# ── Firestore 삭제 ───────────────────────────────────────────────────────
def delete_collection(db, col_ref, batch_size=300):
    from google.cloud.firestore_v1 import CollectionReference
    docs = list(col_ref.limit(batch_size).stream())
    if not docs:
        return 0
    deleted = 0
    for doc in docs:
        # 서브컬렉션도 재귀 삭제
        for sub in doc.reference.collections():
            delete_collection(db, sub, batch_size)
        doc.reference.delete()
        deleted += 1
    return deleted


# ── 실제 업로드 ──────────────────────────────────────────────────────────
def upload(db, plan: list[dict]):
    from google.cloud import firestore

    for item in plan:
        doc_id   = item["docId"]
        meta     = item["meta"]
        roles    = item["roles"]

        # 재난 메타 문서 저장
        col = db.collection(COLLECTION)
        col.document(doc_id).set(meta)
        print(f"  [{doc_id}] 메타 저장 완료")

        # 역할 서브컬렉션 배치 업로드
        roles_col = col.document(doc_id).collection("roles")
        batch     = db.batch()
        op_count  = 0

        for role in roles:
            role_doc_id = make_doc_id(role["roleKey"])
            ref = roles_col.document(role_doc_id)
            batch.set(ref, {
                "roleKey":   role["roleKey"],
                "group":     role["group"],
                "roleLabel": role["roleLabel"],
                "badge":     role["badge"],
                "tasks":     role["tasks"],
                "taskCount": len(role["tasks"]),
                "updatedAt": meta["updatedAt"],
            })
            op_count += 1

            if op_count >= BATCH_LIMIT:
                batch.commit()
                print(f"    배치 커밋 ({op_count}개)")
                batch    = db.batch()
                op_count = 0

        if op_count > 0:
            batch.commit()

        r_cnt = len(roles)
        t_cnt = sum(len(r["tasks"]) for r in roles)
        print(f"    역할 {r_cnt}개, 임무 {t_cnt}개 업로드 완료")
        time.sleep(0.1)   # Firestore rate limit 여유


# ── 메인 ────────────────────────────────────────────────────────────────
def main():
    # 1. tasks.json 로드
    if not TASKS_JSON.exists():
        print(f"오류: {TASKS_JSON} 가 없습니다. 먼저 extract_tasks.py 를 실행하세요.")
        sys.exit(1)

    data = json.loads(TASKS_JSON.read_text(encoding="utf-8"))
    plan = build_upload_plan(data)

    print(f"\ntasks.json 버전: {data['version']}  ({data['extractedAt']})")
    print(f"업로드 대상: {COLLECTION} 컬렉션  (프로젝트: {PROJECT_ID})")

    # 2. 미리보기
    preview(plan)

    if DRY_RUN:
        print("[DRY-RUN] 실제 업로드는 하지 않습니다.")
        return

    # 3. 서비스 계정 키 확인
    if not check_sa_key():
        sys.exit(1)

    # 4. Firebase Admin 초기화
    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        cred = credentials.Certificate(str(SA_KEY))
        firebase_admin.initialize_app(cred, {"projectId": PROJECT_ID})

    db = firestore.client()

    # 5. 기존 데이터 삭제 (--delete 플래그)
    if DELETE:
        print("기존 taskTemplates 삭제 중...")
        col_ref = db.collection(COLLECTION)
        n = delete_collection(db, col_ref)
        print(f"  {n}개 문서 삭제 완료\n")

    # 6. 업로드
    print("업로드 시작...\n")
    upload(db, plan)

    print("\n업로드 완료.")
    print(f"Firestore 확인:")
    print(f"  https://console.firebase.google.com/project/{PROJECT_ID}/firestore/data/{COLLECTION}")


if __name__ == "__main__":
    main()
