"""
Region assignment utilities for Oslo bydeler (districts) and delbydeler (sub-districts).
Loads GeoJSON in EPSG:3857, converts to WGS84, and assigns regions to stations via point-in-polygon.
"""

from pathlib import Path
import json
from typing import Any

from pyproj import Transformer
from shapely.geometry import Point, shape


def load_geojson_wgs84(path: Path) -> dict[str, Any]:
    """
    Load GeoJSON and convert coordinates from EPSG:3857 (Web Mercator) to EPSG:4326 (WGS84).
    Returns the GeoJSON dict with coordinates in WGS84.
    """
    with open(path, encoding="utf-8") as f:
        geojson = json.load(f)

    crs = geojson.get("crs", {})
    if isinstance(crs, dict) and crs.get("properties", {}).get("name") == "EPSG:3857":
        transformer = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)

        def transform_coords(coords: list) -> list:
            if isinstance(coords[0], (int, float)):
                # Single point [x, y] in 3857 (x=easting, y=northing)
                # transformer returns (lon, lat) for 3857->4326
                lon, lat = transformer.transform(coords[0], coords[1])
                return [lon, lat]  # GeoJSON: [longitude, latitude]
            return [transform_coords(ring) for ring in coords]

        for feature in geojson.get("features", []):
            geom = feature.get("geometry")
            if geom and geom.get("type") == "Polygon" and "coordinates" in geom:
                geom["coordinates"] = transform_coords(geom["coordinates"])

        if "crs" in geojson:
            del geojson["crs"]

    return geojson


def assign_regions(
    stations: list[dict[str, Any]],
    bydeler_path: Path,
    delbydeler_path: Path,
) -> list[dict[str, Any]]:
    """
    Assign bydel and delbydel to each station via point-in-polygon.
    Stations must have 'lat' and 'lon' keys (WGS84).
    Returns stations with 'bydel' and 'delbydel' added (or None if no match).
    """
    bydeler = load_geojson_wgs84(bydeler_path)
    delbydeler = load_geojson_wgs84(delbydeler_path)

    delbydel_polygons = []
    for feat in delbydeler.get("features", []):
        geom = feat.get("geometry")
        props = feat.get("properties", {})
        if geom and props:
            poly = shape(geom)
            delbydel_polygons.append((poly, props.get("BYDELSNAVN"), props.get("DELBYDELSN")))

    bydel_polygons = []
    for feat in bydeler.get("features", []):
        geom = feat.get("geometry")
        props = feat.get("properties", {})
        if geom and props:
            poly = shape(geom)
            bydel_polygons.append((poly, props.get("BYDELSNAVN")))

    result = []
    for s in stations:
        lat = s.get("lat")
        lon = s.get("lon")
        bydel = None
        delbydel = None

        if lat is not None and lon is not None:
            point = Point(lon, lat)

            for poly, parent_bydel, sub_name in delbydel_polygons:
                if point.within(poly):
                    bydel = parent_bydel
                    delbydel = sub_name
                    break

            if bydel is None:
                for poly, name in bydel_polygons:
                    if point.within(poly):
                        bydel = name
                        break

        out = dict(s)
        out["bydel"] = bydel
        out["delbydel"] = delbydel
        result.append(out)

    return result
