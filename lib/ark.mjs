/**
 * ark-image-gen · 生图核心（纯 fetch，零依赖）
 * 密钥只从「插件配置」或「环境变量 ARK_API_KEY」读取，绝不写入任何文件。
 */
import fs from 'node:fs';
import path from 'node:path';

export const API_DEFAULT = 'https://ark.cn-beijing.volces.com/api/v3';
export const MODEL_DEFAULT = 'doubao-seedream-5-0-flash-260915';

/** 解析生效配置：插件 config 优先，其次环境变量 */
export function resolveConfig(config = {}) {
  const env = process.env;
  return {
    apiKey: config.apiKey || env.ARK_API_KEY || '',
    model: config.model || env.ARK_MODEL || MODEL_DEFAULT,
    baseUrl: (config.baseUrl || env.ARK_BASE_URL || API_DEFAULT).replace(/\/$/, ''),
    outDir: config.outDir || env.ARK_OUT_DIR || path.join(process.cwd(), 'ark-output'),
  };
}

export const keyHint = (key) => {
  if (!key) return ''
  const prefixed = /^ark-/i.test(key) ? 'ark- 前缀，' : ''
  return `已配置（${prefixed}长度 ${key.length}）`
}

/**
 * 密钥会随 Authorization 头发出去，所以只允许 https；
 * 本机调试（localhost / 127.0.0.1 / [::1]）放行 http。
 */
export function assertSecureBaseUrl(baseUrl) {
  let url
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error(`baseUrl 不是合法 URL：${baseUrl}`)
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !local) {
    throw new Error('baseUrl 必须是 https：密钥会随请求头发送，明文 http 只允许本机地址')
  }
  return baseUrl
}

const EXT_BY_MAGIC = [
  { ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];
export const detectExt = (buf) => (EXT_BY_MAGIC.find((m) => m.test(buf))?.ext ?? 'png');

/** 本地路径 → data URL；URL / data URL 原样返回 */
export function toImageRef(v) {
  if (typeof v !== 'string') throw new Error('image 必须是字符串路径或 URL');
  if (/^(https?:|data:)/i.test(v)) return v;
  const abs = path.resolve(v);
  if (!fs.existsSync(abs)) throw new Error(`参考图不存在：${v}`);
  const ext = path.extname(abs).slice(1).toLowerCase().replace(/^jpg$/, 'jpeg');
  return `data:image/${ext};base64,${fs.readFileSync(abs).toString('base64')}`;
}

function pickImage(json) {
  const d = json?.data?.[0];
  if (!d) throw new Error(`响应缺少 data：${JSON.stringify(json).slice(0, 200)}`);
  if (d.b64_json) return Buffer.from(d.b64_json, 'base64');
  const url = d.url ?? d.image_url ?? d.imageUrl;
  if (!url) throw new Error('响应缺少图片字段');
  return url;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 出 1 张：返回 { buffer, body } */
export async function generateOne({ prompt, size, seed, image, model, watermark = false, outputFormat }, cfg, { retries = 2, timeoutMs = 300000 } = {}) {
  if (!cfg.apiKey) throw new Error('未配置 ARK_API_KEY：请设置环境变量，或在插件配置里填 apiKey');
  if (!prompt) throw new Error('prompt 不能为空');
  assertSecureBaseUrl(cfg.baseUrl);
  const body = {
    model: model || cfg.model,
    prompt,
    response_format: 'url',
    stream: false,
    watermark,
  };
  body.size = size || '2K';
  if (seed !== undefined && seed !== null) body.seed = seed;
  if (image) body.image = Array.isArray(image) ? image.map(toImageRef) : toImageRef(image);
  if (outputFormat) body.output_format = outputFormat;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${cfg.baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
        err.retryable = res.status === 429 || res.status >= 500;
        throw err;
      }
      const got = pickImage(await res.json());
      const buffer = typeof got === 'string'
        ? Buffer.from(await (await fetch(got, { signal: AbortSignal.timeout(timeoutMs) })).arrayBuffer())
        : got;
      return { buffer, body };
    } catch (e) {
      lastErr = e;
      if (!e.retryable || attempt === retries) break;
      await sleep(1500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

/** 出图并落盘，返回文件信息 */
export async function generateToFile(args, cfg, exec) {
  const { buffer, body } = await generateOne(args, cfg, exec);
  fs.mkdirSync(cfg.outDir, { recursive: true });
  const base = (args.file || `ark_${Date.now()}`).replace(/[\\/:*?"<>|]/g, '_');
  const ext = detectExt(buffer);
  const target = path.join(cfg.outDir, `${base}.${ext}`);
  fs.writeFileSync(target, buffer);
  const manifest = path.join(cfg.outDir, 'manifest.json');
  let arr = [];
  if (fs.existsSync(manifest)) { try { arr = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch { arr = []; } }
  arr.push({ file: path.basename(target), model: body.model, size: body.size, seed: args.seed ?? null, prompt: args.prompt, ts: new Date().toISOString() });
  fs.writeFileSync(manifest, JSON.stringify(arr, null, 2), 'utf8');
  return { path: target, bytes: buffer.length, ext, model: body.model, size: body.size, seed: args.seed ?? null };
}
