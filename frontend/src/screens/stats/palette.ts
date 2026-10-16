/** Chart colours for the statistics screen (dark surface). Validated with the dataviz checks:
 *  carto/bio pass lightness band, chroma floor, CVD ΔE 16 and normal-vision ΔE 17 on #111113. */
export const VIZ = {
  surface: '#111113',
  carto: '#0b9bdc',
  bio: '#0ea371',
  /** Credits in total (carto + bio): a neutral light ink, not a series hue. */
  total: '#d4d4d8',
  /** Travel and scanning activity: the app accent. */
  activity: '#0b9bdc',
  cartoTrack: 'rgba(11, 155, 220, 0.16)',
  bioTrack: 'rgba(14, 163, 113, 0.16)',
  empty: '#27272a',
} as const
