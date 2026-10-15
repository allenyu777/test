import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import { cpSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'

// 文字识别（PaddleOCR）的模型：发布时复制到 dist/paddle/，开发时直接从 models/paddle/ 提供
const PADDLE_DIR = 'models/paddle'

function paddleModels(): Plugin {
  let outDir = 'dist'
  return {
    name: 'tingshu-paddle-models',
    configResolved(config) {
      outDir = config.build.outDir
    },
    configureServer(server) {
      server.middlewares.use('/paddle/', (req, res, next) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0]
        if (!/^[\w.-]+$/.test(name)) return next()
        try {
          const data = readFileSync(join(PADDLE_DIR, name))
          res.setHeader('Content-Type', name.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'application/octet-stream')
          res.end(data)
        } catch {
          next()
        }
      })
    },
    writeBundle() {
      cpSync(PADDLE_DIR, join(outDir, 'paddle'), { recursive: true })
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
      // pdf.js 字形表、文字识别模型和运行文件较大，按需下载后再缓存，不预缓存
      const onDemand = (f: string) => f.startsWith('pdfjs/') || f.startsWith('paddle/') || f.endsWith('.wasm')
      const assets = files.filter(f => f !== 'sw.js' && !f.endsWith('.map') && !onDemand(f))
      const hash = createHash('sha256')
      for (const f of assets.sort()) hash.update(f).update(readFileSync(join(outDir, f)))
      const version = hash.digest('hex').slice(0, 12)
      const assetHash = createHash('sha256')
      for (const f of files.filter(onDemand).sort()) {
        assetHash.update(f).update(readFileSync(join(outDir, f)))
      }
      const template = readFileSync('src/sw-template.js', 'utf8')
      const source = template
        .replace('__VERSION__', version)
        .replace('__ASSET_VERSION__', assetHash.digest('hex').slice(0, 12))
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
  resolve: {
    // 只用 WebAssembly 版的 ONNX Runtime（不打包 WebGPU 版，少下载十几 MB）
    alias: [{ find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/wasm' }],
  },
  worker: {
    format: 'es',
  },
  plugins: [paddleModels(), serviceWorker()],
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
  },
})
