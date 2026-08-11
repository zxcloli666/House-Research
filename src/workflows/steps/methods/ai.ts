import { chat as aiChat } from "#ai-agents/openai-compatible.ts";
import {
  chat as geminiChat,
  chatLite as geminiChatLite,
} from "#ai-agents/gemini.ts";
import { deadline } from "@std/async";
import { log } from "#logger";

const TIMEOUT = 240_000;
const RETRIES = 3;

export async function safeFreeAi(
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0,
): Promise<string> {
  try {
    return await geminiChatLite(systemPrompt, userPrompt, temperature);
  } catch {
    return await safeFreeThink(systemPrompt, userPrompt, temperature);
  }
}

/**
 * Основной провайдер (AI_ENDPOINT/AI_API_KEY/AI_MODELS) с несколькими
 * попытками и нарастающей паузой между ними; если он полностью недоступен —
 * падаем обратно на Gemini.
 */
export async function safeFreeThink(
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0,
): Promise<string> {
  for (let i = 0; i < RETRIES; i++) {
    try {
      return await deadline(
        aiChat(systemPrompt, userPrompt, temperature),
        TIMEOUT,
      );
    } catch (err) {
      log.warn(`[ai] attempt ${i + 1}/${RETRIES} failed:`, err);
    }

    await new Promise((resolve) => setTimeout(resolve, i * 3_000));
  }

  log.warn("[ai] primary provider exhausted, falling back to Gemini");
  return await geminiChat(systemPrompt, userPrompt, temperature);
}
