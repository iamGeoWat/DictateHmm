#!/usr/bin/env python3
"""Compile eval/datasets/phrases.txt (+ optional phrases_freeform.txt) into phrases.json.

Schema of phrases.json:
  [ { "id": "p001", "text": "你好", "pinyin": "nǐ hǎo",
      "toneSeq": [3, 3], "source": "script" }, ... ]

ID scheme:
  - p001..p499 reserved for script entries (phrases.txt order)
  - p500+ for freeform entries (phrases_freeform.txt order)

Tone digit:
  - 1..4 normal tones
  - 5 for neutral (pypinyin's 0 remapped to 5); same as build_tone_index.py
"""

from __future__ import annotations
import json
import sys
from pathlib import Path

from pypinyin import lazy_pinyin, Style

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "eval" / "datasets" / "phrases.txt"
FREEFORM_PATH = ROOT / "eval" / "datasets" / "phrases_freeform.txt"
OUT_PATH = ROOT / "eval" / "datasets" / "phrases.json"

SCRIPT_ID_START = 1
FREEFORM_ID_START = 500


def is_chinese_char(ch: str) -> bool:
    return "\u4e00" <= ch <= "\u9fff"


def all_chinese(word: str) -> bool:
    return bool(word) and all(is_chinese_char(c) for c in word)


def tone_of_syllable(s: str) -> int:
    if s and s[-1].isdigit():
        t = int(s[-1])
        return 5 if t == 0 else t
    return 5


def compile_phrase(text: str) -> tuple[str, list[int]] | None:
    syllables = lazy_pinyin(text, style=Style.TONE3, neutral_tone_with_five=True)
    if len(syllables) != len(text):
        return None
    tones = [tone_of_syllable(s) for s in syllables]
    return " ".join(syllables), tones


def read_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    out = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        out.append(line)
    return out


def main() -> int:
    entries: list[dict] = []
    seen: set[str] = set()

    script_lines = read_lines(SCRIPT_PATH)
    for i, text in enumerate(script_lines):
        if not all_chinese(text):
            print(f"skip non-Chinese script line: {text!r}", file=sys.stderr)
            continue
        if text in seen:
            continue
        compiled = compile_phrase(text)
        if compiled is None:
            print(f"could not compile script line: {text!r}", file=sys.stderr)
            continue
        pinyin, tones = compiled
        entries.append({
            "id": f"p{SCRIPT_ID_START + i:03d}",
            "text": text,
            "pinyin": pinyin,
            "toneSeq": tones,
            "source": "script",
        })
        seen.add(text)

    freeform_lines = read_lines(FREEFORM_PATH)
    for i, text in enumerate(freeform_lines):
        if not all_chinese(text) or text in seen:
            continue
        compiled = compile_phrase(text)
        if compiled is None:
            continue
        pinyin, tones = compiled
        entries.append({
            "id": f"p{FREEFORM_ID_START + i:03d}",
            "text": text,
            "pinyin": pinyin,
            "toneSeq": tones,
            "source": "freeform",
        })
        seen.add(text)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    n_script = sum(1 for e in entries if e["source"] == "script")
    n_free = sum(1 for e in entries if e["source"] == "freeform")
    print(f"wrote {OUT_PATH} ({len(entries)} entries: script={n_script}, freeform={n_free})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
