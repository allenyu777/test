# 文字识别模型（PaddleOCR）

扫描版 PDF 在本机识别文字用的模型，构建时复制到 `dist/paddle/`，首次识别时下载并缓存在本机。

| 文件 | 说明 |
| --- | --- |
| `PP-OCRv6_tiny_det.onnx` | 文字行检测（PP-OCRv6 tiny） |
| `PP-OCRv5_mobile_rec_infer.onnx` | 文字识别（PP-OCRv5 mobile，简体、繁体、英文等约 1.8 万字） |
| `ppocrv5_dict.txt` | 识别模型的字表 |

来源：[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) 官方模型的 ONNX 版本，取自 [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models)，Apache-2.0 许可（见 LICENSE）。

在一页真实扫描书页上的测试（237 字）：Tesseract chi_sim 错 12 字左右，这套模型错 0 个汉字。
