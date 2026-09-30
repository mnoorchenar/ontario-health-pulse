#!/usr/bin/env python3
"""Build data/data.json for Ontario Health Pulse from public, aggregated Ontario open data.

Sources (both Open Government Licence - Ontario, aggregated by public health unit and date):
  1. Ontario COVID-19 testing metrics by Public Health Unit (PHU)
  2. COVID-19 Vaccine Data in Ontario: vaccination by PHU and age group

Both datasets were frozen by the province on 2024-11-14; the script is written so a newer file with the
same columns is picked up automatically. Only the Python standard library is used.

Safety rules:
  * Validation runs before anything is written. On failure the script exits with status 1 and the
    existing data.json is left untouched.
  * Counts of 1-4 are masked (set to null) so small cells are never published.
  * Synthetic sample data can only be written with --synthetic and is labelled as such.

Usage:
  python scripts/build_data.py                       # download, validate, write data/data.json
  python scripts/build_data.py --testing-file a.csv --vaccine-file b.csv --out /tmp/x.json
  python scripts/build_data.py --synthetic --out data/sample.json
"""
import argparse
import csv
import datetime as dt
import io
import json
import math
import os
import random
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "data" / "data.json"
BOUNDARIES = ROOT / "data" / "phu_boundaries.geojson"
SCHEMA = 1
SMALL_CELL = 5  # counts of 1..4 are masked

TESTING_URL = ("https://data.ontario.ca/dataset/a2dfa674-a173-45b3-9964-1e3d2130b40f/resource/"
               "07bc0e21-26b5-4152-b609-c1958cb7b227/download/testing_metrics_by_phu.csv")
VACCINE_URL = ("https://data.ontario.ca/dataset/752ce2b7-c15a-4965-a3dc-397bf405e7cc/resource/"
               "2a362139-b782-43b1-b3cb-078a2ef19524/download/vaccines_by_age_phu.csv")

# Current (2025) public health units, as in the official boundary file: id -> name
CURRENT_PHUS = {
    2226: "Algoma Public Health", 2230: "Durham Region Health Department", 2233: "Grey Bruce Public Health",
    2236: "Halton Region Health Department", 2237: "Hamilton Public Health Services",
    2240: "Chatham-Kent Public Health", 2242: "Lambton Public Health", 2244: "Middlesex-London Health Unit",
    2246: "Niagara Region Public Health", 2247: "North Bay Parry Sound District Health Unit",
    2249: "Northwestern Health Unit", 2251: "Ottawa Public Health", 2253: "Peel Public Health",
    2257: "Renfrew County and District Health Unit", 2258: "Eastern Ontario Health Unit",
    2260: "Simcoe Muskoka District Health Unit", 2261: "Public Health Sudbury & Districts",
    2262: "Thunder Bay District Health Unit", 2265: "Region of Waterloo Public Health and Paramedic Services",
    2266: "Wellington-Dufferin-Guelph Public Health", 2268: "Windsor-Essex County Health Unit",
    2270: "York Region Public Health", 3895: "Toronto Public Health", 4913: "Southwestern Public Health",
    5183: "Huron Perth Public Health", 7652: "Grand Erie Public Health", 7653: "Lakelands Public Health",
    7654: "Northeastern Public Health", 7655: "Southeast Public Health",
}
# Pre-2025 unit id -> current unit id (nine units merged into four on 1 Jan 2025). Unlisted ids are unchanged.
MERGED_INTO = {2227: 7652, 2234: 7652, 2235: 7653, 2255: 7653, 2256: 7654, 2263: 7654,
               2238: 7655, 2241: 7655, 2243: 7655}
# Pre-2025 unit id -> (name in testing file, name in vaccine file). This is the "known PHU list".
SOURCE_PHUS = {
    2226: ("District of Algoma Health Unit", "ALGOMA DISTRICT"),
    2227: ("Brant County Health Unit", "BRANT COUNTY"),
    2230: ("Durham Regional Health Unit", "DURHAM REGION"),
    2233: ("Grey Bruce Health Unit", "GREY BRUCE"),
    2234: ("Haldimand-Norfolk Health Unit", "HALDIMAND-NORFOLK"),
    2235: ("Haliburton, Kawartha, Pine Ridge District Health Unit", "HALIBURTON, KAWARTHA, PINE RIDGE"),
    2236: ("Halton Regional Health Unit", "HALTON REGION"),
    2237: ("City of Hamilton Health Unit", "CITY OF HAMILTON"),
    2238: ("Hastings and Prince Edward Counties Health Unit", "HASTINGS & PRINCE EDWARD COUNTIES"),
    2240: ("Chatham-Kent Health Unit", "CHATHAM-KENT"),
    2241: ("Kingston, Frontenac and Lennox and Addington Health Unit", "KINGSTON, FRONTENAC, LENNOX & ADDINGTON"),
    2242: ("Lambton Health Unit", "LAMBTON COUNTY"),
    2243: ("Leeds, Grenville and Lanark District Health Unit", "LEEDS, GRENVILLE AND LANARK DISTRICT"),
    2244: ("Middlesex-London Health Unit", "MIDDLESEX-LONDON"),
    2246: ("Niagara Regional Area Health Unit", "NIAGARA REGION"),
    2247: ("North Bay Parry Sound District Health Unit", "NORTH BAY PARRY SOUND DISTRICT"),
    2249: ("Northwestern Health Unit", "NORTHWESTERN"),
    2251: ("City of Ottawa Health Unit", "CITY OF OTTAWA"),
    2253: ("Peel Regional Health Unit", "PEEL REGION"),
    2255: ("Peterborough County-City Health Unit", "PETERBOROUGH COUNTY-CITY"),
    2256: ("Porcupine Health Unit", "PORCUPINE"),
    2257: ("Renfrew County and District Health Unit", "RENFREW COUNTY AND DISTRICT"),
    2258: ("Eastern Ontario Health Unit", "EASTERN ONTARIO"),
    2260: ("Simcoe Muskoka District Health Unit", "SIMCOE MUSKOKA DISTRICT"),
    2261: ("Sudbury and District Health Unit", "SUDBURY AND DISTRICT"),
    2262: ("Thunder Bay District Health Unit", "THUNDER BAY DISTRICT"),
    2263: ("Timiskaming Health Unit", "TIMISKAMING"),
    2265: ("Waterloo Health Unit", "WATERLOO REGION"),
    2266: ("Wellington-Dufferin-Guelph Health Unit", "WELLINGTON-DUFFERIN-GUELPH"),
    2268: ("Windsor-Essex County Health Unit", "WINDSOR-ESSEX COUNTY"),
    2270: ("York Regional Health Unit", "YORK REGION"),
    3895: ("City of Toronto Health Unit", "TORONTO"),
    4913: ("Southwestern Public Health", "SOUTHWESTERN"),
    5183: ("Huron Perth Health Unit", "HURON PERTH"),
}
ONTARIO_TESTING_ROW = (35, "Ontario")
UNKNOWN_VACCINE_ROW = (9999, "UNKNOWN")  # doses with no PHU recorded; never shown

TESTING_COLUMNS = ["DATE", "PHU_num", "PHU_name", "percent_positive_7d_avg", "test_volumes_7d_avg"]
VACCINE_COLUMNS = ["Date", "PHU ID", "PHU name", "Agegroup", "At least one dose_cumulative",
                   "third_dose_cumulative", "Total population", "Percent_at_least_one_dose", "Percent_3doses"]
VACCINE_AGEGROUP = "Ontario_5plus"
MIN_TESTING_ROWS = 30000
MIN_VACCINE_ROWS = 300000
MAX_DAILY_TESTS = 200000  # plausibility ceiling for province-wide 7-day average daily tests

INDICATORS = ["pos", "vol", "vax1", "vax3"]


class ValidationError(Exception):
    pass


# ---------------------------------------------------------------------------------------------
# Small helpers (unit tested)
# ---------------------------------------------------------------------------------------------
def suppress_small_count(value, threshold=SMALL_CELL):
    """Mask counts of 1..threshold-1 with None. Zero and larger counts pass through; None stays None."""
    if value is None:
        return None
    if 0 < value < threshold:
        return None
    return value


def parse_number(text):
    """Parse '1,093' / '.2743' / '' -> float or None. Raises ValueError on garbage."""
    s = (text or "").strip().replace(",", "")
    if s == "" or s.lower() in ("na", "n/a", "null", "nan"):
        return None
    return float(s)


def parse_date(text):
    return dt.date.fromisoformat(text.strip()[:10])


def week_grid(dates):
    """Weekly grid ending on the latest date, stepping back 7 days to the earliest date."""
    end, start = max(dates), min(dates)
    n = (end - start).days // 7
    return [end - dt.timedelta(days=7 * k) for k in range(n, -1, -1)]


def check_columns(header, expected, label):
    missing = [c for c in expected if c not in header]
    if missing:
        raise ValidationError("%s: expected columns missing: %s" % (label, ", ".join(missing)))


# ---------------------------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------------------------
def download_text(url, cache_dir=None, label="file"):
    cache = None
    if cache_dir:
        cache = Path(cache_dir) / (label + ".csv")
        if cache.exists():
            return cache.read_text(encoding="utf-8-sig")
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ontario-health-pulse-build/1.0"})
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read()
            text = raw.decode("utf-8-sig")
            if text.lstrip().lower().startswith("<!doctype html") or "<html" in text[:500].lower():
                raise ValidationError("%s: server returned an HTML page instead of CSV" % label)
            if cache:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(text, encoding="utf-8")
            return text
        except Exception as exc:  # retry network hiccups
            last = exc
    raise RuntimeError("Could not download %s (%s): %s" % (label, url, last))


# ---------------------------------------------------------------------------------------------
# Parse source files into per-(current PHU, date) records
# ---------------------------------------------------------------------------------------------
def parse_testing(text):
    try:
        return _parse_testing(text)
    except ValueError as exc:
        raise ValidationError("testing file: unreadable value (%s)" % exc)


def _parse_testing(text):
    """Return (rows_read, {(phu_id, date): (positives_weighted_sum, tests_sum)}, ontario{date: (pct, vol)})."""
    reader = csv.DictReader(io.StringIO(text))
    check_columns(reader.fieldnames or [], TESTING_COLUMNS, "testing file")
    acc, ontario, n = {}, {}, 0
    for row in reader:
        n += 1
        pid, name = int(row["PHU_num"]), row["PHU_name"].strip()
        d = parse_date(row["DATE"])
        pct, vol = parse_number(row["percent_positive_7d_avg"]), parse_number(row["test_volumes_7d_avg"])
        if (pid, name) == ONTARIO_TESTING_ROW:
            ontario[d] = (pct, vol)
            continue
        if pid not in SOURCE_PHUS or SOURCE_PHUS[pid][0] != name:
            raise ValidationError("testing file: unknown PHU %r (%r)" % (pid, name))
        if pct is None or vol is None:
            continue
        if pct < 0 or pct > 1 or vol < 0 or vol > MAX_DAILY_TESTS:
            raise ValidationError("testing file: implausible value on %s for %s: pct=%s vol=%s" % (d, name, pct, vol))
        key = (MERGED_INTO.get(pid, pid), d)
        a = acc.setdefault(key, [0.0, 0.0])
        a[0] += pct * vol
        a[1] += vol
    return n, acc, ontario


def parse_vaccine(text):
    try:
        return _parse_vaccine(text)
    except ValueError as exc:
        raise ValidationError("vaccine file: unreadable value (%s)" % exc)


def _parse_vaccine(text):
    """Return (rows_read, {(phu_id, date): [dose1_sum, dose3_sum, pop_sum]}, checks[(pid, date, pct1, pct3, d1, d3, pop)])."""
    reader = csv.DictReader(io.StringIO(text))
    check_columns(reader.fieldnames or [], VACCINE_COLUMNS, "vaccine file")
    acc, checks, n = {}, [], 0
    for row in reader:
        n += 1
        if row["Agegroup"] != VACCINE_AGEGROUP:
            continue
        pid, name = int(row["PHU ID"]), row["PHU name"].strip()
        if (pid, name) == UNKNOWN_VACCINE_ROW:
            continue
        if pid not in SOURCE_PHUS or SOURCE_PHUS[pid][1] != name:
            raise ValidationError("vaccine file: unknown PHU %r (%r)" % (pid, name))
        d = parse_date(row["Date"])
        d1, d3 = parse_number(row["At least one dose_cumulative"]), parse_number(row["third_dose_cumulative"])
        pop = parse_number(row["Total population"])
        if None in (d1, d3, pop) or d1 < 0 or d3 < 0 or pop < 0:
            raise ValidationError("vaccine file: missing or negative count on %s for %s" % (d, name))
        key = (MERGED_INTO.get(pid, pid), d)
        a = acc.setdefault(key, [0.0, 0.0, 0.0])
        a[0] += d1
        a[1] += d3
        a[2] += pop
        if pid not in MERGED_INTO:
            checks.append((pid, d, parse_number(row["Percent_at_least_one_dose"]),
                           parse_number(row["Percent_3doses"]), d1, d3, pop))
    return n, acc, checks


# ---------------------------------------------------------------------------------------------
# Assemble the output document
# ---------------------------------------------------------------------------------------------
def r(x, nd):
    return None if x is None else round(x, nd)


def build_document(testing_text, vaccine_text, today=None):
    today = today or dt.date.today()
    t_rows, t_acc, t_ont = parse_testing(testing_text)
    v_rows, v_acc, v_checks = parse_vaccine(vaccine_text)
    if t_rows < MIN_TESTING_ROWS:
        raise ValidationError("testing file has only %d rows (expected at least %d)" % (t_rows, MIN_TESTING_ROWS))
    if v_rows < MIN_VACCINE_ROWS:
        raise ValidationError("vaccine file has only %d rows (expected at least %d)" % (v_rows, MIN_VACCINE_ROWS))

    # Vaccine coverage published by the source must agree with counts we recompute (catches column shifts).
    bad = [c for c in v_checks if c[6] > 0 and c[2] is not None and abs(c[4] / c[6] - c[2]) > 0.002]
    if len(bad) > len(v_checks) * 0.01:
        raise ValidationError("vaccine file: recomputed coverage disagrees with published coverage on %d rows" % len(bad))

    all_dates = sorted({d for (_, d) in t_acc} | {d for (_, d) in v_acc})
    grid = week_grid(all_dates)
    gset = set(grid)
    latest_t = max(d for (_, d) in t_acc)
    latest_v = max(d for (_, d) in v_acc)

    ids = sorted(CURRENT_PHUS)
    series = {}
    ont_pos_sum = {d: [0.0, 0.0] for d in grid}
    ont_vax = {d: [0.0, 0.0, 0.0] for d in grid}
    for pid in ids:
        s = {k: [] for k in INDICATORS}
        for d in grid:
            t = t_acc.get((pid, d))
            vol = suppress_small_count(round(t[1]) if t else None)
            if t and vol is not None and t[1] > 0:
                s["pos"].append(r(100 * t[0] / t[1], 2))
                s["vol"].append(int(vol))
                ont_pos_sum[d][0] += t[0]
                ont_pos_sum[d][1] += t[1]
            else:
                s["pos"].append(None)
                s["vol"].append(int(vol) if vol is not None else None)
                if t:
                    ont_pos_sum[d][0] += t[0]
                    ont_pos_sum[d][1] += t[1]
            v = v_acc.get((pid, d))
            if v and v[2] > 0:
                n1, n3 = suppress_small_count(v[0]), suppress_small_count(v[1])
                s["vax1"].append(r(100 * n1 / v[2], 2) if n1 is not None else None)
                s["vax3"].append(r(100 * n3 / v[2], 2) if n3 is not None else None)
                for i in range(3):
                    ont_vax[d][i] += v[i]
            else:
                s["vax1"].append(None)
                s["vax3"].append(None)
        series[str(pid)] = s

    on = {k: [] for k in INDICATORS}
    for d in grid:
        p = ont_pos_sum[d]
        on["pos"].append(r(100 * p[0] / p[1], 2) if p[1] > 0 else None)
        on["vol"].append(int(round(p[1])) if p[1] > 0 else None)
        v = ont_vax[d]
        on["vax1"].append(r(100 * v[0] / v[2], 2) if v[2] > 0 else None)
        on["vax3"].append(r(100 * v[1] / v[2], 2) if v[2] > 0 else None)
    series["ON"] = on

    # Cross-check our province total against the province row published in the testing file.
    diffs = [abs(on["pos"][i] / 100 - t_ont[d][0]) for i, d in enumerate(grid)
             if d in t_ont and on["pos"][i] is not None and t_ont[d][0] is not None]
    if diffs and sum(diffs) / len(diffs) > 0.01:
        raise ValidationError("province positivity recomputed from PHUs differs from the published province row "
                              "(mean abs diff %.4f)" % (sum(diffs) / len(diffs)))

    def last_date(key):
        for i in range(len(grid) - 1, -1, -1):
            if series["ON"][key][i] is not None:
                return grid[i].isoformat()
        return None

    doc = {
        "meta": {
            "schema": SCHEMA,
            "synthetic": False,
            "title": "Ontario Health Pulse data snapshot",
            "downloaded": today.isoformat(),
            "latest_data_date": max(latest_t, latest_v).isoformat(),
            "frequency": "weekly (every 7 days, ending on the latest date)",
            "geography": "Ontario public health units as of 2025 (29). Earlier units that merged on 1 Jan 2025 "
                         "are combined so history is shown on today's boundaries.",
            "indicators": {
                "pos": {"label": "COVID-19 test positivity", "unit": "%", "decimals": 1, "source": "testing",
                        "latest_date": last_date("pos"),
                        "help": "Share of COVID-19 lab tests that were positive, 7-day average."},
                "vol": {"label": "COVID-19 tests per day", "unit": "tests", "decimals": 0, "source": "testing",
                        "latest_date": last_date("vol"), "helper": True,
                        "help": "Average number of COVID-19 tests per day, 7-day average."},
                "vax1": {"label": "Vaccinated: at least one dose (ages 5+)", "unit": "%", "decimals": 1,
                         "source": "vaccine", "latest_date": last_date("vax1"),
                         "help": "Share of people aged 5 and over with at least one COVID-19 vaccine dose."},
                "vax3": {"label": "Vaccinated: 3 or more doses (ages 5+)", "unit": "%", "decimals": 1,
                         "source": "vaccine", "latest_date": last_date("vax3"),
                         "help": "Share of people aged 5 and over with three or more COVID-19 vaccine doses."},
            },
            "sources": [
                {"id": "testing", "name": "Ontario COVID-19 testing metrics by Public Health Unit (PHU)",
                 "publisher": "Ontario Ministry of Health / Public Health Ontario via Ontario Data Catalogue",
                 "url": "https://data.ontario.ca/dataset/ontario-covid-19-testing-metrics-by-public-health-unit-phu",
                 "file_url": TESTING_URL, "latest_date": latest_t.isoformat(),
                 "license": "Open Government Licence - Ontario",
                 "license_url": "https://www.ontario.ca/page/open-government-licence-ontario",
                 "status": "Archived: no longer updated after 2024-11-14"},
                {"id": "vaccine", "name": "COVID-19 Vaccine Data in Ontario (by PHU and age group)",
                 "publisher": "Ontario Ministry of Health via Ontario Data Catalogue",
                 "url": "https://data.ontario.ca/dataset/covid-19-vaccine-data-in-ontario",
                 "file_url": VACCINE_URL, "latest_date": latest_v.isoformat(),
                 "license": "Open Government Licence - Ontario",
                 "license_url": "https://www.ontario.ca/page/open-government-licence-ontario",
                 "status": "Archived: no longer updated after 2024-11-14"},
                {"id": "boundaries", "name": "Ministry of Health Public Health Unit Boundary",
                 "publisher": "Land Information Ontario", "url": "https://data.ontario.ca/dataset/public-health-unit-boundaries",
                 "license": "Open Government Licence - Ontario",
                 "license_url": "https://www.ontario.ca/page/open-government-licence-ontario",
                 "status": "Map shapes only; simplified for display"},
            ],
            "notes": [
                "Test positivity is the share of tests that came back positive, so it depends on who gets tested. "
                "It is not the share of all people who are infected.",
                "Values are 7-day averages reported for the lab's public health unit reporting area. "
                "Test counts and positivity for a unit reflect testing, not the number of people ill.",
                "Vaccination coverage counts people with a recorded dose. Doses given without consent to record them, "
                "and some Indigenous community records, are not included, so real coverage may be higher.",
                "Coverage uses 2021 Statistics Canada population estimates for people aged 5 and over.",
                "Public health units that merged on 1 January 2025 are combined for the whole history; "
                "rates are recalculated from combined counts, not averaged.",
                "Counts smaller than 5 are hidden, so a few early weeks or small areas can show no value.",
                "Both source datasets stopped updating in November 2024, so this snapshot is historical.",
            ],
        },
        "phus": [{"id": pid, "name": CURRENT_PHUS[pid],
                  "merged_from": sorted(k for k, v in MERGED_INTO.items() if v == pid)} for pid in ids],
        "dates": [d.isoformat() for d in grid],
        "series": series,
    }
    return doc


# ---------------------------------------------------------------------------------------------
# Validation of the finished document (also run against the existing file for the date check)
# ---------------------------------------------------------------------------------------------
def validate_document(doc, existing=None, boundaries_path=BOUNDARIES):
    """Return a list of error strings; empty list means valid."""
    errs = []
    try:
        meta, phus, dates, series = doc["meta"], doc["phus"], doc["dates"], doc["series"]
    except (KeyError, TypeError):
        return ["document is missing meta, phus, dates or series"]
    if meta.get("schema") != SCHEMA:
        errs.append("unsupported schema %r" % meta.get("schema"))
    for key in ("downloaded", "latest_data_date", "indicators", "sources"):
        if key not in meta:
            errs.append("meta.%s is missing" % key)
    if not meta.get("sources"):
        errs.append("meta.sources is empty")
    ids = [p.get("id") for p in phus]
    if sorted(ids) != sorted(CURRENT_PHUS):
        errs.append("PHU ids do not match the known list of %d units" % len(CURRENT_PHUS))
    for p in phus:
        if CURRENT_PHUS.get(p.get("id")) != p.get("name"):
            errs.append("PHU %r has an unexpected name %r" % (p.get("id"), p.get("name")))
    if len(dates) < 8:
        errs.append("only %d dates (suspiciously few)" % len(dates))
    try:
        parsed = [dt.date.fromisoformat(d) for d in dates]
        if any(b <= a for a, b in zip(parsed, parsed[1:])):
            errs.append("dates are not strictly increasing")
        if meta.get("latest_data_date") and meta["latest_data_date"] != dates[-1] and not meta.get("synthetic"):
            latest_dates = [i.get("latest_date") for i in meta.get("indicators", {}).values() if i.get("latest_date")]
            if not latest_dates or max(latest_dates) != meta["latest_data_date"]:
                errs.append("latest_data_date does not match the data")
    except (ValueError, TypeError, IndexError):
        errs.append("dates are not valid ISO dates")
    if sorted(series) != sorted(["ON"] + [str(i) for i in CURRENT_PHUS]):
        errs.append("series keys do not match the PHU list plus ON")
    for key, s in series.items():
        for ind in INDICATORS:
            vals = s.get(ind)
            if not isinstance(vals, list) or len(vals) != len(dates):
                errs.append("series %s.%s has the wrong length" % (key, ind))
                continue
            for v in vals:
                if v is None:
                    continue
                if not isinstance(v, (int, float)) or isinstance(v, bool) or math.isnan(v) or v < 0:
                    errs.append("series %s.%s has a negative or invalid number %r" % (key, ind, v))
                    break
                if ind in ("pos", "vax1", "vax3") and v > 100:
                    errs.append("series %s.%s has a percentage above 100: %r" % (key, ind, v))
                    break
                if ind == "vol" and v > MAX_DAILY_TESTS:
                    errs.append("series %s.vol has an implausible value %r" % (key, v))
                    break
                if ind == "vol" and 0 < v < SMALL_CELL:
                    errs.append("series %s.vol contains an unmasked small count %r" % (key, v))
                    break
    non_null = sum(1 for s in series.values() for ind in INDICATORS for v in (s.get(ind) or []) if v is not None)
    if non_null < 1000:
        errs.append("only %d data points in total (suspiciously few)" % non_null)
    if boundaries_path and Path(boundaries_path).exists():
        try:
            bids = sorted(f["properties"]["id"] for f in json.loads(Path(boundaries_path).read_text("utf-8"))["features"])
            if bids != sorted(CURRENT_PHUS):
                errs.append("boundary file PHU ids do not match the known list")
        except Exception as exc:
            errs.append("boundary file could not be read: %s" % exc)
    if existing and not errs:
        try:
            if meta["latest_data_date"] < existing["meta"]["latest_data_date"]:
                errs.append("new latest date %s is older than the existing %s"
                            % (meta["latest_data_date"], existing["meta"]["latest_data_date"]))
            if len(dates) < len(existing["dates"]):
                errs.append("new data has fewer weeks (%d) than the existing file (%d)" % (len(dates), len(existing["dates"])))
            if meta.get("synthetic") and not existing["meta"].get("synthetic"):
                errs.append("refusing to replace real data with synthetic data")
        except (KeyError, TypeError):
            pass  # existing file unreadable: nothing to compare against
    return errs


def same_payload(a, b):
    """True when two documents are identical apart from the download date."""
    def strip(d):
        d = json.loads(json.dumps(d))
        d.get("meta", {}).pop("downloaded", None)
        return d
    return strip(a) == strip(b)


def write_atomic(path, doc):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(doc, fh, separators=(",", ":"), ensure_ascii=False)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


# ---------------------------------------------------------------------------------------------
# Synthetic sample data (clearly labelled, never written over real data)
# ---------------------------------------------------------------------------------------------
def build_synthetic(today=None, weeks=156):
    today = today or dt.date.today()
    rng = random.Random(42)
    end = today - dt.timedelta(days=(today.weekday() - 2) % 7)  # most recent Wednesday
    grid = [end - dt.timedelta(days=7 * k) for k in range(weeks - 1, -1, -1)]
    series = {}
    for pid in sorted(CURRENT_PHUS):
        base, amp, phase = rng.uniform(4, 9), rng.uniform(2, 6), rng.uniform(0, 6.28)
        s = {k: [] for k in INDICATORS}
        for i in range(weeks):
            seasonal = math.sin(2 * math.pi * i / 52 + phase)
            s["pos"].append(round(max(0.2, base + amp * seasonal + rng.gauss(0, 0.6)), 2))
            s["vol"].append(int(rng.uniform(300, 4000)))
            s["vax1"].append(round(min(95, 70 + 25 * (1 - math.exp(-i / 30)) + rng.gauss(0, 0.2)), 2))
            s["vax3"].append(round(min(80, 50 * (1 - math.exp(-i / 60)) + rng.uniform(0, 12) * (i / weeks)), 2))
        series[str(pid)] = s
    series["ON"] = {k: [round(sum(series[str(p)][k][i] for p in CURRENT_PHUS) / len(CURRENT_PHUS), 2)
                        for i in range(weeks)] for k in INDICATORS}
    series["ON"]["vol"] = [int(v) for v in series["ON"]["vol"]]
    doc = build_document_skeleton(grid, series, today)
    return doc


def build_document_skeleton(grid, series, today):
    """Reuse the indicator/source metadata from the real build, flagged synthetic."""
    doc = {
        "meta": {
            "schema": SCHEMA, "synthetic": True, "title": "SAMPLE DATA, NOT REAL",
            "downloaded": today.isoformat(), "latest_data_date": grid[-1].isoformat(),
            "frequency": "weekly", "geography": "Ontario public health units as of 2025 (29). Values are invented.",
            "indicators": {
                "pos": {"label": "COVID-19 test positivity", "unit": "%", "decimals": 1, "source": "sample",
                        "latest_date": grid[-1].isoformat(), "help": "Sample values only."},
                "vol": {"label": "COVID-19 tests per day", "unit": "tests", "decimals": 0, "source": "sample",
                        "latest_date": grid[-1].isoformat(), "helper": True, "help": "Sample values only."},
                "vax1": {"label": "Vaccinated: at least one dose (ages 5+)", "unit": "%", "decimals": 1,
                         "source": "sample", "latest_date": grid[-1].isoformat(), "help": "Sample values only."},
                "vax3": {"label": "Vaccinated: 3 or more doses (ages 5+)", "unit": "%", "decimals": 1,
                         "source": "sample", "latest_date": grid[-1].isoformat(), "help": "Sample values only."},
            },
            "sources": [{"id": "sample", "name": "Synthetic sample generated by scripts/build_data.py",
                         "publisher": "Ontario Health Pulse demo", "url": "https://github.com/mnoorchenar/ontario-health-pulse",
                         "license": "MIT (invented numbers)", "license_url": "", "status": "SAMPLE DATA, NOT REAL"}],
            "notes": ["Every number here is invented for demonstration. Do not use it for any decision."],
        },
        "phus": [{"id": pid, "name": CURRENT_PHUS[pid], "merged_from": []} for pid in sorted(CURRENT_PHUS)],
        "dates": [d.isoformat() for d in grid],
        "series": series,
    }
    return doc


# ---------------------------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--testing-file", help="use a local testing CSV instead of downloading")
    ap.add_argument("--vaccine-file", help="use a local vaccine CSV instead of downloading")
    ap.add_argument("--cache-dir", help="reuse/keep downloaded CSVs in this folder")
    ap.add_argument("--synthetic", action="store_true", help="write clearly labelled synthetic sample data")
    ap.add_argument("--force-synthetic", action="store_true", help="allow --synthetic to target data/data.json")
    args = ap.parse_args(argv)
    out = Path(args.out)

    existing = None
    if out.exists():
        try:
            existing = json.loads(out.read_text("utf-8"))
        except Exception:
            existing = None

    try:
        if args.synthetic:
            if out.resolve() == DEFAULT_OUT.resolve() and not args.force_synthetic:
                raise ValidationError("refusing to write synthetic data over data/data.json (use --out or --force-synthetic)")
            doc = build_synthetic()
        else:
            t = Path(args.testing_file).read_text("utf-8-sig") if args.testing_file else \
                download_text(TESTING_URL, args.cache_dir, "testing_metrics_by_phu")
            v = Path(args.vaccine_file).read_text("utf-8-sig") if args.vaccine_file else \
                download_text(VACCINE_URL, args.cache_dir, "vaccines_by_age_phu")
            doc = build_document(t, v)
        errors = validate_document(doc, existing)
        if errors:
            raise ValidationError("; ".join(errors))
    except (ValidationError, RuntimeError) as exc:
        print("ERROR: %s\nExisting %s was left untouched." % (exc, out), file=sys.stderr)
        return 1

    if existing and same_payload(existing, doc):
        print("No change: %s already contains this data (latest %s)." % (out, doc["meta"]["latest_data_date"]))
        return 0
    write_atomic(out, doc)
    print("Wrote %s (%.0f KB), latest data date %s, %d weeks, synthetic=%s"
          % (out, out.stat().st_size / 1024, doc["meta"]["latest_data_date"], len(doc["dates"]), doc["meta"]["synthetic"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
