#!/usr/bin/env python3
"""Build data/cities.json: Ontario cities and towns with the public health unit each one falls in.

Approximate town-centre coordinates are listed below. The public health unit is worked out by testing each point
against data/phu_boundaries.geojson (point in polygon; points on the simplified coastline use the nearest unit).
Standard library only.  Usage: python scripts/build_cities.py
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# name, lat, lon  |  optional label flags: A = label on the all-Ontario map, S = label on the southern map
CITIES = [
    ("Toronto", 43.6532, -79.3832, "AS"), ("Ottawa", 45.4215, -75.6972, "AS"), ("Hamilton", 43.2557, -79.8711, "S"),
    ("London", 42.9849, -81.2453, "S"), ("Windsor", 42.3149, -83.0364, "AS"), ("Thunder Bay", 48.3809, -89.2477, "A"),
    ("Sudbury", 46.4917, -80.9930, "A"), ("Kingston", 44.2312, -76.4860, "AS"), ("Barrie", 44.3894, -79.6903, "S"),
    ("Niagara Falls", 43.0896, -79.0849, "S"), ("Kitchener", 43.4516, -80.4925, "S"), ("Sarnia", 42.9745, -82.4066, "S"),
    ("Peterborough", 44.3091, -78.3197, "S"), ("Timmins", 48.4758, -81.3305, "A"), ("Kenora", 49.7671, -94.4894, "A"),
    ("Sault Ste. Marie", 46.5219, -84.3461, "A"), ("North Bay", 46.3091, -79.4608, "A"),
    ("Mississauga", 43.5890, -79.6441, ""), ("Brampton", 43.7315, -79.7624, ""), ("Markham", 43.8561, -79.3370, ""),
    ("Vaughan", 43.8361, -79.4983, ""), ("Richmond Hill", 43.8828, -79.4403, ""), ("Oakville", 43.4675, -79.6877, ""),
    ("Burlington", 43.3255, -79.7990, ""), ("Oshawa", 43.8971, -78.8658, ""), ("St. Catharines", 43.1594, -79.2469, ""),
    ("Guelph", 43.5448, -80.2482, ""), ("Cambridge", 43.3616, -80.3144, ""), ("Waterloo", 43.4643, -80.5204, ""),
    ("Whitby", 43.8975, -78.9429, ""), ("Ajax", 43.8509, -79.0204, ""), ("Pickering", 43.8384, -79.0868, ""),
    ("Welland", 42.9920, -79.2483, ""), ("Brantford", 43.1394, -80.2644, ""), ("Belleville", 44.1628, -77.3832, ""),
    ("Cornwall", 45.0184, -74.7282, ""), ("Orillia", 44.6082, -79.4199, ""), ("Stratford", 43.3701, -80.9822, ""),
    ("Woodstock", 43.1315, -80.7467, ""), ("St. Thomas", 42.7787, -81.1822, ""), ("Chatham", 42.4048, -82.1910, ""),
    ("Leamington", 42.0537, -82.5995, ""), ("Owen Sound", 44.5690, -80.9436, ""), ("Fort Frances", 48.6167, -93.4000, ""),
    ("Dryden", 49.7833, -92.8333, ""), ("Sioux Lookout", 50.1000, -91.9167, ""), ("Red Lake", 51.0333, -93.8333, ""),
    ("Atikokan", 48.7500, -91.6167, ""), ("Nipigon", 49.0167, -88.2667, ""), ("Marathon", 48.7167, -86.3833, ""),
    ("Terrace Bay", 48.7833, -87.1000, ""), ("Wawa", 47.9833, -84.7833, ""), ("Blind River", 46.1833, -82.9500, ""),
    ("Elliot Lake", 46.3833, -82.6500, ""), ("Espanola", 46.2500, -81.7667, ""), ("Little Current", 45.9667, -81.9333, ""),
    ("Kapuskasing", 49.4167, -82.4333, ""), ("Cochrane", 49.0667, -81.0167, ""), ("Hearst", 49.6833, -83.6667, ""),
    ("Moosonee", 51.2833, -80.6167, ""), ("Iroquois Falls", 48.7667, -80.6667, ""), ("Kirkland Lake", 48.1500, -80.0333, ""),
    ("Temiskaming Shores", 47.5167, -79.6833, ""), ("West Nipissing", 46.3667, -79.9167, ""), ("Mattawa", 46.3167, -78.7000, ""),
    ("Parry Sound", 45.3453, -80.0350, ""), ("Huntsville", 45.3333, -79.2167, ""), ("Bracebridge", 45.0333, -79.3000, ""),
    ("Gravenhurst", 44.9167, -79.3667, ""), ("Collingwood", 44.5000, -80.2167, ""), ("Wasaga Beach", 44.5203, -80.0167, ""),
    ("Midland", 44.7500, -79.8833, ""), ("Innisfil", 44.3000, -79.6000, ""), ("Bradford", 44.1167, -79.5667, ""),
    ("Newmarket", 44.0592, -79.4613, ""), ("Aurora", 44.0065, -79.4504, ""), ("Keswick", 44.2333, -79.4667, ""),
    ("Uxbridge", 44.1086, -79.1206, ""), ("Stouffville", 43.9700, -79.2500, ""), ("Alliston", 44.1500, -79.8667, ""),
    ("Lindsay", 44.3500, -78.7333, ""), ("Cobourg", 43.9593, -78.1677, ""), ("Port Hope", 43.9500, -78.3000, ""),
    ("Campbellford", 44.3000, -77.8000, ""), ("Trenton", 44.1000, -77.5833, ""), ("Picton", 44.0083, -77.1389, ""),
    ("Napanee", 44.2500, -76.9500, ""), ("Brockville", 44.5895, -75.6843, ""), ("Gananoque", 44.3300, -76.1667, ""),
    ("Smiths Falls", 44.9000, -76.0167, ""), ("Perth", 44.9000, -76.2500, ""), ("Carleton Place", 45.1333, -76.1333, ""),
    ("Almonte", 45.2333, -76.2000, ""), ("Kanata", 45.3000, -75.9000, ""), ("Orleans", 45.4667, -75.5167, ""),
    ("Pembroke", 45.8167, -77.1167, ""), ("Petawawa", 45.9000, -77.2833, ""), ("Deep River", 46.1000, -77.5000, ""),
    ("Renfrew", 45.4667, -76.6833, ""), ("Arnprior", 45.4333, -76.3500, ""), ("Bancroft", 45.0500, -77.8500, ""),
    ("Haliburton", 45.0333, -78.5167, ""), ("Minden", 44.9333, -78.7167, ""), ("Hawkesbury", 45.6000, -74.6000, ""),
    ("Rockland", 45.5333, -75.2833, ""), ("Alexandria", 45.3000, -74.6333, ""), ("Kemptville", 45.0167, -75.6333, ""),
    ("Caledon", 43.8667, -79.8667, ""), ("Bolton", 43.8750, -79.7333, ""), ("Orangeville", 43.9200, -80.0943, ""),
    ("Fergus", 43.7000, -80.3833, ""), ("Elora", 43.6833, -80.4333, ""), ("Milton", 43.5183, -79.8774, ""),
    ("Georgetown", 43.6500, -79.9167, ""), ("Grimsby", 43.2000, -79.5667, ""), ("Fort Erie", 42.9000, -78.9333, ""),
    ("Port Colborne", 42.8833, -79.2500, ""), ("Thorold", 43.1167, -79.2000, ""), ("Simcoe", 42.8333, -80.3000, ""),
    ("Port Dover", 42.7833, -80.2000, ""), ("Dunnville", 42.9000, -79.6167, ""), ("Caledonia", 43.0667, -79.9500, ""),
    ("Paris", 43.2000, -80.3833, ""), ("Tillsonburg", 42.8500, -80.7333, ""), ("Ingersoll", 43.0333, -80.8833, ""),
    ("Aylmer", 42.7667, -80.9833, ""), ("Strathroy", 42.9500, -81.6167, ""), ("Goderich", 43.7333, -81.7167, ""),
    ("Exeter", 43.3500, -81.4833, ""), ("Listowel", 43.7333, -80.9500, ""), ("Kincardine", 44.1833, -81.6333, ""),
    ("Walkerton", 44.1167, -81.1500, ""), ("Hanover", 44.1500, -81.0333, ""), ("Port Elgin", 44.4333, -81.3833, ""),
    ("Wiarton", 44.7333, -81.1333, ""), ("Tobermory", 45.2500, -81.6667, ""), ("Meaford", 44.6000, -80.5833, ""),
    ("Scarborough", 43.7731, -79.2578, ""), ("Etobicoke", 43.6205, -79.5132, ""), ("North York", 43.7615, -79.4111, ""),
    ("Woodbridge", 43.7833, -79.6000, ""), ("Thornhill", 43.8161, -79.4247, ""), ("Stoney Creek", 43.2167, -79.7667, ""),
    ("Ancaster", 43.2167, -79.9667, ""), ("Dundas", 43.2667, -79.9500, ""), ("Waterdown", 43.3333, -79.9000, ""),
    ("Tecumseh", 42.3167, -82.9000, ""), ("Amherstburg", 42.1000, -83.1000, ""), ("Kingsville", 42.0333, -82.7333, ""),
    ("Essex", 42.1667, -82.8167, ""), ("Wallaceburg", 42.6000, -82.3833, ""), ("Tilbury", 42.2667, -82.4333, ""),
    ("Petrolia", 42.8833, -82.1500, ""), ("Forest", 43.1000, -82.0000, ""), ("Peterborough", 44.3091, -78.3197, "S"),
]


def pip(pt, ring):
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def in_feature(pt, geom):
    for poly in geom["coordinates"]:
        if pip(pt, poly[0]) and not any(pip(pt, h) for h in poly[1:]):
            return True
    return False


def dist_to_feature(pt, geom):
    best = math.inf
    for poly in geom["coordinates"]:
        for ring in poly:
            for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
                dx, dy = x2 - x1, y2 - y1
                t = 0 if dx == dy == 0 else max(0, min(1, ((pt[0] - x1) * dx + (pt[1] - y1) * dy) / (dx * dx + dy * dy)))
                best = min(best, math.hypot(pt[0] - (x1 + t * dx), pt[1] - (y1 + t * dy)))
    return best


def main():
    gj = json.loads((ROOT / "data" / "phu_boundaries.geojson").read_text("utf-8"))
    out, seen, edge = [], set(), []
    for name, lat, lon, flags in CITIES:
        if name in seen:
            continue
        seen.add(name)
        pt = (lon, lat)
        hit = [f for f in gj["features"] if in_feature(pt, f["geometry"])]
        if hit:
            f = hit[0]
        else:  # on the simplified edge of a unit: use the closest unit, and report it
            f = min(gj["features"], key=lambda g: dist_to_feature(pt, g["geometry"]))
            edge.append((name, f["properties"]["name"], round(dist_to_feature(pt, f["geometry"]), 3)))
        row = {"name": name, "lat": lat, "lon": lon, "phu": f["properties"]["id"]}
        if flags:
            row["label"] = flags
        out.append(row)
    out.sort(key=lambda r: r["name"])
    path = ROOT / "data" / "cities.json"
    path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print("Wrote %s (%d places, %.1f KB)" % (path, len(out), path.stat().st_size / 1024))
    for e in edge:
        print("  nearest-unit fallback: %s -> %s (%.3f deg away)" % e)
    names = {f["properties"]["id"]: f["properties"]["name"] for f in gj["features"]}
    for r in out:
        print("%-20s %s" % (r["name"], names[r["phu"]]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
