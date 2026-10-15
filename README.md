# 听书 · 电子书朗读

[English](#english) · 中文

一个给自己用的「听电子书」网页应用（PWA）。在 iPhone 的 Safari 里打开后「添加到主屏幕」，就能像 App 一样全屏使用，不需要上架 App Store。

👉 **立即使用：<https://allenyu777.github.io/test/>**（用 Safari 打开，点「分享 → 添加到主屏幕」）

## 功能

- **多格式**：EPUB、MOBI、AZW3、PDF、TXT（自动识别 UTF-8 / GBK / Big5）、FB2、DOCX、HTML、Markdown
- **扫描版或乱码 PDF**：自动识别文字（OCR）。文字层是乱码的 PDF（字体缺少编码，繁体/老版本 PDF 常见）也会自动发现并改为按页面图片识别；繁体书自动选繁体识别，有书签时用书签生成目录。本机识别用 PaddleOCR 模型（简体、繁体、英文都很准，首次使用下载约 33 MB，之后离线可用），免费、不上传；设备不支持时（iOS 16.4 以前）自动改用 Tesseract 兼容模式；页眉、页码按版面位置自动去掉，双栏页面按栏读；也可用 OpenAI 兼容的视觉模型做云端识别。逐页在后台识别，前几页好了就能开始听，边听边识别
- **声音可选**
  - 系统声音：免费、离线。iPhone 只把自带的基础声音提供给网页；另有「跟随 iPhone 设置」（实验）选项，部分 iOS 版本能用上你在系统里下载的高品质声音
  - Azure 神经语音（推荐）：晓晓、云希等，非常自然；免费额度每月 50 万字；支持锁屏后台连续播放
  - OpenAI 兼容接口：gpt-4o-mini-tts 或其它兼容 `/v1/audio/speech` 的服务
- **调速**：0.5×–3×，每本书分别记住语速和声音
- **分书记忆进度**：每本书单独显示进度百分比、当前章节、最近收听时间；可以随时切换着听不同的书
- **分章记忆位置**：每一章都记住上次读到哪里。点错跳到别的章节，再点回原来那一章，会接着刚才的位置读；目录里读过一部分的章节显示「读到 x%」，旁边的「从头」可以从这一章开头读；完整听完的章节下次从头读
- **快速定位**：正在朗读的句子高亮显示，自动翻页跟随；滚动走开后点「回到朗读位置」立即跳回
- **读书笔记**：点任意句子 → 写笔记 / 录语音笔记；播放中可一键「语音笔记」；可选把录音自动转成文字
- **导出**：笔记导出为 Markdown、纯文本，或连同录音打包为 ZIP；通过系统分享可存到「文件」、备忘录、微信等
- **其它**：目录跳转、定时关闭（按分钟 / 读完本章）、锁屏控制、深色 / 羊皮纸 / 护眼主题、字号字体调节、完整备份与恢复、离线可用

所有书籍、进度、笔记都只保存在你自己的设备上。

## 推荐的电子书格式

1. **EPUB**：最好。文字是原文，没有错字，章节目录现成
2. **AZW3 / MOBI**：也很好（必须是没有加密的文件；在微信读书、京东读书等 App 里买的书一般导不出来）
3. **TXT**：文字准确，章节靠自动识别
4. **文字版 PDF**（能选中复制文字的）：可以用，偶尔断段
5. **扫描版 PDF**：最后的选择。要先识别文字，准确率已经很高，但难免偶尔有错字

同一本书能找到 EPUB 就用 EPUB。

## 隐私与安全

- 书籍、进度、笔记、录音都只保存在你自己的手机上（这个网页 App 自己的存储里），不会上传
- Azure / OpenAI 的密钥也只保存在本机，只直接发给微软或你填写的接口服务器；不在代码和 GitHub 仓库里，也不在备份文件里。别人打开同一个网址，用的是他们自己手机上的空白存储，看不到你的密钥，也用不了你的额度
- 建议 Azure 语音资源选免费定价层 F0：超出每月免费额度只会停用，不会扣费。担心泄露时可以在 Azure 门户「密钥和终结点」里「重新生成密钥」，再把新密钥填回应用
- 云端识别（扫描版 PDF）会把页面图片发给你填写的接口；本机识别不上传任何内容

## 部署（GitHub Pages，免费）

1. 代码合并到 `main` 分支后会自动发布
2. 第一次需要在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**
3. 等 Actions 里的 “Deploy to GitHub Pages” 跑完，访问 `https://<你的用户名>.github.io/<仓库名>/`

> GitHub Pages 对私有仓库需要付费账户。如果仓库是私有的，也可以用 Cloudflare Pages / Netlify / Vercel 免费部署：构建命令 `npm run build`，输出目录 `dist`。

## 更新应用

新版本发布后，打开 App 会提示「新版本已就绪」，点「立即更新」即可；「设置」页最下面可以看到当前版本号。

## 在 iPhone 上安装

1. 用 **Safari** 打开部署好的网址
2. 点底部「分享」→「添加到主屏幕」
3. 以后从主屏幕图标打开（先安装再导入书籍：主屏幕应用和 Safari 的数据是分开保存的）

## 让朗读更自然

- **系统声音**：iPhone 上所有浏览器和主屏幕网页 App 的朗读都由苹果 WebKit 提供，为了防止设备指纹追踪，它只把系统自带的基础声音（中文一般是婷婷、美佳、善怡）提供给网页。在「设置 → 辅助功能 → 朗读内容 → 声音」里另外下载的增强 / 高级声音和 Siri 声音，网页都读不到，刷新、重启、换浏览器都没有用（[苹果工程师的说明](https://developer.apple.com/forums/thread/723503)、[WebKit 源码](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/cocoa/PlatformSpeechSynthesizerCocoa.mm)）。可以试试「声音」列表最上面的「跟随 iPhone 设置」（实验）：本应用不指定声音，只告诉 iPhone 用哪种语言，由 iPhone 按「朗读内容」里为这种语言选中的声音来读。部分 iOS 版本会用上你下载的声音，部分不会（例如 iOS 26 早期版本），和婷婷试听对比一下就知道
- **Azure**：在 Azure 门户创建「语音服务」资源（定价层选免费 F0），在「密钥和终结点」复制密钥与区域，填到应用「设置」里，点「测试并试听」
- **OpenAI**：在「设置」填写 API Key，模型默认 `gpt-4o-mini-tts`，可以用「朗读风格」描述想要的语气

关于扫描版 PDF：识别只在 App 位于前台时进行（屏幕会保持常亮），切到后台会暂停，回来后自动继续；书架上会显示「识别中 x/y 页」，可以在书的「⋯」菜单里暂停或继续。有几本书同时在识别时，正在听或正在看的那本优先。识别时会去掉每页重复的页眉、页码，被翻页截断的句子会接回一段，朗读不会在句子中间停顿。网络问题导致的识别失败会自动重试，联网后自动继续。全书识别完后，保存在本机的原始 PDF 会被删除以节省空间（识别结果保留）。

关于锁屏播放：云端声音（Azure / OpenAI）是普通音频，锁屏后可以连续播放并显示锁屏控件。系统声音在锁屏后能否继续取决于 iOS，建议开启「朗读时屏幕常亮」；也可以试试设置里的「锁屏继续朗读（实验）」。

## 更新记录

- **v1.4**：扫描版 PDF 改用 PaddleOCR 本机识别（同一页测试：原来错 12～16 个字，现在 0 个），简体繁体都很准，首次使用下载约 33 MB；按版面位置去掉页眉、页码（识别错了也能去掉），双栏页面按栏读；设备不支持时自动改用兼容模式
- **v1.3**：分章记忆位置；说明 iPhone 只把基础系统声音提供给网页，新增「跟随 iPhone 设置」声音（实验）
- **v1.2**：后台识别更稳：正在听的书优先识别、失败自动重试、联网后自动继续；去掉重复的页眉页码，跨页的句子接回一段；识别完删除原始 PDF 节省空间
- **v1.1**：扫描版、乱码 PDF 识别文字（繁体书自动选繁体）；刷新声音列表有提示
- **v1.0**：多格式导入、多种声音、调速、分书记忆进度、读书笔记与导出、备份恢复、离线可用

## 本地开发

```bash
npm install
npm run dev      # 开发服务器（手机和电脑在同一网络时可用手机访问）
npm test         # 单元测试
npm run build    # 生产构建，输出到 dist/
```

技术栈：Vite + Preact + TypeScript，IndexedDB 本地存储，Service Worker 离线缓存。

## 致谢

- [foliate-js](https://github.com/johnfactotum/foliate-js)（MIT）：EPUB / MOBI / AZW3 / FB2 解析
- [pdf.js](https://github.com/mozilla/pdf.js)（Apache-2.0）：PDF 文字提取和页面渲染
- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)（Apache-2.0）的 PP-OCR 模型、[ppu-paddle-ocr](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr)（MIT）、[ONNX Runtime Web](https://github.com/microsoft/onnxruntime)（MIT）：扫描版 PDF 的本机文字识别
- [Tesseract.js](https://github.com/naptha/tesseract.js)（Apache-2.0）：不支持 PaddleOCR 的设备上的备用识别引擎
- [fflate](https://github.com/101arrowz/fflate)（MIT）、[idb](https://github.com/jakearchibald/idb)（ISC）、[Preact](https://preactjs.com)（MIT）

---

## English

**Tingshu (听书, "listen to books")** is an ebook reader that reads your books aloud: a text-to-speech audiobook player built as a progressive web app (PWA) for iPhone. Open it in Safari and choose "Add to Home Screen" to use it full-screen like a native app, with no App Store needed. The interface is in Chinese; books can be in Chinese, English or other languages.

👉 **Try it: <https://allenyu777.github.io/test/>** (open in Safari, then Share → Add to Home Screen)

### Features

- **Many formats**: EPUB, MOBI, AZW3, PDF, TXT (UTF-8 / GBK / Big5 detected automatically), FB2, DOCX, HTML, Markdown
- **Scanned and garbled PDFs**: on-device OCR with PaddleOCR models (simplified and traditional Chinese, English); a one-time download of about 33 MB, then works offline and uploads nothing. Falls back to Tesseract on devices that can't run it (before iOS 16.4). Running headers and page numbers are removed by their position on the page, two-column pages are read column by column, and sentences split across pages are joined. Pages are recognized in the background, so you can start listening after the first few. Optional cloud OCR through any OpenAI-compatible vision model
- **Voices**
  - System voices: free and offline. iOS only exposes its built-in voices to web pages; an experimental "follow iPhone settings" option may use a downloaded higher-quality voice on some iOS versions
  - Azure neural voices (recommended): very natural, 500,000 free characters per month, keeps playing on the lock screen
  - Any OpenAI-compatible `/v1/audio/speech` service (e.g. gpt-4o-mini-tts)
- **Speed** from 0.5× to 3×; speed and voice are remembered per book
- **Progress per book and per chapter**: each book keeps its own position; each chapter remembers where you stopped, so jumping to the wrong chapter and back resumes where you were
- **Follow along**: the sentence being read is highlighted and the page scrolls with it; one tap jumps back to the reading position
- **Notes**: text or voice notes on any sentence, optional speech-to-text; export as Markdown, plain text, or a ZIP with recordings
- **Also**: table of contents, sleep timer (minutes or end of chapter), lock-screen controls, light / sepia / green / dark themes, font settings, full backup and restore, offline use

### Privacy

Books, progress, notes and recordings stay on your device. Azure / OpenAI keys are stored only on the device, sent only to the service you configured, and never included in backups or in this repository.

### Install on iPhone

1. Open the deployed site in **Safari**
2. Tap Share → **Add to Home Screen**
3. Always open it from the home-screen icon (home-screen apps keep their own data, separate from Safari)

### Deploy your own copy

Fork the repository, then in **Settings → Pages** set **Source** to **GitHub Actions**. Every push to `main` builds and publishes the site to `https://<user>.github.io/<repo>/`. Any static host works too: build with `npm run build` and publish `dist/`.

### Development

```bash
npm install
npm run dev      # dev server
npm test         # unit tests
npm run build    # production build into dist/
```

Built with Vite, Preact and TypeScript; IndexedDB storage; a service worker for offline use. Thanks to foliate-js, pdf.js, PaddleOCR, ppu-paddle-ocr, ONNX Runtime Web, Tesseract.js, fflate, idb and Preact (licenses listed above).
