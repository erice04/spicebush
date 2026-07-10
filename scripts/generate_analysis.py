"""Write precomputed morphology analysis JSON for the frontend."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from analysis import compute_analysis  # noqa: E402

OUTPUT_PATHS = [
    ROOT / "data" / "analysis.json",
    ROOT / "frontend" / "public" / "data" / "analysis.json",
]


def main() -> None:
    payload = compute_analysis()
    text = json.dumps(payload, indent=2)

    for path in OUTPUT_PATHS:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        print(f"Wrote {path}")


if __name__ == "__main__":
    main()
