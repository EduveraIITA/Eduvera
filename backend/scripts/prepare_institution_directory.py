"""Download pinned public snapshots and normalize factual directory fields only.

No source data is committed. Ambiguous/invalid records are counted and quarantined.
This is an initial unverified public directory, not a current official verification.
"""
import argparse
import collections
import csv
import hashlib
import json
from pathlib import Path
import re
import urllib.request

FIELDS = ["name", "institution_type", "source", "source_code", "state", "district", "city", "address", "is_verified", "metadata"]
MANIFEST = Path(__file__).with_name("institution-directory-sources.json")


def clean(value):
    value = str(value or "").strip()
    return "" if value.lower() in {"nan", "null", "none", "n/a", "-"} else value


def school(row, snapshot):
    code = clean(row["udise_school_code"])
    # The public CSV serialized numeric identifiers, losing the leading 0 in 10-digit codes.
    if not re.fullmatch(r"[0-9]{10,11}", code):
        raise ValueError("invalid_udise_code")
    return dict(name=clean(row["school_name"]), institution_type="school", source="UDISE",
                source_code=code.zfill(11), state=clean(row["state_name"]), district=clean(row["district_name"]),
                city=clean(row["village_name"]), address="", is_verified="false",
                metadata=json.dumps({"snapshot": snapshot}, separators=(",", ":")))


def higher_education(row, snapshot):
    code = clean(row.get("aishe_code")).upper()
    if not re.fullmatch(r"[CUS]-[0-9]+", code):
        raise ValueError("unsupported_or_invalid_aishe_code")
    return dict(name=clean(row.get("name")), institution_type={"C": "college", "U": "university", "S": "standalone"}[code[0]],
                source="AISHE", source_code=code, state=clean(row.get("state")), district=clean(row.get("district")),
                city="", address="", is_verified="false", metadata=json.dumps({"snapshot": snapshot}, separators=(",", ":")))


def validate(row):
    if not 2 <= len(row["name"]) <= 180:
        raise ValueError("name_outside_supported_length")
    if not row["state"] or any(len(row[key]) > 120 for key in ["state", "district", "city"]):
        raise ValueError("invalid_location")
    if any("\x00" in str(value) for value in row.values()):
        raise ValueError("invalid_null_character")
    return row


def download(source, directory):
    target = directory / source["file"]
    if not target.exists():
        partial = target.with_suffix(target.suffix + ".part")
        with urllib.request.urlopen(source["url"], timeout=120) as response, partial.open("wb") as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        partial.replace(target)
    with target.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != source["sha256"]:
        raise ValueError(f"Checksum mismatch for {source['file']}; review the changed dataset before importing.")
    return target


def prepare(directory, output):
    manifest = json.loads(MANIFEST.read_text())
    paths = {key: download(source, directory) for key, source in manifest.items()}
    counts = collections.Counter()
    rejected = collections.Counter()
    # Resolve repeated AISHE identifiers before emitting anything. Never choose a
    # conflicting institution name/location arbitrarily just to satisfy uniqueness.
    aishe = {}
    conflicts = set()
    raw_aishe = json.loads(paths["aishe"].read_text())
    if len(raw_aishe) != manifest["aishe"]["expected_rows"]:
        raise ValueError("Unexpected AISHE source row count")
    for raw in raw_aishe:
        try:
            row = validate(higher_education(raw, manifest["aishe"]["snapshot"]))
        except ValueError as error:
            rejected[str(error)] += 1
            continue
        code = row["source_code"]
        if code in aishe:
            previous = aishe[code]
            if any(previous[key].casefold() != row[key].casefold() for key in ["name", "state", "district"]):
                conflicts.add(code)
            else:
                counts["aishe_identical_duplicates"] += 1
        else:
            aishe[code] = row
    counts["aishe_conflicting_codes_quarantined"] = len(conflicts)
    seen = set()
    with output.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        for code, row in sorted(aishe.items()):
            if code not in conflicts:
                writer.writerow(row)
                counts[row["institution_type"]] += 1
        with paths["udise"].open(newline="", encoding="utf-8-sig") as stream:
            for raw in csv.DictReader(stream):
                counts["udise_source_rows"] += 1
                try:
                    row = validate(school(raw, manifest["udise"]["snapshot"]))
                except ValueError as error:
                    rejected[str(error)] += 1
                    continue
                if row["source_code"] in seen:
                    raise ValueError("Duplicate normalized UDISE identity; source needs review")
                seen.add(row["source_code"])
                writer.writerow(row)
                counts["school"] += 1
    if counts["udise_source_rows"] != manifest["udise"]["expected_rows"]:
        raise ValueError("Unexpected UDISE source row count")
    summary = {"counts": dict(counts), "rejected_rows": dict(rejected), "sources": manifest,
               "verification": "Public snapshots, not freshly verified official records. No tenant links are inferred."}
    output.with_suffix(".summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    prepare(args.directory, args.output)
