/**
 * dsh-plugin-ark-image-gen — 火山方舟 / 豆包 Seedream 生图插件
 *
 * 注册两个模型工具：
 *   ark_generate_image  文生图 / 图生图（单张或多张），出图落盘并写 manifest
 *   ark_image_gen_status 自检：密钥是否就绪、模型/网关/输出目录
 *
 * 并注册内置技能 ark-image-gen（用法说明 + 踩坑表），让模型知道怎么用这个工具。
 *
 * 密钥策略：**只从插件 config 或环境变量 ARK_API_KEY 读取**，不写在任何文件里。
 *   - 环境变量：setx ARK_API_KEY "ark-xxx"（重开终端生效）
 *   - 或插件配置：config: { apiKey: !!js process.env.ARK_API_KEY }
 */
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill';
import { resolveConfig, keyHint, generateToFile } from './lib/ark.mjs';

export const name = 'ark-image-gen';
export const inject = ['tools'];

// ---------- 工具 ----------
const statusTool = defineTool({
  name: 'ark_image_gen_status',
  description:
    '检查火山方舟/豆包生图是否就绪：密钥是否配置、生效模型、网关地址、输出目录。'
    + '在第一次出图前、或出图报鉴权错误时使用（不发请求、不计费）。',
  timeoutMs: 10000,
  parameters: {},
  output: {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        ready: { type: 'boolean', required: true },
        hasKey: { type: 'boolean', required: true },
        keyHint: { type: 'string' },
        model: { type: 'string', required: true },
        baseUrl: { type: 'string', required: true },
        outDir: { type: 'string', required: true },
        hint: { type: 'string' },
      },
    },
    render: (_a, v) => [{
      type: 'text',
      text: v.ready
        ? `✅ 已就绪\n模型  ${v.model}\n网关  ${v.baseUrl}\n密钥  ${v.keyHint}\n输出  ${v.outDir}`
        : `❌ 未就绪：${v.hint}`,
    }],
  },
  async execute(_args, exec) {
    const cfg = resolveConfig(exec?.config ?? {});
    const hasKey = Boolean(cfg.apiKey);
    return {
      ready: hasKey,
      hasKey,
      keyHint: keyHint(cfg.apiKey),
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      outDir: cfg.outDir,
      hint: hasKey ? '' : '设置环境变量 ARK_API_KEY（setx ARK_API_KEY "ark-…"）或在插件配置里填 apiKey',
    };
  },
  presentCall: () => ({ card: 'generic', title: '检查生图配置', kind: 'read', rawInput: {} }),
});

const generateTool = defineTool({
  name: 'ark_generate_image',
  description:
    '用火山方舟 / 豆包 Seedream 生成图片（文生图，或带 image 参考图的图生图/多参考图）。'
    + '支持 size（"2K" / "4K" / "1024x1024"）、seed 复现、count 多张。'
    + '出图会落盘到输出目录并写入 manifest.json，返回文件绝对路径。',
  timeoutMs: 600000,
  parameters: {
    prompt: { type: 'string', required: true, description: '提示词。不要用 ASCII 双引号，用「」或转义' },
    size: { type: 'string', description: '"2K"（默认，沿用参考图比例）/ "4K" / "1024x1024" 这类精确尺寸' },
    seed: { type: 'integer', description: '随机种子；固定它可复现结果' },
    image: {
      type: 'array',
      description: '参考图数组：本地绝对路径 / http URL / data URL。单张也请用数组',
    },
    count: { type: 'integer', description: '出几张（1-4，默认 1）；多张时 seed 依次 +1' },
    file: { type: 'string', description: '输出文件名（不带扩展名）；默认 ark_<时间戳>' },
    model: { type: 'string', description: '覆盖默认模型（必须是 doubao-seedream-*）' },
    outDir: { type: 'string', description: '覆盖输出目录' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        ok: { type: 'boolean', required: true },
        model: { type: 'string', required: true },
        size: { type: 'string', required: true },
        files: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: true,
            properties: {
              path: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              seed: { type: 'integer' },
            },
          },
        },
        error: { type: 'string' },
      },
    },
    render: (_a, v) => [{
      type: 'text',
      text: v.ok
        ? `已生成 ${v.files.length} 张（${v.model} · ${v.size}）\n${v.files.map((f) => `  ${f.path}  ${Math.round(f.bytes / 1024)} KB${f.seed != null ? `  seed=${f.seed}` : ''}`).join('\n')}`
        : `生成失败：${v.error}`,
    }],
  },
  async execute(args, exec) {
    const cfg = resolveConfig({ ...(exec?.config ?? {}), ...(args.outDir ? { outDir: args.outDir } : {}) });
    const count = Math.max(1, Math.min(4, args.count || 1));
    const files = [];
    try {
      for (let i = 0; i < count; i++) {
        const seed = args.seed != null ? args.seed + i : undefined;
        const file = count > 1 ? `${args.file || `ark_${Date.now()}`}_${i + 1}` : args.file;
        const r = await generateToFile(
          { prompt: args.prompt, size: args.size, seed, image: args.image, model: args.model, file },
          cfg,
          { retries: 2, timeoutMs: 300000 },
        );
        files.push({ path: r.path, bytes: r.bytes, seed: r.seed ?? null, ext: r.ext });
      }
      return { ok: true, model: cfg.model, size: args.size || '2K', files };
    } catch (e) {
      return { ok: false, model: cfg.model, size: args.size || '2K', files, error: e.message };
    }
  },
  presentCall: (args) => ({
    card: 'generic',
    title: `生成图片：${String(args.prompt).slice(0, 48)}${String(args.prompt).length > 48 ? '…' : ''}`,
    kind: 'generate',
    rawInput: args,
  }),
});

// ---------- 内置技能 ----------
const SKILL_BODY_URL = new URL('./skills/ark-image-gen/SKILL.md', import.meta.url);
const skillCandidate = {
  name: 'ark-image-gen',
  description:
    'Use when generating or editing images with the Volcano Ark (火山方舟) / Doubao Seedream API — '
    + 'text-to-image, image-to-image with reference images, batch of variants with fixed seeds, '
    + 'or diagnosing credential/model errors. Prefers the ark_generate_image tool.',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: 'dsh-plugin-ark-image-gen',
  source: 'bundled',
  resourceBase: { kind: 'directory', path: fileURLToPath(new URL('./skills/ark-image-gen/', import.meta.url)) },
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
};

const skillProvider = {
  name: 'dsh-plugin-ark-image-gen',
  list: () => Promise.resolve([skillCandidate]),
  async get() {
    const { readFile } = await import('node:fs/promises');
    return {
      name: skillCandidate.name,
      description: skillCandidate.description,
      invocation: skillCandidate.invocation,
      resourceBase: skillCandidate.resourceBase,
      body: await readFile(SKILL_BODY_URL, 'utf8'),
    };
  },
};

// ---------- 插件主体 ----------
export function apply(ctx) {
  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.skills.registerProvider(() => skillProvider);
  });
  ctx.tools.register(statusTool);
  ctx.tools.register(generateTool);
}
