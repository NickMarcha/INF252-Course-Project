"""
Elevation utilities for reading Oslo DOM1 GeoTIFF height data.
Supports point sampling (lat/lon → elevation) and grid-based lookup from a
pre-computed downsampled grid.
"""

from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from pyproj import Transformer


# Reusable transformer: WGS84 (lat/lon) → UTM Zone 33N
_to_utm = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True)


def latlon_to_utm(lat: float, lon: float) -> tuple[float, float]:
    """Convert WGS84 (lat, lon) to UTM33N (easting, northing)."""
    easting, northing = _to_utm.transform(lon, lat)
    return easting, northing


def build_tile_index(dom1_dir: str | Path) -> list[dict]:
    """
    Parse .tfw world files in dom1_dir/data/ to build a tile index.
    Returns list of dicts with keys: path, x_origin, y_origin, pixel_size,
    nrows, ncols, x_max, y_min.
    """
    data_dir = Path(dom1_dir) / "data"
    tiles = []
    for tfw in sorted(data_dir.glob("*.tfw")):
        lines = tfw.read_text().strip().split("\n")
        pixel_size_x = float(lines[0])
        pixel_size_y = float(lines[3])  # negative
        x_origin = float(lines[4])  # upper-left pixel center
        y_origin = float(lines[5])  # upper-left pixel center

        tif_path = tfw.with_suffix(".tif")
        if not tif_path.exists():
            continue

        # Get actual dimensions from rasterio (avoids hardcoding 15010)
        with rasterio.open(tif_path) as ds:
            ncols, nrows = ds.width, ds.height

        # Tile covers from upper-left corner to lower-right corner
        # Origin is center of upper-left pixel; edge is half a pixel out
        x_min = x_origin - pixel_size_x / 2
        y_max = y_origin - pixel_size_y / 2  # pixel_size_y is negative, so this adds
        x_max = x_min + ncols * pixel_size_x
        y_min = y_max + nrows * pixel_size_y  # pixel_size_y negative

        tiles.append({
            "path": tif_path,
            "x_origin": x_origin,
            "y_origin": y_origin,
            "pixel_size_x": pixel_size_x,
            "pixel_size_y": pixel_size_y,
            "nrows": nrows,
            "ncols": ncols,
            "x_min": x_min,
            "x_max": x_max,
            "y_min": y_min,
            "y_max": y_max,
        })
    return tiles


def _find_tile(easting: float, northing: float, tile_index: list[dict]) -> dict | None:
    """Find which tile contains the given UTM coordinate."""
    for tile in tile_index:
        if tile["x_min"] <= easting <= tile["x_max"] and tile["y_min"] <= northing <= tile["y_max"]:
            return tile
    return None


def sample_elevation(lat: float, lon: float, tile_index: list[dict]) -> float | None:
    """
    Get elevation (meters) for a WGS84 point from the DOM1 GeoTIFF tiles.
    Returns None if the point is outside the covered area or on a nodata pixel.
    """
    easting, northing = latlon_to_utm(lat, lon)
    tile = _find_tile(easting, northing, tile_index)
    if tile is None:
        return None

    col = int((easting - tile["x_origin"]) / tile["pixel_size_x"] + 0.5)
    row = int((northing - tile["y_origin"]) / tile["pixel_size_y"] + 0.5)

    if not (0 <= col < tile["ncols"] and 0 <= row < tile["nrows"]):
        return None

    with rasterio.open(tile["path"]) as ds:
        window = Window(col, row, 1, 1)
        data = ds.read(1, window=window)
        val = float(data[0, 0])
        if ds.nodata is not None and val == ds.nodata:
            return None
        return round(val, 1)


def sample_elevations_bulk(
    eastings: np.ndarray,
    northings: np.ndarray,
    tile_index: list[dict],
) -> np.ndarray:
    """
    Sample elevation for arrays of UTM coordinates. Returns array of heights
    with NaN for points outside coverage or on nodata pixels.
    Much more efficient than calling sample_elevation() in a loop.
    """
    result = np.full(len(eastings), np.nan)

    for tile in tile_index:
        # Find points in this tile
        mask = (
            (eastings >= tile["x_min"]) & (eastings <= tile["x_max"]) &
            (northings >= tile["y_min"]) & (northings <= tile["y_max"])
        )
        if not mask.any():
            continue

        cols = ((eastings[mask] - tile["x_origin"]) / tile["pixel_size_x"] + 0.5).astype(int)
        rows = ((northings[mask] - tile["y_origin"]) / tile["pixel_size_y"] + 0.5).astype(int)

        valid = (cols >= 0) & (cols < tile["ncols"]) & (rows >= 0) & (rows < tile["nrows"])
        if not valid.any():
            continue

        with rasterio.open(tile["path"]) as ds:
            # Read the bounding window for all points in this tile
            col_min, col_max = int(cols[valid].min()), int(cols[valid].max())
            row_min, row_max = int(rows[valid].min()), int(rows[valid].max())
            window = Window(col_min, row_min, col_max - col_min + 1, row_max - row_min + 1)
            data = ds.read(1, window=window)

            local_cols = cols[valid] - col_min
            local_rows = rows[valid] - row_min
            vals = data[local_rows, local_cols]

            if ds.nodata is not None:
                vals = np.where(vals == ds.nodata, np.nan, vals)

            # Write back into result
            idx = np.where(mask)[0][valid]
            result[idx] = vals

    return result


def lookup_elevation_from_grid(lat: float, lon: float, grid_data: dict) -> float | None:
    """
    Look up elevation from a pre-computed downsampled grid (as loaded from
    elevation_grid.json). Returns None if point is outside the grid.
    """
    easting, northing = latlon_to_utm(lat, lon)
    origin_e = grid_data["origin_easting"]
    origin_n = grid_data["origin_northing"]
    cell_size = grid_data["cell_size_m"]
    nrows = grid_data["nrows"]
    ncols = grid_data["ncols"]

    col = int((easting - origin_e) / cell_size)
    row = int((origin_n - northing) / cell_size)

    if not (0 <= col < ncols and 0 <= row < nrows):
        return None

    val = grid_data["heights"][row][col]
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    return val
