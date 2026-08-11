import OpenAI from "openai";
import { chatWithOpenAI, createOpenAi } from "./core_fetch.ts";
import { AI_API_KEY, AI_ENDPOINT, AI_MODELS } from "#env";
import { log } from "#logger";

const openAiInstances = new Set<OpenAI>();
for (const key of AI_API_KEY) {
  openAiInstances.add(createOpenAi({ apiKey: key, endpoint: AI_ENDPOINT }));
}

log.info(
  "AI instances:",
  openAiInstances.size,
  "models:",
  AI_MODELS.length,
);

/**
 * Единая точка входа для любого OpenAI-совместимого провайдера
 * (OpenRouter, Together, Groq, свой vLLM/Ollama и т.д.) — настраивается
 * через AI_ENDPOINT/AI_API_KEY/AI_MODELS в .env, см. .env.example.
 * Перебирает все модели и ключи по очереди, пока один из вариантов
 * не отработает.
 */
export async function chat(
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.7,
): Promise<string> {
  let lastError: unknown;

  for (const model of AI_MODELS) {
    for (const openai of openAiInstances) {
      try {
        return await chatWithOpenAI(openai, {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          model,
          temperature,
        });
      } catch (err) {
        lastError = err;
        log.warn(`[ai] model "${model}" failed:`, err);
      }
    }
  }

  throw new Error("No AI model/instance available", { cause: lastError });
}
