# 安装

## 前置要求

| 依赖 | 版本要求 | 说明 |
| --- | --- | --- |
| Node.js | 22.5 或更高 | 使用内置的 `node:sqlite` 存储数据 |
| pnpm | 8.0 或更高 | 包管理器（见根目录 package.json 的 engines 约束） |
| ffmpeg / yt-dlp | 最新即可 | 由安装脚本下载到仓库内部 `bin/` 目录 |
| 语音模型 | — | 由安装脚本下载到仓库内部 `models/` 目录 |

操作系统支持 macOS（Apple Silicon）为主，Linux 与 Windows 由 sherpa-onnx 官方平台包覆盖。

## 安装步骤

```bash
# 1. 安装依赖
pnpm install

# 2. 下载 yt-dlp 与 ffmpeg（约 70MB）
pnpm run setup:bin

# 3. 下载语音模型（约 260MB：SenseVoice int8 + Silero VAD + 说话人分离两个模型）
pnpm run setup:model

# 4. 构建前端
pnpm run build

# 5. 启动服务
pnpm start
```

启动后访问 `http://127.0.0.1:3000`（服务只监听本机回环地址，不对局域网开放）。

下载脚本内置镜像源回退：官方源失败会自动切换镜像（GitHub 加速代理、hf-mirror.com），单个资源重试后仍失败会明确报错。

## 开发模式

```bash
pnpm run dev        # 同时启动后端(3000)与前端热更新(vite 默认端口)
pnpm run dev:server # 只启动后端
pnpm run dev:web    # 只启动前端
```

开发模式下前端代码修改即时生效；后端代码修改后需要重启。

## 手动下载（可选）

如果不使用安装脚本，也可以手动放置文件，目录结构如下：

```text
bin/
├── yt-dlp
└── ffmpeg

models/
├── sense-voice/
│   ├── model.int8.onnx
│   └── tokens.txt
├── silero-vad.onnx
└── diarization/
    ├── pyannote-segmentation-3-0.onnx
    └── 3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx
```

来源均为官方发布页：

- SenseVoice：`k2-fsa/sherpa-onnx` 仓库 asr-models 发布（sherpa-onnx-sense-voice-zh-en-ja-ko-yue）
- Silero VAD：silero-vad 官方仓库
- 说话人分离：`k2-fsa/sherpa-onnx` 仓库的 speaker-segmentation-models 与 speaker-recongition-models 发布（官方拼写如此）

## 数据存放

首次启动会在 `data/` 下自动创建 sqlite 数据库（`app.db`），所有项目、视频、词汇表与配置都存在这一个文件里；音频与转写产物分别放在 `data/audio/` 与 `data/transcripts/`。整个 `data/` 目录与 `models/`、`bin/` 都不进版本库，备份数据时拷贝 `data/` 目录即可。

## 登录凭证（可选）

在侧栏「设置」中粘贴哔哩哔哩 cookies.txt 全文或 `SESSDATA=xxx`，可下载会员音质。凭证只保存在本机 `data/cookies.txt`，界面上仅显示掩码。

## 常见问题

- **端口被占用**：设置环境变量 `PORT` 可更换监听端口，例如 `PORT=3200 pnpm start`。
- **下载失败或零字节文件**：多为风控或网络问题，可在「设置」配置登录凭证后重试。
- **模型未就绪就转写**：转写按钮会明确报错提示缺少模型，先运行 `pnpm run setup:model`。
