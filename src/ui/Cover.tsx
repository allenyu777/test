import type { BookMeta } from '../db'
import { coverUrl } from '../library'
import { IconHeadphones } from './icons'

const PALETTES = [
  ['#c2410c', '#f59e4b'],
  ['#1e3a5f', '#4f7cac'],
  ['#2f5d50', '#6aa88e'],
  ['#5b2a86', '#9d6ad8'],
  ['#7a2e2e', '#c96b5b'],
  ['#334155', '#64748b'],
  ['#8a5a00', '#d6a542'],
  ['#0f5257', '#3fa7a3'],
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function Cover({ meta, playing, badge }: { meta: BookMeta; playing?: boolean; badge?: string }) {
  const url = coverUrl(meta)
  const [a, b] = PALETTES[hash(meta.title) % PALETTES.length]
  return (
    <div class="cover">
      {url ? (
        <img src={url} alt="" loading="lazy" decoding="async" />
      ) : (
        <div class="gen" style={{ background: `linear-gradient(150deg, ${b}, ${a})` }}>
          <div class="gen-title">{meta.title}</div>
          <div class="gen-author">{meta.author}</div>
          <div class="gen-fmt">{meta.format}</div>
        </div>
      )}
      {badge && <span class="badge">{badge}</span>}
      {playing && (
        <span class="playing-dot">
          <IconHeadphones size={13} />
        </span>
      )}
    </div>
  )
}
