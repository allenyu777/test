# 听书 · 电子书朗读

一个给自己用的「听电子书」网页应用（PWA）。在 iPhone 的 Safari 里打开后「添加到主屏幕」，就能像 App 一样全屏使用，不需要上架 App Store。

## 功能

- **多格式**：EPUB、MOBI、AZW3、PDF、TXT（自动识别 UTF-8 / GBK / Big5）、FB2、DOCX、HTML、Markdown
- **扫描版或乱码 PDF**：自动识别文字（OCR）。文字层是乱码的 PDF（字体缺少编码，繁体/老版本 PDF 常见）也会自动发现并改为按页面图片识别；繁体书自动选繁体识别，有书签时用书签生成目录。本机识别免费、离线、不上传；也可用 OpenAI 兼容的视觉模型做云端识别。逐页在后台识别，前几页好了就能开始听，边听边识别
- **声音可选**
  - 系统声音：免费、离线，推荐在 iPhone 上下载「增强 / 高级」版本的中文声音，自然很多
  - Azure 神经语音（推荐）：晓晓、云希等，非常自然；免费额度每月 50 万字；支持锁屏后台连续播放
  - OpenAI 兼容接口：gpt-4o-mini-tts 或其它兼容 `/v1/audio/speech` 的服务
- **调速**：0.5×–3×，每本书分别记住语速和声音
- **分书记忆进度**：每本书单独显示进度百分比、当前章节、最近收听时间；可以随时切换着听不同的书
- **快速定位**：正在朗读的句子高亮显示，自动翻页跟随；滚动走开后点「回到朗读位置」立即跳回
- **读书笔记**：点任意句子 → 写笔记 / 录语音笔记；播放中可一键「语音笔记」；可选把录音自动转成文字
- **导出**：笔记导出为 Markdown、纯文本，或连同录音打包为 ZIP；通过系统分享可存到「文件」、备忘录、微信等
- **其它**：目录跳转、定时关闭（按分钟 / 读完本章）、锁屏控制、深色 / 羊皮纸 / 护眼主题、字号字体调节、完整备份与恢复、离线可用

所有书籍、进度、笔记都只保存在你自己的设备上。

## 部署（GitHub Pages，免费）

1. 把本分支合并到 `main`
2. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**
3. 等 Actions 里的 “Deploy to GitHub Pages” 跑完，访问 `https://<你的用户名>.github.io/<仓库名>/`

> GitHub Pages 对私有仓库需要付费账户。如果仓库是私有的，也可以用 Cloudflare Pages / Netlify / Vercel 免费部署：构建命令 `npm run build`，输出目录 `dist`。

## 在 iPhone 上安装

1. 用 **Safari** 打开部署好的网址
2. 点底部「分享」→「添加到主屏幕」
3. 以后从主屏幕图标打开（先安装再导入书籍：主屏幕应用和 Safari 的数据是分开保存的）

## 让朗读更自然

- **系统声音**：iPhone「设置 → 辅助功能 → 朗读内容 → 声音 → 中文」，下载带「增强」或「高级」标记的声音（需要 Wi-Fi）。下载完成后从后台完全关闭本应用再打开，新声音才会出现在「声音」面板里，选中即可。应用的声音单独设置，不跟随系统「朗读内容」的选择。Siri 的声音苹果不开放给网页和第三方应用，无法使用
- **Azure**：在 Azure 门户创建「语音服务」资源（定价层选免费 F0），在「密钥和终结点」复制密钥与区域，填到应用「设置」里，点「测试并试听」
- **OpenAI**：在「设置」填写 API Key，模型默认 `gpt-4o-mini-tts`，可以用「朗读风格」描述想要的语气

关于扫描版 PDF：识别只在 App 位于前台时进行（屏幕会保持常亮），切到后台会暂停，回来后自动继续；书架上会显示「识别中 x/y 页」，可以在书的「⋯」菜单里暂停或继续。有几本书同时在识别时，正在听或正在看的那本优先。识别时会去掉每页重复的页眉、页码，被翻页截断的句子会接回一段，朗读不会在句子中间停顿。网络问题导致的识别失败会自动重试，联网后自动继续。全书识别完后，保存在本机的原始 PDF 会被删除以节省空间（识别结果保留）。

关于锁屏播放：云端声音（Azure / OpenAI）是普通音频，锁屏后可以连续播放并显示锁屏控件。系统声音在锁屏后能否继续取决于 iOS，建议开启「朗读时屏幕常亮」；也可以试试设置里的「锁屏继续朗读（实验）」。

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
- [Tesseract.js](https://github.com/naptha/tesseract.js)（Apache-2.0）：扫描版 PDF 的本机文字识别
- [fflate](https://github.com/101arrowz/fflate)（MIT）、[idb](https://github.com/jakearchibald/idb)（ISC）、[Preact](https://preactjs.com)（MIT）
