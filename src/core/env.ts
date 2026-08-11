/**
 * `Deno.env.get(x)!` не защищает от отсутствия переменной в рантайме —
 * `!` это чисто TS-заглушка, стирающаяся при компиляции. Без явной проверки
 * отсутствующая переменная превращается в невнятный
 * `Cannot read properties of undefined` где-то в глубине AI-клиента.
 * Эта функция сразу говорит, чего не хватает и в каком файле искать пример.
 */
function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(
      `[env] Отсутствует обязательная переменная окружения "${name}". ` +
        `Скопируйте .env.example в .env и заполните её.`,
    );
  }
  return value;
}

function requireEnvList(name: string): string[] {
  return requireEnv(name).split(",").map((v) => v.trim()).filter(Boolean);
}

export const CHUTES_API_KEY = requireEnv("CHUTES_API_KEY");
export const OPENROUTER_API_KEY = requireEnvList("OPENROUTER_API_KEY");
export const NVIDIA_API_KEY = requireEnvList("NVIDIA_API_KEY");

export const GEMINI_API_KEY = requireEnvList("GEMINI_API_KEY");
export const GEMINI_ENDPOINT = requireEnv("GEMINI_ENDPOINT");
export const GEMINI_CHAT_ENDPOINT = Deno.env.get("GEMINI_CHAT_ENDPOINT") ??
  GEMINI_ENDPOINT;

export const RAPID_API_KEY = requireEnvList("RAPID_API_KEY");

// Cookie Циан-агента опционален: без него просто не будет работать поиск Циан.
export const CIAN_SEARCH_COOKIE = Deno.env.get("CIAN_SEARCH_COOKIE") ?? "";
export const BOT_TOKEN = requireEnv("BOT_TOKEN");
export const TELEGRAM_CHAT_ID = requireEnv("TELEGRAM_CHAT_ID");
