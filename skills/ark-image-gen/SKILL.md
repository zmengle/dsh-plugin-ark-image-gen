---
name: ark-image-gen
description: Use when generating or editing images with the Volcano Ark (火山方舟) / Doubao Seedream API — text-to-image, image-to-image with reference images, variants with fixed seeds, or diagnosing credential/model errors. Prefer the ark_generate_image tool.
whenToUse: 需要出图/改图（豆包 Seedream）、要复现同一张图（固定 seed）、或报 403/404/InvalidParameter 时。
---

# 生图（火山方舟 / 豆包 Seedream）

**首选工具 `ark_generate_image`**（本插件注册的模型工具），不要自己拼 HTTP 请求。

## 先自检

```
ark_image_gen_status()
```

返回 `ready: false` 时，让用户配置密钥（**不要索取明文，也不要写进文件**）：

- 环境变量：`setx ARK_API_KEY "ark-…"`（重开终端生效）
- 或在插件配置里：`config: { apiKey: !!js process.env.ARK_API_KEY }`

## 出图

```
ark_generate_image({ prompt: "一枚象牙白麻将牌，俯视，深墨绿呢面背景", size: "1024x1024", seed: 1001 })
ark_generate_image({ prompt: "把这张改成线稿", image: ["D:/work/photo.jpg"], size: "2K" })
ark_generate_image({ prompt: "…", count: 3, seed: 2000 })      // 出 3 张，seed 依次 +1
```

| 参数 | 说明 |
|---|---|
| `prompt` | 提示词。**不要用 ASCII 双引号**，用「」或转义 |
| `size` | `2K`（默认，沿用参考图比例）/ `4K` / `1024x1024` 这类精确尺寸 |
| `seed` | 固定可复现；`count>1` 时依次 +1 |
| `image` | 参考图数组：本地绝对路径 / http URL / data URL |
| `count` | 1–4 张 |
| `file` | 输出文件名（不带扩展名） |
| `outDir` | 覆盖输出目录（默认 `<cwd>/ark-output`） |

出图落盘并写 `manifest.json`（模型/尺寸/种子/提示词），工具返回文件**绝对路径**。

## 常见报错

| 现象 | 原因 | 处理 |
|---|---|---|
| `HTTP 400 … image generation is only supported by certain models` | 用了语言模型 | 模型必须是 `doubao-seedream-*` |
| `HTTP 404 ModelNotOpen` | 模型未开通 | 换已开通模型或去控制台开通 |
| `HTTP 403 AccessDenied` | 账号无权限/额度 | 检查账号与 Key 所属项目 |
| 图片带水印 | 未关水印 | 工具已默认 `watermark: false` |
| 扩展名不对 | 按请求参数命名 | 工具按**图片魔数**判定扩展名 |

## 注意

- 按调用计费：先 `ark_image_gen_status`，量大了先用 `count: 1` 试风格
- 不同批次用不同 `outDir`，避免产物混在一起
