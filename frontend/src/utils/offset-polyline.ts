/**
 * Offset polyline points perpendicular to the path.
 * At ~60°N: 1 deg lat ≈ 111 km, 1 deg lon ≈ 55 km.
 * offsetMeters ~15 gives ~15 m perpendicular offset.
 */
export function offsetPolyline(
  points: [number, number][],
  offsetMeters: number
): [number, number][] {
  if (points.length < 2) return points.map((p) => [...p] as [number, number]);

  const LAT_M_PER_DEG = 111_000;
  const LNG_M_PER_DEG = 55_000; // ~60°N

  const offsetDeg = offsetMeters / Math.min(LAT_M_PER_DEG, LNG_M_PER_DEG);
  const result: [number, number][] = [];

  for (let i = 0; i < points.length; i++) {
    let dx: number;
    let dy: number;

    if (i === 0) {
      dx = points[1][1] - points[0][1];
      dy = points[1][0] - points[0][0];
    } else if (i === points.length - 1) {
      dx = points[i][1] - points[i - 1][1];
      dy = points[i][0] - points[i - 1][0];
    } else {
      dx = points[i + 1][1] - points[i - 1][1];
      dy = points[i + 1][0] - points[i - 1][0];
    }

    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const perpLat = (-dx / len) * offsetDeg;
    const perpLng = (dy / len) * offsetDeg;

    result.push([
      points[i][0] + perpLat,
      points[i][1] + perpLng,
    ]);
  }
  return result;
}
