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
interface Props {
  name: string
  pages: number
  reason: 'scanned' | 'garbled' | 'forced'
  langHint: OcrLang
  onDone: (choice: ScanChoice | null) => void
}

export function ScanSheet({ name, pages, reason, langHint, onDone }: Props) {
  const cloud = cloudOcrReady()
  const [engine, setEngine] = useState<OcrEngine>('local')
  const [lang, setLang] = useState<OcrLang>(langHint)
  // 默认：文字正常的页直接用原文，有问题的页才识别（识别后对得上原文的段落仍用原文）；
  // 设置里打开了「一律按图片识别」时每页都识别
  const [ignoreText, setIgnoreText] = useState(reason === 'forced')
  // 本机识别在手机上大约每页 10 秒；云端约 3 秒
  const estimate = formatDuration(pages * (engine === 'local' ? 10 : 3))

  return (
    <Sheet
      title={reason === 'garbled' ? '这本 PDF 的文字有错乱' : reason === 'forced' ? '按页面图片识别' : '这是扫描版 PDF'}
      onClose={() => onDone(null)}
      footer={
        <>
          <button class="btn" onClick={() => onDone(null)}>
            取消
          </button>
          <button class="btn primary" onClick={() => onDone({ engine, lang, ignoreText })}>
            开始识别
          </button>
        </>
      }
    >
      <div class="hint">
        <b style={{ wordBreak: 'break-all' }}>{name}</b>
        <br />
        {reason === 'garbled'
          ? `共 ${pages} 页。PDF 自带的文字有错乱（乱码、错字，繁体或老版本 PDF 常见），直接读取会读错。可以按页面图片重新识别文字后朗读。`
          : reason === 'forced'
            ? `共 ${pages} 页。设置里打开了「PDF 一律按图片识别」，不使用 PDF 自带的文字。`
            : `共 ${pages} 页，页面是图片，需要先识别出文字才能朗读。`}
        识别在后台逐页进行，前几页识别完就可以开始听，后面的边听边识别。
      </div>
      <div class="field">
        <span class="label">识别方式</span>
        <div class="option-list">
          <button class="option" style={{ minHeight: '62px' }} onClick={() => setEngine('local')}>
            <div>
              <div>本机识别</div>
              <div class="muted small">免费、不上传、可离线，简体繁体都识别得很准；首次需下载约 30 MB 识别模型（建议连 Wi-Fi）</div>
            </div>
            {engine === 'local' && <span class="check">✓</span>}
          </button>
          <button class="option" style={{ minHeight: '62px' }} disabled={!cloud} onClick={() => setEngine('cloud')}>
            <div>
              <div>云端识别（更快）</div>
              <div class="muted small">{cloud ? '使用设置里的 OpenAI 兼容接口：页面图片会上传，会产生费用' : '需要先在设置里填写 OpenAI 兼容接口的密钥'}</div>
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
      {reason !== 'scanned' && (
        <div class="field">
          <span class="label">PDF 自带的文字</span>
          <div class="option-list">
            <button class="option" onClick={() => setIgnoreText(false)}>
              <div>
                <div>正常的文字直接用（推荐）</div>
                <div class="muted small">PDF 自带的文字正常的部分直接用原文，一字不差；只有乱码、错字的部分按图片识别</div>
              </div>
              {!ignoreText && <span class="check">✓</span>}
            </button>
            <button class="option" onClick={() => setIgnoreText(true)}>
              <div>
                <div>全部按图片识别</div>
                <div class="muted small">每页都识别，完全不用 PDF 自带的文字；较慢，识别偶尔会错个别字</div>
              </div>
              {ignoreText && <span class="check">✓</span>}
            </button>
          </div>
        </div>
      )}
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
