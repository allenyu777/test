import { useState } from 'preact/hooks'
import type { BookMeta } from '../db'
import { formatListen, listenStats, summarize } from '../stats'
import { useStore } from '../store'
import { IconChevronRight } from './icons'
import { Sheet } from './Sheet'

/** 书架上的一行：今天、本周听了多久、连续几天，点开看详细统计 */
export function StatsCard({ books }: { books: BookMeta[] }) {
  const stats = useStore(listenStats, s => s)
  const [open, setOpen] = useState(false)
  const sum = summarize(stats)
  if (!sum.total && !books.length) return null
  return (
    <>
      <button class="stats-card" onClick={() => setOpen(true)}>
        <span>
          今天 <b>{formatListen(sum.today)}</b>
        </span>
        <span>
          本周 <b>{formatListen(sum.week)}</b>
        </span>
        {sum.streak > 1 && (
          <span>
            连续 <b>{sum.streak}</b> 天
          </span>
        )}
        <IconChevronRight size={16} />
      </button>
      {open && <StatsSheet books={books} onClose={() => setOpen(false)} />}
    </>
  )
}

export function StatsSheet({ books, onClose }: { books: BookMeta[]; onClose: () => void }) {
  const stats = useStore(listenStats, s => s)
  const sum = summarize(stats)
  const max = Math.max(60, ...sum.last7.map(d => d.seconds))
  const finished = books.filter(b => b.percent >= 99).length
  const titles = new Map(books.map(b => [b.id, b.title]))
  const top = Object.entries(stats.books)
    .filter(([id, s]) => titles.has(id) && s >= 60)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  return (
    <Sheet title="听书统计" onClose={onClose}>
      <div class="stats-grid">
        <div>
          <b>{formatListen(sum.today)}</b>
          <span>今天</span>
        </div>
        <div>
          <b>{formatListen(sum.week)}</b>
          <span>最近 7 天</span>
        </div>
        <div>
          <b>{formatListen(sum.total)}</b>
          <span>累计</span>
        </div>
        <div>
          <b>{sum.streak} 天</b>
          <span>连续收听</span>
        </div>
        <div>
          <b>{finished} 本</b>
          <span>已听完</span>
        </div>
      </div>
      <div class="section-title" style={{ marginTop: '18px' }}>
        最近 7 天
      </div>
      <div class="stats-bars" role="img" aria-label="最近 7 天每天收听时长">
        {sum.last7.map(d => (
          <div key={d.day} class="stats-bar">
            <span class="v">{d.seconds >= 60 ? Math.round(d.seconds / 60) : ''}</span>
            <div class="bar" style={{ height: `${Math.max(2, (d.seconds / max) * 100)}%` }} />
            <span class="l">{d.label}</span>
          </div>
        ))}
      </div>
      <div class="hint" style={{ textAlign: 'center', marginTop: '4px' }}>
        单位：分钟
      </div>
      {top.length > 0 && (
        <>
          <div class="section-title" style={{ marginTop: '18px' }}>
            听得最多的书
          </div>
          <div class="stats-books">
            {top.map(([id, s]) => (
              <div key={id}>
                <span class="t">{titles.get(id)}</span>
                <span class="muted">{formatListen(s)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div class="hint" style={{ marginTop: '16px' }}>
        只统计真正在朗读的时间，数据保存在这台设备上，「完整备份」时会一起备份。
      </div>
    </Sheet>
  )
}
