import { useState } from 'preact/hooks'
import type { Book } from '../core/book'
import { estimateSeconds, formatDuration } from '../core/text'
import { player } from '../player'
import { useStore } from '../store'
import { voiceLabel } from '../tts/voices'
import {
  IconBack15,
  IconFwd15,
  IconMic,
  IconMoon,
  IconNextChapter,
  IconPause,
  IconPen,
  IconPlay,
  IconPrevChapter,
  IconSkipPara,
  IconVoice,
} from './icons'

export type ToolSheet = 'speed' | 'voice' | 'timer'

interface Props {
  book: Book
  lang: string
  onSheet: (sheet: ToolSheet) => void
  onNote: (voice: boolean) => void
  onPlayFrom: () => void
}

export function PlayerBar({ book, lang, onSheet, onNote, onPlayFrom }: Props) {
  const status = useStore(player.store, s => s.status)
  const loading = useStore(player.store, s => s.loading)
  const pos = useStore(player.store, s => s.pos)
  const rate = useStore(player.store, s => s.rate)
  const voice = useStore(player.store, s => s.voice)
  const sleep = useStore(player.store, s => s.sleep)
  const percent = useStore(player.store, s => s.percent)
  const chapter = useStore(player.store, s => s.chapter)
  const [drag, setDrag] = useState<number | null>(null)

  const range = book.chapterRange(pos.b)
  const total = Math.max(1, book.charsBetween(range.start, range.end))
  const done = Math.min(total, book.charsBetween(range.start, pos.b) + pos.o)
  const value = drag ?? Math.round((done / total) * 1000)
  const remaining = estimateSeconds(total - (drag != null ? (drag / 1000) * total : done), lang, rate)

  const seekTo = (v: number) => {
    const target = book.cum[range.start] + (v / 1000) * total
    player.seek(book.posAtChar(Math.min(target, book.cum[range.end] - 1)))
    setDrag(null)
  }

  const playing = status === 'playing'
  const sleepLabel =
    sleep.mode === 'chapter' ? '本章' : sleep.mode === 'minutes' && sleep.endsAt ? `${Math.max(1, Math.round((sleep.endsAt - Date.now()) / 60000))}分` : '定时'

  return (
    <div class="player-bar">
      <div class="player-inner">
        <div class="player-meta">
          <span>
            {chapter || '正文'} · 剩余约 {formatDuration(remaining)}
          </span>
          <span>全书 {percent.toFixed(1)}%</span>
        </div>
        <input
          class="range"
          type="range"
          min={0}
          max={1000}
          value={value}
          aria-label="本章进度"
          onInput={e => setDrag(Number((e.target as HTMLInputElement).value))}
          onChange={e => seekTo(Number((e.target as HTMLInputElement).value))}
          onTouchEnd={() => setTimeout(() => setDrag(null), 0)}
          onPointerUp={() => setTimeout(() => setDrag(null), 0)}
          onBlur={() => setDrag(null)}
        />
        <div class="player-controls">
          <button class="icon-btn" onClick={() => player.skipChapter(-1)} aria-label="上一章">
            <IconPrevChapter size={22} />
          </button>
          <button class="icon-btn" onClick={() => player.skip(-1)} aria-label="上一句">
            <IconBack15 size={24} />
          </button>
          <button
            class="main"
            onClick={() => (playing ? player.pause() : onPlayFrom())}
            aria-label={playing ? '暂停' : '播放'}
          >
            {loading ? <div class="spinner" /> : playing ? <IconPause size={28} /> : <IconPlay size={28} />}
          </button>
          <button class="icon-btn" onClick={() => player.skip(1)} aria-label="下一句">
            <IconFwd15 size={24} />
          </button>
          <button class="icon-btn" onClick={() => player.skipChapter(1)} aria-label="下一章">
            <IconNextChapter size={22} />
          </button>
        </div>
        <div class="player-tools">
          <button class="tool" onClick={() => onSheet('speed')}>
            <b>{rate.toFixed(2).replace(/\.?0+$/, '')}×</b>
            <span>语速</span>
          </button>
          <button class="tool" onClick={() => onSheet('voice')}>
            <IconVoice size={22} />
            <span>{voiceLabel(voice)}</span>
          </button>
          <button class={`tool ${sleep.mode !== 'off' ? 'active' : ''}`} onClick={() => onSheet('timer')}>
            <IconMoon size={22} />
            <span>{sleepLabel}</span>
          </button>
          <button class="tool" onClick={() => player.skipParagraph()}>
            <IconSkipPara size={22} />
            <span>跳过本段</span>
          </button>
          <button class="tool" onClick={() => onNote(true)}>
            <IconMic size={22} />
            <span>语音笔记</span>
          </button>
          <button class="tool" onClick={() => onNote(false)}>
            <IconPen size={22} />
            <span>写笔记</span>
          </button>
        </div>
      </div>
    </div>
  )
}
