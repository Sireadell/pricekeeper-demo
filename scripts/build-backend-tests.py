# Builds testsprite_tests/backend/B*.py: the shared setup in _common.py on top,
# the test from src/ below. TestSprite runs each file on its own.
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "testsprite_tests" / "backend"
common = (root / "_common.py").read_text(encoding="utf-8")
for src in sorted((root / "src").glob("B*.py")):
    (root / src.name).write_text(common + "\n\n" + src.read_text(encoding="utf-8"), encoding="utf-8")
    print(src.name)
