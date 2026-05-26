const API_KEY_STORAGE = "openai_api_key";
const TEXT_LAYER_CACHE_PREFIX = "text_layer_result:";
const APP_VERSION = "0.2.20";
const APP_BUILD_TIMESTAMP = "2026-05-26 11:03 JST";

const state = {
  moodImages: [],
  baseImages: [],
  headlines: [],
  originalHeadlines: [],
  headlineAngles: [],
  selectedHeadlineIndex: 0,
  generatedDesignUrl: "",
  generatedBackgroundUrl: "",
  generatedTextLayerUrl: "",
  generatedTextLayerQuality: null,
  designCache: new Map(),
  textStyleIndex: 0,
  designPlan: null,
  referenceReport: "",
  textThemes: [],
  palette: ["#e63b2e", "#0f8f8a", "#f3c230"],
  apiKey: localStorage.getItem(API_KEY_STORAGE) || sessionStorage.getItem(API_KEY_STORAGE) || "",
  apiVersion: "",
};

const fallbackTextThemes = [
  { name: "ブランド寄せ", direction: "掲載先ブランドの配色と余白感に寄せた、品よく読みやすい文字" },
  { name: "クリック強め", direction: "太字、強い縁取り、アクセント色で視認性を優先する文字" },
  { name: "レビュー感", direction: "本音感が出る少しラフな強調と、比較しやすい見出し配置" },
];

const templates = [
  { name: "Impact Slash", draw: drawImpactSlash },
  { name: "News Burst", draw: drawNewsBurst },
  { name: "Cinema Lower", draw: drawCinemaLower },
  { name: "Clean Focus", draw: drawCleanFocus },
  { name: "Pop Label", draw: drawPopLabel },
  { name: "Mono Proof", draw: drawMonoProof },
  { name: "Urgent Frame", draw: drawUrgentFrame },
  { name: "Side Title", draw: drawSideTitle },
];

const els = {
  moodFiles: document.querySelector("#moodFiles"),
  baseFiles: document.querySelector("#baseFiles"),
  moodPreview: document.querySelector("#moodPreview"),
  basePreview: document.querySelector("#basePreview"),
  scriptText: document.querySelector("#scriptText"),
  brandUrl: document.querySelector("#brandUrl"),
  headlineCount: document.querySelector("#headlineCount"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  apiKeyStatus: document.querySelector("#apiKeyStatus"),
  saveApiKey: document.querySelector("#saveApiKey"),
  clearApiKey: document.querySelector("#clearApiKey"),
  generateBtn: document.querySelector("#generateBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  refreshHeadlines: document.querySelector("#refreshHeadlines"),
  headlineList: document.querySelector("#headlineList"),
  designResult: document.querySelector("#designResult"),
  textStyleControls: document.querySelector("#textStyleControls"),
  referenceReport: document.querySelector("#referenceReport"),
  downloadActions: document.querySelector("#downloadActions"),
  textLayerSection: document.querySelector("#textLayerSection"),
  textLayerResult: document.querySelector("#textLayerResult"),
  statusText: document.querySelector("#statusText"),
  generateDesign: document.querySelector("#generateDesign"),
  generateTextLayer: document.querySelector("#generateTextLayer"),
  downloadDesign: document.querySelector("#downloadDesign"),
  downloadTextLayer: document.querySelector("#downloadTextLayer"),
  appVersion: document.querySelector("#appVersion"),
};

syncVersionUi();
loadApiVersion();
syncApiKeyUi();
if (state.apiKey) {
  localStorage.setItem(API_KEY_STORAGE, state.apiKey);
  sessionStorage.removeItem(API_KEY_STORAGE);
}

els.saveApiKey.addEventListener("click", () => {
  const key = els.apiKeyInput.value.trim();
  if (!key) {
    setStatus("APIキーを入力してください");
    return;
  }
  state.apiKey = key;
  localStorage.setItem(API_KEY_STORAGE, key);
  sessionStorage.removeItem(API_KEY_STORAGE);
  els.apiKeyInput.value = "";
  syncApiKeyUi();
  setStatus("APIキーを保存しました。次回起動時も使えます");
});

els.clearApiKey.addEventListener("click", () => {
  state.apiKey = "";
  localStorage.removeItem(API_KEY_STORAGE);
  sessionStorage.removeItem(API_KEY_STORAGE);
  els.apiKeyInput.value = "";
  syncApiKeyUi();
  setStatus("APIキーを削除しました");
});

els.moodFiles.addEventListener("change", async (event) => {
  await setMoodImages(event.target.files);
});

els.baseFiles.addEventListener("change", async (event) => {
  await setBaseImages(event.target.files);
});

els.generateBtn.addEventListener("click", async () => {
  const generated = await generateHeadlines();
  if (generated) {
    renderHeadlines();
    resetDesignResult("見出し案を選んでからAIデザインを生成してください");
  }
});

els.refreshHeadlines.addEventListener("click", async () => {
  const generated = await generateHeadlines();
  if (generated) {
    renderHeadlines();
    resetDesignResult("見出し案を選んでからAIデザインを生成してください");
  }
});

els.clearBtn.addEventListener("click", () => {
  state.moodImages = [];
  state.baseImages = [];
  state.headlines = [];
  state.originalHeadlines = [];
  state.headlineAngles = [];
  state.selectedHeadlineIndex = 0;
  state.generatedDesignUrl = "";
  state.generatedBackgroundUrl = "";
  state.generatedTextLayerUrl = "";
  state.designCache = new Map();
  state.textStyleIndex = 0;
  state.designPlan = null;
  state.referenceReport = "";
  state.textThemes = [];
  state.palette = ["#e63b2e", "#0f8f8a", "#f3c230"];
  els.moodFiles.value = "";
  els.baseFiles.value = "";
  els.scriptText.value = "";
  els.brandUrl.value = "";
  els.moodPreview.innerHTML = "";
  els.basePreview.innerHTML = "";
  els.headlineList.innerHTML = "";
  renderReferenceReport("");
  resetDesignResult("見出し案を選んでからAIデザインを生成してください");
  setStatus("素材と原稿を入れて生成してください");
});

els.generateDesign.addEventListener("click", async () => {
  await generateAiDesign();
});

els.downloadDesign.addEventListener("click", () => {
  if (!state.generatedDesignUrl) {
    setStatus("保存できる完成サムネPNGがまだありません");
    return;
  }
  downloadDataUrl(state.generatedDesignUrl, "youtube-thumbnail-ai.png");
  setStatus("完成サムネPNGの保存を開始しました");
});

els.generateTextLayer.addEventListener("click", async () => {
  await generateTextLayer();
});

els.downloadTextLayer.addEventListener("click", () => {
  if (!state.generatedTextLayerUrl) {
    setStatus("保存できる文字だけ透過PNGがまだありません。画像生成後に有効になります");
    return;
  }
  downloadDataUrl(state.generatedTextLayerUrl, "youtube-thumbnail-text-layer.png");
  setStatus("文字だけ透過PNGの保存を開始しました");
});

setupDropZone(document.querySelector("label[for='moodFiles']"), setMoodImages);
setupDropZone(document.querySelector("label[for='baseFiles']"), setBaseImages);

async function setMoodImages(files) {
  state.moodImages = await loadImages(files);
  renderThumbs(els.moodPreview, state.moodImages);
  state.palette = await buildPalette(state.moodImages);
  setStatus(`${state.moodImages.length}枚の参考画像から色味を拾いました`);
}

async function setBaseImages(files) {
  state.baseImages = await loadImages(files);
  renderThumbs(els.basePreview, state.baseImages);
  setStatus(`${state.baseImages.length}枚の元素材を読み込みました`);
}

function setupDropZone(zone, handler) {
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("is-dragging");
  });
  zone.addEventListener("dragleave", () => {
    zone.classList.remove("is-dragging");
  });
  zone.addEventListener("drop", async (event) => {
    event.preventDefault();
    zone.classList.remove("is-dragging");
    const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
    if (files.length) await handler(files);
  });
}

async function loadImages(files) {
  const list = [...files];
  return Promise.all(
    list.map((file) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => resolve({ file, url, img });
        img.onerror = reject;
        img.src = url;
      });
    })
  );
}

function renderThumbs(container, images) {
  container.innerHTML = "";
  images.forEach(({ file, url }) => {
    const img = document.createElement("img");
    img.src = url;
    img.alt = file.name;
    container.appendChild(img);
  });
}

async function generateHeadlines() {
  const count = clamp(Number(els.headlineCount.value) || 5, 2, 8);
  const script = els.scriptText.value.trim();
  if (!script) {
    state.headlines = sampleHeadlines(count);
    state.originalHeadlines = [...state.headlines];
    state.textThemes = fallbackTextThemes;
    state.headlineAngles = state.headlines.map(() => "原稿未入力のため仮案");
    setStatus("原稿が空なので、汎用の見出し案を出しました");
    return true;
  }

  if (!state.apiKey) {
    state.headlines = [];
    state.originalHeadlines = [];
    state.headlineAngles = [];
    els.headlineList.innerHTML = "";
    resetDesignResult("見出し案を選んでからAIデザインを生成してください");
    setStatus("OpenAI APIキーを保存してから生成してください");
    return false;
  }

  const result = await generateAiHeadlines(script, count);
  if (!result.headlines.length) return false;

  state.headlines = result.headlines.map((item) => item.text);
  state.originalHeadlines = [...state.headlines];
  state.headlineAngles = result.headlines.map((item) => item.angle || "AI生成");
  state.textThemes = result.textThemes.length ? result.textThemes : fallbackTextThemes;
  state.referenceReport = result.referenceReport || "";
  state.selectedHeadlineIndex = 0;
  state.textStyleIndex = 0;
  renderReferenceReport(state.referenceReport);
  setStatus(`AI生成成功: ${result.model} で${state.headlines.length}個の見出し案を作りました`);
  return true;
}

async function generateAiHeadlines(script, count) {
  setBusy(true, "AIが原稿全体と画像文脈を読んでいます");
  try {
    const payload = {
      script,
      count,
      brandUrl: normalizeBrandUrl(els.brandUrl.value),
      moodImages: await imagesForAi(state.moodImages),
      baseImages: await imagesForAi(state.baseImages),
    };
    const response = await fetch("/api/headlines", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.apiKey ? { "X-OpenAI-API-Key": state.apiKey } : {}),
        "X-Client-Version": APP_VERSION,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (data.version?.apiVersion) {
      state.apiVersion = `${data.version.apiVersion} / ${data.version.buildTimestamp || ""}`.trim();
      syncVersionUi();
    }
    if (!response.ok) {
      throw new Error(data.detail || data.error || "AI生成に失敗しました");
    }
    return {
      model: data.model || "OpenAI",
      headlines: Array.isArray(data.headlines) ? data.headlines : [],
      textThemes: Array.isArray(data.textThemes) ? data.textThemes : [],
      referenceReport: data.referenceReport || "",
    };
  } catch (error) {
    state.headlines = [];
    state.originalHeadlines = [];
    state.headlineAngles = [];
    els.headlineList.innerHTML = "";
    resetDesignResult("見出し案を選んでからAIデザインを生成してください");
    setStatus(`AI生成に失敗しました: ${error.message}`);
    return { model: "", headlines: [] };
  } finally {
    setBusy(false);
  }
}

async function imagesForAi(images) {
  const targets = images.slice(0, 4);
  return Promise.all(targets.map(({ img }) => resizeImageDataUrl(img, 720, 0.72)));
}

function resizeImageDataUrl(img, maxWidth, quality) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, maxWidth / img.width);
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function compressTextLayerSource(dataUrl, diagnostics) {
  const originalLength = dataUrl.length;
  try {
    const img = await imageFromDataUrl(dataUrl);
    const compressed = resizeImageDataUrl(img, 1024, 0.82);
    diagnostics.push({
      stage: "client-compress",
      status: "ok",
      message: `送信用画像を軽量化しました: ${originalLength} chars -> ${compressed.length} chars`,
    });
    return compressed;
  } catch (error) {
    diagnostics.push({
      stage: "client-compress",
      status: "fallback",
      message: `送信用画像の軽量化に失敗したため元画像を送ります: ${error.message || error.type || "unknown"}`,
    });
    return dataUrl;
  }
}

function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function normalizeBrandUrl(value) {
  const raw = value.trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function extractSeeds(text) {
  const cleaned = text
    .replace(/[「」『』【】（）()[\]{}]/g, " ")
    .replace(/[、。,.!?！？:：;；]/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const chunks = cleaned
    .flatMap((line) => line.split(/\s+/))
    .map((part) => part.replace(/です|ます|でした|ました|する|した|して|という|こと|もの/g, ""))
    .map((part) => part.trim())
    .filter((part) => visibleLength(part) >= 4 && visibleLength(part) <= 13);

  return unique([...chunks, ...cleaned.map((line) => compactLine(line))])
    .filter((part) => visibleLength(part) >= 4 && visibleLength(part) <= 13)
    .sort((a, b) => scoreSeed(b) - scoreSeed(a))
    .slice(0, 8);
}

function pickTopic(script, seeds) {
  const compact = script.replace(/\s+/g, "");
  const topicPatterns = [
    /(キッチン収納|サムネ|デザイン|レビュー|引き出し|新商品)/,
    /[一-龠ぁ-んァ-ヶA-Za-z0-9０-９]{2,10}(収納|商品|機能|サービス|アプリ|ツール|設計|比較)/,
  ];
  for (const pattern of topicPatterns) {
    const match = compact.match(pattern);
    if (match) return trimSeed(match[0]);
  }
  return trimSeed(seeds[0] || "これは便利");
}

function pickClause(script, patterns, fallback) {
  const compact = script.replace(/\s+/g, "");
  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (match) return trimSeed(match[0]);
  }
  return fallback;
}

function trimSeed(seed) {
  return seed
    .replace(/です|ます|でした|ました|だった|ので|けど|から|ほど/g, "")
    .replace(/^[、。,.!?！？]+|[、。,.!?！？]+$/g, "")
    .slice(0, 11);
}

function compactLine(line) {
  return line.replace(/\s+/g, "").slice(0, 13);
}

function scoreSeed(text) {
  let score = visibleLength(text);
  if (/便利|変わ|損|理由|本音|比較|失敗|正直|想像|新|使/.test(text)) score += 8;
  if (/[0-9０-９]/.test(text)) score += 5;
  return score;
}

function sampleHeadlines(count) {
  return [
    "正直、\nこれで変わる",
    "知らないと損",
    "使ってわかった\n本音",
    "この差、\n大きい",
    "選ぶ理由が\nありました",
  ].slice(0, count);
}

function renderHeadlines() {
  els.headlineList.innerHTML = "";
  if (state.selectedHeadlineIndex >= state.headlines.length) state.selectedHeadlineIndex = 0;
  renderTextStyleControls();
  state.headlines.forEach((headline, index) => {
    const item = document.createElement("article");
    item.className = "headline-item";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "selectedHeadline";
    radio.checked = index === state.selectedHeadlineIndex;
    radio.addEventListener("change", () => {
      state.selectedHeadlineIndex = index;
      resetDesignResult("見出しを選択しました。選択見出しで再生成してください");
    });
    const body = document.createElement("div");
    body.className = "headline-body";
    const input = document.createElement("textarea");
    input.value = headline;
    input.rows = 2;
    input.addEventListener("input", () => {
      state.headlines[index] = input.value;
      renderHeadlineMeta(note, restoreButton, index);
      if (index === state.selectedHeadlineIndex) resetDesignResult("見出しを編集しました。選択見出しで再生成してください");
    });
    const note = document.createElement("small");
    const restoreButton = document.createElement("button");
    restoreButton.type = "button";
    restoreButton.className = "restore-headline";
    restoreButton.addEventListener("click", () => {
      state.headlines[index] = state.originalHeadlines[index] || state.headlines[index];
      renderHeadlines();
      if (index === state.selectedHeadlineIndex) resetDesignResult("元の見出し案に戻しました。選択見出しで再生成してください");
    });
    renderHeadlineMeta(note, restoreButton, index);
    const actions = document.createElement("div");
    actions.className = "headline-actions";
    actions.append(note, restoreButton);
    body.append(input, actions);
    item.append(radio, body);
    els.headlineList.appendChild(item);
  });
}

function renderHeadlineMeta(note, restoreButton, index) {
  const edited = state.originalHeadlines[index] && state.headlines[index] !== state.originalHeadlines[index];
  note.textContent = `案 ${index + 1} / ${state.headlineAngles[index] || "AI生成"}${edited ? " / 編集済み" : ""}`;
  restoreButton.textContent = "元に戻す";
  restoreButton.disabled = !edited;
}

function renderTextStyleControls() {
  els.textStyleControls.innerHTML = "";
  els.textStyleControls.hidden = !state.headlines.length;
  if (!state.headlines.length) return;

  const themes = state.textThemes.length ? state.textThemes : fallbackTextThemes;
  themes.forEach((style, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = style.name;
    button.title = style.direction || style.name;
    button.className = index === state.textStyleIndex ? "is-active" : "";
    button.addEventListener("click", () => {
      state.textStyleIndex = index;
      renderTextStyleControls();
      const cached = getCachedDesign();
      if (cached) {
        state.designPlan = cached.designPlan || state.designPlan;
        renderGeneratedImages(cached.image, cached.textLayer, { alreadyNormalized: true, textLayerQuality: cached.textLayerQuality || null });
        renderReferenceReport(cached.referenceReport || state.referenceReport);
        setStatus("生成済みの文字テーマを表示しました");
      } else {
        showDesignReadyForTheme("この文字テーマでは未生成です。選択見出しで生成してください");
      }
    });
    els.textStyleControls.appendChild(button);
  });
}

async function generateAiDesign() {
  if (!state.headlines.length) {
    setStatus("先に原稿から見出しを生成してください");
    return;
  }
  if (!state.baseImages.length) {
    setStatus("Bの元素材画像を入れてからAIデザインを生成してください");
    return;
  }
  if (!state.apiKey) {
    setStatus("OpenAI APIキーを保存してからAIデザインを生成してください");
    return;
  }

  const headline = state.headlines[state.selectedHeadlineIndex] || state.headlines[0];
  const textTheme = (state.textThemes.length ? state.textThemes : fallbackTextThemes)[state.textStyleIndex] || fallbackTextThemes[0];
  showDesignLoading("AIが完成サムネを生成中", "背景と文字を一体でデザインした後、文字だけの透過PNGを別生成します。");
  setDesignBusy(true, "AIが全体デザインと文字レイヤー方針を設計しています");
  try {
    const response = await fetch("/api/design", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.apiKey ? { "X-OpenAI-API-Key": state.apiKey } : {}),
      },
      body: JSON.stringify({
        headline,
        textTheme,
        script: els.scriptText.value.trim(),
        brandUrl: normalizeBrandUrl(els.brandUrl.value),
        moodImages: await imagesForAi(state.moodImages),
        baseImages: await imagesForAi(state.baseImages),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || "AIデザイン生成に失敗しました");
    state.designPlan = data.designPlan || null;
    state.referenceReport = data.referenceReport || "";
    renderTextStyleControls();
    renderReferenceReport(state.referenceReport);
    await renderGeneratedImages(data.image, "");
    state.designCache.set(designCacheKey(), {
      image: state.generatedDesignUrl,
      textLayer: "",
      textLayerQuality: null,
      referenceReport: state.referenceReport,
      designPlan: state.designPlan,
    });
    setStatus(`AIデザイン生成成功: ${data.model || "OpenAI"}`);
  } catch (error) {
    resetDesignResult("AIデザイン生成に失敗しました");
    setStatus(`AIデザイン生成に失敗しました: ${error.message}`);
  } finally {
    setDesignBusy(false);
  }
}

async function generateTextLayer() {
  if (!state.generatedDesignUrl) {
    setStatus("先に完成サムネを生成してください");
    return;
  }
  if (!state.apiKey) {
    setStatus("OpenAI APIキーを保存してから文字だけ透過PNGを生成してください");
    return;
  }

  showTextLayerLoading("文字だけ透過PNGを生成中", "AIが文字マスクを作成し、完成サムネの色を保持したまま透過PNGへ合成しています。");
  setDesignBusy(true, "AIが文字マスクを生成し、品質チェックしています");
  const diagnostics = [{
    stage: "client",
    status: "start",
    message: `Web v${APP_VERSION} で文字だけ透過PNG生成を開始`,
  }];
  try {
    const headline = state.headlines[state.selectedHeadlineIndex] || state.headlines[0];
    const textTheme = (state.textThemes.length ? state.textThemes : fallbackTextThemes)[state.textStyleIndex] || fallbackTextThemes[0];
    const cacheKey = textLayerCacheKey(headline, textTheme);
    const cachedResult = readTextLayerCache(cacheKey);
    if (cachedResult?.ok && cachedResult.textLayer) {
      diagnostics.push({ stage: "client-cache", status: "hit", message: "同じ条件の成功結果を再利用しました。APIは呼んでいません。" });
      state.generatedTextLayerUrl = cachedResult.textLayer;
      state.generatedTextLayerQuality = cachedResult.quality || null;
      renderTextLayerImage(state.generatedTextLayerUrl, state.generatedTextLayerQuality, [...diagnostics, ...(cachedResult.diagnostics || [])]);
      els.downloadTextLayer.disabled = state.generatedTextLayerQuality?.status === "再生成推奨";
      setStatus("キャッシュ済みの文字だけ透過PNGを表示しました。APIは使っていません");
      return;
    }
    if (cachedResult?.ok === false) {
      diagnostics.push({ stage: "client-cache", status: "skip", message: "失敗結果は再利用せず、APIへ再試行します。" });
    }
    diagnostics.push({
      stage: "client-request",
      status: "ready",
      message: `imageChars=${state.generatedDesignUrl.length}, headlineChars=${String(headline?.text || headline || "").length}, theme=${textTheme.name}`,
    });
    const requestImage = await compressTextLayerSource(state.generatedDesignUrl, diagnostics);
    const response = await fetch("/api/text-layer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.apiKey ? { "X-OpenAI-API-Key": state.apiKey } : {}),
        "X-Client-Version": APP_VERSION,
      },
      body: JSON.stringify({
        image: requestImage,
        headline,
        textTheme,
        designPlan: state.designPlan || {},
      }),
    });
    diagnostics.push({ stage: "client-response", status: String(response.status), message: `HTTP ${response.status} を受信しました` });
    const data = await response.json().catch((error) => {
      diagnostics.push({ stage: "client-response", status: "json-error", message: error.message });
      return {};
    });
    if (data.version?.apiVersion) {
      state.apiVersion = `${data.version.apiVersion} / ${data.version.buildTimestamp || ""}`.trim();
      syncVersionUi();
    }
    const mergedDiagnostics = [...diagnostics, ...(data.diagnostics || [])];
    if (!response.ok) {
      const error = new Error(data.detail || data.error || "文字だけ透過PNG生成に失敗しました");
      error.diagnostics = mergedDiagnostics;
      throw error;
    }
    if (!data.textLayer || typeof data.textLayer !== "string") {
      const error = new Error("APIレスポンスに textLayer が含まれていません");
      error.diagnostics = mergedDiagnostics;
      throw error;
    }
    if (data.processing === "client-chroma-package") {
      const composed = await composeChromaPackageInBrowser(data.textLayer, data.chromaKey, data.styleSpec, mergedDiagnostics);
      state.generatedTextLayerUrl = composed.textLayer;
      state.generatedTextLayerQuality = composed.quality;
    } else {
      state.generatedTextLayerUrl = await normalizeImageToThumbnail(data.textLayer, true).catch((error) => {
        mergedDiagnostics.push({
          stage: "client-normalize",
          status: "fallback",
          message: `ブラウザ内の1280x720正規化に失敗したため、APIが返したPNGをそのまま使います: ${error.message || error.type || "unknown"}`,
        });
        return data.textLayer;
      });
      state.generatedTextLayerQuality = data.quality || null;
    }
    renderTextLayerImage(state.generatedTextLayerUrl, state.generatedTextLayerQuality, mergedDiagnostics);
    writeTextLayerCache(cacheKey, {
      ok: true,
      textLayer: state.generatedTextLayerUrl,
      quality: state.generatedTextLayerQuality,
      diagnostics: mergedDiagnostics,
    });
    const cached = getCachedDesign();
    if (cached) {
      cached.textLayer = state.generatedTextLayerUrl;
      cached.textLayerQuality = state.generatedTextLayerQuality;
    }
    const failedQuality = state.generatedTextLayerQuality?.status === "再生成推奨";
    els.downloadTextLayer.disabled = failedQuality;
    setStatus(failedQuality ? "文字だけ透過PNGを生成しましたが、品質チェックで再生成推奨です" : "文字だけ透過PNGを生成しました");
  } catch (error) {
    showTextLayerError(`文字だけ透過PNG生成に失敗しました: ${error.message}`, error.diagnostics?.length ? error.diagnostics : diagnostics);
    setStatus(`文字だけ透過PNG生成に失敗しました: ${error.message}`);
  } finally {
    setDesignBusy(false);
  }
}

function resetDesignResult(message) {
  state.generatedDesignUrl = "";
  state.generatedBackgroundUrl = "";
  state.generatedTextLayerUrl = "";
  state.generatedTextLayerQuality = null;
  els.downloadDesign.disabled = true;
  els.generateTextLayer.disabled = true;
  els.downloadTextLayer.disabled = true;
  els.downloadActions.hidden = true;
  resetTextLayerResult();
  els.designResult.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = message;
  els.designResult.appendChild(p);
  if (!state.headlines.length) {
    els.textStyleControls.innerHTML = "";
    els.textStyleControls.hidden = true;
  }
}

function showDesignReadyForTheme(message) {
  state.generatedDesignUrl = "";
  state.generatedBackgroundUrl = "";
  state.generatedTextLayerUrl = "";
  state.generatedTextLayerQuality = null;
  els.downloadDesign.disabled = true;
  els.generateTextLayer.disabled = true;
  els.downloadTextLayer.disabled = true;
  els.downloadActions.hidden = false;
  resetTextLayerResult();
  els.designResult.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = message;
  els.designResult.appendChild(p);
}

function showDesignLoading(title, detail) {
  els.downloadDesign.disabled = true;
  els.generateTextLayer.disabled = true;
  els.downloadTextLayer.disabled = true;
  els.designResult.innerHTML = "";
  const box = document.createElement("div");
  box.className = "loading-box";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const p = document.createElement("p");
  p.textContent = detail;
  const track = document.createElement("div");
  track.className = "progress-track";
  const bar = document.createElement("div");
  bar.className = "progress-bar";
  track.appendChild(bar);
  box.append(strong, p, track);
  els.designResult.appendChild(box);
}

function showTextLayerLoading(title, detail) {
  els.textLayerSection.hidden = false;
  els.downloadTextLayer.disabled = true;
  els.textLayerResult.innerHTML = "";
  const box = document.createElement("div");
  box.className = "loading-box";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const p = document.createElement("p");
  p.textContent = detail;
  const track = document.createElement("div");
  track.className = "progress-track";
  const bar = document.createElement("div");
  bar.className = "progress-bar";
  track.appendChild(bar);
  box.append(strong, p, track);
  els.textLayerResult.appendChild(box);
}

function resetTextLayerResult(message = "文字だけ透過PNGを生成するとここに表示されます") {
  state.generatedTextLayerUrl = "";
  state.generatedTextLayerQuality = null;
  els.downloadTextLayer.disabled = true;
  els.textLayerSection.hidden = true;
  els.textLayerResult.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = message;
  els.textLayerResult.appendChild(p);
}

function showTextLayerError(message, diagnostics = []) {
  state.generatedTextLayerUrl = "";
  state.generatedTextLayerQuality = null;
  els.downloadTextLayer.disabled = true;
  els.textLayerSection.hidden = false;
  els.textLayerResult.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = message;
  p.style.whiteSpace = "pre-wrap";
  els.textLayerResult.appendChild(p);
  els.textLayerResult.appendChild(renderDiagnostics(diagnostics.length ? diagnostics : [{
    stage: "client",
    status: "missing",
    message: "サーバーから診断ログ配列を受け取れませんでした。上のエラー本文に診断が含まれているか確認してください。",
  }]));
}

async function loadApiVersion() {
  try {
    const response = await fetch(`/api/version?v=${encodeURIComponent(APP_VERSION)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.apiVersion = `${data.apiVersion || "-"} / ${data.buildTimestamp || "-"}`;
  } catch (error) {
    state.apiVersion = `未確認 (${error.message})`;
  }
  syncVersionUi();
}

function syncVersionUi() {
  if (!els.appVersion) return;
  els.appVersion.textContent = `Web v${APP_VERSION} / API ${state.apiVersion || "確認中"} / ${APP_BUILD_TIMESTAMP}`;
}

function renderTextLayerImage(src, quality = null, diagnostics = []) {
  els.textLayerSection.hidden = false;
  els.textLayerResult.innerHTML = "";
  const img = document.createElement("img");
  img.src = src;
  img.alt = "AI generated transparent text layer";
  els.textLayerResult.appendChild(img);
  if (quality) els.textLayerResult.appendChild(renderQualityReport(quality));
  if (diagnostics.length) els.textLayerResult.appendChild(renderDiagnostics(diagnostics));
}

function renderQualityReport(quality) {
  const box = document.createElement("div");
  box.className = `quality-report quality-${quality.status === "良好" ? "good" : quality.status === "要確認" ? "warn" : "bad"}`;
  const title = document.createElement("strong");
  title.textContent = `${quality.summary || "品質チェック"} / ${quality.score ?? "-"}点`;
  const note = document.createElement("p");
  note.textContent = quality.status === "再生成推奨"
    ? "保存は無効です。マスクがずれている可能性が高いので、もう一度生成してください。"
    : "完成サムネとの差分をもとに自動判定しています。";
  const list = document.createElement("ul");
  for (const check of quality.checks || []) {
    const item = document.createElement("li");
    item.textContent = check;
    list.appendChild(item);
  }
  box.append(title, note, list);
  return box;
}

function renderDiagnostics(diagnostics) {
  const box = document.createElement("div");
  box.className = "quality-report quality-warn";
  const title = document.createElement("strong");
  title.textContent = "生成診断ログ";
  const note = document.createElement("p");
  note.textContent = "文字だけ透過PNGの内部処理で、どの方式を試したかを表示しています。";
  const list = document.createElement("ul");
  for (const entry of diagnostics) {
    const item = document.createElement("li");
    const stage = entry.stage ? `[${entry.stage}] ` : "";
    const status = entry.status ? `${entry.status}: ` : "";
    item.textContent = `${stage}${status}${entry.message || ""}`;
    list.appendChild(item);
  }
  box.append(title, note, list);
  return box;
}

function renderReferenceReport(report) {
  els.referenceReport.hidden = !report;
  els.referenceReport.innerHTML = "";
  if (!report) return;
  const title = document.createElement("strong");
  title.textContent = "参考にした要素";
  const body = document.createElement("div");
  body.textContent = report;
  els.referenceReport.append(title, body);
}

async function renderGeneratedImages(imageUrl, textLayerUrl, options = {}) {
  state.generatedDesignUrl = options.alreadyNormalized ? imageUrl : await normalizeImageToThumbnail(imageUrl);
  state.generatedTextLayerUrl = textLayerUrl ? (options.alreadyNormalized ? textLayerUrl : await normalizeImageToThumbnail(textLayerUrl, true)) : "";
  state.generatedTextLayerQuality = textLayerUrl ? options.textLayerQuality || state.generatedTextLayerQuality || null : null;
  els.designResult.innerHTML = "";
  const img = document.createElement("img");
  img.src = state.generatedDesignUrl;
  img.alt = "AI generated YouTube thumbnail";
  els.designResult.appendChild(img);
  els.downloadDesign.disabled = false;
  els.generateTextLayer.disabled = false;
  els.downloadTextLayer.disabled = !textLayerUrl;
  els.downloadActions.hidden = false;
  if (textLayerUrl) renderTextLayerImage(state.generatedTextLayerUrl, state.generatedTextLayerQuality);
  else resetTextLayerResult();
}

function designCacheKey() {
  const headline = state.headlines[state.selectedHeadlineIndex] || "";
  const theme = (state.textThemes.length ? state.textThemes : fallbackTextThemes)[state.textStyleIndex] || fallbackTextThemes[0];
  return JSON.stringify({ headline, theme: theme.name, direction: theme.direction });
}

function getCachedDesign() {
  return state.designCache.get(designCacheKey());
}

function textLayerCacheKey(headline, textTheme) {
  const payload = [
    APP_VERSION,
    state.generatedDesignUrl.slice(0, 240),
    state.generatedDesignUrl.length,
    typeof headline === "string" ? headline : headline?.text || "",
    textTheme?.name || "",
    textTheme?.direction || "",
  ].join("|");
  return `${TEXT_LAYER_CACHE_PREFIX}${hashString(payload)}`;
}

function readTextLayerCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeTextLayerCache(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify({
      ...value,
      version: APP_VERSION,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Large images may exceed sessionStorage; caching is only a cost-saver.
  }
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function composeChromaPackageInBrowser(src, chromaKey, styleSpec = {}, diagnostics = []) {
  const image = await imageFromDataUrl(src);
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  drawCover(ctx, image, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const key = normalizeChromaKey(chromaKey);
  const matte = estimateCanvasMatteColor(data, canvas.width, canvas.height, key);
  const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
  const low = 24;
  const high = 118;
  let active = 0;
  let soft = 0;
  let despilled = 0;

  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    const i = pixel * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const distance = rgbDistance({ r, g, b }, matte);
    let a = 255;
    if (distance <= low) a = 0;
    else if (distance < high) a = clamp(Math.round(((distance - low) / (high - low)) * 255), 0, 255);
    alpha[pixel] = a;
    if (a > 12) active += 1;
    if (a > 12 && a < 180) soft += 1;

    if (a > 0 && a < 255) {
      const ratio = a / 255;
      data[i] = clamp(Math.round((r - matte.r * (1 - ratio)) / ratio), 0, 255);
      data[i + 1] = clamp(Math.round((g - matte.g * (1 - ratio)) / ratio), 0, 255);
      data[i + 2] = clamp(Math.round((b - matte.b * (1 - ratio)) / ratio), 0, 255);
      if (despillCanvasPixel(data, i, matte, styleSpec, a)) despilled += 1;
    }
    data[i + 3] = a;
  }

  const objectAlpha = erodeCanvasAlpha(sharpenCanvasAlpha(alpha), canvas.width, canvas.height);
  const layer = new Uint8ClampedArray(data.length);
  for (let pixel = 0; pixel < objectAlpha.length; pixel += 1) {
    const a = objectAlpha[pixel];
    if (!a) continue;
    const i = pixel * 4;
    compositeCanvasPixel(layer, i, data[i], data[i + 1], data[i + 2], a);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(new ImageData(layer, canvas.width, canvas.height), 0, 0);
  const coverage = active / alpha.length;
  const softRatio = active ? soft / active : 0;
  const score = clamp(Math.round(88 - (coverage < 0.015 ? 32 : 0) - (coverage > 0.3 ? 16 : 0) - (coverage > 0.42 ? 22 : 0)), 0, 100);
  diagnostics.push({
    stage: "client-compose",
    status: "ok",
    message: `Cloudflareではなくブラウザで透過PNGへ合成しました: coverage=${coverage.toFixed(4)}`,
  });

  return {
    textLayer: canvas.toDataURL("image/png"),
    quality: {
      status: score >= 78 ? "良好" : score >= 55 ? "要確認" : "再生成推奨",
      score,
      summary: `品質チェック: ${score >= 78 ? "良好" : score >= 55 ? "要確認" : "再生成推奨"}`,
      coverage: Number(coverage.toFixed(4)),
      softRatio: Number(softRatio.toFixed(4)),
      despilled,
      chromaKey: key.hex,
      colorization: { style: styleSpec, mode: "browser-chroma-package" },
      checks: [
        `ブラウザ側でクロマキー透過合成しました: ${key.hex}`,
        `実測マット色: ${rgbToHex(matte.r, matte.g, matte.b)}`,
        "編集しやすい文字素材にするため、抽出後のシャドー再構築は行っていません",
        "クロマキー縁を抑えるため、文字エッジを約1px内側に締めました",
        despilled ? `クロマキー色のにじみを${despilled}ピクセル補正しました` : "クロマキー色の大きなにじみは検出されませんでした",
        coverage < 0.015 ? "抽出面積が小さく、文字や帯が欠けている可能性があります" : coverage > 0.3 ? "抽出面積が大きめです。文字の重複や不要な装飾が混入していないか確認してください" : "抽出面積は妥当そうです",
      ],
    },
  };
}

function normalizeChromaKey(chromaKey) {
  if (chromaKey && typeof chromaKey === "object" && Number.isFinite(chromaKey.r)) {
    return {
      r: clamp(Math.round(chromaKey.r), 0, 255),
      g: clamp(Math.round(chromaKey.g), 0, 255),
      b: clamp(Math.round(chromaKey.b), 0, 255),
      hex: chromaKey.hex || rgbToHex(chromaKey.r, chromaKey.g, chromaKey.b),
    };
  }
  return { r: 0, g: 255, b: 0, hex: "#00ff00" };
}

function estimateCanvasMatteColor(data, width, height, expected) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 120));
  for (let x = 0; x < width; x += step) {
    samples.push(canvasPixelAt(data, width, x, 0), canvasPixelAt(data, width, x, height - 1));
  }
  for (let y = 0; y < height; y += step) {
    samples.push(canvasPixelAt(data, width, 0, y), canvasPixelAt(data, width, width - 1, y));
  }
  const near = samples.filter((pixel) => rgbDistance(pixel, expected) <= 120);
  const source = near.length >= Math.max(12, samples.length * 0.12) ? near : samples;
  return {
    r: medianNumber(source.map((pixel) => pixel.r)),
    g: medianNumber(source.map((pixel) => pixel.g)),
    b: medianNumber(source.map((pixel) => pixel.b)),
  };
}

function canvasPixelAt(data, width, x, y) {
  const i = (y * width + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

function medianNumber(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function rgbDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function parseHexColor(value, fallback = "#222222") {
  const match = String(value || fallback).match(/^#?([0-9a-f]{6})$/i);
  const hex = match ? match[1] : fallback.replace("#", "");
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function despillCanvasPixel(data, index, matte, styleSpec, alpha) {
  const target = alpha < 115
    ? parseHexColor(styleSpec?.shadowColor, "#222222")
    : parseHexColor(styleSpec?.fillColor, "#ffffff");
  const before = { r: data[index], g: data[index + 1], b: data[index + 2] };
  const keyVector = { r: matte.r - target.r, g: matte.g - target.g, b: matte.b - target.b };
  const pixelVector = { r: before.r - target.r, g: before.g - target.g, b: before.b - target.b };
  const keyMagnitude = keyVector.r ** 2 + keyVector.g ** 2 + keyVector.b ** 2;
  if (!keyMagnitude) return false;
  const projection = (pixelVector.r * keyVector.r + pixelVector.g * keyVector.g + pixelVector.b * keyVector.b) / keyMagnitude;
  if (projection <= 0) return false;
  const amount = clamp(projection * (1 - alpha / 255) * 1.25, 0, 0.9);
  if (amount <= 0.015) return false;
  data[index] = clamp(Math.round(before.r - keyVector.r * amount), 0, 255);
  data[index + 1] = clamp(Math.round(before.g - keyVector.g * amount), 0, 255);
  data[index + 2] = clamp(Math.round(before.b - keyVector.b * amount), 0, 255);
  return true;
}

function sharpenCanvasAlpha(alpha) {
  const output = new Uint8ClampedArray(alpha.length);
  for (let i = 0; i < alpha.length; i += 1) {
    const value = alpha[i];
    if (value < 64) output[i] = 0;
    else if (value < 190) output[i] = clamp(Math.round(((value - 64) / 126) * 220), 0, 220);
    else output[i] = value;
  }
  return output;
}

function erodeCanvasAlpha(alpha, width, height) {
  const output = new Uint8ClampedArray(alpha.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = alpha[index];
      if (!value) continue;
      let minNeighbor = value;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
          minNeighbor = Math.min(minNeighbor, alpha[yy * width + xx]);
        }
      }
      output[index] = minNeighbor < 128 ? 0 : Math.round(value * 0.98);
    }
  }
  return output;
}

function rebuildCanvasShadow(layer, objectAlpha, width, height, styleSpec = {}) {
  const opacity = clamp(Number(styleSpec.shadowOpacity ?? 0.28), 0, 1);
  const blur = clamp(Math.round(Number(styleSpec.shadowBlur ?? 10)), 0, 20);
  const offsetX = clamp(Math.round(Number(styleSpec.shadowOffsetX ?? 6)), -20, 20);
  const offsetY = clamp(Math.round(Number(styleSpec.shadowOffsetY ?? 7)), -20, 20);
  if (opacity <= 0 || blur <= 0) return;
  const shadowColor = parseHexColor(styleSpec.shadowColor, "#222222");
  const blurred = blurAlpha(objectAlpha, width, height, blur);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x - offsetX;
      const sy = y - offsetY;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const a = Math.round(blurred[sy * width + sx] * opacity * 0.72);
      if (a) compositeCanvasPixel(layer, (y * width + x) * 4, shadowColor.r, shadowColor.g, shadowColor.b, a);
    }
  }
}

function blurAlpha(alpha, width, height, radius) {
  const output = new Uint8ClampedArray(alpha.length);
  const r = Math.max(1, radius);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      let sum = 0;
      let count = 0;
      for (let yy = y0; yy <= y1; yy += 2) {
        for (let xx = x0; xx <= x1; xx += 2) {
          sum += alpha[yy * width + xx];
          count += 1;
        }
      }
      output[y * width + x] = Math.round(sum / count);
    }
  }
  return output;
}

function compositeCanvasPixel(layer, index, r, g, b, alpha) {
  const srcA = clamp(alpha, 0, 255) / 255;
  const dstA = layer[index + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (!outA) return;
  layer[index] = Math.round((r * srcA + layer[index] * dstA * (1 - srcA)) / outA);
  layer[index + 1] = Math.round((g * srcA + layer[index + 1] * dstA * (1 - srcA)) / outA);
  layer[index + 2] = Math.round((b * srcA + layer[index + 2] * dstA * (1 - srcA)) / outA);
  layer[index + 3] = Math.round(outA * 255);
}

function normalizeImageToThumbnail(src, transparent = false) {
  return new Promise((resolve, reject) => {
    if (!src || typeof src !== "string") {
      reject(new Error("画像データURLが空です"));
      return;
    }
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d");
      if (!transparent) {
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      drawCover(ctx, image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = reject;
    image.src = src;
  });
}

async function buildPalette(images) {
  if (!images.length) return state.palette;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = 80;
  canvas.height = 45;

  const samples = [];
  images.slice(0, 4).forEach(({ img }) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCover(ctx, img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 64) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (sat > 34 && r + g + b > 150 && r + g + b < 690) samples.push([r, g, b]);
    }
  });

  if (samples.length < 3) return state.palette;
  samples.sort((a, b) => colorEnergy(b) - colorEnergy(a));
  return unique(samples.slice(0, 24).map(([r, g, b]) => rgbToHex(r, g, b))).slice(0, 3);
}

function drawBase(ctx, img, intensity = 0.28) {
  drawCover(ctx, img, 0, 0, 1280, 720);
  const gradient = ctx.createLinearGradient(0, 0, 1280, 720);
  gradient.addColorStop(0, `rgba(0, 0, 0, ${intensity + 0.18})`);
  gradient.addColorStop(0.5, `rgba(0, 0, 0, ${intensity * 0.4})`);
  gradient.addColorStop(1, `rgba(0, 0, 0, ${intensity + 0.06})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1280, 720);
}

function drawImpactSlash(ctx, img, text, index) {
  const [accent, teal, yellow] = colors(index);
  drawBase(ctx, img, 0.32);
  polygon(ctx, [[0, 0], [510, 0], [410, 720], [0, 720]], accent);
  polygon(ctx, [[840, 0], [1280, 0], [1280, 720], [960, 720]], "rgba(0,0,0,.72)");
  strokeTextBlock(ctx, text, 74, 112, 610, 94, "#fff", "#111", 14, "left");
  tag(ctx, "BEFORE / AFTER", 80, 595, yellow, "#111");
  bar(ctx, 80, 548, 460, 12, teal);
}

function drawNewsBurst(ctx, img, text, index) {
  const [accent, teal, yellow] = colors(index);
  drawBase(ctx, img, 0.18);
  ctx.fillStyle = yellow;
  ctx.fillRect(0, 0, 1280, 86);
  ctx.fillStyle = "#111";
  ctx.font = "900 42px sans-serif";
  ctx.fillText("POINT", 54, 58);
  ctx.fillStyle = accent;
  ctx.fillRect(56, 478, 870, 150);
  strokeTextBlock(ctx, text, 74, 492, 815, 76, "#fff", "#111", 10, "left");
  circle(ctx, 1090, 148, 112, teal);
  ctx.fillStyle = "#fff";
  ctx.font = "900 64px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("注目", 1090, 169);
}

function drawCinemaLower(ctx, img, text, index) {
  const [accent, teal] = colors(index);
  drawBase(ctx, img, 0.38);
  ctx.fillStyle = "rgba(0,0,0,.72)";
  ctx.fillRect(0, 472, 1280, 248);
  bar(ctx, 74, 446, 210, 14, accent);
  bar(ctx, 304, 446, 126, 14, teal);
  strokeTextBlock(ctx, text, 74, 510, 900, 72, "#fff", "rgba(0,0,0,.95)", 8, "left");
  labelOutline(ctx, "REAL REVIEW", 988, 610);
}

function drawCleanFocus(ctx, img, text, index) {
  const [accent, teal, yellow] = colors(index);
  drawBase(ctx, img, 0.1);
  ctx.fillStyle = "rgba(255,255,255,.92)";
  roundRect(ctx, 56, 72, 560, 570, 8);
  ctx.fill();
  bar(ctx, 92, 112, 88, 10, accent);
  fillTextBlock(ctx, text, 92, 168, 455, 72, "#111", "left");
  tag(ctx, "THUMBNAIL", 92, 555, teal, "#fff");
  circle(ctx, 555, 128, 46, yellow);
}

function drawPopLabel(ctx, img, text, index) {
  const [accent, teal, yellow] = colors(index);
  drawBase(ctx, img, 0.24);
  polygon(ctx, [[0, 520], [1280, 410], [1280, 720], [0, 720]], "#fff");
  polygon(ctx, [[0, 555], [1280, 445], [1280, 512], [0, 625]], yellow);
  strokeTextBlock(ctx, text, 92, 458, 885, 80, "#111", "#fff", 16, "left");
  tag(ctx, "CHECK", 970, 594, accent, "#fff");
  bar(ctx, 1040, 108, 150, 150, teal);
}

function drawMonoProof(ctx, img, text, index) {
  const [accent] = colors(index);
  drawBase(ctx, img, 0.46);
  ctx.fillStyle = "rgba(255,255,255,.1)";
  for (let x = -200; x < 1400; x += 88) {
    polygon(ctx, [[x, 0], [x + 34, 0], [x - 220, 720], [x - 254, 720]], "rgba(255,255,255,.08)");
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = 18;
  ctx.strokeRect(44, 44, 1192, 632);
  strokeTextBlock(ctx, text, 88, 154, 910, 88, "#fff", "#000", 12, "left");
  labelOutline(ctx, "PROOF", 946, 588);
}

function drawUrgentFrame(ctx, img, text, index) {
  const [accent, teal, yellow] = colors(index);
  drawBase(ctx, img, 0.26);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 1280, 34);
  ctx.fillRect(0, 686, 1280, 34);
  ctx.fillRect(0, 0, 34, 720);
  ctx.fillRect(1246, 0, 34, 720);
  ctx.fillStyle = "rgba(0,0,0,.78)";
  roundRect(ctx, 84, 96, 700, 392, 8);
  ctx.fill();
  strokeTextBlock(ctx, text, 116, 142, 620, 84, "#fff", "#000", 10, "left");
  tag(ctx, "結論", 116, 414, yellow, "#111");
  circle(ctx, 1020, 560, 76, teal);
}

function drawSideTitle(ctx, img, text, index) {
  const [accent, teal, yellow] = colors(index);
  drawBase(ctx, img, 0.2);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, 438, 720);
  bar(ctx, 438, 0, 16, 720, accent);
  fillTextBlock(ctx, text, 58, 132, 320, 68, "#fff", "left");
  tag(ctx, "DESIGN TEST", 58, 568, yellow, "#111");
  bar(ctx, 58, 516, 210, 10, teal);
}

function fillTextBlock(ctx, text, x, y, maxWidth, fontSize, color, align) {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillStyle = color;
  const lines = wrapLines(ctx, text, maxWidth, fontSize);
  lines.forEach((line, index) => {
    ctx.font = `900 ${fontSize}px sans-serif`;
    ctx.fillText(line, x, y + index * fontSize * 1.13);
  });
  ctx.restore();
}

function strokeTextBlock(ctx, text, x, y, maxWidth, fontSize, fill, stroke, strokeWidth, align) {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  ctx.lineWidth = strokeWidth;
  const lines = wrapLines(ctx, text, maxWidth, fontSize);
  lines.forEach((line, index) => {
    ctx.font = `900 ${fontSize}px sans-serif`;
    const yy = y + index * fontSize * 1.12;
    ctx.strokeText(line, x, yy);
    ctx.fillText(line, x, yy);
  });
  ctx.restore();
}

function wrapLines(ctx, text, maxWidth, fontSize) {
  ctx.font = `900 ${fontSize}px sans-serif`;
  const manual = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const output = [];
  manual.forEach((line) => {
    let current = "";
    [...line].forEach((char) => {
      const trial = current + char;
      if (ctx.measureText(trial).width > maxWidth && current) {
        output.push(current);
        current = char;
      } else {
        current = trial;
      }
    });
    if (current) output.push(current);
  });
  return output.slice(0, 4);
}

function drawCover(ctx, img, x, y, width, height) {
  const scale = Math.max(width / img.width, height / img.height);
  const sw = width / scale;
  const sh = height / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, width, height);
}

function tag(ctx, text, x, y, bg, color) {
  ctx.save();
  ctx.font = "900 32px sans-serif";
  const width = ctx.measureText(text).width + 34;
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, width, 54, 6);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 17, y + 28);
  ctx.restore();
}

function labelOutline(ctx, text, x, y) {
  ctx.save();
  ctx.font = "900 42px sans-serif";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,.82)";
  ctx.fillStyle = "rgba(255,255,255,.08)";
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

function bar(ctx, x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

function circle(ctx, x, y, radius, color) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function polygon(ctx, points, color) {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function colors(index) {
  const colors = state.palette.length >= 3 ? state.palette : ["#e63b2e", "#0f8f8a", "#f3c230"];
  return [colors[index % colors.length], colors[(index + 1) % colors.length], colors[(index + 2) % colors.length]];
}

function colorEnergy([r, g, b]) {
  return Math.max(r, g, b) - Math.min(r, g, b) + Math.abs(r - g) * 0.3 + Math.abs(g - b) * 0.3;
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => clamp(v, 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function visibleLength(text) {
  return [...text].length;
}

function unique(items) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function setBusy(isBusy, message = "") {
  els.generateBtn.disabled = isBusy;
  els.refreshHeadlines.disabled = isBusy;
  els.generateDesign.disabled = isBusy;
  if (message) setStatus(message);
}

function setDesignBusy(isBusy, message = "") {
  els.generateDesign.disabled = isBusy;
  els.generateTextLayer.disabled = isBusy || !state.generatedDesignUrl;
  els.generateBtn.disabled = isBusy;
  els.refreshHeadlines.disabled = isBusy;
  if (message) setStatus(message);
}

function syncApiKeyUi() {
  els.apiKeyStatus.textContent = state.apiKey ? "設定済み" : "未設定";
  els.clearApiKey.disabled = !state.apiKey;
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
