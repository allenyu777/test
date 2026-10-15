// 导入扫描版 PDF：保存原文件，先识别出第一段文字，其余页面交给后台
import * as db from '../db'
import type { BookMeta, OcrEngine, OcrLang } from '../db'
import { refreshLibrary } from '../library'
import { renderPage, type ScannedPdfError } from '../parsers/pdf'
import { onModelProgress } from './engines'
import { ocrRunner } from './runner'

export interface ScanChoice {
  engine: OcrEngine
  lang: OcrLang
}

async function coverFromFirstPage(data: ArrayBuffer): Promise<{ data: ArrayBuffer; type: string } | null> {
  try {
    const { openPdf } = await import('../parsers/pdf')
    const pdf = await openPdf(data)
    try {
      const canvas = await renderPage(pdf, 0, 320)
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
      canvas.width = 0
      return blob ? { data: await blob.arrayBuffer(), type: 'image/jpeg' } : null
    } finally {
      pdf.destroy()
    }
  } catch {
    return null
  }
}

export async function createScannedBook(
  file: File,
  scanned: ScannedPdfError,
  choice: ScanChoice,
  setProgress: (progress: number, message: string) => void,
): Promise<BookMeta> {
  const id = db.uid()
  const data = await file.arrayBuffer()
  setProgress(0, '正在保存文件…')
  await db.saveFile({ id, data, type: file.type || 'application/pdf', name: file.name })
  const cover = await coverFromFirstPage(data)
  const meta: BookMeta = {
    id,
    title: scanned.title || file.name.replace(/\.[^.]+$/, ''),
    author: scanned.author,
    lang: choice.lang === 'eng' ? 'en' : 'zh',
    format: 'pdf',
    fileName: file.name,
    fileSize: file.size,
    addedAt: Date.now(),
    lastReadAt: 0,
    totalChars: 0,
    pos: { b: 0, o: 0 },
    percent: 0,
    chapter: '',
    cover: cover?.data ?? null,
    coverType: cover?.type,
    ocr: { pages: scanned.pages, done: 0, engine: choice.engine, lang: choice.lang, status: 'running' },
  }
  await db.saveBook(meta, { id, blocks: [], heads: {}, toc: [], sections: [], pages: [] })
  await refreshLibrary()
  // 本机识别要先加载识别模型（首次使用要下载），显示进度
  const stopProgress =
    choice.engine === 'local'
      ? onModelProgress(({ loaded, total, cached }) => {
          const pct = Math.min(99, Math.round((loaded / total) * 100))
          setProgress(
            Math.min(1, loaded / total),
            cached ? '正在加载识别引擎…' : `首次使用，正在下载识别模型 ${pct}%（约 ${Math.round(total / 1e6)} MB，之后离线可用）`,
          )
        })
      : () => {}
  try {
    // 先识别到出现第一段文字为止（第一页常是空白或纯图片封面）
    await ocrRunner.process(id, {
      untilText: true,
      onPage: (done, total) => setProgress(done / total, `正在识别第 ${done + 1} / ${total} 页`),
    })
  } catch (e) {
    await db.deleteBook(id)
    await refreshLibrary()
    throw e
  } finally {
    stopProgress()
  }
  const saved = await db.getBook(id)
  const content = await db.getContent(id)
  if (!saved || !content?.blocks.length) {
    await db.deleteBook(id)
    await refreshLibrary()
    throw new Error('没有识别出文字，请确认 PDF 内容清晰，或换用云端识别')
  }
  if (saved.ocr?.status === 'running') ocrRunner.start(id)
  return saved
}
