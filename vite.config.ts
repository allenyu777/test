import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import { cpSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { createHash } from 'node:crypto'

// 文字识别（Tesseract）需要的文件：发布时复制到 dist/tesseract/，开发时直接从 node_modules 提供
const TESSERACT_FILES: Record<string, string> = {
  'worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'core/tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'core/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'lang/chi_sim.traineddata.gz': 'node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz',
  'lang/chi_tra.traineddata.gz': 'node_modules/@tesseract.js-data/chi_tra/4.0.0_best_int/chi_tra.traineddata.gz',
  'lang/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
}

function tesseractAssets(): Plugin {
  let outDir = 'dist'
  return {
    name: 'tingshu-tesseract',
    configResolved(config) {
      outDir = config.build.outDir
    },
    configureServer(server) {
      server.middlewares.use('/tesseract/', (req, res, next) => {
        const source = TESSERACT_FILES[(req.url ?? '').replace(/^\//, '').split('?')[0]]
        if (!source) return next()
        res.setHeader('Content-Type', source.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        res.end(readFileSync(source))
      })
    },
    writeBundle() {
      for (const [target, source] of Object.entries(TESSERACT_FILES)) {
        const dest = join(outDir, 'tesseract', target)
        mkdirSync(dirname(dest), { recursive: true })
        cpSync(source, dest)
      }
    },
  }
}

// 构建完成后生成 Service Worker：预缓存全部静态文件，保证离线可用
function serviceWorker(): Plugin {
  let outDir = 'dist'
  return {
    name: 'tingshu-sw',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      // pdf.js 解析中文 PDF 需要的 CMap 文件（按需加载，不预缓存）
      cpSync('node_modules/pdfjs-dist/cmaps', join(outDir, 'pdfjs/cmaps'), { recursive: true })
      const files: string[] = []
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name)
          if (statSync(full).isDirectory()) walk(full)
          else files.push(relative(outDir, full).split('\\').join('/'))
        }
      }
      walk(outDir)
      // pdf.js 字形表和文字识别文件较大，按需下载后再缓存，不预缓存
      const assets = files.filter(f => f !== 'sw.js' && !f.endsWith('.map') && !f.startsWith('pdfjs/') && !f.startsWith('tesseract/'))
      const hash = createHash('sha256')
      for (const f of assets.sort()) hash.update(f).update(readFileSync(join(outDir, f)))
      const version = hash.digest('hex').slice(0, 12)
      const template = readFileSync('src/sw-template.js', 'utf8')
      const source = template
        .replace('__VERSION__', version)
        .replace('__ASSETS__', JSON.stringify(['./', ...assets.map(f => './' + f)], null, 1))
      writeFileSync(join(outDir, 'sw.js'), source)
    },
  }
}

export default defineConfig({
  base: './',
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  build: {
    target: ['safari15', 'es2020'],
    chunkSizeWarningLimit: 1500,
  },
  plugins: [tesseractAssets(), serviceWorker()],
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
  },
})
