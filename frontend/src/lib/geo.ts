// Great-circle helpers for planetary surfaces. Latitude/longitude in degrees,
// distances in metres, bearings in degrees clockwise from north (like Status.json Heading).

const RAD = Math.PI / 180

export interface LatLon {
  lat: number
  lon: number
}

/** Haversine distance between two surface points on a sphere of `radiusM`. */
export function haversineM(a: LatLon, b: LatLon, radiusM: number): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLon = (b.lon - a.lon) * RAD
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * radiusM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial bearing from `a` to `b`, 0..360. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = a.lat * RAD
  const lat2 = b.lat * RAD
  const dLon = (b.lon - a.lon) * RAD
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) / RAD + 360) % 360
}

/** Point `b` relative to `a` on a local north-up plane: east/north offsets in metres. */
export function localOffset(
  a: LatLon,
  b: LatLon,
  radiusM: number,
): { east: number; north: number; distance: number } {
  const distance = haversineM(a, b, radiusM)
  const brg = bearingDeg(a, b) * RAD
  return { east: distance * Math.sin(brg), north: distance * Math.cos(brg), distance }
}

/** Inverse of localOffset for small offsets: move `east`/`north` metres from `origin`. */
export function offsetLatLon(origin: LatLon, east: number, north: number, radiusM: number): LatLon {
  const lat = origin.lat + (north / radiusM) / RAD
  const lon = origin.lon + (east / (radiusM * Math.cos(origin.lat * RAD))) / RAD
  return { lat, lon }
}
