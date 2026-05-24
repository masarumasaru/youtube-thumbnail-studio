import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const root = fileURLToPath(new URL("./public/", import.meta.url));
const port = Number(process.env.PORT || 4173);
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const designModel = process.env.OPENAI_DESIGN_MODEL || "gpt-5.4-mini";
const textLayerImageModel = process.env.OPENAI_TEXT_LAYER_IMAGE_MODEL || "gpt-image-1";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/headlines") {
      await handleHeadlines(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/design") {
      await handleDesign(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/text-layer") {
      await handleTextLayer(req, res);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(root, safePath);
    if (!filePath.startsWith(root)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(port, () => {
  console.log(`Thumbnail Studio running at http://localhost:${port}/`);
});

async function handleHeadlines(req, res) {
  const apiKey = getApiKey(req);
  if (!apiKey) {
    sendJson(res, 501, {
      error: "OpenAI API key is not set",
      detail: "Enter an API key in the app, or start with OPENAI_API_KEY=... node server.mjs",
    });
    return;
  }

  const body = await readJson(req, 18 * 1024 * 1024);
  const count = clamp(Number(body.count) || 5, 2, 8);
  const script = String(body.script || "").trim();
  const brandUrl = String(body.brandUrl || "").trim();
  const moodImages = Array.isArray(body.moodImages) ? body.moodImages.slice(0, 4) : [];
  const baseImages = Array.isArray(body.baseImages) ? body.baseImages.slice(0, 4) : [];

  if (!script) {
    sendJson(res, 400, { error: "script is required" });
    return;
  }

  const brandContext = await getBrandContext(brandUrl);

  console.log(`AI headline request: model=${model}, count=${count}, moodImages=${moodImages.length}, baseImages=${baseImages.length}, brand=${brandContext.url ? "yes" : "no"}`);

  const content = [
    {
      type: "input_text",
      text: buildPrompt({ script, count, moodCount: moodImages.length, baseCount: baseImages.length, brandContext }),
    },
    ...moodImages.map((imageUrl) => ({ type: "input_image", image_url: imageUrl, detail: "low" })),
    ...baseImages.map((imageUrl) => ({ type: "input_image", image_url: imageUrl, detail: "low" })),
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions:
        "You are a senior Japanese YouTube thumbnail copywriter. Read the whole context before writing. Avoid keyword stuffing, broken fragments, generic hype, and claims not supported by the script. Output only valid JSON.",
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "thumbnail_headlines",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["headlines", "textThemes"],
            properties: {
              headlines: {
                type: "array",
                minItems: count,
                maxItems: count,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["text", "angle"],
                  properties: {
                    text: {
                      type: "string",
                      description: "Japanese thumbnail headline. Use \\n where a two-line break helps composition.",
                    },
                    angle: {
                      type: "string",
                      description: "Short Japanese note describing the strategic angle.",
                    },
                  },
                },
              },
              textThemes: {
                type: "array",
                minItems: 3,
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "direction"],
                  properties: {
                    name: { type: "string" },
                    direction: { type: "string" },
                  },
                },
              },
            },
          },
        },
        verbosity: "low",
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.warn(`OpenAI API error: status=${response.status}, message=${data.error?.message || "unknown"}`);
    sendJson(res, response.status, { error: data.error?.message || "OpenAI API request failed" });
    return;
  }

  const text = extractOutputText(data);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn("OpenAI response was not parseable JSON");
    sendJson(res, 502, { error: "OpenAI response was not valid JSON" });
    return;
  }
  console.log(`AI headline success: ${parsed.headlines?.length || 0} headlines`);
  const referenceReport = fallbackReferenceReport({ brandContext, moodCount: moodImages.length, baseCount: baseImages.length });
  sendJson(res, 200, {
    model,
    headlines: parsed.headlines.map((item) => ({
      text: normalizeHeadline(item.text),
      angle: String(item.angle || ""),
    })),
    textThemes: normalizeTextThemes(parsed.textThemes),
    referenceReport,
  });
}

async function handleDesign(req, res) {
  const apiKey = getApiKey(req);
  if (!apiKey) {
    sendJson(res, 501, {
      error: "OpenAI API key is not set",
      detail: "Enter an API key in the app, or start with OPENAI_API_KEY=... node server.mjs",
    });
    return;
  }

  const body = await readJson(req, 18 * 1024 * 1024);
  const headline = normalizeHeadline(body.headline || "");
  const textTheme = normalizeTextTheme(body.textTheme);
  const script = String(body.script || "").trim();
  const brandUrl = String(body.brandUrl || "").trim();
  const moodImages = Array.isArray(body.moodImages) ? body.moodImages.slice(0, 4) : [];
  const baseImages = Array.isArray(body.baseImages) ? body.baseImages.slice(0, 4) : [];

  if (!headline) {
    sendJson(res, 400, { error: "headline is required" });
    return;
  }
  if (!baseImages.length) {
    sendJson(res, 400, { error: "At least one base image is required" });
    return;
  }

  const brandContext = await getBrandContext(brandUrl);
  const designPlan = await createDesignPlan(apiKey, {
    headline,
    textTheme,
    script,
    moodCount: moodImages.length,
    baseCount: baseImages.length,
    brandContext,
  });

  console.log(`AI design request: model=${designModel}, moodImages=${moodImages.length}, baseImages=${baseImages.length}, brand=${brandContext.url ? "yes" : "no"}`);

  const content = [
    {
      type: "input_text",
      text: buildDesignPrompt({ headline, textTheme, script, moodCount: moodImages.length, baseCount: baseImages.length, brandContext, designPlan }),
    },
    ...moodImages.map((imageUrl) => ({ type: "input_image", image_url: imageUrl, detail: "low" })),
    ...baseImages.map((imageUrl) => ({ type: "input_image", image_url: imageUrl, detail: "low" })),
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: designModel,
      instructions:
        "You are an expert Japanese YouTube thumbnail art director. Generate one complete 16:9 YouTube thumbnail with integrated Japanese headline typography. Prioritize a cohesive design where image, color, and text feel created together.",
      input: [{ role: "user", content }],
      tools: [
        {
          type: "image_generation",
          size: "1536x1024",
          quality: "medium",
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.warn(`OpenAI design error: status=${response.status}, message=${data.error?.message || "unknown"}`);
    sendJson(res, response.status, { error: data.error?.message || "OpenAI image generation failed" });
    return;
  }

  const imageBase64 = extractImageResult(data);
  if (!imageBase64) {
    console.warn("OpenAI design response did not include image_generation_call result");
    sendJson(res, 502, { error: "OpenAI response did not include an image" });
    return;
  }

  console.log("AI design success: 1 image");
  sendJson(res, 200, {
    model: designModel,
    image: `data:image/png;base64,${imageBase64}`,
    designPlan,
    referenceReport: designPlan.referenceReport || fallbackReferenceReport({ brandContext, moodCount: moodImages.length, baseCount: baseImages.length }),
  });
}

async function handleTextLayer(req, res) {
  const apiKey = getApiKey(req);
  if (!apiKey) {
    sendJson(res, 501, {
      error: "OpenAI API key is not set",
      detail: "Enter an API key in the app, or start with OPENAI_API_KEY=... node server.mjs",
    });
    return;
  }

  const body = await readJson(req, 18 * 1024 * 1024);
  const image = String(body.image || "");
  const headline = normalizeHeadline(body.headline || "");
  const textTheme = normalizeTextTheme(body.textTheme);
  const designPlan = typeof body.designPlan === "object" && body.designPlan ? body.designPlan : {};
  const imageBase64 = image.replace(/^data:image\/\w+;base64,/, "");

  if (!imageBase64 || !headline) {
    sendJson(res, 400, { error: "image and headline are required" });
    return;
  }

  let textLayerResult = null;
  try {
    textLayerResult = await generateTransparentTextLayer(apiKey, {
      fullImageBase64: imageBase64,
      headline,
      textTheme,
      designPlan,
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "OpenAI text layer generation failed",
      detail: error.message || "OpenAI text layer generation failed",
    });
    return;
  }

  if (!textLayerResult?.textLayerBase64) {
    sendJson(res, 502, { error: "OpenAI response did not include a transparent text layer" });
    return;
  }

  sendJson(res, 200, {
    model: textLayerImageModel,
    textLayer: `data:image/png;base64,${textLayerResult.textLayerBase64}`,
    mask: textLayerResult.maskBase64 ? `data:image/png;base64,${textLayerResult.maskBase64}` : "",
    quality: textLayerResult.quality,
  });
}

async function createDesignPlan(apiKey, { headline, textTheme, script, moodCount, baseCount, brandContext }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions:
        "You are a Japanese YouTube thumbnail art director. Return a compact JSON art direction for a separate transparent text layer and a short report of references used.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "サムネ全体のアートディレクションを作ってください。背景はこの後AIで生成し、文字はブラウザで透明PNGレイヤーとして描画します。",
                "文字レイヤーが背景と一体に見えるように、配色、位置、処理を具体化してください。",
                `見出し: ${headline}`,
                `選択文字テーマ: ${textTheme.name} - ${textTheme.direction}`,
                `原稿: ${script || "未入力"}`,
                `A参考画像: ${moodCount}枚 / B元素材: ${baseCount}枚`,
                `掲載先ブランド: ${brandContext.url ? formatBrandContext(brandContext) : "指定なし"}`,
              ].join("\n"),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "thumbnail_design_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["layout", "textTreatment", "accentColor", "subAccentColor", "textColor", "strokeColor", "panelColor", "fontSize", "backgroundDirection", "referenceReport"],
            properties: {
              layout: { type: "string", enum: ["left", "right", "lower"] },
              textTreatment: { type: "string", enum: ["editorial", "sticker", "slash", "lower"] },
              accentColor: { type: "string" },
              subAccentColor: { type: "string" },
              textColor: { type: "string" },
              strokeColor: { type: "string" },
              panelColor: { type: "string" },
              fontSize: { type: "number" },
              backgroundDirection: { type: "string" },
              referenceReport: { type: "string" },
            },
          },
        },
        verbosity: "low",
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    console.warn(`OpenAI design-plan error: status=${response.status}, message=${data.error?.message || "unknown"}`);
    return defaultDesignPlan({ brandContext, moodCount, baseCount });
  }
  try {
    return { ...defaultDesignPlan({ brandContext, moodCount, baseCount }), ...JSON.parse(extractOutputText(data)) };
  } catch {
    return defaultDesignPlan({ brandContext, moodCount, baseCount });
  }
}

async function generateTransparentTextLayer(apiKey, { fullImageBase64, headline, textTheme, designPlan }) {
  const styleSpec = await createTextLayerStyle(apiKey, { fullImageBase64, headline, textTheme, designPlan });
  const keyColor = chooseChromaKeyColor(styleSpec);
  const packageBase64 = await generateChromaTextPackage(apiKey, { fullImageBase64, headline, textTheme, designPlan, styleSpec, keyColor });
  if (!packageBase64) return null;
  const composed = chromaPackageToTransparentPng(packageBase64, keyColor, styleSpec);
  return {
    textLayerBase64: composed.textLayerBase64,
    maskBase64: composed.maskBase64,
    quality: composed.quality,
  };
}

async function generateChromaTextPackage(apiKey, { fullImageBase64, headline, textTheme, designPlan, styleSpec, keyColor }) {
  const styleSummary = [
    `主要文字色: ${styleSpec.fillColor}`,
    styleSpec.fillRegions?.length ? `複数色領域: ${styleSpec.fillRegions.map((region) => `${region.label}:${region.color}`).join(", ")}` : "複数色領域: なし",
    Number(styleSpec.strokeOpacity) > 0 ? `縁取り: ${styleSpec.strokeColor} 幅${styleSpec.strokeWidth}` : "縁取り: なし",
    Number(styleSpec.shadowOpacity) > 0 ? `影: ${styleSpec.shadowColor} 透明度${styleSpec.shadowOpacity}` : "影: なし",
    styleSpec.backingRegions?.length ? `帯/背景プレート: あり` : "帯/背景プレート: 完成サムネにある場合のみ再現",
  ].join("\n");
  const prompt = [
    "添付の完成サムネを参照し、見出しの文字デザインパッケージだけを再生成してください。",
    "文字、縁取り、影、光彩、帯、ラベル背景、斜め線、装飾枠など、見出しと不可分なデザイン部品は含めてください。",
    "部屋、人物、家具、写真、商品、壁、床、照明、背景画像は絶対に含めないでください。",
    `背景は全面を完全な単色 ${keyColor.hex} にしてください。アンチエイリアス以外で背景色を文字や装飾に使わないでください。`,
    "完成サムネと同じ16:9キャンバス上で、文字デザインの位置、サイズ、改行、傾きをできるだけ一致させてください。",
    "文字の色分け、金色、赤い強調語、白帯、縁取り、斜めラインがある場合は完成サムネの見た目を優先して再現してください。",
    "背景以外は不透明または半透明のデザインとして描いてください。透明PNGではなく、指定背景色つきPNGを出してください。",
    `見出し: ${headline}`,
    `文字テーマ: ${textTheme.name} - ${textTheme.direction}`,
    `設計方針: ${designPlan.backgroundDirection || ""}`,
    "読み取った文字デザイン:",
    styleSummary,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: textLayerImageModel,
      images: [
        {
          image_url: `data:image/png;base64,${fullImageBase64}`,
        },
      ],
      prompt,
      size: "1536x1024",
      quality: "high",
      background: "opaque",
      output_format: "png",
      input_fidelity: "high",
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data.error?.message || "OpenAI text package generation failed";
    console.warn(`OpenAI text-package error: status=${response.status}, message=${message}`);
    throw new Error(message);
  }
  return data.data?.[0]?.b64_json || "";
}

async function generateTransparentTextLayerLegacy(apiKey, { fullImageBase64, headline, textTheme, designPlan }) {
  const styleSpec = await createTextLayerStyle(apiKey, { fullImageBase64, headline, textTheme, designPlan });
  const prompt = [
    "添付の完成サムネから、見出し文字・縁取り・影・光彩・文字と不可分な装飾だけのアルファマスクを作ってください。",
    "出力はカラー文字ではなく、白黒グレースケールのマスク画像です。",
    "背景、写真、家具、人物、部屋、壁、床、照明の光ムラ、壁のハイライト、窓光、影、画面、ロゴ風の不要要素は完全な黒にしてください。",
    "文字本体と強い縁取りは白、半透明の影や光彩やぼかしは濃度に応じたグレーで表現してください。",
    "文字から離れた広い光の帯や壁面のグラデーションは、文字の光彩ではありません。必ず黒にしてください。",
    "完成サムネに重ねた時の位置、サイズ、改行、傾き、文字間を維持してください。",
    "白い文字を背景として扱わないでください。白文字はマスクでは白です。",
    "キャンバス全体は完成サムネと同じ構図の16:9です。余計な説明文や色は入れないでください。",
    `見出し: ${headline}`,
    `文字テーマ: ${textTheme.name} - ${textTheme.direction}`,
    `設計方針: ${designPlan.backgroundDirection || ""}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: textLayerImageModel,
      images: [
        {
          image_url: `data:image/png;base64,${fullImageBase64}`,
        },
      ],
      prompt,
      size: "1536x1024",
      quality: "high",
      background: "opaque",
      output_format: "png",
      input_fidelity: "high",
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data.error?.message || "OpenAI text layer generation failed";
    console.warn(`OpenAI text-layer error: status=${response.status}, message=${message}`);
    throw new Error(message);
  }
  const maskBase64 = data.data?.[0]?.b64_json || "";
  if (!maskBase64) return null;
  const composed = composeTextLayerFromMask(fullImageBase64, maskBase64, styleSpec);
  return {
    textLayerBase64: composed.textLayerBase64,
    maskBase64: composed.maskBase64,
    quality: composed.quality,
  };
}

async function createTextLayerStyle(apiKey, { fullImageBase64, headline, textTheme, designPlan }) {
  const fallback = defaultTextLayerStyle();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions:
        "You are a thumbnail typography art director. Inspect the completed thumbnail and return only JSON describing the actual visible text color and shadow treatment. Do not sample furniture, room, wall, or photo colors as text fill.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "完成サムネに描かれた見出し文字の配色を読み取ってください。",
                "文字内部は背景写真ではなく、実際の文字塗り色として指定してください。",
                "背景、家具、部屋、壁、照明の色は文字色として採用しないでください。",
                "JSONキー: fillColor, fillRegions, strokeColor, strokeOpacity, strokeWidth, shadowColor, shadowOpacity, shadowBlur, shadowOffsetX, shadowOffsetY, backingRegions, note",
                "fillRegionsは色が違う文字範囲ごとに {color, x, y, width, height, label}。座標は画像全体に対する0から1の正規化bbox。",
                "赤い強調語など複数色がある場合は必ずfillRegionsに分けてください。単色なら空配列で構いません。",
                "帯やラベル背景が文字デザインとしてある場合はbackingRegionsに {color, opacity, x, y, width, height, radius, label} を入れてください。ない場合は空配列。",
                "縁取りが見える場合はstrokeColor/strokeOpacity/strokeWidthを指定してください。ない場合strokeOpacityは0。",
                "色は#RRGGBB。opacityは0から1。shadowBlurは0から24。offsetは-20から20。strokeWidthは0から18。",
                `見出し: ${headline}`,
                `文字テーマ: ${textTheme.name} - ${textTheme.direction}`,
                `設計方針: ${designPlan.backgroundDirection || ""}`,
              ].join("\n"),
            },
            {
              type: "input_image",
              image_url: `data:image/png;base64,${fullImageBase64}`,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "text_layer_style",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              fillColor: { type: "string" },
              fillRegions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    color: { type: "string" },
                    x: { type: "number" },
                    y: { type: "number" },
                    width: { type: "number" },
                    height: { type: "number" },
                    label: { type: "string" },
                  },
                  required: ["color", "x", "y", "width", "height", "label"],
                },
              },
              strokeColor: { type: "string" },
              strokeOpacity: { type: "number" },
              strokeWidth: { type: "number" },
              shadowColor: { type: "string" },
              shadowOpacity: { type: "number" },
              shadowBlur: { type: "number" },
              shadowOffsetX: { type: "number" },
              shadowOffsetY: { type: "number" },
              backingRegions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    color: { type: "string" },
                    opacity: { type: "number" },
                    x: { type: "number" },
                    y: { type: "number" },
                    width: { type: "number" },
                    height: { type: "number" },
                    radius: { type: "number" },
                    label: { type: "string" },
                  },
                  required: ["color", "opacity", "x", "y", "width", "height", "radius", "label"],
                },
              },
              note: { type: "string" },
            },
            required: ["fillColor", "fillRegions", "strokeColor", "strokeOpacity", "strokeWidth", "shadowColor", "shadowOpacity", "shadowBlur", "shadowOffsetX", "shadowOffsetY", "backingRegions", "note"],
          },
        },
        verbosity: "low",
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.warn(`OpenAI text-style error: status=${response.status}, message=${data.error?.message || "unknown"}`);
    return fallback;
  }
  try {
    return normalizeTextLayerStyle({ ...fallback, ...JSON.parse(extractOutputText(data)) });
  } catch {
    return fallback;
  }
}

function getApiKey(req) {
  const headerKey = req.headers["x-openai-api-key"];
  if (typeof headerKey === "string" && headerKey.trim()) return headerKey.trim();
  if (Array.isArray(headerKey) && headerKey[0]?.trim()) return headerKey[0].trim();
  return process.env.OPENAI_API_KEY || "";
}

async function getBrandContext(rawUrl) {
  if (!rawUrl) return {};
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { url: rawUrl, error: "URL形式を読み取れませんでした" };
  }

  if (!["http:", "https:"].includes(url.protocol) || isBlockedHost(url.hostname)) {
    return { url: rawUrl, error: "このURLは取得対象外です" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 ThumbnailStudio/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeout);
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) {
      return { url: url.href, error: `HTMLを取得できませんでした (${response.status})` };
    }
    const html = (await response.text()).slice(0, 500000);
    return {
      url: url.href,
      siteName: pickMeta(html, ["og:site_name", "application-name"]),
      title: pickMeta(html, ["og:title", "twitter:title"]) || pickTitle(html),
      description: pickMeta(html, ["description", "og:description", "twitter:description"]),
      themeColor: pickMeta(html, ["theme-color", "msapplication-TileColor"]),
      image: absolutizeUrl(pickMeta(html, ["og:image", "twitter:image"]), url),
    };
  } catch (error) {
    return { url: url.href, error: "サイト情報を取得できませんでした" };
  }
}

function isBlockedHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  );
}

function pickMeta(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta\\b[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${escaped}["'][^>]*>`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtml(match[1]).trim();
    }
  }
  return "";
}

function pickTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1]).replace(/\s+/g, " ").trim() : "";
}

function absolutizeUrl(value, baseUrl) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

function formatBrandContext(context) {
  return [
    `URL=${context.url || ""}`,
    context.siteName ? `siteName=${context.siteName}` : "",
    context.title ? `title=${context.title}` : "",
    context.description ? `description=${context.description}` : "",
    context.themeColor ? `themeColor=${context.themeColor}` : "",
    context.image ? `ogImage=${context.image}` : "",
    context.error ? `note=${context.error}` : "",
  ]
    .filter(Boolean)
    .join(" / ");
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, " ");
}

function buildPrompt({ script, count, moodCount, baseCount, brandContext }) {
  return [
    `次の原稿と画像文脈から、YouTubeサムネイル用の日本語見出しを${count}案作ってください。`,
    "",
    "目的:",
    "- 動画全体の文脈を読み、視聴者がクリックする理由を短く表現する",
    "- 釣りすぎず、動画を見た後に裏切られない強さにする",
    "- 画像に載せやすいよう、原則2行以内にする",
    "",
    "見出しの条件:",
    "- 1案は合計18文字前後までを目安にする。長くても24文字以内",
    "- 必要なら改行位置を \\n で入れる",
    "- 原稿の一部を雑に切り抜かない",
    "- 「正直すごい」「知らないと損」だけの汎用表現に逃げない",
    "- 具体性、意外性、ベネフィット、不安解消、本音感の角度を分散する",
    "",
    "文字テーマ案:",
    "- 掲載先ブランド、A参考画像、B元素材に合う文字デザインテーマを3〜5案出す",
    "- 固定テンプレ名ではなく、この案件のトーンに合わせた名前にする",
    "- directionには、文字の雰囲気、色、配置、強弱、余白の使い方を書く",
    "",
    `画像文脈: このメッセージの画像は、先にAの雰囲気参考画像 ${moodCount}枚、その後にBの元素材画像 ${baseCount}枚の順で添付しています。`,
    brandContext.url ? `掲載先ブランド文脈: ${formatBrandContext(brandContext)}` : "掲載先ブランド文脈: 指定なし",
    "",
    "原稿:",
    script,
  ].join("\n");
}

function buildDesignPrompt({ headline, textTheme, script, moodCount, baseCount, brandContext, designPlan }) {
  return [
    "YouTubeサムネイルの完成画像を1枚生成してください。",
    "",
    "必須条件:",
    "- 16:9の横長サムネイル",
    "- Bの元素材画像を主役として使う。人物・商品・画面・場所などの重要要素はできるだけ保つ",
    "- Aの雰囲気参考画像は色、テンション、余白、コントラストの参考にする",
    "- 見出し文字を画像と一体でデザインする。読みやすく、背景になじみ、スマホでも判読できること",
    "- 見出し以外の余計な日本語テキスト、ロゴ風テキスト、架空ラベルは入れない",
    `- 文字テーマ: ${textTheme.name} - ${textTheme.direction}`,
    `- 文字配置は ${designPlan.layout}、処理は ${designPlan.textTreatment}`,
    `- 背景方向性: ${designPlan.backgroundDirection}`,
    "- クリックベイト感より、内容と一致する強い訴求を優先する",
    "",
    `画像文脈: このメッセージの画像は、先にAの雰囲気参考画像 ${moodCount}枚、その後にBの元素材画像 ${baseCount}枚の順で添付しています。`,
    brandContext.url ? `掲載先ブランド文脈: ${formatBrandContext(brandContext)}` : "掲載先ブランド文脈: 指定なし",
    brandContext.url ? "- 背景デザインは掲載先ブランドのトーン、配色、余白感、品位に寄せる。ただしブランドロゴや固有の商標風テキストは描画しない" : "",
    "",
    "サムネに描画する見出し。できるだけこの内容を正確に使ってください:",
    headline,
    "",
    "動画原稿の文脈:",
    script || "未入力",
  ].join("\n");
}

function defaultDesignPlan({ brandContext, moodCount, baseCount }) {
  return {
    layout: "left",
    textTreatment: "editorial",
    accentColor: brandContext.themeColor && /^#[0-9a-f]{6}$/i.test(brandContext.themeColor) ? brandContext.themeColor : "#f3c230",
    subAccentColor: "#e63b2e",
    textColor: "#ffffff",
    strokeColor: "#101114",
    panelColor: "#000000",
    fontSize: 104,
    backgroundDirection: "Bの元素材を主役に、左から中央にかけて見出し用の暗め余白を作る",
    referenceReport: fallbackReferenceReport({ brandContext, moodCount, baseCount }),
  };
}

function fallbackReferenceReport({ brandContext, moodCount, baseCount }) {
  const parts = [];
  if (brandContext.url) {
    parts.push(`掲載先サイトは ${brandContext.siteName || brandContext.title || brandContext.url} を参照`);
    if (brandContext.description) parts.push(`descriptionから「${brandContext.description.slice(0, 80)}」のトーンを参照`);
    if (brandContext.themeColor) parts.push(`theme-color ${brandContext.themeColor} を配色候補として参照`);
  }
  if (moodCount) parts.push(`A参考画像${moodCount}枚から色味とテンションを参照`);
  if (baseCount) parts.push(`B元素材${baseCount}枚を主役画像として参照`);
  return parts.join("。") || "参考サイト指定なし。アップロード画像と原稿の文脈を中心に設計";
}

function textStyleIndexForPlan(plan) {
  const map = { editorial: 0, sticker: 1, slash: 3, lower: 4 };
  return map[plan.textTreatment] ?? 0;
}

function normalizeTextThemes(themes) {
  const fallback = [
    { name: "ブランド寄せ", direction: "掲載先ブランドの配色と余白感に寄せた、品よく読みやすい文字" },
    { name: "クリック強め", direction: "太字、強い縁取り、アクセント色で視認性を優先する文字" },
    { name: "レビュー感", direction: "本音感が出る少しラフな強調と、比較しやすい見出し配置" },
  ];
  if (!Array.isArray(themes) || !themes.length) return fallback;
  return themes.slice(0, 5).map((theme, index) => ({
    name: String(theme.name || fallback[index % fallback.length].name).slice(0, 18),
    direction: String(theme.direction || fallback[index % fallback.length].direction).slice(0, 180),
  }));
}

function normalizeTextTheme(theme) {
  const fallback = normalizeTextThemes([])[0];
  if (!theme || typeof theme !== "object") return fallback;
  return {
    name: String(theme.name || fallback.name).slice(0, 18),
    direction: String(theme.direction || fallback.direction).slice(0, 180),
  };
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
      if (content.type === "text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("");
}

function extractImageResult(data) {
  for (const item of data.output || []) {
    if (item.type === "image_generation_call" && item.result) return item.result;
  }
  return "";
}

function chooseChromaKeyColor(styleSpec = defaultTextLayerStyle()) {
  const candidates = [
    { hex: "#00ff00", r: 0, g: 255, b: 0, name: "green" },
    { hex: "#ff00ff", r: 255, g: 0, b: 255, name: "magenta" },
    { hex: "#00ffff", r: 0, g: 255, b: 255, name: "cyan" },
    { hex: "#0000ff", r: 0, g: 0, b: 255, name: "blue" },
  ];
  const used = [
    styleSpec.fillColor,
    styleSpec.strokeColor,
    styleSpec.shadowColor,
    ...(styleSpec.fillRegions || []).map((region) => region.color),
    ...(styleSpec.backingRegions || []).map((region) => region.color),
  ].filter(isHexColor).map((color) => parseHexColor(color, "#000000"));
  const scored = candidates.map((candidate) => {
    const minDistance = used.length ? Math.min(...used.map((color) => colorDistance(candidate, color))) : 999;
    return { ...candidate, minDistance };
  });
  return scored.sort((a, b) => b.minDistance - a.minDistance)[0];
}

function chromaPackageToTransparentPng(base64, keyColor, styleSpec = defaultTextLayerStyle()) {
  const png = decodePng(Buffer.from(base64, "base64"));
  const matteColor = estimateChromaMatteColor(png.data, png.width, png.height, keyColor);
  const alpha = Buffer.alloc(png.width * png.height);
  const rgba = Buffer.alloc(png.width * png.height * 4);
  const low = 24;
  const high = 118;
  let active = 0;
  let soft = 0;
  let despilled = 0;

  for (let i = 0; i < alpha.length; i += 1) {
    const src = i * 4;
    const r = png.data[src];
    const g = png.data[src + 1];
    const b = png.data[src + 2];
    const distance = colorDistance({ r, g, b }, matteColor);
    let a = 255;
    if (distance <= low) a = 0;
    else if (distance < high) a = clamp(Math.round(((distance - low) / (high - low)) * 255), 0, 255);
    alpha[i] = a;
    if (a > 12) active += 1;
    if (a > 12 && a < 180) soft += 1;

    if (a > 0 && a < 255) {
      const alphaRatio = a / 255;
      rgba[src] = clamp(Math.round((r - matteColor.r * (1 - alphaRatio)) / alphaRatio), 0, 255);
      rgba[src + 1] = clamp(Math.round((g - matteColor.g * (1 - alphaRatio)) / alphaRatio), 0, 255);
      rgba[src + 2] = clamp(Math.round((b - matteColor.b * (1 - alphaRatio)) / alphaRatio), 0, 255);
    } else {
      rgba[src] = r;
      rgba[src + 1] = g;
      rgba[src + 2] = b;
    }
    rgba[src + 3] = a;
    if (a > 0 && a < 245 && despillPixel(rgba, src, matteColor, styleSpec, a)) despilled += 1;
  }

  const coverage = active / alpha.length;
  const softRatio = active ? soft / active : 0;
  const checks = [
    `自動クロマキー色: ${keyColor.hex} (${keyColor.name})`,
    `実測マット色: ${matteColor.hex} (指定色との差 ${Math.round(matteColor.sourceDistance)})`,
    "完成サムネを参照した文字デザインパッケージから背景色をマット処理で除去しました",
  ];
  let score = 88;
  if (coverage < 0.015) {
    checks.push("抽出面積が小さく、文字や帯が欠けている可能性があります");
    score -= 32;
  } else if (coverage > 0.42) {
    checks.push("抽出面積が大きく、背景色以外の不要部分が混入している可能性があります");
    score -= 26;
  } else {
    checks.push("抽出面積は妥当そうです");
  }
  if (softRatio < 0.03 && Number(styleSpec.shadowOpacity) > 0) {
    checks.push("半透明領域が少なく、影や光彩が硬い可能性があります");
    score -= 10;
  }
  if (despilled) checks.push(`クロマキー色のにじみを${despilled}ピクセル補正しました`);

  return {
    textLayerBase64: encodePng(png.width, png.height, rgba).toString("base64"),
    maskBase64: encodeMaskPng(png.width, png.height, alpha).toString("base64"),
    quality: {
      status: score >= 78 ? "良好" : score >= 55 ? "要確認" : "再生成推奨",
      score: clamp(Math.round(score), 0, 100),
      summary: `品質チェック: ${score >= 78 ? "良好" : score >= 55 ? "要確認" : "再生成推奨"}`,
      coverage: Number(coverage.toFixed(4)),
      softRatio: Number(softRatio.toFixed(4)),
      despilled,
      chromaKey: matteColor.hex,
      colorization: { style: styleSpec, mode: "chroma-package" },
      checks,
    },
  };
}

function estimateChromaMatteColor(data, width, height, expectedColor) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 120));
  for (let x = 0; x < width; x += step) {
    samples.push(pixelAt(data, width, x, 0), pixelAt(data, width, x, height - 1));
  }
  for (let y = 0; y < height; y += step) {
    samples.push(pixelAt(data, width, 0, y), pixelAt(data, width, width - 1, y));
  }
  const nearExpected = samples.filter((pixel) => colorDistance(pixel, expectedColor) <= 120);
  const source = nearExpected.length >= Math.max(12, samples.length * 0.12) ? nearExpected : samples;
  const color = {
    r: median(source.map((pixel) => pixel.r)),
    g: median(source.map((pixel) => pixel.g)),
    b: median(source.map((pixel) => pixel.b)),
  };
  const sourceDistance = colorDistance(color, expectedColor);
  return {
    ...color,
    hex: rgbToHex(color),
    name: sourceDistance <= 8 ? expectedColor.name : `${expectedColor.name}補正`,
    sourceDistance,
  };
}

function despillPixel(rgba, index, keyColor, styleSpec, alpha) {
  const fillColor = parseHexColor(styleSpec.fillColor, defaultTextLayerStyle().fillColor);
  const shadowColor = parseHexColor(styleSpec.shadowColor, defaultTextLayerStyle().shadowColor);
  const target = alpha < 115 ? shadowColor : fillColor;
  const before = { r: rgba[index], g: rgba[index + 1], b: rgba[index + 2] };
  const keyVector = {
    r: keyColor.r - target.r,
    g: keyColor.g - target.g,
    b: keyColor.b - target.b,
  };
  const pixelVector = {
    r: before.r - target.r,
    g: before.g - target.g,
    b: before.b - target.b,
  };
  const keyMagnitude = keyVector.r ** 2 + keyVector.g ** 2 + keyVector.b ** 2;
  if (keyMagnitude <= 0) return false;
  const projection = (pixelVector.r * keyVector.r + pixelVector.g * keyVector.g + pixelVector.b * keyVector.b) / keyMagnitude;
  if (projection <= 0) return false;
  const amount = clamp(projection * (1 - alpha / 255) * 1.25, 0, 0.9);
  if (amount <= 0.015) return false;
  rgba[index] = clamp(Math.round(before.r - keyVector.r * amount), 0, 255);
  rgba[index + 1] = clamp(Math.round(before.g - keyVector.g * amount), 0, 255);
  rgba[index + 2] = clamp(Math.round(before.b - keyVector.b * amount), 0, 255);
  return Math.abs(rgba[index] - before.r) + Math.abs(rgba[index + 1] - before.g) + Math.abs(rgba[index + 2] - before.b) > 2;
}

function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function composeTextLayerFromMask(originalBase64, maskBase64, styleSpec = defaultTextLayerStyle()) {
  const original = decodePng(Buffer.from(originalBase64, "base64"));
  const mask = decodePng(Buffer.from(maskBase64, "base64"));
  const alpha = buildAlphaFromMask(mask, original.width, original.height);
  const cleanup = removeBackgroundLikeComponents(original, alpha);
  const colorization = colorizeTextLayer(original, alpha, styleSpec);
  const layer = colorization.layer;

  const quality = inspectTextLayerQuality(original, alpha, cleanup);
  quality.colorization = colorization.report;
  return {
    textLayerBase64: encodePng(original.width, original.height, layer).toString("base64"),
    maskBase64: encodeMaskPng(original.width, original.height, alpha).toString("base64"),
    quality,
  };
}

function buildAlphaFromMask(mask, targetWidth, targetHeight) {
  const luminance = resizeMaskLuminance(mask, targetWidth, targetHeight);
  const border = estimateMaskBorder(luminance, targetWidth, targetHeight);
  const sorted = [...luminance].sort((a, b) => a - b);
  const whitePoint = sorted[Math.floor(sorted.length * 0.995)] || 255;
  const blackPoint = Math.min(border + 10, 80);
  const range = Math.max(60, whitePoint - blackPoint);
  const alpha = Buffer.alloc(luminance.length);

  for (let i = 0; i < luminance.length; i += 1) {
    const normalized = clamp(Math.round(((luminance[i] - blackPoint) / range) * 255), 0, 255);
    alpha[i] = normalized < 10 ? 0 : normalized;
  }

  return alpha;
}

function resizeMaskLuminance(mask, targetWidth, targetHeight) {
  const luminance = Buffer.alloc(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = ((y + 0.5) * mask.height) / targetHeight - 0.5;
    const y0 = clamp(Math.floor(sourceY), 0, mask.height - 1);
    const y1 = clamp(y0 + 1, 0, mask.height - 1);
    const fy = sourceY - y0;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = ((x + 0.5) * mask.width) / targetWidth - 0.5;
      const x0 = clamp(Math.floor(sourceX), 0, mask.width - 1);
      const x1 = clamp(x0 + 1, 0, mask.width - 1);
      const fx = sourceX - x0;
      const top = mix(maskLuminanceAt(mask, x0, y0), maskLuminanceAt(mask, x1, y0), fx);
      const bottom = mix(maskLuminanceAt(mask, x0, y1), maskLuminanceAt(mask, x1, y1), fx);
      luminance[y * targetWidth + x] = clamp(Math.round(mix(top, bottom, fy)), 0, 255);
    }
  }
  return luminance;
}

function maskLuminanceAt(mask, x, y) {
  const i = (y * mask.width + x) * 4;
  return Math.round(mask.data[i] * 0.2126 + mask.data[i + 1] * 0.7152 + mask.data[i + 2] * 0.0722);
}

function estimateMaskBorder(luminance, width, height) {
  const values = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 80));
  for (let x = 0; x < width; x += step) {
    values.push(luminance[x], luminance[(height - 1) * width + x]);
  }
  for (let y = 0; y < height; y += step) {
    values.push(luminance[y * width], luminance[y * width + width - 1]);
  }
  return median(values);
}

function colorizeTextLayer(original, alpha, styleSpec = defaultTextLayerStyle()) {
  const components = collectAlphaComponents(original, alpha, 12);
  const layer = Buffer.alloc(original.width * original.height * 4);
  const fillAlpha = sharpenAlpha(alpha);
  const shadowAlpha = createShadowAlpha(fillAlpha, original.width, original.height, styleSpec);
  const strokeAlpha = createStrokeAlpha(fillAlpha, original.width, original.height, styleSpec);
  const report = [];
  const fillColor = parseHexColor(styleSpec.fillColor, defaultTextLayerStyle().fillColor);
  const shadowColor = parseHexColor(styleSpec.shadowColor, defaultTextLayerStyle().shadowColor);
  const strokeColor = parseHexColor(styleSpec.strokeColor, defaultTextLayerStyle().strokeColor);

  drawBackingRegions(layer, original.width, original.height, styleSpec.backingRegions || []);

  for (let pixel = 0; pixel < shadowAlpha.length; pixel += 1) {
    const a = shadowAlpha[pixel];
    if (!a) continue;
    const i = pixel * 4;
    layer[i] = shadowColor.r;
    layer[i + 1] = shadowColor.g;
    layer[i + 2] = shadowColor.b;
    layer[i + 3] = a;
  }

  for (let pixel = 0; pixel < strokeAlpha.length; pixel += 1) {
    const a = strokeAlpha[pixel];
    if (!a) continue;
    compositePixel(layer, pixel, strokeColor, a);
  }

  for (const component of components) {
    const componentColor = colorForComponent(component, styleSpec, fillColor, original.width, original.height);
    report.push({
      color: componentColor,
      areaRatio: Number((component.pixels.length / alpha.length).toFixed(4)),
      bounds: component.bounds,
    });
    for (const pixel of component.pixels) {
      const i = pixel * 4;
      const a = fillAlpha[pixel];
      if (!a) continue;
      compositePixel(layer, pixel, componentColor, a);
    }
  }

  return { layer, report: { style: styleSpec, components: report } };
}

function defaultTextLayerStyle() {
  return {
    fillColor: "#3a2819",
    fillRegions: [],
    strokeColor: "#6f6456",
    strokeOpacity: 0,
    strokeWidth: 0,
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowBlur: 8,
    shadowOffsetX: 4,
    shadowOffsetY: 5,
    backingRegions: [],
    note: "fallback dark brown text with soft shadow",
  };
}

function normalizeTextLayerStyle(style) {
  const fallback = defaultTextLayerStyle();
  const strokeOpacity = Number(style.strokeOpacity);
  const strokeWidth = Number(style.strokeWidth);
  const shadowOpacity = Number(style.shadowOpacity);
  const shadowBlur = Number(style.shadowBlur);
  const shadowOffsetX = Number(style.shadowOffsetX);
  const shadowOffsetY = Number(style.shadowOffsetY);
  return {
    fillColor: isHexColor(style.fillColor) ? style.fillColor : fallback.fillColor,
    fillRegions: normalizeColorRegions(style.fillRegions),
    strokeColor: isHexColor(style.strokeColor) ? style.strokeColor : fallback.strokeColor,
    strokeOpacity: Number.isFinite(strokeOpacity) ? clamp(strokeOpacity, 0, 1) : fallback.strokeOpacity,
    strokeWidth: Number.isFinite(strokeWidth) ? clamp(Math.round(strokeWidth), 0, 18) : fallback.strokeWidth,
    shadowColor: isHexColor(style.shadowColor) ? style.shadowColor : fallback.shadowColor,
    shadowOpacity: Number.isFinite(shadowOpacity) ? clamp(shadowOpacity, 0, 1) : fallback.shadowOpacity,
    shadowBlur: Number.isFinite(shadowBlur) ? clamp(Math.round(shadowBlur), 0, 24) : fallback.shadowBlur,
    shadowOffsetX: Number.isFinite(shadowOffsetX) ? clamp(Math.round(shadowOffsetX), -20, 20) : fallback.shadowOffsetX,
    shadowOffsetY: Number.isFinite(shadowOffsetY) ? clamp(Math.round(shadowOffsetY), -20, 20) : fallback.shadowOffsetY,
    backingRegions: normalizeBackingRegions(style.backingRegions),
    note: String(style.note || fallback.note).slice(0, 180),
  };
}

function normalizeColorRegions(regions) {
  if (!Array.isArray(regions)) return [];
  return regions
    .filter((region) => isHexColor(region?.color))
    .map((region) => ({
      color: region.color,
      x: clamp(Number(region.x), 0, 1),
      y: clamp(Number(region.y), 0, 1),
      width: clamp(Number(region.width), 0, 1),
      height: clamp(Number(region.height), 0, 1),
      label: String(region.label || "").slice(0, 80),
    }))
    .filter((region) => region.width > 0.01 && region.height > 0.01)
    .slice(0, 12);
}

function normalizeBackingRegions(regions) {
  if (!Array.isArray(regions)) return [];
  return regions
    .filter((region) => isHexColor(region?.color))
    .map((region) => ({
      color: region.color,
      opacity: clamp(Number(region.opacity), 0, 1),
      x: clamp(Number(region.x), 0, 1),
      y: clamp(Number(region.y), 0, 1),
      width: clamp(Number(region.width), 0, 1),
      height: clamp(Number(region.height), 0, 1),
      radius: clamp(Number(region.radius), 0, 0.2),
      label: String(region.label || "").slice(0, 80),
    }))
    .filter((region) => region.opacity > 0 && region.width > 0.01 && region.height > 0.01)
    .slice(0, 8);
}

function sharpenAlpha(alpha) {
  const output = Buffer.alloc(alpha.length);
  for (let i = 0; i < alpha.length; i += 1) {
    output[i] = clamp(Math.round((alpha[i] - 18) * 1.28), 0, 255);
  }
  return output;
}

function createShadowAlpha(fillAlpha, width, height, styleSpec) {
  const opacity = clamp(Number(styleSpec.shadowOpacity), 0, 1);
  if (opacity <= 0) return Buffer.alloc(fillAlpha.length);
  const offsetX = clamp(Math.round(Number(styleSpec.shadowOffsetX)), -20, 20);
  const offsetY = clamp(Math.round(Number(styleSpec.shadowOffsetY)), -20, 20);
  const shifted = Buffer.alloc(fillAlpha.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - offsetX;
      const sourceY = y - offsetY;
      if (sourceX < 0 || sourceY < 0 || sourceX >= width || sourceY >= height) continue;
      shifted[y * width + x] = Math.round(fillAlpha[sourceY * width + sourceX] * opacity);
    }
  }

  const blur = clamp(Math.round(Number(styleSpec.shadowBlur)), 0, 24);
  return blur ? boxBlurAlpha(shifted, width, height, blur, 3) : shifted;
}

function createStrokeAlpha(fillAlpha, width, height, styleSpec) {
  const opacity = clamp(Number(styleSpec.strokeOpacity), 0, 1);
  const radius = clamp(Math.round(Number(styleSpec.strokeWidth)), 0, 18);
  if (!opacity || !radius) return Buffer.alloc(fillAlpha.length);
  const dilated = dilateAlpha(fillAlpha, width, height, radius);
  const output = Buffer.alloc(fillAlpha.length);
  for (let i = 0; i < output.length; i += 1) {
    const ring = Math.max(0, dilated[i] - Math.round(fillAlpha[i] * 0.7));
    output[i] = Math.round(ring * opacity);
  }
  return radius > 1 ? boxBlurAlpha(output, width, height, Math.max(1, Math.floor(radius / 3)), 1) : output;
}

function dilateAlpha(alpha, width, height, radius) {
  const horizontal = Buffer.alloc(alpha.length);
  const output = Buffer.alloc(alpha.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let max = 0;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        max = Math.max(max, alpha[y * width + nx]);
      }
      horizontal[y * width + x] = max;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let max = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        max = Math.max(max, horizontal[ny * width + x]);
      }
      output[y * width + x] = max;
    }
  }
  return output;
}

function colorForComponent(component, styleSpec, fallbackColor, width, height) {
  const centerX = (component.bounds.x + component.bounds.width / 2) / width;
  const centerY = (component.bounds.y + component.bounds.height / 2) / height;
  const candidates = (styleSpec.fillRegions || []).filter((region) =>
    centerX >= region.x - 0.015 &&
    centerX <= region.x + region.width + 0.015 &&
    centerY >= region.y - 0.015 &&
    centerY <= region.y + region.height + 0.015
  );
  if (!candidates.length) return fallbackColor;
  const region = candidates.sort((a, b) => a.width * a.height - b.width * b.height)[0];
  return parseHexColor(region.color, styleSpec.fillColor);
}

function drawBackingRegions(layer, width, height, regions) {
  for (const region of regions) {
    const color = parseHexColor(region.color, "#ffffff");
    const alpha = Math.round(clamp(region.opacity, 0, 1) * 255);
    const x0 = Math.round(region.x * width);
    const y0 = Math.round(region.y * height);
    const x1 = Math.round((region.x + region.width) * width);
    const y1 = Math.round((region.y + region.height) * height);
    const radius = Math.round(region.radius * Math.min(width, height));
    for (let y = clamp(y0, 0, height - 1); y < clamp(y1, 0, height); y += 1) {
      for (let x = clamp(x0, 0, width - 1); x < clamp(x1, 0, width); x += 1) {
        if (!insideRoundedRect(x, y, x0, y0, x1, y1, radius)) continue;
        compositePixel(layer, y * width + x, color, alpha);
      }
    }
  }
}

function insideRoundedRect(x, y, x0, y0, x1, y1, radius) {
  if (radius <= 0) return true;
  const cx = x < x0 + radius ? x0 + radius : x >= x1 - radius ? x1 - radius - 1 : x;
  const cy = y < y0 + radius ? y0 + radius : y >= y1 - radius ? y1 - radius - 1 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function boxBlurAlpha(alpha, width, height, radius, passes = 1) {
  let current = Buffer.from(alpha);
  for (let pass = 0; pass < passes; pass += 1) {
    const horizontal = Buffer.alloc(alpha.length);
    const output = Buffer.alloc(alpha.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          sum += current[y * width + nx];
          count += 1;
        }
        horizontal[y * width + x] = Math.round(sum / count);
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          sum += horizontal[ny * width + x];
          count += 1;
        }
        output[y * width + x] = Math.round(sum / count);
      }
    }
    current = output;
  }
  return current;
}

function compositePixel(layer, pixel, color, alpha) {
  const i = pixel * 4;
  const sourceA = alpha / 255;
  const destA = layer[i + 3] / 255;
  const outA = sourceA + destA * (1 - sourceA);
  if (outA <= 0) return;
  layer[i] = Math.round((color.r * sourceA + layer[i] * destA * (1 - sourceA)) / outA);
  layer[i + 1] = Math.round((color.g * sourceA + layer[i + 1] * destA * (1 - sourceA)) / outA);
  layer[i + 2] = Math.round((color.b * sourceA + layer[i + 2] * destA * (1 - sourceA)) / outA);
  layer[i + 3] = Math.round(outA * 255);
}

function parseHexColor(value, fallback) {
  const color = isHexColor(value) ? value : fallback;
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16),
  };
}

function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function collectAlphaComponents(original, alpha, threshold) {
  const total = alpha.length;
  const visited = new Uint8Array(total);
  const components = [];
  const stack = [];

  for (let start = 0; start < total; start += 1) {
    if (visited[start] || alpha[start] <= threshold) continue;
    const pixels = [];
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    let minX = original.width;
    let minY = original.height;
    let maxX = 0;
    let maxY = 0;

    while (stack.length) {
      const current = stack.pop();
      pixels.push(current);
      const x = current % original.width;
      const y = Math.floor(current / original.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [current - 1, current + 1, current - original.width, current + original.width];
      for (const next of neighbors) {
        if (next < 0 || next >= total || visited[next] || alpha[next] <= threshold) continue;
        const nx = next % original.width;
        const ny = Math.floor(next / original.width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }

    if (pixels.length > 8) {
      components.push({ pixels, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } });
    }
  }

  return components;
}

function estimateComponentTextColor(original, alpha, component) {
  const bgLum = estimateComponentBackgroundLuminance(original, alpha, component.bounds);
  const samples = [];
  for (const pixel of component.pixels) {
    if (alpha[pixel] < 140) continue;
    const i = pixel * 4;
    samples.push({
      r: original.data[i],
      g: original.data[i + 1],
      b: original.data[i + 2],
      lum: pixelLuminanceByIndex(original, pixel),
    });
  }

  const pool = samples.length >= 12 ? samples : component.pixels.map((pixel) => {
    const i = pixel * 4;
    return { r: original.data[i], g: original.data[i + 1], b: original.data[i + 2], lum: pixelLuminanceByIndex(original, pixel) };
  });
  if (!pool.length) return bgLum > 128 ? { r: 31, g: 27, b: 23 } : { r: 245, g: 241, b: 232 };

  const lums = pool.map((sample) => sample.lum).sort((a, b) => a - b);
  const cutoff = bgLum >= 128 ? lums[Math.floor(lums.length * 0.38)] : lums[Math.floor(lums.length * 0.62)];
  let selected = pool.filter((sample) => bgLum >= 128 ? sample.lum <= cutoff : sample.lum >= cutoff);
  selected = selected.filter((sample) => Math.abs(sample.lum - bgLum) >= 16);
  if (selected.length < 6) selected = pool.filter((sample) => Math.abs(sample.lum - bgLum) >= 10);
  if (selected.length < 6) {
    return bgLum >= 128 ? { r: 38, g: 32, b: 27 } : { r: 246, g: 242, b: 233 };
  }

  return {
    r: clamp(Math.round(median(selected.map((sample) => sample.r))), 0, 255),
    g: clamp(Math.round(median(selected.map((sample) => sample.g))), 0, 255),
    b: clamp(Math.round(median(selected.map((sample) => sample.b))), 0, 255),
  };
}

function estimateComponentBackgroundLuminance(original, alpha, bounds) {
  const values = [];
  const margin = 10;
  const minX = clamp(bounds.x - margin, 0, original.width - 1);
  const minY = clamp(bounds.y - margin, 0, original.height - 1);
  const maxX = clamp(bounds.x + bounds.width + margin, 0, original.width - 1);
  const maxY = clamp(bounds.y + bounds.height + margin, 0, original.height - 1);
  const step = Math.max(1, Math.floor(Math.max(bounds.width, bounds.height) / 28));

  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      if (x > bounds.x - 2 && x < bounds.x + bounds.width + 2 && y > bounds.y - 2 && y < bounds.y + bounds.height + 2) continue;
      const pixel = y * original.width + x;
      if (alpha[pixel] > 8) continue;
      values.push(pixelLuminanceByIndex(original, pixel));
    }
  }

  return values.length ? median(values) : 180;
}

function pixelLuminanceByIndex(image, pixel) {
  const i = pixel * 4;
  return image.data[i] * 0.2126 + image.data[i + 1] * 0.7152 + image.data[i + 2] * 0.0722;
}

function removeBackgroundLikeComponents(original, alpha) {
  const total = alpha.length;
  const visited = new Uint8Array(total);
  const removed = [];
  const stack = [];
  const pixels = [];
  const threshold = 12;

  for (let start = 0; start < total; start += 1) {
    if (visited[start] || alpha[start] <= threshold) continue;
    stack.length = 0;
    pixels.length = 0;
    stack.push(start);
    visited[start] = 1;
    let minX = original.width;
    let minY = original.height;
    let maxX = 0;
    let maxY = 0;
    let gradientSum = 0;

    while (stack.length) {
      const current = stack.pop();
      pixels.push(current);
      const x = current % original.width;
      const y = Math.floor(current / original.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x > 0 && y > 0 && x < original.width - 1 && y < original.height - 1) {
        gradientSum += pixelGradient(original, x, y);
      }

      const neighbors = [current - 1, current + 1, current - original.width, current + original.width];
      for (const next of neighbors) {
        if (next < 0 || next >= total || visited[next] || alpha[next] <= threshold) continue;
        const nx = next % original.width;
        const ny = Math.floor(next / original.width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const areaRatio = pixels.length / total;
    const boxRatio = (width * height) / total;
    const density = pixels.length / Math.max(1, width * height);
    const averageGradient = gradientSum / Math.max(1, pixels.length);
    const touchesEdge = minX < 4 || minY < 4 || maxX >= original.width - 4 || maxY >= original.height - 4;
    const largeLowDetail = areaRatio > 0.035 && boxRatio > 0.12 && density > 0.18 && averageGradient < 16;
    const hugeRegion = areaRatio > 0.12 || boxRatio > 0.32;
    const edgeGlow = touchesEdge && areaRatio > 0.02 && averageGradient < 14;

    if (largeLowDetail || hugeRegion || edgeGlow) {
      for (const pixel of pixels) alpha[pixel] = 0;
      removed.push({
        areaRatio: Number(areaRatio.toFixed(4)),
        boxRatio: Number(boxRatio.toFixed(4)),
        averageGradient: Number(averageGradient.toFixed(2)),
        bounds: { x: minX, y: minY, width, height },
      });
    }
  }

  return { removedComponents: removed };
}

function inspectTextLayerQuality(original, alpha, cleanup = { removedComponents: [] }) {
  const total = alpha.length;
  let active = 0;
  let opaque = 0;
  let soft = 0;
  let border = 0;
  let gradientSum = 0;
  let gradientCount = 0;
  let interiorGradientSum = 0;
  let interiorGradientCount = 0;
  let minX = original.width;
  let minY = original.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < original.height; y += 1) {
    for (let x = 0; x < original.width; x += 1) {
      const i = y * original.width + x;
      const a = alpha[i];
      if (a <= 12) continue;
      active += 1;
      if (a >= 180) opaque += 1;
      else soft += 1;
      if (x < 3 || y < 3 || x >= original.width - 3 || y >= original.height - 3) border += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x > 0 && y > 0 && x < original.width - 1 && y < original.height - 1) {
        const gradient = pixelGradient(original, x, y);
        gradientSum += gradient;
        gradientCount += 1;
        const left = alpha[i - 1];
        const right = alpha[i + 1];
        const up = alpha[i - original.width];
        const down = alpha[i + original.width];
        if (a >= 180 && left >= 180 && right >= 180 && up >= 180 && down >= 180) {
          interiorGradientSum += gradient;
          interiorGradientCount += 1;
        }
      }
    }
  }

  const coverage = active / total;
  const opaqueRatio = active ? opaque / active : 0;
  const softRatio = active ? soft / active : 0;
  const borderRatio = active ? border / active : 0;
  const averageGradient = gradientCount ? gradientSum / gradientCount : 0;
  const interiorGradient = interiorGradientCount ? interiorGradientSum / interiorGradientCount : 0;
  const interiorRatio = active ? interiorGradientCount / active : 0;
  const box = active ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
  const checks = [];
  let score = 100;

  if (cleanup.removedComponents?.length) {
    checks.push(`背景っぽい大きなマスク領域を${cleanup.removedComponents.length}件自動除去しました`);
    score -= 8;
  }

  if (coverage < 0.015) {
    checks.push("マスク面積が小さく、文字の一部が欠けている可能性があります");
    score -= 32;
  } else if (coverage > 0.38) {
    checks.push("マスク面積が大きく、背景が混入している可能性があります");
    score -= 32;
  } else {
    checks.push("文字領域の面積は妥当そうです");
  }

  if (borderRatio > 0.02) {
    checks.push("端にマスクが出ていて、不要な背景や余白を拾っている可能性があります");
    score -= 18;
  }

  if (opaqueRatio < 0.18) {
    checks.push("不透明部分が少なく、文字本体が薄く出ている可能性があります");
    score -= 18;
  }

  if (softRatio < 0.08) {
    checks.push("半透明部分が少なく、影や光彩が硬くなっている可能性があります");
    score -= 10;
  } else {
    checks.push("影・光彩用の半透明領域を検出しました");
  }

  if (averageGradient < 8) {
    checks.push("マスク領域の画像変化が弱く、文字以外を拾っている可能性があります");
    score -= 14;
  }

  checks.push("文字内部は写真ピクセルを使わず、推定した文字色で塗っています");

  const status = score >= 78 ? "良好" : score >= 55 ? "要確認" : "再生成推奨";
  return {
    status,
    score: clamp(Math.round(score), 0, 100),
    summary: `品質チェック: ${status}`,
    coverage: Number(coverage.toFixed(4)),
    opaqueRatio: Number(opaqueRatio.toFixed(4)),
    softRatio: Number(softRatio.toFixed(4)),
    borderRatio: Number(borderRatio.toFixed(4)),
    averageGradient: Number(averageGradient.toFixed(2)),
    interiorGradient: Number(interiorGradient.toFixed(2)),
    interiorRatio: Number(interiorRatio.toFixed(4)),
    bounds: box,
    cleanup,
    checks,
  };
}

function pixelGradient(image, x, y) {
  const center = pixelLuminance(image, x, y);
  const dx = Math.abs(center - pixelLuminance(image, x + 1, y)) + Math.abs(center - pixelLuminance(image, x - 1, y));
  const dy = Math.abs(center - pixelLuminance(image, x, y + 1)) + Math.abs(center - pixelLuminance(image, x, y - 1));
  return (dx + dy) / 4;
}

function pixelLuminance(image, x, y) {
  const i = (y * image.width + x) * 4;
  return image.data[i] * 0.2126 + image.data[i + 1] * 0.7152 + image.data[i + 2] * 0.0722;
}

function encodeMaskPng(width, height, alpha) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < alpha.length; i += 1) {
    const dest = i * 4;
    rgba[dest] = alpha[i];
    rgba[dest + 1] = alpha[i];
    rgba[dest + 2] = alpha[i];
    rgba[dest + 3] = 255;
  }
  return encodePng(width, height, rgba);
}

function mix(a, b, amount) {
  return a + (b - a) * amount;
}

function chromaKeyToTransparentPng(base64) {
  const png = decodePng(Buffer.from(base64, "base64"));
  const bg = estimateBorderColor(png.data, png.width, png.height);
  const low = 42;
  const high = 150;

  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const distance = Math.hypot(r - bg.r, g - bg.g, b - bg.b);
    if (distance <= low) {
      png.data[i + 3] = 0;
      continue;
    }
    if (distance < high) {
      const alpha = clamp(Math.round(((distance - low) / (high - low)) * 255), 0, 255);
      png.data[i] = clamp(Math.round((r - bg.r * (1 - alpha / 255)) / (alpha / 255 || 1)), 0, 255);
      png.data[i + 1] = clamp(Math.round((g - bg.g * (1 - alpha / 255)) / (alpha / 255 || 1)), 0, 255);
      png.data[i + 2] = clamp(Math.round((b - bg.b * (1 - alpha / 255)) / (alpha / 255 || 1)), 0, 255);
      png.data[i + 3] = Math.min(png.data[i + 3], alpha);
    }
  }

  return encodePng(png.width, png.height, png.data).toString("base64");
}

function estimateBorderColor(data, width, height) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 80));
  for (let x = 0; x < width; x += step) {
    samples.push(pixelAt(data, width, x, 0), pixelAt(data, width, x, height - 1));
  }
  for (let y = 0; y < height; y += step) {
    samples.push(pixelAt(data, width, 0, y), pixelAt(data, width, width - 1, y));
  }
  return {
    r: median(samples.map((pixel) => pixel.r)),
    g: median(samples.map((pixel) => pixel.g)),
    b: median(samples.map((pixel) => pixel.b)),
  };
}

function pixelAt(data, width, x, y) {
  const i = (y * width + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function normalizeHeadline(text) {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function decodePng(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) throw new Error("Generated image is not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error("Generated PNG format is not supported");
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const row = Buffer.from(inflated.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    unfilterRow(row, previous, filter, channels);
    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dest = (y * width + x) * 4;
      rgba[dest] = row[src];
      rgba[dest + 1] = row[src + 1];
      rgba[dest + 2] = row[src + 2];
      rgba[dest + 3] = channels === 4 ? row[src + 3] : 255;
    }
    previous = row;
  }

  return { width, height, data: rgba };
}

function unfilterRow(row, previous, filter, bytesPerPixel) {
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
    const up = previous[i] || 0;
    const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] || 0 : 0;
    if (filter === 1) row[i] = (row[i] + left) & 255;
    else if (filter === 2) row[i] = (row[i] + up) & 255;
    else if (filter === 3) row[i] = (row[i] + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) row[i] = (row[i] + paeth(left, up, upLeft)) & 255;
    else if (filter !== 0) throw new Error("Generated PNG uses an unsupported filter");
  }
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    rgba.copy(raw, offset, y * width * 4, (y + 1) * width * 4);
    offset += width * 4;
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  return Buffer.concat([uint32(data.length), typeBuffer, data, uint32(crc32(Buffer.concat([typeBuffer, data])))]); 
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
