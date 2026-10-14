import { useState } from 'preact/hooks'
import type { OcrEngine, OcrLang } from '../db'
import type { ScanChoice } from '../ocr/importScanned'
import { cloudOcrReady } from '../ocr/engines'
import { formatDuration } from '../core/text'
import { navigate } from './router'
import { Sheet } from './Sheet'

const LANGS: [OcrLang, string][] = [
  ['chi_sim', '简体中文'],
  ['chi_tra', '繁体中文'],
  ['chi_sim+eng', '中英混合'],
  ['eng', '英文'],
]

/** 导入扫描版 PDF 时选择识别方式 */
export function ScanSheet({ name, pages, onDone }: { name: string; pages: number; onDone: (choice: ScanChoice | null) => void }) {
  const cloud = cloudOcrReady()
  const [engine, setEngine] = useState<OcrEngine>('local')
  const [lang, setLang] = useState<OcrLang>('chi_sim')
  // 本机识别在手机上大约每页 5 秒；云端约 3 秒
  const estimate = formatDuration(pages * (engine === 'local' ? 5 : 3))

  return (
    <Sheet
      title="这是扫描版 PDF"
      onClose={() => onDone(null)}
      footer={
        <>
          <button class="btn" onClick={() => onDone(null)}>
            取消
          </button>
          <button class="btn primary" onClick={() => onDone({ engine, lang })}>
            开始识别
          </button>
        </>
      }
    >
      <div class="hint">
        <b style={{ wordBreak: 'break-all' }}>{name}</b>
        <br />
        共 {pages} 页，页面是图片，需要先识别出文字才能朗读。识别在后台逐页进行，前几页识别完就可以开始听，后面的边听边识别。
      </div>
      <div class="field">
        <span class="label">识别方式</span>
        <div class="option-list">
          <button class="option" style={{ minHeight: '62px' }} onClick={() => setEngine('local')}>
            <div>
              <div>本机识别</div>
              <div class="muted small">免费、不上传、可离线；首次需下载约 2–5 MB 识别数据</div>
            </div>
            {engine === 'local' && <span class="check">✓</span>}
          </button>
          <button class="option" style={{ minHeight: '62px' }} disabled={!cloud} onClick={() => setEngine('cloud')}>
            <div>
              <div>云端识别（更准、更快）</div>
              <div class="muted small">{cloud ? '使用设置里的 OpenAI 兼容接口，会产生少量费用' : '需要先在设置里填写 OpenAI 兼容接口的密钥'}</div>
            </div>
            {engine === 'cloud' && <span class="check">✓</span>}
          </button>
        </div>
        {!cloud && (
          <button class="chip" style={{ marginTop: '8px', alignSelf: 'flex-start' }} onClick={() => {
            onDone(null)
            navigate('#/settings')
          }}>
            去设置
          </button>
        )}
      </div>
      <div class="field">
        <span class="label">书的文字</span>
        <div class="chips">
          {LANGS.map(([key, label]) => (
            <button key={key} class={`chip ${lang === key ? 'active' : ''}`} onClick={() => setLang(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div class="hint">
        全书识别预计约 {estimate}。识别时请让 App 保持在前台（屏幕会保持常亮）；切到后台会暂停，回来后自动继续。
      </div>
    </Sheet>
  )
}
