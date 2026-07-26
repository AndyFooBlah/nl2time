"""Dev triage: run all parity fixtures, bucket mismatches by op.

Usage: uv run python tests/triage.py [--show OP [N]]
"""

from __future__ import annotations

import json
import sys
import traceback
from collections import Counter
from pathlib import Path

from nl2time import TimeContext, resolve, value_to_json

FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent / "corpus" / "ir"


def run() -> None:
    show_op = None
    show_n = 3
    if len(sys.argv) > 2 and sys.argv[1] == "--show":
        show_op = sys.argv[2]
        if len(sys.argv) > 3:
            show_n = int(sys.argv[3])
    total = 0
    failures: list[tuple[str, dict, str]] = []
    per_file: dict[str, tuple[int, int]] = {}
    by_op: Counter[str] = Counter()
    shown = 0
    for f in sorted(FIXTURE_DIR.glob("resolved-*.json")):
        cases = json.loads(f.read_text())["cases"]
        ok = 0
        for case in cases:
            total += 1
            try:
                ctx = TimeContext.make(case["ctx"])
                got = [value_to_json(v) for v in resolve(case["expr"], ctx)["candidates"]]
                err = None
            except Exception:
                got = None
                err = traceback.format_exc(limit=3)
            if got == case["candidates"]:
                ok += 1
            else:
                failures.append((f.stem, case, err or ""))
                by_op[case["expr"]["op"]] += 1
                if show_op and case["expr"]["op"] == show_op and shown < show_n:
                    shown += 1
                    print(f"--- {f.stem}:{case['id']}")
                    print("ctx: ", json.dumps(case["ctx"]))
                    print("expr:", json.dumps(case["expr"]))
                    print("want:", json.dumps(case["candidates"], indent=1))
                    print("got: ", json.dumps(got, indent=1) if got is not None else err)
        per_file[f.stem] = (ok, len(cases))
    print()
    for name, (ok, n) in per_file.items():
        pct = 100.0 * ok / n if n else 100.0
        print(f"{name:22s} {ok:5d}/{n:<5d} {pct:6.2f}%")
    ok_total = total - len(failures)
    print(f"{'TOTAL':22s} {ok_total:5d}/{total:<5d} {100.0 * ok_total / total:6.2f}%")
    if by_op:
        print("\nmismatches by op:", dict(by_op.most_common()))


if __name__ == "__main__":
    run()
