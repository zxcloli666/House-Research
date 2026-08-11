import { chatWithOpenAI, createOpenAi } from "./core_fetch.ts";
import {
  createPartFromUri,
  createUserContent,
  GoogleGenAI,
  type Part,
} from "genai";
import readPdf from "./prompts/read-pdf.ts";
import { spyFetch } from "#utils/spyFetch.ts";
import { createRateLimiter } from "#utils/rateLimit.ts";
import OpenAI from "openai";
import {
  GEMINI_API_KEY,
  GEMINI_CHAT_ENDPOINT,
  GEMINI_ENDPOINT,
  GEMINI_RPM,
} from "#env";
import { log } from "#logger";

/**
 * Модели от лучшей к худшей. "-latest" — официальные алиасы Google на
 * актуальную модель нужного уровня, поэтому список не протухнет сам по
 * себе через полгода-год, как это уже дважды случалось с зашитыми
 * версионными именами вроде "gemini-3.1-pro-preview".
 * Перебор всегда идёт "модель X все ключи, потом модель похуже X все ключи":
 * так покрывается максимум комбинаций модель×ключ, и на бесплатном тарифе,
 * где у Pro обычно нулевая квота, откат до Flash/Flash-Lite происходит
 * автоматически без единой настройки.
 */
const MODELS = [
  "gemini-pro-latest",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
];
/** Только самая дешёвая/быстрая модель — для намеренно лёгких запросов. */
const LITE_MODEL = "gemini-flash-lite-latest";

interface GeminiProvider {
  openai: OpenAI;
  genAi: GoogleGenAI;
  /** Гоняет запросы к этому конкретному ключу не чаще GEMINI_RPM раз в минуту. */
  limit: <T>(fn: () => Promise<T>) => Promise<T>;
}

const providers: GeminiProvider[] = GEMINI_API_KEY.map((key) => ({
  openai: createOpenAi({
    apiKey: key,
    endpoint: `${GEMINI_CHAT_ENDPOINT}/v1beta/openai`,
  }),
  genAi: new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      baseUrl: GEMINI_ENDPOINT,
    },
  }),
  limit: createRateLimiter(GEMINI_RPM),
}));

log.info(
  "GEMINI API instances:",
  providers.length,
  "models:",
  MODELS.length,
);

export async function chat(
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.7,
) {
  return await localChat(systemPrompt, userPrompt, temperature, MODELS);
}

export async function chatLite(
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.7,
) {
  return await localChat(systemPrompt, userPrompt, temperature, [
    LITE_MODEL,
  ]);
}

async function localChat(
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.7,
  models: string[] = MODELS,
) {
  let lastError: unknown;
  for (const model of models) {
    for (const { openai, limit } of providers) {
      try {
        return await limit(() =>
          chatWithOpenAI(openai, {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            model,
            temperature,
          })
        );
      } catch (e) {
        lastError = e;
        log.warn(`[gemini] chat model "${model}" failed:`, e);
      }
    }
  }

  throw new Error("No openai instances/models available", {
    cause: lastError,
  });
}

export async function uploadFilesAndCustomRun<O>(
  url: string[] = [],
  models: string[],
  fn: (
    parts: Part[],
    genAI: GoogleGenAI,
    model: string,
    limit: <T>(f: () => Promise<T>) => Promise<T>,
  ) => Promise<O>,
): Promise<O> {
  let lastError: unknown;
  for (const model of models) {
    for (const { genAi, limit } of providers) {
      try {
        return await uploadFilesAndCustomRunWithModel(
          url,
          genAi,
          model,
          limit,
          fn,
        );
      } catch (e) {
        lastError = e;
        log.warn(`[gemini] genai model "${model}" failed:`, e);
      }
    }
  }

  throw new Error("No genai instances/models available", {
    cause: lastError,
  });
}
export async function uploadFilesAndCustomRunWithModel<O>(
  url: string[] = [],
  genAi: GoogleGenAI,
  model: string,
  limit: <T>(f: () => Promise<T>) => Promise<T>,
  fn: (
    parts: Part[],
    genAI: GoogleGenAI,
    model: string,
    limit: <T>(f: () => Promise<T>) => Promise<T>,
  ) => Promise<O>,
): Promise<O> {
  const files = await Promise.all(url.map(async (url) => {
    const res = await spyFetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());

    return await genAi.files.upload({
      file: new Blob([bytes]),
      config: {
        mimeType: res.headers.get("Content-Type")?.split(";")[0] ??
          "application/octet-stream",
      },
    });
  }));

  const parts = files.map((file) =>
    createPartFromUri(file.uri ?? "", file.mimeType ?? "")
  );

  try {
    return await fn(parts, genAi, model, limit);
  } finally {
    for (const file of files) {
      await genAi.files.delete({ name: file.name ?? "" });
    }
  }
}

export async function pasteFileAndProWebAsk(
  systemPrompt: string,
  userPrompt: string,
  file: { mimeType: string; base64: string },
  temperature: number = 0.7,
) {
  return await localPasteFileAndWebAsk(
    systemPrompt,
    userPrompt,
    file,
    temperature,
    MODELS,
  );
}

export async function pasteFileAndFlashWebAsk(
  systemPrompt: string,
  userPrompt: string,
  file: { mimeType: string; base64: string },
  temperature: number = 0.7,
) {
  return await localPasteFileAndWebAsk(
    systemPrompt,
    userPrompt,
    file,
    temperature,
    MODELS,
  );
}

export async function pasteFileAndLiteFlashWebAsk(
  systemPrompt: string,
  userPrompt: string,
  file: { mimeType: string; base64: string },
  temperature: number = 0.7,
) {
  return await localPasteFileAndWebAsk(
    systemPrompt,
    userPrompt,
    file,
    temperature,
    [LITE_MODEL],
  );
}

async function localPasteFileAndWebAsk(
  systemPrompt: string,
  userPrompt: string,
  { mimeType, base64 }: { mimeType: string; base64: string },
  temperature: number = 0.7,
  models: string[] = MODELS,
) {
  let lastError: unknown;
  for (const model of models) {
    for (const { genAi, limit } of providers) {
      try {
        const result = await limit(() =>
          genAi.models.generateContent({
            model,
            config: {
              tools: [{ googleSearch: {} }],
              systemInstruction: systemPrompt,
              temperature,
              thinkingConfig: {
                thinkingBudget: -1,
              },
            },
            contents: [
              { inlineData: { mimeType, data: base64 } },
              { text: userPrompt },
            ],
          })
        );

        return result.text;
      } catch (e) {
        lastError = e;
        log.warn(`[gemini] genai model "${model}" failed:`, e);
      }
    }
  }

  throw new Error("No genai instances/models available", {
    cause: lastError,
  });
}

export async function uploadFilesAndChat(
  systemPrompt: string,
  userPrompt: string = "",
  url: string[] = [],
  temperature: number = 0.7,
) {
  return await uploadFilesAndCustomRun(
    url,
    MODELS,
    async (parts, genAi, model, limit) => {
      const result = await limit(() =>
        genAi.models.generateContent({
          model,
          config: {
            systemInstruction: systemPrompt,
            temperature,
            thinkingConfig: {
              thinkingBudget: -1,
            },
          },
          contents: createUserContent([
            ...parts,
            userPrompt,
          ]),
        })
      );

      return result.text;
    },
  );
}

if (import.meta.main) {
  log.info(
    await uploadFilesAndChat(readPdf, "", [
      "https://cian.ru/export/pdf/rent/flat/319554040/",
    ], 0),
  );
}
