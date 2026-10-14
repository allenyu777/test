import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import { cpSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'

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
      const assets = files.filter(f => f !== 'sw.js' && !f.endsWith('.map') && !f.startsWith('pdfjs/'))
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
  plugins: [serviceWorker()],
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
  },
})
