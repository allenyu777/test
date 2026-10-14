import { useEffect, useRef, useState } from 'preact/hooks'
import { createBackup, restoreBackup } from '../backup'
import { requestPersistence, storageEstimate } from '../db'
import { player } from '../player'
import { settings, updateSettings, type Settings } from '../settings'
import { useStore } from '../store'
import { mainAudio, primeAudio } from '../tts/audio'
import { azureProvider, openaiProvider } from '../tts/cloud'
import { ExportReady, ExportSheet } from './ExportSheet'
import { IconChevronLeft, IconChevronRight, IconDownload, IconPlay, IconUpload } from './icons'
import { goBack } from './router'
import { Sheet, Switch } from './Sheet'
import { toast } from './toast'

const AZURE_REGIONS = [
  ['eastasia', '东亚（香港）'],
  ['southeastasia', '东南亚（新加坡）'],
  ['japaneast', '日本东部'],
  ['koreacentral', '韩国中部'],
  ['eastus', '美国东部'],
  ['westus2', '美国西部 2'],
  ['westeurope', '西欧'],
  ['australiaeast', '澳大利亚东部'],
]

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function Row({ title, desc, children, onClick }: { title: string; desc?: string; children?: preact.ComponentChildren; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag class="row" onClick={onClick}>
      <div class="row-body">
        <div class="row-title">{title}</div>
        {desc && <div class="row-desc">{desc}</div>}
      </div>
      {children}
    </Tag>
  )
}

async function testVoice(kind: 'azure' | 'openai', s: Settings) {
  if (player.state.status === 'playing') player.pause()
  primeAudio()
  try {
    const provider = kind === 'azure' ? azureProvider(s.azure.key, s.azure.region) : openaiProvider(s.openai)
    const voice = kind === 'azure' ? 'zh-CN-XiaoxiaoNeural' : 'nova'
    const blob = await provider.synthesize('你好，配置成功了。现在可以用自然的声音听书了。', voice, 'zh-CN')
    const audio = mainAudio()
    audio.onended = audio.ontimeupdate = audio.onpause = audio.onerror = null
    audio.src = URL.createObjectURL(blob)
    await audio.play()
    toast('连接成功 ✓', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : '连接失败', 'error', { duration: 8000 })
  }
}

export function SettingsPage() {
  const s = useStore(settings, x => x)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [sheet, setSheet] = useState<'export' | 'backup' | null>(null)
  const [backupFile, setBackupFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const restoreRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    storageEstimate().then(setStorage)
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
  }, [])

  const setAzure = (patch: Partial<Settings['azure']>) => updateSettings({ azure: { ...s.azure, ...patch } })
  const setOpenai = (patch: Partial<Settings['openai']>) => updateSettings({ openai: { ...s.openai, ...patch } })

  const makeBackup = async (includeBooks: boolean) => {
    setBusy(true)
    try {
      setBackupFile(await createBackup(includeBooks))
      setSheet('backup')
    } catch (e) {
      toast(e instanceof Error ? e.message : '备份失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const onRestore = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const r = await restoreBackup(file)
      toast(`已恢复 ${r.books} 本书、${r.notes} 条笔记${r.skipped ? `；${r.skipped} 本书没有正文被跳过` : ''}`, 'success', { duration: 6000 })
    } catch (e) {
      toast(e instanceof Error ? e.message : '恢复失败', 'error')
    } finally {
      setBusy(false)
      if (restoreRef.current) restoreRef.current.value = ''
    }
  }

  return (
    <div class="page">
      <div class="topbar">
        <button class="icon-btn" onClick={goBack} aria-label="返回">
          <IconChevronLeft />
        </button>
      </div>
      <h1 class="large-title">设置</h1>

      <div class="section-title">云端神经语音 · Azure（推荐）</div>
      <div class="group">
        <div class="group-pad">
          <div class="field">
            <label>密钥（Key）</label>
            <input
              class="input"
              type="password"
              autoComplete="off"
              value={s.azure.key}
              placeholder="Azure 语音服务的密钥"
              onInput={e => setAzure({ key: (e.target as HTMLInputElement).value.trim() })}
            />
          </div>
          <div class="field">
            <label>区域（Region）</label>
            <input
              class="input"
              list="azure-regions"
              value={s.azure.region}
              onInput={e => setAzure({ region: (e.target as HTMLInputElement).value.trim() })}
            />
            <datalist id="azure-regions">
              {AZURE_REGIONS.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </datalist>
          </div>
          <div class="field">
            <button class="btn small" disabled={!s.azure.key} onClick={() => testVoice('azure', s)}>
              <IconPlay size={16} /> 测试并试听
            </button>
          </div>
        </div>
      </div>
      <div class="group-note">
        在 Azure 门户创建「语音服务」（选免费 F0 定价层，每月 50 万字免费），在「密钥和终结点」里复制密钥和区域。中文推荐晓晓、云希。云端语音支持锁屏后台连续播放。
      </div>

      <div class="section-title">OpenAI 兼容接口</div>
      <div class="group">
        <div class="group-pad">
          <div class="field">
            <label>接口地址</label>
            <input class="input" value={s.openai.baseUrl} onInput={e => setOpenai({ baseUrl: (e.target as HTMLInputElement).value.trim() })} />
          </div>
          <div class="field">
            <label>API Key</label>
            <input
              class="input"
              type="password"
              autoComplete="off"
              value={s.openai.key}
              placeholder="sk-…"
              onInput={e => setOpenai({ key: (e.target as HTMLInputElement).value.trim() })}
            />
          </div>
          <div class="field">
            <label>朗读模型</label>
            <input class="input" value={s.openai.model} onInput={e => setOpenai({ model: (e.target as HTMLInputElement).value.trim() })} />
          </div>
          <div class="field">
            <label>朗读风格（gpt-4o-mini-tts 支持）</label>
            <textarea
              class="textarea"
              style={{ minHeight: '70px' }}
              value={s.openai.instructions}
              onInput={e => setOpenai({ instructions: (e.target as HTMLTextAreaElement).value })}
            />
          </div>
          <div class="field">
            <button class="btn small" disabled={!s.openai.baseUrl} onClick={() => testVoice('openai', s)}>
              <IconPlay size={16} /> 测试并试听
            </button>
          </div>
        </div>
      </div>
      <div class="group-note">也可以填写任何兼容 /v1/audio/speech 的服务地址（需 HTTPS），例如自建的 edge-tts 代理。密钥只保存在本机浏览器里。</div>

      <div class="section-title">播放</div>
      <div class="group">
        <Row title="朗读时自动翻页跟随">
          <Switch on={s.follow} onChange={v => updateSettings({ follow: v })} />
        </Row>
        <Row title="朗读时屏幕常亮" desc="系统语音在锁屏后可能会停止，建议开启">
          <Switch on={s.keepAwake} onChange={v => updateSettings({ keepAwake: v })} />
        </Row>
        <Row title="锁屏继续朗读（实验）" desc="系统语音朗读时在后台播放静音音频，尝试保持锁屏后继续；若出现无声请关闭">
          <Switch on={s.keepAlive} onChange={v => updateSettings({ keepAlive: v })} />
        </Row>
        <Row title="每本书单独记住语速">
          <Switch on={s.perBookRate} onChange={v => updateSettings({ perBookRate: v })} />
        </Row>
        <Row title="写完笔记后继续播放">
          <Switch on={s.resumeAfterNote} onChange={v => updateSettings({ resumeAfterNote: v })} />
        </Row>
      </div>

      <div class="section-title">语音笔记</div>
      <div class="group">
        <div class="group-pad">
          <div class="field">
            <span class="label">录音自动转文字</span>
            <div class="seg">
              {(
                [
                  ['off', '关闭'],
                  ['azure', 'Azure'],
                  ['openai', 'OpenAI'],
                ] as const
              ).map(([key, label]) => (
                <button key={key} class={s.transcribe === key ? 'active' : ''} onClick={() => updateSettings({ transcribe: key })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {s.transcribe === 'openai' && (
            <div class="field">
              <label>转写模型</label>
              <input
                class="input"
                value={s.openai.transcribeModel}
                onInput={e => setOpenai({ transcribeModel: (e.target as HTMLInputElement).value.trim() })}
              />
            </div>
          )}
        </div>
      </div>
      <div class="group-note">
        转文字使用上面填写的 Azure 或 OpenAI 密钥。不配置也没关系：写笔记时点键盘上的麦克风就能用 iPhone 自带听写，或使用「语音输入」按钮。
      </div>

      <div class="section-title">数据</div>
      <div class="group">
        <Row title="导出全部读书笔记" desc="Markdown / 纯文本 / 含录音的压缩包" onClick={() => setSheet('export')}>
          <IconChevronRight size={18} class="muted" />
        </Row>
        <Row title="完整备份" desc="书籍、进度、笔记和录音，可在其他设备恢复" onClick={() => !busy && makeBackup(true)}>
          <IconDownload size={20} class="muted" />
        </Row>
        <Row title="仅备份进度和笔记" desc="文件更小；恢复时需要设备上已有相同的书" onClick={() => !busy && makeBackup(false)}>
          <IconDownload size={20} class="muted" />
        </Row>
        <Row title="从备份恢复" onClick={() => restoreRef.current?.click()}>
          <IconUpload size={20} class="muted" />
        </Row>
        <Row
          title="存储空间"
          desc={
            storage
              ? `已用 ${formatBytes(storage.usage)}${storage.quota ? ` / 可用 ${formatBytes(storage.quota)}` : ''}${persisted ? ' · 已设为持久保存' : ''}`
              : '无法获取'
          }
        >
          {!persisted && (
            <button
              class="btn small"
              onClick={async () => {
                const ok = await requestPersistence()
                setPersisted(ok)
                toast(ok ? '已开启持久保存' : '浏览器暂未允许，添加到主屏幕后会更稳妥')
              }}
            >
              持久保存
            </button>
          )}
        </Row>
      </div>
      <input
        ref={restoreRef}
        type="file"
        accept=".zip,application/zip"
        class="sr-only"
        onChange={e => onRestore((e.target as HTMLInputElement).files?.[0])}
      />
      {busy && (
        <div class="import-overlay">
          <div class="import-card">
            <div class="spinner" />
            <div>正在处理…</div>
          </div>
        </div>
      )}

      <div class="section-title">使用帮助</div>
      <div class="group">
        <div class="group-pad" style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--text-2)', paddingBottom: '14px' }}>
          <b style={{ color: 'var(--text)' }}>安装到主屏幕</b>：用 Safari 打开本页 → 分享 → 添加到主屏幕。之后从图标打开，全屏无地址栏，数据单独保存。
          <br />
          <b style={{ color: 'var(--text)' }}>更自然的系统声音</b>：设置 → 辅助功能 → 朗读内容 → 声音 → 中文，下载「增强 / 高级」声音。
          <br />
          <b style={{ color: 'var(--text)' }}>做笔记</b>：在正文点一下句子，选「笔记」或「语音」；播放时可直接点底部「语音笔记」。
          <br />
          <b style={{ color: 'var(--text)' }}>快速定位</b>：滚动离开朗读位置后，右下角会出现「回到朗读位置」。
          <br />
          <b style={{ color: 'var(--text)' }}>数据安全</b>：所有书籍和笔记只保存在这台设备上，建议定期「完整备份」。
        </div>
      </div>
      <div class="about">
        听书 v1.0 · 电子书解析使用 foliate-js（MIT）与 pdf.js（Apache-2.0）
      </div>

      {sheet === 'export' && <ExportSheet onClose={() => setSheet(null)} />}
      {sheet === 'backup' && backupFile && (
        <Sheet title="备份已生成" onClose={() => setSheet(null)}>
          <ExportReady file={backupFile} />
          <div class="hint" style={{ marginTop: '14px' }}>
            建议存到「文件」App 或 iCloud 云盘。在新设备上打开本应用，进入设置 → 从备份恢复即可。
          </div>
        </Sheet>
      )}
    </div>
  )
}
