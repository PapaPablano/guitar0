"""Fails if a package in the staged Python runtime carries a non-commercial or unrecognised licence.

Usage: python -I scripts/check-licences.py <site-packages dir>

Reads each *.dist-info/METADATA. A package passes when its licence text matches a permissive pattern; it fails when it
matches a blocked pattern (non-commercial, GPL/AGPL) or when no licence is declared and it is not in REVIEWED.
Add to REVIEWED only after reading the package's licence by hand.
"""
import email
import os
import re
import sys

BLOCKED = re.compile(r"non-?commercial|\bCC[- ]BY[- ]NC|\bAGPL|\bGPL(?!.*(linking|classpath))|\bSSPL|Commons Clause", re.I)
OK = re.compile(
    r"\bMIT\b|\bBSD\b|\bApache\b|\bISC\b|\bMPL\b|Mozilla Public|\bPSF\b|Python Software Foundation|\bUnlicense\b|"
    r"\bLGPL\b|\b0BSD\b|\bZlib\b|\bCC0\b|\bHPND\b|MIT-CMU|\bBSL\b|Dual License",
    re.I,
)
# Reviewed by hand: no usable licence field in METADATA, or text that trips the patterns.
# LGPL libraries (lameenc, soxr) are dynamically loaded and listed in packaging/windows/THIRD_PARTY_NOTICES.md.
REVIEWED = {
    "stemdeck": "Apache-2.0, https://github.com/stemdeckapp/stemdeck",
    "colorama": "BSD-3-Clause",
    "jinja2": "BSD-3-Clause",
    "omegaconf": "BSD-3-Clause",
    "segno": "BSD-3-Clause",
    "torchaudio": "BSD-style",
    "submitit": "MIT",
    "ml-collections": "Apache-2.0",
}


def licence_of(meta):
    text = meta.get("License-Expression") or meta.get("License") or ""
    classifiers = [c for c in meta.get_all("Classifier") or [] if c.startswith("License ::")]
    return " ".join([text.replace("\n", " ")[:300]] + classifiers)


def main(root):
    failures = []
    count = 0
    for entry in sorted(os.listdir(root)):
        path = os.path.join(root, entry, "METADATA")
        if not entry.endswith(".dist-info") or not os.path.exists(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as handle:
            meta = email.message_from_file(handle)
        name = (meta.get("Name") or entry).lower().replace("_", "-")
        text = licence_of(meta)
        count += 1
        if BLOCKED.search(text) and name not in REVIEWED:
            failures.append(f"{name} {meta.get('Version')}: blocked licence: {text.strip()[:80]}")
        elif not OK.search(text) and name not in REVIEWED:
            failures.append(f"{name} {meta.get('Version')}: no recognised licence: {text.strip()[:80] or '(none declared)'}")
    print(f"Checked {count} packages in {root}")
    for line in failures:
        print(f"  FAIL {line}")
    return 1 if failures else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: check-licences.py <site-packages dir>")
    sys.exit(main(sys.argv[1]))
