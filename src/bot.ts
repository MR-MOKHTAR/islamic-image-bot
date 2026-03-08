import * as dotenv from "dotenv";
dotenv.config();

import { Telegraf, session, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { BotContext, SessionData } from "./types";
import { htmlFileToImage, downloadText, closeBrowser } from "./renderer/render";

// ────────────────────────────────────────────────
//  بررسی توکن
// ────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ متغیر محیطی BOT_TOKEN تنظیم نشده است!");
  process.exit(1);
}

// ────────────────────────────────────────────────
//  ساخت ربات
// ────────────────────────────────────────────────
const bot = new Telegraf<BotContext>(BOT_TOKEN);
bot.use(session({ defaultSession: (): SessionData => ({}) }));

// ────────────────────────────────────────────────
//  متن‌های ثابت
// ────────────────────────────────────────────────
const WELCOME_MSG = `
🖼 *HtmlSnapBot*

فایل \`.html\` خود را ارسال کنید تا به تصویر PNG تبدیل شود.

*موارد استفاده:*
• طرح‌های HTML ساخته شده با هوش مصنوعی
• پوسترها و اعلان‌های اسلامی
• هر صفحه HTML که می‌خواهید به تصویر تبدیل کنید

─────────────────────
📌 *محدودیت‌های امنیتی:*
• حداکثر حجم: ۲ مگابایت
• اسکریپت‌های خارجی پشتیبانی نمی‌شوند
• فونت‌ها فقط از Google Fonts و cdnjs بارگذاری می‌شوند

─────────────────────
/help — راهنما  |  /cancel — لغو
`;

// ────────────────────────────────────────────────
//  /start  /help
// ────────────────────────────────────────────────
bot.start(async (ctx) => {
  ctx.session = {};
  await ctx.reply(WELCOME_MSG, { parse_mode: "Markdown" });
});

bot.help(async (ctx) => {
  await ctx.reply(WELCOME_MSG, { parse_mode: "Markdown" });
});

bot.command("cancel", async (ctx) => {
  ctx.session = {};
  await ctx.reply("✅ عملیات لغو شد.", Markup.removeKeyboard());
});

// ────────────────────────────────────────────────
//  راهنما برای پیام متنی
// ────────────────────────────────────────────────
bot.on(message("text"), async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith("/")) return;
  await ctx.reply("💡 برای ساخت تصویر، فایل *.html* خود را ارسال کنید.", {
    parse_mode: "Markdown",
  });
});

// ────────────────────────────────────────────────
//  پردازش فایل HTML → تصویر
// ────────────────────────────────────────────────
bot.on(message("document"), async (ctx) => {
  const doc = ctx.message.document;
  const fileName = (doc.file_name ?? "").toLowerCase();

  if (!fileName.endsWith(".html") && !fileName.endsWith(".htm")) {
    await ctx.reply("⚠️ لطفاً فقط فایل‌های *HTML* ارسال کنید.", {
      parse_mode: "Markdown",
    });
    return;
  }

  // بررسی حجم فایل قبل از دانلود
  if (doc.file_size && doc.file_size > 2 * 1024 * 1024) {
    await ctx.reply("❌ حجم فایل بیش از ۲ مگابایت است.");
    return;
  }

  const waitMsg = await ctx.reply("⏳ در حال دانلود و پردازش فایل...");

  try {
    // ─── دریافت لینک فایل ───
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);

    // ─── دانلود با https داخلی Node (بدون axios) + retry ───
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        waitMsg.message_id,
        undefined,
        "⏳ در حال دانلود فایل...",
      )
      .catch(() => {});

    const htmlContent = await downloadText(fileLink.href);

    // ─── تبدیل به تصویر ───
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        waitMsg.message_id,
        undefined,
        "🖼 در حال رندر کردن تصویر...",
      )
      .catch(() => {});

    const imageBuffer = await htmlFileToImage(htmlContent);

    // ─── ارسال تصویر ───
    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});

    await ctx.replyWithPhoto(
      { source: imageBuffer, filename: "output.png" },
      {
        caption: `✅ \`${doc.file_name}\``,
        parse_mode: "Markdown",
      },
    );
  } catch (err: unknown) {
    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});
    console.error("[HTML→Image Error]", err);

    // پیام خطای مناسب برای کاربر
    const msg = err instanceof Error ? err.message : String(err);
    let userMsg = "❌ خطا در پردازش فایل.";

    if (
      msg.includes("timeout") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("ECONNRESET")
    ) {
      userMsg =
        "⏱ اتصال به سرور قطع شد.\nلطفاً چند ثانیه صبر کنید و دوباره امتحان کنید.";
    } else if (msg.includes("امنیتی") || msg.includes("مشکوک")) {
      userMsg = `🔒 فایل به دلایل امنیتی رد شد:\n_${msg}_`;
    } else if (msg.includes("مگابایت")) {
      userMsg = "❌ حجم فایل بیش از ۲ مگابایت است.";
    } else if (msg.includes("Chrome")) {
      userMsg = "⚙️ Chrome در دسترس نیست. با ادمین تماس بگیرید.";
    }

    await ctx.reply(userMsg, { parse_mode: "Markdown" });
  }
});

// ────────────────────────────────────────────────
//  مدیریت خطا
// ────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`[Bot Error] updateType=${ctx.updateType}`, err);
});

// ────────────────────────────────────────────────
//  راه‌اندازی
// ────────────────────────────────────────────────
bot
  .launch()
  .then(() => console.log("✅ HtmlSnapBot آماده است!"))
  .catch((err) => {
    console.error("❌ خطا در راه‌اندازی:", err);
    process.exit(1);
  });

const shutdown = async (signal: string) => {
  bot.stop(signal);
  await closeBrowser();
  process.exit(0);
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
