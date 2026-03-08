import puppeteer, { Browser, Page } from "puppeteer";
import { execSync } from "child_process";
import * as fs from "fs";
import * as https from "https";
import * as http from "http";

// ────────────────────────────────────────────────
//  پیدا کردن Chrome روی سیستم
// ────────────────────────────────────────────────
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
];

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) return browserInstance;

  try {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: LAUNCH_ARGS,
    });
    console.log("✅ Chrome از Puppeteer cache بارگذاری شد.");
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
//  دانلود فایل با https داخلی Node + retry
//  (جایگزین axios که گاهی ETIMEDOUT می‌دهد)
// ────────────────────────────────────────────────
export function downloadText(url: string, retries = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const attempt = (remaining: number) => {
      const lib = url.startsWith("https") ? https : http;
      let data = "";

      const req = lib.get(url, { timeout: 20_000 }, (res) => {
        // redirect
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
          console.warn(
            `⚠️  دانلود timeout شد، تلاش مجدد (${remaining - 1} بار باقی)...`,
          );
          setTimeout(() => attempt(remaining - 1), 1500);
        } else {
          reject(new Error("دانلود فایل پس از چند تلاش موفق نشد (timeout)"));
        }
      });

      req.on("error", (err) => {
        if (remaining > 1) {
          console.warn(`⚠️  خطای دانلود: ${err.message}، تلاش مجدد...`);
          setTimeout(() => attempt(remaining - 1), 1500);
        } else {
          reject(err);
        }
      });
    };

    attempt(retries);
  });
}

// ────────────────────────────────────────────────
//  اعتبارسنجی و پاک‌سازی HTML
//  (جلوگیری از حملات SSRF و اجرای کد مخرب)
// ────────────────────────────────────────────────
const MAX_HTML_SIZE = 2 * 1024 * 1024; // ۲ مگابایت

// دامنه‌های مجاز برای font/style (whitelist)
const ALLOWED_FONT_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdnjs.cloudflare.com",
];

function validateHtml(html: string): void {
  if (html.length > MAX_HTML_SIZE) {
    throw new Error("حجم فایل HTML بیش از ۲ مگابایت است.");
  }

  // بلاک کردن الگوهای خطرناک
  const dangerous = [
    /<script[^>]*src\s*=\s*["']?(?!data:)/i, // script با src خارجی
    /javascript\s*:/i, // javascript: در href/src
    /data:\s*text\/html/i, // data URI با HTML
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

  for (const pattern of dangerous) {
    if (pattern.test(html)) {
      throw new Error(
        `محتوای HTML به دلایل امنیتی رد شد (الگوی مشکوک: ${pattern})`,
      );
    }
  }
}

// ────────────────────────────────────────────────
//  تنظیم Page با interceptor امنیتی
// ────────────────────────────────────────────────
async function setupSecurePage(page: Page): Promise<void> {
  await page.setRequestInterception(true);

  page.on("request", (req) => {
    const url = req.url();
    const type = req.resourceType();

    // اجازه به محتوای داخلی (about:blank, data:)
    if (url === "about:blank" || url.startsWith("data:")) {
      req.continue();
      return;
    }

    // فونت و استایل فقط از whitelist
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

    // تصاویر base64 مجاز
    if (type === "image" && url.startsWith("data:image/")) {
      req.continue();
      return;
    }

    // مسدود کردن همه درخواست‌های شبکه‌ای دیگر
    // (XHR، fetch، script خارجی، iframe، ...)
    if (
      type === "xhr" ||
      type === "fetch" ||
      type === "websocket" ||
      type === "other"
    ) {
      req.abort("blockedbyclient");
      return;
    }

    // اسکریپت‌های inline (بدون src) مجاز هستند
    if (type === "script" && url.startsWith("data:")) {
      req.continue();
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
//  HTML → تصویر PNG
// ────────────────────────────────────────────────
export async function htmlFileToImage(htmlContent: string): Promise<Buffer> {
  // اعتبارسنجی اول
  validateHtml(htmlContent);

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await setupSecurePage(page);

    // محدود کردن زمان اجرای JavaScript
    page.setDefaultTimeout(30_000);

    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 });
    await page.setContent(htmlContent, {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });

    // اجرای JS را پس از رندر غیرفعال کنیم
    await page.setJavaScriptEnabled(false).catch(() => {});

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

    // سقف ابعاد برای جلوگیری از حمله DoS
    const safeW = Math.min(dims.w, 4096);
    const safeH = Math.min(dims.h, 8192);

    await page.setViewport({
      width: safeW,
      height: safeH,
      deviceScaleFactor: 1,
    });

    return Buffer.from(await page.screenshot({ type: "png", fullPage: true }));
  } finally {
    await page.close().catch(() => {});
  }
}
