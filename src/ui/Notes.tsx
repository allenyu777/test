import { useEffect, useRef, useState } from 'preact/hooks'
import type { Book, Pos } from '../core/book'
import * as db from '../db'
import type { BookMeta, Note } from '../db'
import { Dictation, dictationSupported } from '../notes/dictation'
import { formatClock, formatDate } from '../notes/export'
import { Recorder, recordingSupported, type Recording } from '../notes/recorder'
import { transcribe, transcriptionAvailable } from '../notes/transcribe'
import { player } from '../player'
import { settings } from '../settings'
import { makeWav } from '../tts/audio'
import { IconMic, IconPause, IconPen, IconPlay, IconShare, IconSparkles, IconStop, IconTrash } from './icons'
import { Sheet } from './Sheet'
import { toast } from './toast'

let noteAudio: HTMLAudioElement | null = null
let noteAudioOwner: ((playing: boolean) => void) | null = null
let silentUrl: string | null = null

/** 播放语音笔记的小按钮 */
export function AudioChip({ audioId, blob, duration }: { audioId?: string; blob?: Blob | null; duration?: number }) {
  const [playing, setPlaying] = useState(false)
  const urlRef = useRef<string | null>(null)

  useEffect(
    () => () => {
      if (noteAudioOwner === setPlaying) {
        noteAudio?.pause()
        noteAudioOwner = null
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  const toggle = async () => {
    noteAudio ??= new Audio()
    const a = noteAudio
    if (playing) {
      a.pause()
      return
    }
    let source = blob ?? null
    if (!source) {
      // 录音要先从数据库读出来；iOS 要求 play() 在点击中调用，所以先用静音解锁
      silentUrl ??= URL.createObjectURL(makeWav(0.2))
      noteAudioOwner?.(false)
      noteAudioOwner = null
      a.onended = a.onpause = a.onplay = null
      a.src = silentUrl
      a.play().catch(() => {})
    }
    if (!source && audioId) {
      const rec = await db.getAudio(audioId)
      if (rec) source = new Blob([rec.data], { type: rec.type })
    }
    if (!source) {
      toast('找不到录音文件', 'error')
      return
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = URL.createObjectURL(source)
    noteAudioOwner?.(false)
    noteAudioOwner = setPlaying
    if (player.state.status === 'playing') player.pause()
    a.src = urlRef.current
    a.onended = a.onpause = () => setPlaying(false)
    a.onplay = () => setPlaying(true)
    a.play().catch(() => toast('无法播放录音', 'error'))
  }

  return (
    <button class="audio-chip" onClick={toggle}>
      {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
      语音 {formatClock(duration ?? 0)}
    </button>
  )
}

interface EditorProps {
  book: Book
  meta: BookMeta
  pos: Pos
  note?: Note | null
  autoRecord?: boolean
  onClose: () => void
  onSaved: (note: Note | null) => void
}

/** 写笔记：文字 + 录音 + 听写 */
export function NoteEditor({ book, meta, pos, note, autoRecord, onClose, onSaved }: EditorProps) {
  const [text, setText] = useState(note?.text ?? '')
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [audio, setAudio] = useState<Recording | null>(null)
  const [keepAudioId, setKeepAudioId] = useState(note?.audioId ?? null)
  const [dictating, setDictating] = useState(false)
  const [interim, setInterim] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const recorder = useRef<Recorder | null>(null)
  const dictation = useRef<Dictation | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const wasPlaying = useRef(false)
  const starting = useRef(false)
  const mounted = useRef(true)
  const [saving, setSaving] = useState(false)

  const quote = note?.quote ?? book.sentenceText(pos)
  const lang = meta.lang || 'zh'

  useEffect(() => {
    if (player.state.status === 'playing') {
      wasPlaying.current = true
      player.pause()
    }
    if (autoRecord && recordingSupported()) startRecording()
    else if (!note) setTimeout(() => textRef.current?.focus(), 300)
    return () => {
      mounted.current = false
      recorder.current?.cancel()
      dictation.current?.abort()
      if (timer.current) clearInterval(timer.current)
    }
  }, [])

  const startRecording = async () => {
    if (!recordingSupported()) {
      toast('当前浏览器不支持录音', 'error')
      return
    }
    if (starting.current || recorder.current) return
    // 正在听写时先把未确认的文字留下，再停止听写
    if (interim) setText(t => t + interim)
    setInterim('')
    dictation.current?.abort()
    setDictating(false)
    starting.current = true
    const r = new Recorder()
    try {
      await r.start(setLevel)
    } catch {
      starting.current = false
      r.cancel()
      toast('无法使用麦克风，请在系统设置中允许访问', 'error')
      return
    }
    starting.current = false
    // 等待麦克风授权期间面板已经关闭：立即释放麦克风
    if (!mounted.current) {
      r.cancel()
      return
    }
    recorder.current = r
    setRecording(true)
    setElapsed(0)
    timer.current = setInterval(() => setElapsed(r.elapsed), 250)
  }

  /** 停止录音；返回这段录音（太短则返回 null） */
  const stopRecording = async (transcribeAfter = true): Promise<Recording | null> => {
    const r = recorder.current
    if (!r) return null
    if (timer.current) clearInterval(timer.current)
    recorder.current = null
    setRecording(false)
    setLevel(0)
    const rec = await r.stop()
    if (rec.duration < 0.6 || !rec.blob.size) {
      toast('录音太短了')
      return null
    }
    setAudio(rec)
    setKeepAudioId(null)
    if (transcribeAfter && transcriptionAvailable()) runTranscribe(rec.blob)
    return rec
  }

  const runTranscribe = async (blob: Blob) => {
    setTranscribing(true)
    try {
      const result = await transcribe(blob, lang)
      if (result) setText(t => (t.trim() ? `${t.trim()}\n${result}` : result))
      else toast('没有识别到文字')
    } catch (e) {
      toast(e instanceof Error ? e.message : '转文字失败', 'error')
    } finally {
      setTranscribing(false)
    }
  }

  const toggleDictation = () => {
    if (dictating) {
      dictation.current?.stop()
      return
    }
    const base = text.trim() ? text.trim() + '\n' : ''
    const d = new Dictation()
    dictation.current = d
    setDictating(true)
    d.start(
      lang,
      (finalText, interimText) => {
        setText(base + finalText)
        setInterim(interimText)
      },
      error => {
        setDictating(false)
        setInterim('')
        if (error) toast(error, 'error')
      },
    )
  }

  const finish = (saved: Note | null) => {
    onSaved(saved)
    onClose()
    if (wasPlaying.current && settings.get().resumeAfterNote) player.play()
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await doSave()
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  const doSave = async () => {
    // 直接点保存时，正在录的这段也要保存下来（用返回值，避免读到旧的 state）
    let rec = audio
    let keep = keepAudioId
    if (recorder.current) {
      const r = await stopRecording(false)
      if (r) {
        rec = r
        keep = null
      }
    }
    dictation.current?.stop()
    const body = (text + (interim ? interim : '')).trim()
    if (!body && !rec && !keep) {
      toast('写点什么，或者录一段语音吧')
      return
    }
    const now = Date.now()
    let audioId = keep ?? undefined
    let audioType = keep ? note?.audioType : undefined
    let audioDuration = keep ? note?.audioDuration : undefined
    if (rec) {
      audioId = db.uid()
      audioType = rec.type
      audioDuration = rec.duration
      await db.saveAudio({ id: audioId, data: await rec.blob.arrayBuffer(), type: rec.type })
    }
    if (note?.audioId && note.audioId !== audioId) await db.deleteAudio(note.audioId)
    const saved: Note = {
      id: note?.id ?? db.uid(),
      bookId: meta.id,
      b: note?.b ?? pos.b,
      o: note?.o ?? pos.o,
      quote,
      text: body,
      chapter: note?.chapter ?? book.chapterTitle(pos.b),
      createdAt: note?.createdAt ?? now,
      updatedAt: now,
      audioId,
      audioType,
      audioDuration,
    }
    await db.saveNote(saved)
    toast(note ? '笔记已更新' : '笔记已保存', 'success')
    finish(saved)
  }

  const remove = async () => {
    if (!note || !confirm('删除这条笔记？')) return
    await db.deleteNote(note)
    toast('已删除')
    finish(null)
  }

  const hasAudio = !!audio || !!keepAudioId
  return (
    <Sheet
      title={note ? '编辑笔记' : '写笔记'}
      onClose={() => finish(note ?? null)}
      actions={
        note && (
          <button class="icon-btn" onClick={remove} aria-label="删除笔记" style={{ color: 'var(--danger)' }}>
            <IconTrash size={20} />
          </button>
        )
      }
      footer={
        <>
          <button class="btn" onClick={() => finish(note ?? null)}>
            取消
          </button>
          <button class="btn primary" onClick={save} disabled={transcribing || saving}>
            保存
          </button>
        </>
      }
    >
      <div class="quote-box">{quote}</div>

      {recordingSupported() && (
        <div class="recorder">
          <button
            class={`rec-btn ${recording ? 'recording' : ''}`}
            style={{ '--level': String(1 + level * 0.35) }}
            onClick={() => (recording ? stopRecording() : startRecording())}
            aria-label={recording ? '停止录音' : '开始录音'}
          >
            {recording ? <IconStop size={22} /> : <IconMic size={24} />}
          </button>
          <div class="rec-info">
            {recording ? (
              <>
                <div class="rec-time">{formatClock(elapsed)}</div>
                <div>正在录音，点击停止</div>
              </>
            ) : hasAudio ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <AudioChip blob={audio?.blob} audioId={audio ? undefined : keepAudioId ?? undefined} duration={audio?.duration ?? note?.audioDuration} />
                {transcriptionAvailable() && (
                  <button
                    class="chip"
                    disabled={transcribing}
                    onClick={async () => {
                      let blob = audio?.blob ?? null
                      if (!blob && keepAudioId) {
                        const rec = await db.getAudio(keepAudioId)
                        if (rec) blob = new Blob([rec.data], { type: rec.type })
                      }
                      if (blob) runTranscribe(blob)
                    }}
                  >
                    <IconSparkles size={14} /> 转文字
                  </button>
                )}
                <button
                  class="chip"
                  onClick={() => {
                    setAudio(null)
                    setKeepAudioId(null)
                  }}
                >
                  删除录音
                </button>
              </div>
            ) : (
              <>
                <div style={{ color: 'var(--text)', fontWeight: 600 }}>语音笔记</div>
                <div>点红色按钮开始录音{transcriptionAvailable() ? '，结束后自动转成文字' : ''}</div>
              </>
            )}
            {transcribing && <div style={{ marginTop: '6px' }}>正在转文字…</div>}
          </div>
        </div>
      )}

      <div class="field">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span class="label">文字</span>
          <div class="spacer" />
          {dictationSupported() && (
            <button class={`chip ${dictating ? 'active' : ''}`} onClick={toggleDictation}>
              <IconMic size={14} /> {dictating ? '停止听写' : '语音输入'}
            </button>
          )}
        </div>
        <textarea
          ref={textRef}
          class="textarea"
          rows={5}
          value={text + (interim ? interim : '')}
          readOnly={dictating}
          placeholder="写下你的想法…（也可以点键盘上的麦克风直接说）"
          onInput={e => setText((e.target as HTMLTextAreaElement).value)}
        />
      </div>
    </Sheet>
  )
}

interface NotesSheetProps {
  book: Book
  meta: BookMeta
  notes: Note[]
  onClose: () => void
  onJump: (pos: Pos) => void
  onEdit: (note: Note) => void
  onExport: () => void
}

export function NotesSheet({ meta, notes, onClose, onJump, onEdit, onExport }: NotesSheetProps) {
  let lastChapter: string | null = null
  return (
    <Sheet
      title={`笔记 · ${notes.length}`}
      onClose={onClose}
      actions={
        notes.length > 0 && (
          <button class="icon-btn" onClick={onExport} aria-label="导出笔记">
            <IconShare size={20} />
          </button>
        )
      }
    >
      {!notes.length && (
        <div class="empty" style={{ paddingTop: '24px' }}>
          <div class="empty-art" style={{ width: '72px', height: '72px', borderRadius: '22px' }}>
            <IconPen size={32} />
          </div>
          <h2>还没有笔记</h2>
          <p>
            在正文里点一下任意句子，选择「笔记」或「语音」；
            <br />
            播放时也可以直接点下方的「语音笔记」。
          </p>
        </div>
      )}
      {notes.map(n => {
        const header = n.chapter !== lastChapter ? n.chapter : null
        lastChapter = n.chapter
        return (
          <div key={n.id}>
            {header !== null && <div class="note-chapter">{header || meta.title}</div>}
            <div class="note-card">
              <button class="note-quote" onClick={() => onJump({ b: n.b, o: n.o })}>
                {n.quote}
              </button>
              {n.text && <div class="note-text">{n.text}</div>}
              <div class="note-meta">
                {n.audioId && <AudioChip audioId={n.audioId} duration={n.audioDuration} />}
                <span>{formatDate(n.createdAt)}</span>
                <div class="spacer" />
                <button class="chip" onClick={() => onJump({ b: n.b, o: n.o })}>
                  定位
                </button>
                <button class="chip" onClick={() => onEdit(n)}>
                  编辑
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </Sheet>
  )
}
