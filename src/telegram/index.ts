import { autoRetry, Bot } from "./deps.ts";
import {
  sendToTopic as _sendToTopic,
  type SendToTopicOptions,
} from "./topic.ts";
import { sendToMainChannel as _sendToMainChannel } from "./channel.ts";
import { BOT_TOKEN, TELEGRAM_CHAT_ID } from "#env";
import { log } from "#logger";

const bot = new Bot(BOT_TOKEN);
bot.api.config.use(autoRetry());
// bot.start() — долгоживущий промис, который резолвится только после
// bot.stop(). Без .catch() любая ошибка запуска (протухший/невалидный
// BOT_TOKEN, бан бота, сетевой сбой) становится unhandled rejection и
// убивает весь процесс Deno целиком — включая парсеры Avito/Cian, которые
// вообще не зависят от Telegram.
bot.start().catch((err) => {
  log.error(
    "[telegram] bot.start() упал, Telegram-уведомления не работают:",
    err,
  );
});

export const sendToTopic = (opts: SendToTopicOptions) =>
  _sendToTopic(bot, TELEGRAM_CHAT_ID, opts);

export const sendToMainChannel = (text: string) =>
  _sendToMainChannel(bot, TELEGRAM_CHAT_ID, text);
