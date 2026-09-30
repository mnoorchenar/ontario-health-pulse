#!/usr/bin/env python3
"""Download the official Ontario public health unit (PHU) boundaries and write a small GeoJSON.

Source: Ontario Ministry of Health "Public Health Unit Boundary" (Land Information Ontario open data),
Open Government Licence - Ontario. Only the standard library is used.

Usage:  python scripts/build_boundaries.py [--tolerance 0.01] [--out data/phu_boundaries.geojson]
"""
import argparse
import json
import math
import sys
import urllib.request
from pathlib import Path

SOURCE_URL = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open09/MapServer/44"
QUERY = (
    SOURCE_URL + "/query?where=1%3D1&outFields=PHU_ID,PHU_NAME_ENG&outSR=4326&returnGeometry=true"
    "&maxAllowableOffset=0.002&geometryPrecision=5&f=json"
)
ROOT = Path(__file__).resolve().parent.parent


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ontario-health-pulse-build/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def ring_area(ring):
    """Signed shoelace area (positive = counter-clockwise in lon/lat)."""
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        s += x1 * y2 - x2 * y1
    return s / 2


def perp_dist(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def douglas_peucker(points, tol):
    """Iterative Douglas-Peucker (avoids recursion limits on big rings)."""
    n = len(points)
    if n < 3:
        return list(points)
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0.0, None
        for k in range(i + 1, j):
            d = perp_dist(points[k], points[i], points[j])
            if d > best:
                best, idx = d, k
        if idx is not None and best > tol:
            keep[idx] = True
            stack.extend([(i, idx), (idx, j)])
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring, tol, min_area):
    if abs(ring_area(ring)) < min_area:
        return None  # drop tiny islands that would be invisible at map scale
    out = douglas_peucker(ring[:-1], tol)
    if len(out) < 3:
        return None
    out = [[round(x, 3), round(y, 3)] for x, y in out]
    out.append(out[0])
    return out


def esri_to_multipolygon(rings, tol, min_area):
    """Esri outer rings are clockwise, holes counter-clockwise. Group holes with their outer ring."""
    polygons = []
    for ring in rings:
        simple = simplify_ring(ring, tol, min_area if ring_area(ring) < 0 else 0)
        if simple is None:
            continue
        if ring_area(ring) < 0:  # clockwise = outer
            polygons.append([simple[::-1]])  # GeoJSON wants counter-clockwise outer rings
        elif polygons:
            polygons[-1].append(simple[::-1])  # hole (clockwise in GeoJSON)
    return {"type": "MultiPolygon", "coordinates": polygons}


def build(tolerance):
    raw = fetch_json(QUERY)
    if "features" not in raw or not raw["features"]:
        raise RuntimeError("Boundary service returned no features: %s" % str(raw)[:200])
    features = []
    for f in raw["features"]:
        geom = esri_to_multipolygon(f["geometry"]["rings"], tolerance, tolerance * tolerance * 4)
        if not geom["coordinates"]:
            raise RuntimeError("Empty geometry for PHU %s" % f["attributes"]["PHU_ID"])
        features.append({
            "type": "Feature",
            "properties": {"id": int(f["attributes"]["PHU_ID"]), "name": f["attributes"]["PHU_NAME_ENG"]},
            "geometry": geom,
        })
    features.sort(key=lambda x: x["properties"]["id"])
    return {
        "type": "FeatureCollection",
        "name": "Ontario public health unit boundaries (simplified)",
        "source": "Ontario Ministry of Health Public Health Unit Boundary, Land Information Ontario open data. "
                  "Open Government Licence - Ontario. Simplified for display only; not for legal or analytic use.",
        "features": features,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tolerance", type=float, default=0.01, help="simplification tolerance in degrees")
    ap.add_argument("--out", default=str(ROOT / "data" / "phu_boundaries.geojson"))
    args = ap.parse_args()
    try:
        gj = build(args.tolerance)
    except Exception as exc:  # leave any existing file untouched
        print("ERROR: could not build boundaries: %s" % exc, file=sys.stderr)
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(gj, separators=(",", ":")), encoding="utf-8")
    print("Wrote %s (%d features, %.0f KB)" % (out, len(gj["features"]), out.stat().st_size / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
