// jsdom 缺少的一些浏览器 API
const g = globalThis as any
if (!g.CSS) g.CSS = {}
if (!g.CSS.escape) g.CSS.escape = (s: string) => s.replace(/([^\w-])/g, '\\$1')
if (!URL.createObjectURL) (URL as any).createObjectURL = () => 'blob:mock'
if (!URL.revokeObjectURL) (URL as any).revokeObjectURL = () => {}
if (g.HTMLElement && !('innerText' in g.HTMLElement.prototype)) {
  Object.defineProperty(g.HTMLElement.prototype, 'innerText', {
    get() {
      return this.textContent
    },
  })
}

// jsdom 的 Blob 没有 arrayBuffer()/text()
const readAs = (blob: Blob, method: 'readAsArrayBuffer' | 'readAsText') =>
  new Promise<any>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader[method](blob)
  })
if (!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = function () { return readAs(this, 'readAsArrayBuffer') }
if (!Blob.prototype.text) Blob.prototype.text = function () { return readAs(this, 'readAsText') }
