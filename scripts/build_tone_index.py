#!/usr/bin/env python3
"""Build tone-sequence -> phrase index for DictateHmm.

Input: jieba dict.txt (word, freq, pos)
Output: public/data/tone-index.json

Schema:
{
  "byTone": { "<tone_seq>": [[phrase, freq, pinyin], ...] },
  "byLen":  { "1": [...tone_seqs...], "2": [...], ... },
  "meta":   { "totalPhrases": int, "minFreq": int, "topPerSeq": int }
}

tone_seq: dash-joined digits, e.g. "4-3-1" for 汉堡包.
  Tones: 1/2/3/4 = regular; 5 = neutral tone (轻声, pypinyin style 0 remapped to 5).
"""

from __future__ import annotations
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

from pypinyin import lazy_pinyin, Style

ROOT = Path(__file__).resolve().parents[1]
DICT_PATH = Path(os.environ.get("JIEBA_DICT", "/tmp/jieba-dict.txt"))
OUT_PATH = ROOT / "public" / "data" / "tone-index.json"

# Tunables
MIN_FREQ = 3         # drop very rare words (low threshold because jieba's dict
                     # often lists common phrases with small freq, e.g. 汉堡包=21)
MAX_LEN = 6          # we only support up to 6 Chinese chars for MVP
TOP_PER_SEQ = 1500   # keep top-N phrases per tone sequence

# Frequency boost for everyday conversational phrases that jieba underweights
# because it's trained on news/web. These are guaranteed to land in their bucket.
BOOST_PHRASES: dict[str, int] = {
    "你好": 200000, "您好": 150000, "早上好": 150000, "晚安": 150000, "晚上好": 150000,
    "谢谢": 200000, "多谢": 50000, "不客气": 80000, "没关系": 80000, "对不起": 100000,
    "再见": 150000, "拜拜": 80000, "回头见": 30000, "明天见": 30000,
    "好的": 120000, "行": 0, "好": 0, "嗯": 0, "是": 0, "对": 0,
    "吃了": 80000, "吃饭": 100000, "吃什么": 80000, "什么": 0, "吃过了": 30000,
    "汉堡包": 50000, "三明治": 30000, "炸鸡": 30000, "米饭": 50000,
    "怎么了": 60000, "怎么办": 60000, "没事": 80000, "在干嘛": 40000, "干什么": 40000,
    "我爱你": 80000, "想你": 40000, "抱抱": 20000,
    "你好吗": 60000, "还好": 30000, "挺好的": 20000, "不错": 40000,
    "加油": 50000, "辛苦了": 40000, "有空吗": 30000, "在吗": 40000,
}


def is_chinese_char(ch: str) -> bool:
    return "\u4e00" <= ch <= "\u9fff"


def all_chinese(word: str) -> bool:
    return bool(word) and all(is_chinese_char(c) for c in word)


def tone_of_syllable(s: str) -> int | None:
    """Extract tone 1-5 from a TONE3-style pinyin syllable (e.g. 'han4', 'ma5').
    pypinyin uses 0 for neutral; we remap to 5. Returns None if not decodable."""
    if not s:
        return None
    last = s[-1]
    if last.isdigit():
        t = int(last)
        if t == 0:
            return 5
        if 1 <= t <= 5:
            return t
    # no explicit tone digit -> treat as neutral
    return 5


def word_to_tone_seq(word: str) -> tuple[str, ...] | None:
    """Return tuple of pinyin syllables (with tone digit), or None if unusable."""
    syllables = lazy_pinyin(word, style=Style.TONE3, neutral_tone_with_five=True)
    if len(syllables) != len(word):
        return None
    tones = []
    for s in syllables:
        t = tone_of_syllable(s)
        if t is None:
            return None
        tones.append(t)
    return tuple(syllables), tuple(tones)


def build():
    if not DICT_PATH.exists():
        print(f"ERROR: dict not found at {DICT_PATH}", file=sys.stderr)
        sys.exit(1)

    by_tone: dict[str, list[tuple[str, int, str]]] = defaultdict(list)
    n_read = 0
    n_used = 0
    n_skipped_chars = 0
    n_skipped_freq = 0
    n_skipped_len = 0

    seen_words: set[str] = set()

    with DICT_PATH.open("r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 2:
                continue
            word = parts[0]
            try:
                freq = int(parts[1])
            except ValueError:
                continue
            n_read += 1

            if not all_chinese(word):
                n_skipped_chars += 1
                continue
            if len(word) > MAX_LEN:
                n_skipped_len += 1
                continue
            if freq < MIN_FREQ:
                n_skipped_freq += 1
                continue

            # Apply boost for everyday phrases
            if word in BOOST_PHRASES:
                freq = max(freq, BOOST_PHRASES[word])

            result = word_to_tone_seq(word)
            if result is None:
                continue
            syllables, tones = result
            tone_key = "-".join(str(t) for t in tones)
            pinyin_str = " ".join(syllables)
            by_tone[tone_key].append((word, freq, pinyin_str))
            seen_words.add(word)
            n_used += 1

    # Ensure every BOOST phrase is present even if absent from jieba dict
    for word, boost_freq in BOOST_PHRASES.items():
        if word in seen_words or not all_chinese(word) or len(word) > MAX_LEN:
            continue
        result = word_to_tone_seq(word)
        if result is None:
            continue
        syllables, tones = result
        tone_key = "-".join(str(t) for t in tones)
        pinyin_str = " ".join(syllables)
        freq = max(boost_freq, MIN_FREQ)
        by_tone[tone_key].append((word, freq, pinyin_str))
        n_used += 1

    # Sort each bucket by freq desc, keep top N
    out_by_tone: dict[str, list] = {}
    for key, entries in by_tone.items():
        entries.sort(key=lambda e: -e[1])
        out_by_tone[key] = [[w, f, p] for (w, f, p) in entries[:TOP_PER_SEQ]]

    # Index of tone sequences by length
    by_len: dict[str, list[str]] = defaultdict(list)
    for key in out_by_tone:
        n = key.count("-") + 1
        by_len[str(n)].append(key)

    total_phrases = sum(len(v) for v in out_by_tone.values())

    payload = {
        "byTone": out_by_tone,
        "byLen": dict(by_len),
        "meta": {
            "totalPhrases": total_phrases,
            "uniqueToneSeqs": len(out_by_tone),
            "minFreq": MIN_FREQ,
            "maxLen": MAX_LEN,
            "topPerSeq": TOP_PER_SEQ,
        },
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = OUT_PATH.stat().st_size / 1024 / 1024
    print(f"Read {n_read} dict entries.")
    print(f"  Skipped non-Chinese: {n_skipped_chars}")
    print(f"  Skipped too long:    {n_skipped_len}")
    print(f"  Skipped low freq:    {n_skipped_freq}")
    print(f"Used {n_used} words across {len(out_by_tone)} unique tone sequences.")
    print(f"After top-{TOP_PER_SEQ}-per-seq cap: {total_phrases} phrases.")
    print(f"Wrote {OUT_PATH} ({size_mb:.2f} MB).")


if __name__ == "__main__":
    build()
