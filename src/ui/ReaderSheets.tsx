import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Book } from '../core/book'
import { baseLang } from '../core/text'
import type { BookMeta } from '../db'
import { player } from '../player'
import { engineReady, settings, updateSettings, type EngineId, type FontFamily, type Theme, type VoiceChoice } from '../settings'
import { useStore } from '../store'
import { makeWav } from '../tts/audio'
import { azureProvider, fetchAzureVoices, openaiProvider } from '../tts/cloud'
import {
  AZURE_VOICES,
  ENGINE_LABELS,
  OPENAI_VOICES,
  langLabel,
  loadSystemVoices,
  onVoicesChanged,
  systemVoiceOptions,
  systemVoices,
  type VoiceOption,
} from '../tts/voices'
import { IconCheck, IconPlay, IconRefresh, IconStop } from './icons'
import { navigate } from './router'
import { Sheet, Switch } from './Sheet'
import { toast } from './toast'

/* ---------- 目录 ---------- */
export function TocSheet({
  book,
  onClose,
  onJump,
}: {
  book: Book
  onClose: () => void
  /** fromStart：从这一章开头读（否则读过一部分的章节接着上次的位置读） */
  onJump: (b: number, fromStart?: boolean) => void
}) {
  const pos = useStore(player.store, s => s.pos)
  const current = book.tocIndex(pos.b)
  const listRef = useRef<HTMLDivElement>(null)
  // 每一章上次读到的位置
  const resumes = useMemo(() => book.toc.map(t => player.chapterResume(t.b)), [book])
  useLayoutEffect(() => {
    listRef.current?.querySelector('.current')?.scrollIntoView({ block: 'center' })
  }, [])
  return (
    <Sheet title={`目录 · ${book.toc.length}`} onClose={onClose}>
      {!book.toc.length && <div class="muted">这本书没有目录</div>}
      {resumes.some(Boolean) && <div class="hint small">读过一部分的章节，点一下会接着上次的位置读；点「从头」从这一章开头读。</div>}
      <div ref={listRef}>
        {book.toc.map((t, i) => {
          const resume = resumes[i]
          return (
            <div class="toc-row" key={i}>
              <button
                class={`toc-item ${i === current ? 'current' : t.b < pos.b ? 'read' : ''}`}
                style={{ paddingLeft: `${8 + Math.min(t.level, 4) * 18}px` }}
                onClick={() => onJump(t.b)}
              >
                <span>{t.title}</span>
                {resume ? (
                  <span class="pct resume">读到 {Math.floor(player.chapterPercent(resume))}%</span>
                ) : (
                  <span class="pct">{Math.floor(book.percent({ b: t.b, o: 0 }))}%</span>
                )}
              </button>
              {resume && (
                <button class="toc-restart" onClick={() => onJump(t.b, true)} aria-label={`从头读 ${t.title}`}>
                  从头
                </button>
              )}
            </div>
          )
        })}
      </div>
    </Sheet>
  )
}

/* ---------- 显示设置 ---------- */
const THEMES: [Theme, string, string][] = [
  ['auto', '跟随系统', 'linear-gradient(135deg,#f7f5f0 50%,#121212 50%)'],
  ['light', '浅色', '#f7f5f0'],
  ['sepia', '羊皮纸', '#f3e9d2'],
  ['green', '护眼绿', '#dcebd3'],
  ['dark', '深色', '#121212'],
]

const FONTS: [FontFamily, string][] = [
  ['sans', '苹方'],
  ['serif', '宋体'],
  ['kai', '楷体'],
]

export function DisplaySheet({ onClose }: { onClose: () => void }) {
  const s = useStore(settings, x => x)
  return (
    <Sheet title="显示" onClose={onClose}>
      <div class="field">
        <span class="label">字号 {s.fontSize}</span>
        <div class="speed-row">
          <button class="btn small" onClick={() => updateSettings({ fontSize: Math.max(14, s.fontSize - 1) })}>
            A-
          </button>
          <input
            class="range"
            type="range"
            min={14}
            max={32}
            step={1}
            value={s.fontSize}
            onInput={e => updateSettings({ fontSize: Number((e.target as HTMLInputElement).value) })}
          />
          <button class="btn small" onClick={() => updateSettings({ fontSize: Math.min(32, s.fontSize + 1) })}>
            A+
          </button>
        </div>
      </div>
      <div class="field">
        <span class="label">行距</span>
        <div class="chips">
          {(
            [
              [1.6, '紧凑'],
              [1.85, '标准'],
              [2.1, '宽松'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} class={`chip ${Math.abs(s.lineHeight - v) < 0.01 ? 'active' : ''}`} onClick={() => updateSettings({ lineHeight: v })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div class="field">
        <span class="label">字体</span>
        <div class="chips">
          {FONTS.map(([key, label]) => (
            <button key={key} class={`chip ${s.font === key ? 'active' : ''}`} onClick={() => updateSettings({ font: key })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div class="field">
        <span class="label">主题</span>
        <div class="chips">
          {THEMES.map(([key, label, swatch]) => (
            <button key={key} class={`chip ${s.theme === key ? 'active' : ''}`} onClick={() => updateSettings({ theme: key })}>
              <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: swatch, border: '1px solid var(--border)' }} />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div class="group" style={{ marginTop: '8px' }}>
        <div class="row">
          <div class="row-body">
            <div class="row-title">朗读时自动翻页跟随</div>
          </div>
          <Switch on={s.follow} onChange={v => updateSettings({ follow: v })} />
        </div>
      </div>
    </Sheet>
  )
}

/* ---------- 语速 ---------- */
const SPEEDS = [0.75, 0.9, 1, 1.15, 1.25, 1.5, 1.75, 2, 2.5, 3]

export function SpeedSheet({ onClose }: { onClose: () => void }) {
  const rate = useStore(player.store, s => s.rate)
  const engine = useStore(player.store, s => s.voice.engine)
  return (
    <Sheet title="语速" onClose={onClose}>
      <div class="speed-display">{rate.toFixed(2).replace(/0$/, '')}×</div>
      <div class="speed-row">
        <button class="btn small" onClick={() => player.setRate(rate - 0.05)}>
          −
        </button>
        <input
          class="range"
          type="range"
          min={0.5}
          max={3}
          step={0.05}
          value={rate}
          onChange={e => player.setRate(Number((e.target as HTMLInputElement).value))}
        />
        <button class="btn small" onClick={() => player.setRate(rate + 0.05)}>
          +
        </button>
      </div>
      <div class="chips" style={{ marginTop: '16px', justifyContent: 'center' }}>
        {SPEEDS.map(v => (
          <button key={v} class={`chip ${Math.abs(rate - v) < 0.001 ? 'active' : ''}`} onClick={() => player.setRate(v)}>
            {v}×
          </button>
        ))}
      </div>
      <div class="hint" style={{ marginTop: '18px' }}>
        {engine === 'system'
          ? '系统语音调速会从当前句重新开始朗读。不同声音在高倍速下的效果不同，可以多试几个。'
          : '云端语音调速即时生效，并保持音调不变。'}
        语速会分别记在每本书上。
      </div>
    </Sheet>
  )
}

/* ---------- 定时关闭 ---------- */
export function TimerSheet({ onClose }: { onClose: () => void }) {
  const sleep = useStore(player.store, s => s.sleep)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const remaining = sleep.mode === 'minutes' && sleep.endsAt ? Math.max(0, sleep.endsAt - Date.now()) : 0
  const pick = (mode: 'off' | 'minutes' | 'chapter', minutes = 0) => {
    player.setSleep(mode, minutes)
    if (mode !== 'off') toast(mode === 'chapter' ? '将在本章读完后暂停' : `${minutes} 分钟后暂停`)
    onClose()
  }
  return (
    <Sheet title="定时关闭" onClose={onClose}>
      {sleep.mode !== 'off' && (
        <div class="hint" style={{ textAlign: 'center', fontSize: '15px' }}>
          {sleep.mode === 'chapter' ? '本章读完后暂停' : `还剩 ${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`}
        </div>
      )}
      <div class="option-list">
        <button class="option" onClick={() => pick('off')}>
          不开启{sleep.mode === 'off' && <IconCheck class="check" size={20} />}
        </button>
        {[15, 30, 45, 60, 90].map(m => (
          <button key={m} class="option" onClick={() => pick('minutes', m)}>
            {m} 分钟{sleep.mode === 'minutes' && sleep.minutes === m && <IconCheck class="check" size={20} />}
          </button>
        ))}
        <button class="option" onClick={() => pick('chapter')}>
          读完本章{sleep.mode === 'chapter' && <IconCheck class="check" size={20} />}
        </button>
      </div>
    </Sheet>
  )
}

/* ---------- 声音 ---------- */
const SAMPLES: Record<string, string> = {
  zh: '你好，我是你的朗读助手。春眠不觉晓，处处闻啼鸟。',
  en: 'Hello, I will read this book for you. It was a bright cold day in April.',
  ja: 'こんにちは。この本を読み上げます。',
}

let previewAudio: HTMLAudioElement | null = null

let silentUrl: string | null = null

function stopPreview() {
  previewAudio?.pause()
  if (typeof speechSynthesis !== 'undefined' && player.state.status !== 'playing') speechSynthesis.cancel()
}

export function VoiceSheet({ meta, onClose }: { meta: BookMeta; onClose: () => void }) {
  const current = useStore(player.store, s => s.voice)
  const s = useStore(settings, x => x)
  const [tab, setTab] = useState<EngineId>(current.engine)
  const [allLangs, setAllLangs] = useState(false)
  const [voicesVersion, setVoicesVersion] = useState(0)
  const [azureAll, setAzureAll] = useState<VoiceOption[] | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [custom, setCustom] = useState(current.engine === 'openai' ? current.id : '')
  const lang = baseLang(meta.lang) || 'zh'

  useEffect(() => {
    loadSystemVoices().then(() => setVoicesVersion(v => v + 1))
    const off = onVoicesChanged(() => setVoicesVersion(v => v + 1))
    return () => {
      off()
      stopPreview()
    }
  }, [])

  const refreshVoices = async () => {
    const before = systemVoices().map(v => v.voiceURI).join('|')
    const list = await loadSystemVoices()
    setVoicesVersion(v => v + 1)
    const mine = systemVoiceOptions(lang)
    const good = mine.filter(v => v.quality === 'premium' || v.quality === 'enhanced').length
    const unchanged = list.map(v => v.voiceURI).join('|') === before
    toast(
      `找到 ${mine.length} 个${langLabel(lang)}声音，其中高品质 ${good} 个。` +
        (unchanged ? '\n列表没有变化：刚下载的声音要从后台完全关闭本 App 后重新打开才会出现，必要时重启手机。' : ''),
      'info',
      { duration: unchanged ? 9000 : 4000 },
    )
  }

  const systemList = useMemo(() => systemVoiceOptions(allLangs ? undefined : lang), [allLangs, lang, voicesVersion])
  const azureList = useMemo(() => {
    const list = azureAll ?? AZURE_VOICES
    return allLangs ? list : list.filter(v => baseLang(v.lang) === lang || (lang === 'zh' && /^zh/.test(v.lang)))
  }, [azureAll, allLangs, lang])

  const choose = (v: VoiceOption) => {
    const choice: VoiceChoice = { engine: v.engine, id: v.id, name: v.name, lang: v.lang }
    player.setVoice(choice)
  }

  const preview = async (v: VoiceOption) => {
    const key = `${v.engine}:${v.id}`
    if (previewing === key) {
      stopPreview()
      setPreviewing(null)
      return
    }
    if (player.state.status === 'playing') player.pause()
    stopPreview()
    const sample = SAMPLES[baseLang(v.lang) || lang] ?? SAMPLES[lang] ?? SAMPLES.zh
    setPreviewing(key)
    if (v.engine === 'system') {
      const u = new SpeechSynthesisUtterance(sample)
      const voice = speechSynthesis.getVoices().find(x => x.voiceURI === v.id || x.name === v.id)
      if (voice) {
        u.voice = voice
        u.lang = voice.lang
      }
      u.rate = player.state.rate
      u.onend = u.onerror = () => setPreviewing(p => (p === key ? null : p))
      speechSynthesis.cancel()
      speechSynthesis.speak(u)
      return
    }
    previewAudio ??= new Audio()
    const audio = previewAudio
    // 先在点击中解锁播放，再异步下载试听音频
    silentUrl ??= URL.createObjectURL(makeWav(0.2))
    audio.src = silentUrl
    audio.play().catch(() => {})
    try {
      const provider = v.engine === 'azure' ? azureProvider(s.azure.key, s.azure.region) : openaiProvider(s.openai)
      const blob = await provider.synthesize(sample, v.id, v.lang)
      audio.src = URL.createObjectURL(blob)
      audio.playbackRate = player.state.rate
      audio.onended = audio.onpause = () => setPreviewing(p => (p === key ? null : p))
      await audio.play()
    } catch (e) {
      setPreviewing(null)
      toast(e instanceof Error ? e.message : '试听失败', 'error')
    }
  }

  const loadAzureAll = async () => {
    try {
      const list = await fetchAzureVoices(s.azure.key, s.azure.region)
      setAzureAll(
        list
          .filter(v => /Neural/.test(v.ShortName))
          .map(v => ({
            engine: 'azure' as const,
            id: v.ShortName,
            name: v.LocalName,
            lang: v.Locale,
            quality: 'premium' as const,
            desc: `${v.Gender === 'Female' ? '女声' : v.Gender === 'Male' ? '男声' : ''} · ${langLabel(v.Locale)}`,
          })),
      )
      toast(`已加载 ${list.length} 个声音`, 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '加载失败', 'error')
    }
  }

  const row = (v: VoiceOption) => {
    const active = current.engine === v.engine && current.id === v.id
    const key = `${v.engine}:${v.id}`
    return (
      <div key={key} class={`voice-row ${active ? 'active' : ''}`} onClick={() => choose(v)} role="button">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div class="name">
            {v.name}
            {v.quality === 'premium' && v.engine === 'system' && <span class="q-badge premium">高品质</span>}
            {v.quality === 'enhanced' && <span class="q-badge premium">增强</span>}
            {v.quality === 'novelty' && <span class="q-badge">趣味</span>}
          </div>
          <div class="desc">{[v.engine === 'system' ? langLabel(v.lang) : '', v.desc].filter(Boolean).join(' · ')}</div>
        </div>
        <button
          class="icon-btn"
          onClick={e => {
            e.stopPropagation()
            preview(v)
          }}
          aria-label="试听"
        >
          {previewing === key ? <IconStop size={18} /> : <IconPlay size={18} />}
        </button>
        {active && <IconCheck size={20} class="check" />}
      </div>
    )
  }

  const notConfigured = (engine: EngineId) => (
    <div class="hint">
      <p style={{ margin: '0 0 8px' }}>
        {engine === 'azure'
          ? 'Azure 神经语音是目前最自然的中文朗读之一（晓晓、云希等），免费额度每月 50 万字，并且支持锁屏后台连续播放。'
          : '可以使用 OpenAI 的 gpt-4o-mini-tts，或任何兼容 OpenAI /audio/speech 接口的服务（比如自建的 edge-tts 代理）。'}
      </p>
      <button class="btn small primary" onClick={() => navigate('#/settings')}>
        去设置里填写密钥
      </button>
    </div>
  )

  return (
    <Sheet title="朗读声音" onClose={onClose}>
      <div class="seg">
        {(['system', 'azure', 'openai'] as EngineId[]).map(e => (
          <button key={e} class={tab === e ? 'active' : ''} onClick={() => setTab(e)}>
            {e === 'system' ? '系统' : e === 'azure' ? 'Azure' : 'OpenAI'}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
        <span class="muted small">{ENGINE_LABELS[tab]} · 本书语言：{langLabel(lang)}</span>
        <div class="spacer" />
        {tab !== 'openai' && (
          <button class={`chip ${allLangs ? 'active' : ''}`} onClick={() => setAllLangs(!allLangs)}>
            全部语言
          </button>
        )}
      </div>

      {tab === 'system' && (
        <>
          {!systemList.length && <div class="hint">没有找到{allLangs ? '' : '该语言的'}系统语音。{!allLangs && '可以打开「全部语言」看看。'}</div>}
          {systemList.map(row)}
          <div class="hint">
            <b>想要更自然的系统声音？</b>
            <ol style={{ margin: '6px 0 0', paddingLeft: '20px' }}>
              <li>iPhone「设置 → 辅助功能 → 朗读内容 → 声音 → 中文」，下载带「增强」或「高级」字样的声音（需要 Wi-Fi，几十到几百 MB）。</li>
              <li>下载完成后，<b>从后台上滑完全关闭本 App 再打开</b>，新声音才会出现在上面的列表里。</li>
              <li>在这里点选它。本 App 的声音单独设置，不跟随系统「朗读内容」里选的声音。</li>
            </ol>
            <div style={{ marginTop: '6px' }}>注意：Siri 的声音苹果不开放给网页和第三方 App 使用，这里不会出现，也不需要下载。</div>
            <div style={{ marginTop: '8px' }}>
              <button class="chip" onClick={refreshVoices}>
                <IconRefresh size={14} /> 刷新声音列表
              </button>
            </div>
          </div>
        </>
      )}

      {tab === 'azure' &&
        (engineReady('azure', s) ? (
          <>
            {azureList.map(row)}
            {!azureAll && (
              <button class="btn small block" onClick={loadAzureAll} style={{ marginTop: '6px' }}>
                从 Azure 加载全部声音
              </button>
            )}
          </>
        ) : (
          notConfigured('azure')
        ))}

      {tab === 'openai' &&
        (engineReady('openai', s) ? (
          <>
            {OPENAI_VOICES.map(row)}
            <div class="field" style={{ marginTop: '12px' }}>
              <label>自定义声音名称（兼容接口用）</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  class="input"
                  value={custom}
                  placeholder="例如 zh-CN-XiaoxiaoNeural"
                  onInput={e => setCustom((e.target as HTMLInputElement).value)}
                />
                <button
                  class="btn"
                  disabled={!custom.trim()}
                  onClick={() => choose({ engine: 'openai', id: custom.trim(), name: custom.trim(), lang: '', quality: 'premium' })}
                >
                  使用
                </button>
              </div>
            </div>
          </>
        ) : (
          notConfigured('openai')
        ))}
    </Sheet>
  )
}
