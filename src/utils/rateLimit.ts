/**
 * Rate-limiter на скользящем окне в 1 минуту: не больше maxPerMinute
 * вызовов fn() за любые 60 секунд. Лишние вызовы не отклоняются и не падают
 * с ошибкой — они встают в очередь и ждут своей минуты.
 *
 * Нужен потому, что бесплатные лимиты Gemini мизерные (по факту 5–16
 * запросов в минуту в зависимости от модели), а при первом запуске/бэклоге
 * объявлений код обрабатывает несколько офферов параллельно и без паузы —
 * без лимитера это гарантированно ловит 429 уже на первых секундах работы.
 */
export function createRateLimiter(maxPerMinute: number) {
  const timestamps: number[] = [];
  let chain = Promise.resolve();

  return function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    const wait = chain.then(async () => {
      while (true) {
        const now = Date.now();
        while (timestamps.length && now - timestamps[0] >= 60_000) {
          timestamps.shift();
        }
        if (timestamps.length < maxPerMinute) {
          timestamps.push(now);
          return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 60_000 - (now - timestamps[0]) + 50)
        );
      }
    });
    // Следующий вызов в очереди ждёт этот тик независимо от того,
    // выбросит ли сам fn() исключение.
    chain = wait.catch(() => {});
    return wait.then(fn);
  };
}
