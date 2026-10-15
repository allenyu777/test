// ONNX Runtime 的运行文件用本站自带的一份（不从国外 CDN 下载）。
// 必须在 ppu-paddle-ocr 之前导入：它导入时发现没设置路径，会改成 CDN 地址。
import * as ort from 'onnxruntime-web'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

ort.env.wasm.wasmPaths = { wasm: wasmUrl }
// GitHub Pages 不能开启跨源隔离，多线程用不了
ort.env.wasm.numThreads = 1

export { ort, wasmUrl }
