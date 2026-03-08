import puppeteer, { Browser, Page } from "puppeteer";
import { execSync } from "child_process";
import * as fs from "fs";
import * as https from "https";
import * as http from "http";

function findSystemChrome(): string | undefined {
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const r = execSync(
      "which google-chrome 2>/dev/null || which chromium-browser 2>/dev/null || which chromium 2>/dev/null",
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (r) return r;
  } catch {}
  return undefined;
}

// ────────────────────────────────────────────────
//  Singleton مرورگر
// ────────────────────────────────────────────────
let browserInstance: Browser | null = null;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--disable-gpu",
  "--font-render-hinting=none",
  "--enable-font-antialiasing",
  // کیفیت بالاتر رندر
  "--force-device-scale-factor=2",
];

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) return browserInstance;

  try {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: LAUNCH_ARGS,
    });
    console.log("✅ Chrome بارگذاری شد.");
    return browserInstance;
  } catch {
    console.warn("⚠️  Chrome cache یافت نشد، جستجو در سیستم...");
  }

  const systemChrome = findSystemChrome();
  if (systemChrome) {
    console.log(`✅ Chrome سیستم: ${systemChrome}`);
    browserInstance = await puppeteer.launch({
      headless: true,
      executablePath: systemChrome,
      args: LAUNCH_ARGS,
    });
    return browserInstance;
  }

  throw new Error(
    "Chrome پیدا نشد!\n" +
      "  ۱) npx puppeteer browsers install chrome\n" +
      "  ۲) sudo apt-get install -y chromium-browser\n" +
      "  ۳) brew install --cask google-chrome",
  );
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

// ────────────────────────────────────────────────
//  دانلود با https داخلی Node + retry
// ────────────────────────────────────────────────
export function downloadText(url: string, retries = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const attempt = (remaining: number) => {
      const lib = url.startsWith("https") ? https : http;
      let data = "";

      const req = lib.get(url, { timeout: 20_000 }, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          attempt(remaining);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      });

      req.on("timeout", () => {
        req.destroy();
        if (remaining > 1) {
          console.warn(`⚠️  timeout، تلاش مجدد (${remaining - 1})...`);
          setTimeout(() => attempt(remaining - 1), 1500);
        } else {
          reject(new Error("دانلود فایل پس از چند تلاش موفق نشد (timeout)"));
        }
      });

      req.on("error", (err) => {
        if (remaining > 1) setTimeout(() => attempt(remaining - 1), 1500);
        else reject(err);
      });
    };
    attempt(retries);
  });
}

// ────────────────────────────────────────────────
//  اعتبارسنجی HTML
// ────────────────────────────────────────────────
const MAX_HTML_SIZE = 2 * 1024 * 1024;

const ALLOWED_FONT_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdnjs.cloudflare.com",
];

function validateHtml(html: string): void {
  if (html.length > MAX_HTML_SIZE)
    throw new Error("حجم فایل HTML بیش از ۲ مگابایت است.");

  const dangerous = [
    /<script[^>]*src\s*=\s*["']?(?!data:)/i,
    /javascript\s*:/i,
    /data:\s*text\/html/i,
    /vbscript\s*:/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /<form/i,
    /document\.cookie/i,
    /localStorage/i,
    /fetch\s*\(/i,
    /XMLHttpRequest/i,
    /navigator\./i,
    /window\.location/i,
  ];

  for (const p of dangerous)
    if (p.test(html)) throw new Error(`محتوای HTML به دلایل امنیتی رد شد`);
}

// ────────────────────────────────────────────────
//  تزریق فونت ایموجی و فارسی
// ────────────────────────────────────────────────
const EMOJI_FONT_INJECT = `
<style id="__emoji_font_fix__">
  *:not(#__emoji_font_fix__) {
    font-family: inherit, "Noto Color Emoji", "Segoe UI Emoji",
                 "Apple Color Emoji", "Twemoji Mozilla" !important;
  }
  body {
    font-family: "Vazirmatn", "Noto Sans Arabic", "Tahoma",
                 "Noto Color Emoji", "Segoe UI Emoji", sans-serif;
  }
</style>`;

function injectEmojiFont(html: string): string {
  if (/<\/head>/i.test(html))
    return html.replace(/<\/head>/i, `${EMOJI_FONT_INJECT}\n</head>`);
  if (/<body/i.test(html))
    return html.replace(/<body/i, `${EMOJI_FONT_INJECT}\n<body`);
  return EMOJI_FONT_INJECT + "\n" + html;
}

// ────────────────────────────────────────────────
//  Request interceptor امنیتی
// ────────────────────────────────────────────────
async function setupSecurePage(page: Page): Promise<void> {
  await page.setRequestInterception(true);

  page.on("request", (req) => {
    const url = req.url();
    const type = req.resourceType();

    if (url === "about:blank" || url.startsWith("data:")) {
      req.continue();
      return;
    }

    if (type === "font" || type === "stylesheet") {
      try {
        const host = new URL(url).hostname;
        if (
          ALLOWED_FONT_HOSTS.some((h) => host === h || host.endsWith("." + h))
        ) {
          req.continue();
          return;
        }
      } catch {}
      req.abort("blockedbyclient");
      return;
    }

    if (type === "image" && url.startsWith("data:image/")) {
      req.continue();
      return;
    }
    if (
      type === "xhr" ||
      type === "fetch" ||
      type === "websocket" ||
      type === "other"
    ) {
      req.abort("blockedbyclient");
      return;
    }
    if (type === "script") {
      req.abort("blockedbyclient");
      return;
    }

    req.continue();
  });
}

// ────────────────────────────────────────────────
//  HTML → تصویر PNG با کیفیت بالا
// ────────────────────────────────────────────────

// ضریب مقیاس — عدد بالاتر = کیفیت بیشتر، حجم بیشتر
// 2 = Full HD کیفیت (توصیه شده)
// 3 = 4K کیفیت (برای متون ریز یا پوسترهای بزرگ)
const SCALE_FACTOR = 2;

export async function htmlFileToImage(htmlContent: string): Promise<Buffer> {
  validateHtml(htmlContent);

  const enrichedHtml = injectEmojiFont(htmlContent);

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await setupSecurePage(page);
    page.setDefaultTimeout(40_000);

    // ── مرحله ۱: viewport اولیه برای محاسبه ابعاد واقعی ──
    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 });

    await page.setContent(enrichedHtml, {
      waitUntil: "networkidle0",
      timeout: 40_000,
    });

    // صبر برای بارگذاری کامل فونت‌ها
    await page.evaluateHandle("document.fonts.ready");

    // ── مرحله ۲: اندازه‌گیری ابعاد واقعی محتوا ──
    const dims: { w: number; h: number } = await page.evaluate(() => ({
      w: Math.max(
        document.body.scrollWidth,
        document.documentElement.scrollWidth,
        800,
      ),
      h: Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        600,
      ),
    }));

    // سقف ابعاد منطقی (قبل از اعمال scale)
    const logicalW = Math.min(dims.w, 2048);
    const logicalH = Math.min(dims.h, 4096);

    // ── مرحله ۳: اعمال deviceScaleFactor برای کیفیت بالا ──
    // نتیجه: تصویر خروجی = logicalW * SCALE_FACTOR پیکسل
    await page.setViewport({
      width: logicalW,
      height: logicalH,
      deviceScaleFactor: SCALE_FACTOR,
    });

    // یک فریم برای اطمینان از رندر نهایی
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => r())),
    );

    const screenshot = await page.screenshot({
      type: "png",
      fullPage: true,
    });

    console.log(
      `✅ رندر شد: ${logicalW}x${logicalH} logical → ` +
        `${logicalW * SCALE_FACTOR}x${logicalH * SCALE_FACTOR}px واقعی`,
    );

    return Buffer.from(screenshot);
  } finally {
    await page.close().catch(() => {});
  }
}
