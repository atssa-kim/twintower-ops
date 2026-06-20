"""
extract_tasks.py
disa_app/index.html 안의 JS 데이터 블록에서 재난별 임무를 추출하여
tasks.json 으로 저장한다.

출력 구조:
{
  "version": "...",
  "extractedAt": "...",
  "disasters": {
    "화재": {
      "key": "화재",
      "label": "🔥 화재",
      "roles": [
        { "roleKey": "지휘/총괄", "group": "지휘",
          "roleLabel": "...", "badge": "...", "tasks": [...] }
      ],
      "scenarios": {               # 화재 세부 시나리오
        "kitchen": { "label": "...", "roles": [...] }, ...
      },
      "nightRoles": [...],         # FIRE_NIGHT (야간 공통)
      "bmsRoles":   [...]          # FIRE_BMS  (상황실 절차)
    },
    "정전": { ... },
    ...
  }
}
"""

import re, json
from datetime import datetime, timezone
from pathlib import Path


# ── 설정 ────────────────────────────────────────────────────────────────
SRC  = Path(r"c:\kcoding\disa_app\index.html")
DEST = Path(r"c:\kcoding\twintower-ops\tasks.json")


# ── JS 변수 값 추출 (괄호 카운터 방식) ──────────────────────────────────
def extract_js_var(content: str, var_name: str) -> str | None:
    """content 에서 'const VAR_NAME = VALUE;' 의 VALUE 부분 raw 문자열 반환."""
    m = re.search(rf'const {re.escape(var_name)}\s*=\s*', content)
    if not m:
        return None
    start = m.end()
    first = content[start]
    open_c  = '[' if first == '[' else ('{' if first == '{' else None)
    close_c = ']' if first == '[' else '}'
    if open_c is None:
        return None

    depth = 0
    i = start
    in_str = False
    esc    = False
    while i < len(content):
        c = content[i]
        if esc:
            esc = False
        elif c == '\\' and in_str:
            esc = True
        elif c == '"':
            in_str = not in_str
        elif not in_str:
            if c == open_c:
                depth += 1
            elif c == close_c:
                depth -= 1
                if depth == 0:
                    return content[start : i + 1]
        i += 1
    return None


def parse_js_var(content: str, var_name: str):
    raw = extract_js_var(content, var_name)
    if raw is None:
        print(f"  [WARN] {var_name} 를 찾을 수 없습니다.")
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"  [WARN] {var_name} JSON 파싱 오류: {e}")
        return None


# ── roleKey 생성 ─────────────────────────────────────────────────────────
def make_role_key(group: str, badge: str, idx: int) -> str:
    """
    group / badge 를 조합한 안정적인 키.
    badge 가 비어 있으면 idx(순서)를 보조값으로 사용.
    """
    g = re.sub(r'[^\w가-힣]', '', group)   # 특수문자 제거
    b = re.sub(r'[^\w가-힣]', '', badge) if badge else str(idx)
    return f"{g}/{b}"


# ── members 배열 → roles 리스트 변환 ─────────────────────────────────────
def convert_members(members: list) -> list:
    roles = []
    for idx, m in enumerate(members):
        group = m.get("group", "")
        badge = m.get("badge", "")
        roles.append({
            "roleKey":   make_role_key(group, badge, idx),
            "group":     group,
            "roleLabel": m.get("role", ""),
            "badge":     badge,
            "tasks":     m.get("tasks", [])
        })
    return roles


# ── 메인 추출 ────────────────────────────────────────────────────────────
def main():
    print(f"읽는 중: {SRC}")
    content = SRC.read_text(encoding="utf-8")

    # ── 1. DISASTERS 배열 ──────────────────────────────────────────────
    disasters_raw = parse_js_var(content, "DISASTERS")
    if not disasters_raw:
        raise SystemExit("DISASTERS 추출 실패")

    # ── 2. 화재 전용 부가 데이터 ───────────────────────────────────────
    fire_night_raw     = parse_js_var(content, "FIRE_NIGHT")     or []
    fire_bms_raw       = parse_js_var(content, "FIRE_BMS")       or []
    fire_scenarios_raw = parse_js_var(content, "FIRE_SCENARIOS") or {}

    # ── 3. 최상위 버전 ────────────────────────────────────────────────
    ver_m = re.search(r"const DATA_VERSION\s*=\s*'([^']+)'", content)
    data_version = ver_m.group(1) if ver_m else "unknown"

    # ── 4. 재난별 조합 ────────────────────────────────────────────────
    out_disasters = {}

    for d in disasters_raw:
        key   = d.get("key", "")
        roles = convert_members(d.get("members", []))

        entry = {
            "key":   key,
            "label": d.get("label", ""),
            "color": d.get("color", ""),
            "roles": roles,
        }

        # 화재에만 추가 데이터 붙이기
        if key == "화재":
            # 세부 시나리오
            scenarios = {}
            for sc_key, sc_val in fire_scenarios_raw.items():
                sc_members = sc_val.get("members")
                scenarios[sc_key] = {
                    "label": sc_val.get("label", ""),
                    "roles": convert_members(sc_members) if sc_members else None
                    # None = "일반화재"처럼 기본 역할과 동일한 경우
                }
            entry["scenarios"]  = scenarios
            entry["nightRoles"] = convert_members(fire_night_raw)
            entry["bmsRoles"]   = convert_members(fire_bms_raw)

        out_disasters[key] = entry

    # ── 5. 최종 JSON 조합 ─────────────────────────────────────────────
    output = {
        "version":     data_version,
        "extractedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalDisasters": len(out_disasters),
        "disasters":   out_disasters
    }

    # ── 6. 저장 ───────────────────────────────────────────────────────
    DEST.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"\n[OK] 저장: {DEST}")
    print(f"     버전: {data_version}")
    print(f"     재난 수: {len(out_disasters)}")

    # ── 7. 요약 출력 ─────────────────────────────────────────────────
    total_roles = 0
    total_tasks = 0
    for dk, dv in out_disasters.items():
        r_count = len(dv["roles"])
        t_count = sum(len(r["tasks"]) for r in dv["roles"])
        total_roles += r_count
        total_tasks += t_count
        print(f"  {dk:10s}: {r_count:2d}개 역할, {t_count:3d}개 임무")

        if dk == "화재":
            sc = dv.get("scenarios", {})
            for sc_key, sc_val in sc.items():
                sc_roles = sc_val.get("roles") or []
                sc_t = sum(len(r["tasks"]) for r in sc_roles)
                print(f"    └ 시나리오/{sc_key}: {len(sc_roles)}개 역할, {sc_t}개 임무")
            nr = dv.get("nightRoles", [])
            br = dv.get("bmsRoles", [])
            print(f"    └ 야간대응: {len(nr)}개 역할, {sum(len(r['tasks']) for r in nr)}개 임무")
            print(f"    └ 상황실BMS: {len(br)}개 역할, {sum(len(r['tasks']) for r in br)}개 임무")

    print(f"\n  합계: {total_roles}개 역할, {total_tasks}개 임무")

    # ── 8. roleKey 목록 출력 (Firestore 업로드 키 확인용) ─────────────
    print("\n[ roleKey list - Firestore taskTemplates key ]")
    for dk, dv in out_disasters.items():
        label_safe = dk.encode('cp949', 'replace').decode('cp949')
        print(f"\n  [{label_safe}]")
        for r in dv["roles"]:
            t_cnt = len(r['tasks'])
            role_safe = r['roleLabel'].encode('cp949', 'replace').decode('cp949')
            print(f"    {r['roleKey']:30s}  tasks={t_cnt:2d}  ({role_safe[:30]})")


if __name__ == "__main__":
    main()
