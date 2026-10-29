"""Capture per-share sales organizations from Sohu's public fund institution pages.

Run explicitly to refresh the dated audit snapshot; this is not called by the app.
"""

import html
import json
import pathlib
import re
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "config/nasdaq-funds.json"
TARGET = ROOT / "config/nasdaq-sales-audit-2026-09-24.tsv"
OTC_CODES = {
    fund["code"] for fund in json.loads(SOURCE.read_text())["funds"]
    if fund["venue"] == "otc"
}


def cells(row: str) -> list[str]:
    return [
        re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", item))).strip()
        for item in re.findall(r"<td\b[^>]*>(.*?)</td>", row, re.I | re.S)
    ]


lines = ["code\tchannel_kind\tseller\tsource_url"]
failures = []
for index, code in enumerate(sorted(OTC_CODES), 1):
    url = f"https://q.fund.sohu.com/q/fx.php?code={code}"
    source = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            source = urllib.request.urlopen(request, timeout=18).read().decode("utf-8", "ignore")
            break
        except Exception as exc:
            if attempt == 2:
                failures.append((code, str(exc)))
            else:
                time.sleep(attempt + 1)
    if source is None:
        continue
    if not re.search(r"<title>[^<]*\(" + code + r"\)", source):
        failures.append((code, "title/code mismatch"))
        continue
    found = set()
    for row in re.findall(r"<tr\b[^>]*>.*?</tr>", source, re.I | re.S):
        values = cells(row)
        if len(values) < 3 or values[2] not in {"直销机构", "代销机构"}:
            continue
        seller = values[1].replace("\t", " ").strip()
        if not seller or len(seller) > 120:
            continue
        kind = "direct" if values[2] == "直销机构" else "agency"
        found.add((kind, seller))
    if not found:
        failures.append((code, "no sales rows"))
    for kind, seller in sorted(found):
        lines.append(f"{code}\t{kind}\t{seller}\t{url}")
    if index % 10 == 0:
        print(f"checked {index}/{len(OTC_CODES)}", flush=True)

if failures:
    print("incomplete audit: " + repr(failures), file=sys.stderr)
    raise SystemExit(1)
TARGET.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"saved {len(lines) - 1} sales rows across {len(OTC_CODES)} OTC funds", flush=True)
