# dsh-plugin-ark-image-gen

火山方舟 / 豆包 Seedream 生图插件 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)。
Text-to-image and image-to-image through the Volcano Ark API, with a bundled skill so the model knows how to use it.

给 DSH 两个模型工具 + 一个内置技能：

| 工具 | 作用 |
|---|---|
| `ark_generate_image` | 文生图 / 图生图（单张或多张参考图）、一次出多张、固定 seed 复现 |
| `ark_image_gen_status` | 自检：密钥是否就绪、生效模型、网关、输出目录（**不发请求、不计费**） |

出图会落盘到输出目录并追加写 `manifest.json`（文件名、模型、尺寸、seed、prompt、时间）。

## 安装

```sh
# npm
dsh plugin --profile web add dsh-plugin-ark-image-gen

# 或直接从 GitHub（源码安装）
dsh plugin --profile web add https://github.com/zmengle/dsh-plugin-ark-image-gen
```

装好后重启 `dsh web`（或桌面端），插件行是 `ark-image-gen`。

## 配置

密钥**只从环境变量或插件配置读取，绝不写入任何文件**。

| 环境变量 | 插件配置键 | 默认值 | 说明 |
|---|---|---|---|
| `ARK_API_KEY` | `apiKey` | —（必填） | 火山方舟 API Key，形如 `ark-...` |
| `ARK_MODEL` | `model` | `doubao-seedream-5-0-flash-260915` | 生图模型 |
| `ARK_BASE_URL` | `baseUrl` | `https://ark.cn-beijing.volces.com/api/v3` | 网关地址 |
| `ARK_OUT_DIR` | `outDir` | `<工作目录>/ark-output` | 出图目录 |

```powershell
# Windows：设置环境变量后重开终端
setx ARK_API_KEY "ark-xxxx"
```

也可以写进 profile 补丁（推荐，别把密钥放进仓库）：

```yaml
- id: ark-image-gen
  config:
    apiKey: !!js process.env.ARK_API_KEY
    outDir: D:/ark-output
```

## 用法

模型侧直接调用 `ark_generate_image`：

| 参数 | 类型 | 说明 |
|---|---|---|
| `prompt` | string（必填） | 提示词。**不要用 ASCII 双引号**，用「」或转义 |
| `size` | string | `"2K"`（默认，沿用参考图比例）/ `"4K"` / `"1024x1024"` 这类精确尺寸 |
| `seed` | integer | 随机种子，固定它可复现 |
| `image` | string[] | 参考图：本地绝对路径 / http URL / data URL。单张也用数组 |
| `count` | integer | 出几张（1-4，默认 1）；多张时 seed 依次 +1 |
| `file` | string | 输出文件名（不带扩展名），默认 `ark_<时间戳>` |
| `model` | string | 覆盖默认模型（必须是 `doubao-seedream-*`） |
| `outDir` | string | 覆盖输出目录 |

返回：

```json
{
  "ok": true,
  "model": "doubao-seedream-5-0-flash-260915",
  "size": "2K",
  "files": [{ "path": "D:/ark-output/ark_1750000000000.png", "bytes": 1843200, "seed": 42 }]
}
```

## 内置技能

插件同时注册技能 `ark-image-gen`（`skills/ark-image-gen/SKILL.md`），说明用法和踩坑表，
模型可以自己发现它；也可以直接说「用 ark 生成一张……」。

## 行为说明

- 请求 `POST <baseUrl>/images/generations`，`response_format: url`，`watermark: false`。
- 429 与 5xx 自动重试 2 次，指数退避；单次请求超时 300 秒，工具级超时 600 秒。
- 图片按文件头（magic number）识别 `png` / `jpg` / `webp` 再落盘，不信任响应里的扩展名。
- 本地参考图会转成 base64 data URL 发送——**大图会显著增加请求体体积**。
- 默认模型名可能随火山方舟下线调整，遇到 404 用 `model` 参数或 `ARK_MODEL` 指定当前可用模型。

## 安全

- 密钥**只从环境变量 `ARK_API_KEY` 或插件 `config.apiKey` 读取**，不写入任何文件、不进日志、不进 `manifest.json`。
- `ark_image_gen_status` 只报告「已配置（长度 N）」，**不显示密钥片段的任何字符**。
- 密钥随 `Authorization` 头发送，所以 `baseUrl` **必须是 https**；明文 `http` 只允许 `localhost` / `127.0.0.1` / `[::1]` 的本机调试，其他地址直接拒绝。
- 报错只带 HTTP 状态码和响应体前 400 字符，不回显请求头。
- 把密钥写进 profile 补丁时用 `!!js process.env.ARK_API_KEY`，不要写明文——补丁文件是会进 Git 的。
- 参考图会以 base64 data URL 随请求发送，图片越大请求体越大，注意不要顺手把含隐私的截图发出去。

## 许可

MIT
