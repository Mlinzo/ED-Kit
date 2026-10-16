// Tiny stylised SVG glyphs for notable finds: lit spheres, banded giants, glowing stars.
// Drawn, not pictures — simple shapes with a soft light from the upper left.

import { useId, type ReactNode } from 'react'

interface Sphere {
  base: string
  light: string
  dark: string
}

const PLANETS: Record<string, Sphere> = {
  elw: { base: '#2f7fd1', light: '#8fd3a8', dark: '#0c2b57' },
  ww: { base: '#1d5fd6', light: '#7cb6ff', dark: '#081d4f' },
  aw: { base: '#b8925a', light: '#ecd2a0', dark: '#4a3519' },
  terraformable: { base: '#b07a52', light: '#e9c08f', dark: '#3f2614' },
  landable_atmo: { base: '#8f8a83', light: '#d9d3c9', dark: '#2c2a27' },
  ringed: { base: '#c99a6b', light: '#f1d6b0', dark: '#4a3320' },
  gg_water_life: { base: '#8fb3d6', light: '#e3f0fb', dark: '#2a4560' },
  gg_ammonia_life: { base: '#d39a62', light: '#f6dcb6', dark: '#5a361a' },
}

const STARS: Record<string, { core: string; glow: string; r: number }> = {
  white_dwarf: { core: '#ffffff', glow: '#cfe2ff', r: 4 },
  blue_star: { core: '#e8f0ff', glow: '#7fa6ff', r: 9 },
  giant: { core: '#ffd6a0', glow: '#ff8a3d', r: 15 },
  carbon: { core: '#ffb08a', glow: '#e0452b', r: 10 },
  wolf_rayet: { core: '#f4ecff', glow: '#9b7bff', r: 8 },
}

function LitSphere({ id, s, r = 15, cx = 24, cy = 24, children }: { id: string; s: Sphere; r?: number; cx?: number; cy?: number; children?: ReactNode }) {
  return (
    <>
      <defs>
        <radialGradient id={`${id}-sph`} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor={s.light} />
          <stop offset="45%" stopColor={s.base} />
          <stop offset="100%" stopColor={s.dark} />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-sph)`} />
      <g clipPath={`url(#${id}-clip)`}>{children}</g>
    </>
  )
}

function Bands({ id, color, cx = 24, cy = 24, r = 15 }: { id: string; color: string; cx?: number; cy?: number; r?: number }) {
  const ys = [-9, -4, 1, 6, 10]
  return (
    <g opacity={0.55}>
      {ys.map((dy, i) => (
        <ellipse key={i} cx={cx} cy={cy + dy} rx={r + 2} ry={i % 2 ? 1.6 : 1.1} fill={color} transform={`rotate(-12 ${cx} ${cy})`} />
      ))}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-sph)`} opacity={0.35} />
    </g>
  )
}

function Glow({ id, color, r }: { id: string; color: string; r: number }) {
  return (
    <>
      <defs>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0%" stopColor={color} stopOpacity={0.75} />
          <stop offset="40%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={24} cy={24} r={r} fill={`url(#${id}-glow)`} />
    </>
  )
}

export function NotableGlyph({ kind, dim = false, size = 44 }: { kind: string; dim?: boolean; size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  let body: ReactNode

  if (kind === 'black_hole') {
    body = (
      <>
        <defs>
          <linearGradient id={`${id}-disk`} x1="0" x2="1">
            <stop offset="0%" stopColor="#ff9a3c" stopOpacity={0.2} />
            <stop offset="50%" stopColor="#ffd08a" />
            <stop offset="100%" stopColor="#ff7a2a" stopOpacity={0.2} />
          </linearGradient>
        </defs>
        <Glow id={id} color="#ff8a3d" r={22} />
        <ellipse cx={24} cy={24} rx={20} ry={5.5} fill="none" stroke={`url(#${id}-disk)`} strokeWidth={2.5} transform="rotate(-14 24 24)" />
        <circle cx={24} cy={24} r={8} fill="#020203" stroke="#ffb469" strokeOpacity={0.6} strokeWidth={1} />
        <path d="M5 28.5 Q24 21 43 19.5" fill="none" stroke={`url(#${id}-disk)`} strokeWidth={2.5} transform="rotate(-14 24 24)" opacity={0.9} />
      </>
    )
  } else if (kind === 'neutron') {
    body = (
      <>
        <defs>
          <linearGradient id={`${id}-jet`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#9fd0ff" stopOpacity={0} />
            <stop offset="50%" stopColor="#d9ecff" />
            <stop offset="100%" stopColor="#9fd0ff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Glow id={id} color="#7cc4ff" r={16} />
        <path d="M22.6 2 L25.4 2 L24.6 46 L23.4 46 Z" fill={`url(#${id}-jet)`} transform="rotate(18 24 24)" />
        <circle cx={24} cy={24} r={3.6} fill="#ffffff" />
      </>
    )
  } else if (kind in STARS) {
    const s = STARS[kind]
    body = (
      <>
        <Glow id={id} color={s.glow} r={Math.min(23, s.r * 2.4 + 4)} />
        <defs>
          <radialGradient id={`${id}-core`} cx="40%" cy="38%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor={s.core} />
            <stop offset="100%" stopColor={s.glow} />
          </radialGradient>
        </defs>
        {kind === 'wolf_rayet' && (
          <g stroke="#c9b6ff" strokeOpacity={0.55} strokeWidth={1.2} strokeLinecap="round">
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i * Math.PI) / 4 + 0.3
              return <line key={i} x1={24 + Math.cos(a) * 11} y1={24 + Math.sin(a) * 11} x2={24 + Math.cos(a) * (i % 2 ? 17 : 21)} y2={24 + Math.sin(a) * (i % 2 ? 17 : 21)} />
            })}
          </g>
        )}
        <circle cx={24} cy={24} r={s.r} fill={`url(#${id}-core)`} />
      </>
    )
  } else if (kind === 'ringed') {
    const s = PLANETS.ringed
    body = (
      <>
        <ellipse cx={24} cy={24} rx={22} ry={6.5} fill="none" stroke="#e8cfa6" strokeOpacity={0.35} strokeWidth={3} transform="rotate(-18 24 24)" />
        <LitSphere id={id} s={s} r={12} />
        {/* front half of the ring over the planet */}
        <path d="M2 24 A22 6.5 0 0 0 46 24" fill="none" stroke="#f1dcb8" strokeOpacity={0.8} strokeWidth={2} transform="rotate(-18 24 24)" />
      </>
    )
  } else if (kind === 'gg_water_life' || kind === 'gg_ammonia_life') {
    const s = PLANETS[kind]
    body = (
      <LitSphere id={id} s={s} r={17}>
        <Bands id={id} color={kind === 'gg_water_life' ? '#ffffff' : '#7a4a22'} r={17} />
        <circle cx={31} cy={17} r={2.2} fill="#5eead4" opacity={0.9} />
      </LitSphere>
    )
  } else if (kind in PLANETS) {
    const s = PLANETS[kind]
    const halo = kind === 'landable_atmo' ? '#f2c38b' : kind === 'elw' ? '#9ecbff' : kind === 'ww' ? '#8fbaff' : kind === 'aw' ? '#f0d8a8' : null
    body = (
      <>
        {halo && <circle cx={24} cy={24} r={17} fill="none" stroke={halo} strokeOpacity={kind === 'landable_atmo' ? 0.55 : 0.35} strokeWidth={kind === 'landable_atmo' ? 3 : 1.5} />}
        <LitSphere id={id} s={s}>
          {kind === 'elw' && (
            <g fill="#3f9d5a" opacity={0.85}>
              <path d="M14 18 q4 -5 9 -2 q2 3 -2 5 q-3 1 -2 5 q-3 2 -5 -1 q-2 -3 0 -7z" />
              <path d="M27 27 q5 -2 8 2 q0 4 -4 6 q-4 0 -5 -3z" />
            </g>
          )}
          {kind === 'terraformable' && (
            <path d="M9 30 q8 -4 15 -1 t16 -2 v14 h-31z" fill="#4ade80" opacity={0.45} />
          )}
          {kind === 'ww' && <ellipse cx={20} cy={16} rx={7} ry={2} fill="#ffffff" opacity={0.25} transform="rotate(-15 20 16)" />}
        </LitSphere>
      </>
    )
  } else {
    body = <circle cx={24} cy={24} r={12} fill="#52525b" />
  }

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={`shrink-0 overflow-visible transition-[filter,opacity] ${dim ? 'opacity-30 grayscale' : ''}`}
      aria-hidden
    >
      {body}
    </svg>
  )
}
