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
- **后退 10 秒 / 快进 15 秒**：播放栏的两个按钮按时间跳（按语速估算，跳到那一句的开头），秒数可在设置里改成 5 / 10 / 15 / 30 秒；锁屏和耳机上的快进快退也一样
- **调速**：0.5×–3×，每本书分别记住语速和声音
- **分书记忆进度**：每本书单独显示进度百分比、当前章节、最近收听时间；可以随时切换着听不同的书
- **分章记忆位置**：每一章都记住上次读到哪里。点错跳到别的章节，再点回原来那一章，会接着刚才的位置读；目录里读过一部分的章节显示「读到 x%」，旁边的「从头」可以从这一章开头读；完整听完的章节下次从头读
- **脚注只看不听**：书页下方的注释（〔1〕 民国《临县志》……）和正文里的注释编号（〔7〕、①、上标数字）在屏幕上照常显示（脚注用小字），朗读时自动跳过，跨页的句子也不会被脚注打断；扫描版、文字版 PDF 和 EPUB/MOBI 都支持。想听注释可以在设置里打开「朗读脚注」
- **目录页、版权页、图表只看不听**：书前印的目录页、版权页（ISBN、定价、责任编辑……）、图表标题、表格（扫描版按表格的框线认出整张表，连同标题和下面的资料来源）用灰色显示，朗读时跳过；印出来的目录也不会被误当成章节。设置里可以打开「朗读目录、版权页和图表」
- **跳过本段**：遇到不想听的内容（大段引文等），点播放栏的「跳过本段」直接从下一段开始
- **快速定位**：正在朗读的句子高亮显示，自动翻页跟随；滚动走开后点「回到朗读位置」立即跳回
- **划线、书签、笔记**：点任意句子可以「划线」「笔记」「书签」，阅读页顶部的书签按钮一键在朗读位置加书签；笔记列表按全部 / 笔记 / 划线 / 书签筛选，导出时一起导出
- **全书搜索**：阅读页点「目录」，在最上面的搜索框输入词语，列出全书所有出现的地方（带前后文）；点一条跳过去并闪一下，正在播放的不受影响，点那句话可以「从这读」
- **点注释编号看注释**：正文里的〔7〕、①、上标数字点一下，直接弹出对应的注释内容，不用翻到页底
- **书架分组**：书架分「在读」「已读完」两栏；读到全书结尾自动归到「已读完」，也可以在书的「⋯」菜单里手动「标记为已读完」（跳过了某些章节的书也能归进去）或「移回在读」，书末也有按钮；搜索时在全部书里找
- **听书统计**：书架上显示今天、本周听了多久和连续收听天数，点开看最近 7 天的柱状图、累计时长、听完几本、听得最多的书
- **读书笔记**：播放中点底部「笔记」，可以打字也可以录音；可选把录音自动转成文字
- **导出**：笔记导出为 Markdown、纯文本，或连同录音打包为 ZIP；通过系统分享可存到「文件」、备忘录、微信等
- **其它**：目录跳转、定时关闭（按分钟 / 读完本章）、锁屏控制、深色 / 羊皮纸 / 护眼主题、字号字体调节、完整备份与恢复、离线可用

所有书籍、进度、笔记都只保存在你自己的设备上。

## 推荐的电子书格式

1. **EPUB**：最好。文字是原文，没有错字，章节目录现成
2. **AZW3 / MOBI**：也很好（必须是没有加密的文件；从 Kindle 商店、微信读书、京东读书等买的书一般有加密，导不进来）
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

新版本发布后，书架左上角会一直显示「新版本 · 点击更新」，什么时候方便就点一下（正在听书时不会打断）；「设置」页最下面也有这个按钮，并显示当前版本号。没看到的话，把 App 从后台关掉再打开一次。

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

- **v1.18**：锁屏 ±秒按钮兜底：iOS 有时不经过 App、直接把正在播放的那一小段音频拨动 10 秒，现在 App 能察觉并改成按设置的秒数在全书里跳；设置里新增「播放诊断记录」，记录锁屏按钮、播放中断等，方便排查
- **v1.17.5**：修复锁屏上按快进/快退（以及跳章）后不再出声：跳转时不再先停下声音，而是马上换成静音接着放，新位置的语音下载好再换过去（锁屏时声音一停，iOS 就不允许页面自己再开始播放）
- **v1.17.4**：修复锁屏听扫描版时读到识别进度处停下后不再接着读：等后面页面识别期间继续播放静音，页面不会被 iOS 挂起，识别好后直接接着朗读（最多等 15 分钟）
- **v1.17.3**：修复扫描版锁屏后识别停住：页面渲染改为不依赖动画帧（锁屏、切到后台时动画帧不触发，识别会卡在当前页，听到识别进度处就停下等待）
- **v1.17.2**：去掉「定时」里的「现在停止并收起锁屏控件」按钮
- **v1.17.1**：修复锁屏控件仍显示上一节/下一节：iOS 在开始出声、换一段音频时会丢掉之前设置的按钮，现在每次开始出声、回到前台时都重新设置
- **v1.17**：锁屏和控制中心的播放控件左右两边改成快退/快进按钮（秒数跟随设置里的「后退」「快进」），设置里「锁屏控件按钮」可以换回上一节/下一节
- **v1.16.1**：正文里的注释编号（〔3〕、[5〕、(2] 这类，识别时括号常认错一半）在屏幕上显示成像原书一样的小号上标，编号后面多出来的空格不再占位置；点编号仍然可以看注释，朗读时照旧跳过
- **v1.16**：扫描版的表格整张跳过：按页面上表格的框线（或三线表的横线）认出整张表，表头、每个格子里的文字连同上面的「表 2-4 ……」标题、下面的「资料来源：」都显示为灰色、朗读时跳过，在屏幕上留在原来的位置；整段缩进的引文（首行缩进四个字、其余缩进两个字）不再被拆成一行一段
- **v1.15**：扫描版按版面认出插图和图表说明：图里的文字（坐标轴、图例）、图表标题，以及下面「说明：1. 2. 3.」这类悬挂缩进的说明，都显示为灰色、朗读时跳过；每条说明合成完整的一段，不再按行断开；整页都是插图时，前后两页没说完的句子照样接起来
- **v1.14.3**：目录项定位到标题所在的那一段：PDF 书签只记页码，一页上同时有「第三章」和它的「第一节」时，章的开头不再被算进第一节；以前导入的书打开时也会自动重新定位
- **v1.14.2**：很长的一节分成几页显示时，翻页按钮写「上一页 / 下一页 · 本节第 2/3 部分」，页首注明「（续，第 2/3 部分）」，不再误写成「上一章」
- **v1.14.1**：章节时长按声音实际的朗读速度估算（云端语音每读一段就校准一次，原来固定按每分钟 260 字，Azure 声音读得更快，时长显得偏长）；锁屏控件和播放栏都按目录里的每一项（例如每一节）计时
- **v1.14**：书架分「在读」「已读完」两栏，可以手动标记已读完或移回在读；手动标记后再听其中的章节也不会被改回在读
- **v1.13.2**：锁屏控件的按钮和实际状态一致：暂停时音频真正暂停（显示「播放」按钮），改用听不见的 Web Audio 让 App 保持活跃，锁屏上点播放仍能马上继续
- **v1.13.1**：暂停时用来保持锁屏控件可用的静音改成完全无声（之前混有轻微的嗡嗡声）；暂停超过 5 分钟就真正停下并收起锁屏控件，再在 App 里点播放会从原位置继续
- **v1.13**：锁屏控件暂停后再播放没反应的问题：iOS 上的网页应用暂停一会儿后系统会收回它的音频（WebKit 已知问题），现在云端语音暂停时用静音占着音频（最长 30 分钟），锁屏、耳机上随时能继续，并从暂停的位置接着读；同时告诉 iOS 这是媒体播放（audioSession）
- **v1.12.2**：云端语音播放时每秒检查一次是不是真的在出声：iOS 拒绝或打断播放时自动重新播放；实在播不了就显示为暂停，点一下播放即可（不会再出现显示在播放、其实没声音，要先暂停再播放的情况）；回到 App 时也会马上检查
- **v1.12.1**：修复云端语音在锁屏控件上暂停后再点播放没有声音（要打开 App 才响）的问题：锁屏的播放 / 暂停直接交给系统控制音频
- **v1.12**：云端语音（Azure / OpenAI）更稳：网络断开、切换 Wi-Fi 时自动等待和重试（请求超时 25 秒，最多重试 5 次），下一段还没下载好时先播放静音，锁屏后不会被系统挂起；锁屏和控制中心的进度条按整章显示（可拖动），不再每一两句就重新开始
- **v1.11**：后退、快进按钮改成按时间跳（默认后退 10 秒、快进 15 秒，可在设置里调整），按钮上显示秒数
- **v1.10**：全书搜索（在目录里搜索，点结果跳到原文，不打断正在听的内容）
- **v1.9**：划线和书签（笔记列表可筛选，随笔记导出）；点正文里的注释编号直接弹出注释；听书统计（今天、本周、连续天数、最近 7 天、听得最多的书，完整备份时一起备份）
- **v1.8**：有新版本时书架左上角一直显示「新版本 · 点击更新」，点了才更新（设置页底部也有，并显示当前版本号）；播放栏的「语音笔记」「写笔记」合并成一个「笔记」按钮
- **v1.7.1**：扫描版按书上的脚注线（正文和注释之间的短横线）找脚注，识别时注释行和正文一样高、中英文混排的注释也能认出来
- **v1.7**：目录页、版权页、图表说明和表格只显示不朗读；新书从第一章开始读；播放栏新增「跳过本段」
- **v1.6**：脚注只显示、不朗读：页面下方的注释和正文里的注释编号听书时自动跳过，跨页的句子不再被脚注打断；设置里可打开「朗读脚注」
- **v1.5**：iPhone 上导入时 MOBI、AZW3、FB2 文件不再是灰色、可以选中了；选错文件（照片、Word 等）或书有 DRM 加密时直接说明原因
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
- **Footnotes are shown but not read aloud**: notes at the bottom of the page and note numbers in the text (〔7〕, ①, superscripts) stay on screen in small print but are skipped while listening, so sentences that run across a page aren't interrupted. Works for scanned and text PDFs and for EPUB/MOBI; turn on "Read footnotes" in Settings if you want them
- **Contents pages, copyright pages, figures and tables are shown but not read**: printed contents and copyright pages, figure and table captions, table rows and source lines appear in grey and are skipped while listening (a Settings switch reads them anyway). "Skip paragraph" in the player jumps to the next paragraph
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
