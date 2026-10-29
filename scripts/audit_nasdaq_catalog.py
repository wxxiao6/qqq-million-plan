"""Compare the sole Nasdaq catalog with Eastmoney's current public fund-code index.

This reports candidates for review. It never inserts a search hit automatically.
"""

import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
CATALOG = ROOT / "config/nasdaq-funds.json"
INDEX_URL = "https://fund.eastmoney.com/js/fundcode_search.js"

known = {fund["code"] for fund in json.loads(CATALOG.read_text())["funds"]}
request = urllib.request.Request(INDEX_URL, headers={"User-Agent": "Mozilla/5.0"})
raw = urllib.request.urlopen(request, timeout=20).read().decode("utf-8-sig")
index = json.loads(raw.split("=", 1)[1].strip().rstrip(";"))
candidates = {
    item[0]: item[2] for item in index
    if len(item) > 2 and re.search("纳斯达克|纳指|广发生物科技指数", item[2])
}
missing = sorted(set(candidates) - known)
for code in missing:
    print(f"{code}\t{candidates[code]}")
print(f"catalog={len(known)} index_candidates={len(candidates)} missing={len(missing)}")
sys.exit(1 if missing else 0)
