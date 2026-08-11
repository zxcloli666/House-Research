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
  GEMINI_MODEL,
  GEMINI_MODEL_LITE,
  GEMINI_RPM,
} from "#env";
import { log } from "#logger";

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

log.info("GEMINI API instances:", providers.length);

export async function chat(
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.7,
) {
  return await localChat(systemPrompt, userPrompt, temperature, GEMINI_MODEL);
}

export async function chatLite(
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.7,
) {
  return await localChat(
    systemPrompt,
    userPrompt,
    temperature,
    GEMINI_MODEL_LITE,
  );
}

async function localChat(
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.7,
  model: string = GEMINI_MODEL_LITE,
) {
  let lastError: unknown;
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
      log.warn("[gemini] chat instance failed:", e);
    }
  }

  throw new Error("No openai instances", { cause: lastError });
}

export async function uploadFilesAndCustomRun<O>(
  url: string[] = [],
  fn: (
    parts: Part[],
    genAI: GoogleGenAI,
    limit: <T>(f: () => Promise<T>) => Promise<T>,
  ) => Promise<O>,
): Promise<O> {
  let lastError: unknown;
  for (const { genAi, limit } of providers) {
    try {
      return await uploadFilesAndCustomRunWithModel(url, genAi, limit, fn);
    } catch (e) {
      lastError = e;
      log.warn("[gemini] genai instance failed:", e);
    }
  }

  throw new Error("No genai instances", { cause: lastError });
}
export async function uploadFilesAndCustomRunWithModel<O>(
  url: string[] = [],
  genAi: GoogleGenAI,
  limit: <T>(f: () => Promise<T>) => Promise<T>,
  fn: (
    parts: Part[],
    genAI: GoogleGenAI,
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
    return await fn(parts, genAi, limit);
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
  try {
    return await localPasteFileAndWebAsk(
      systemPrompt,
      userPrompt,
      file,
      temperature,
      GEMINI_MODEL,
    );
  } catch (e) {
    log.warn("[gemini] pasteFileAndProWebAsk failed, retrying:", e);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    return await localPasteFileAndWebAsk(
      systemPrompt,
      userPrompt,
      file,
      temperature,
      GEMINI_MODEL,
    );
  }
}

export async function pasteFileAndFlashWebAsk(
  systemPrompt: string,
  userPrompt: string,
  file: { mimeType: string; base64: string },
  temperature: number = 0.7,
) {
  try {
    return await localPasteFileAndWebAsk(
      systemPrompt,
      userPrompt,
      file,
      temperature,
      GEMINI_MODEL_LITE,
    );
  } catch (e) {
    log.warn("[gemini] pasteFileAndFlashWebAsk failed, retrying:", e);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    return await localPasteFileAndWebAsk(
      systemPrompt,
      userPrompt,
      file,
      temperature,
      GEMINI_MODEL_LITE,
    );
  }
}

export async function pasteFileAndLiteFlashWebAsk(
  systemPrompt: string,
  userPrompt: string,
  file: { mimeType: string; base64: string },
  temperature: number = 0.7,
) {
  try {
    return await localPasteFileAndWebAsk(
      systemPrompt,
      userPrompt,
      file,
      temperature,
      GEMINI_MODEL_LITE,
    );
  } catch (e) {
    log.warn("[gemini] pasteFileAndLiteFlashWebAsk failed, retrying:", e);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    return await localPasteFileAndWebAsk(
      systemPrompt,
      userPrompt,
      file,
      temperature,
      GEMINI_MODEL_LITE,
    );
  }
}

async function localPasteFileAndWebAsk(
  systemPrompt: string,
  userPrompt: string,
  { mimeType, base64 }: { mimeType: string; base64: string },
  temperature: number = 0.7,
  model: string = GEMINI_MODEL_LITE,
) {
  let lastError: unknown;
  for (const { genAi, limit } of providers) {
    try {
      const result = await limit(() =>
        genAi.models.generateContent({
          model: model,
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
      log.warn("[gemini] genai instance failed:", e);
    }
  }

  throw new Error("No genai instances", { cause: lastError });
}

export async function uploadFilesAndChat(
  systemPrompt: string,
  userPrompt: string = "",
  url: string[] = [],
  temperature: number = 0.7,
) {
  return await uploadFilesAndCustomRun(url, async (parts, genAi, limit) => {
    const result = await limit(() =>
      genAi.models.generateContent({
        model: GEMINI_MODEL,
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
  });
}

if (import.meta.main) {
  log.info(
    await uploadFilesAndChat(readPdf, "", [
      "https://cian.ru/export/pdf/rent/flat/319554040/",
    ], 0),
  );
}
