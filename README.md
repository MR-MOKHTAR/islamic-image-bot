# 🌟 ربات تصویرساز اسلامی — Islamic Image Bot

ربات تلگرام برای ساخت تصاویر زیبا از احادیث، جملات کوتاه و نکات دروس حوزوی.

---

## ✨ قابلیت‌ها

- **۵ قالب زیبا** با طراحی اسلامی
- **تشخیص خودکار منبع** از متن (با خط تیره جدا کنید)
- **۳ نوع محتوا**: حدیث · جمله کوتاه · نکته درسی
- **تبدیل HTML به تصویر** — فایل HTML بفرستید، تصویر بگیرید
- **تنظیم خودکار فونت** بر اساس طول متن
- **فونت وزیرمتن** برای متن فارسی/عربی زیبا

---

## 📐 قالب‌ها

| قالب | توضیح |
|------|-------|
| ☀️ **نور** | زمینه کرم با حاشیه طلایی کلاسیک |
| 🌙 **شب** | زمینه تیره نیلی با متن طلایی و ستاره |
| 🌿 **سبز** | سبز اسلامی با بسم‌الله |
| ⬜ **ساده** | طراحی مینیمال و مدرن |
| 🌟 **طلایی** | قهوه‌ای تیره با حاشیه طلایی لوکس |

---

## 🚀 راه‌اندازی

### ۱. پیش‌نیازها

- **Node.js** نسخه ۱۸ یا بالاتر
- **npm** یا **yarn**

### ۲. نصب وابستگی‌ها

```bash
cd islamic-image-bot
npm install
```

> ⚠️ نصب Puppeteer ممکن است چند دقیقه طول بکشد چون Chromium را دانلود می‌کند.

### ۳. تنظیم محیط

```bash
cp .env.example .env
```

فایل `.env` را باز کنید و توکن ربات خود را از [@BotFather](https://t.me/BotFather) وارد کنید:

```env
BOT_TOKEN=123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi
```

### ۴. اجرا در حالت توسعه

```bash
npm run dev
```

### ۵. ساخت و اجرا در محیط production

```bash
npm run build
npm start
```

---

## 🤖 نحوه استفاده از ربات

### ارسال متن ساده

```
العلم نور والجهل ظلام
```

### ارسال متن با منبع

```
العلم نور والجهل ظلام — امام علی (ع)
```

### دستورات

| دستور | کارکرد |
|-------|--------|
| `/start` | شروع و راهنما |
| `/hadith` | تنظیم نوع: حدیث |
| `/quote` | تنظیم نوع: جمله کوتاه |
| `/lesson` | تنظیم نوع: نکته درسی |
| `/templates` | نمایش قالب‌ها |
| `/cancel` | لغو عملیات |

### تبدیل HTML به تصویر

فایل `.html` یا `.htm` خود را در چت ارسال کنید.  
این قابلیت به ویژه برای وقتی مفید است که با هوش مصنوعی متن را استایل داده‌اید و می‌خواهید آن را به تصویر تبدیل کنید.

---

## 🏗 ساختار پروژه

```
islamic-image-bot/
├── src/
│   ├── bot.ts              # فایل اصلی ربات + تمام هندلرها
│   ├── types.ts            # تایپ‌های TypeScript
│   ├── templates/
│   │   └── index.ts        # ۵ قالب HTML زیبا
│   └── renderer/
│       └── render.ts       # تبدیل HTML به تصویر با Puppeteer
├── .env                    # متغیرهای محیطی (نسازید در git)
├── .env.example            # نمونه متغیرهای محیطی
├── package.json
├── tsconfig.json
└── README.md
```

---

## ➕ اضافه کردن قالب جدید

در فایل `src/templates/index.ts` یک قالب جدید بسازید:

```typescript
const myTemplate: Template = {
  id: 'my-template',
  name: 'قالب من',
  emoji: '🎨',
  description: 'توضیح کوتاه',
  generate({ text, source, type }) {
    return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>...</head>
<body>
  <div>${text}</div>
  ${source ? `<div>${source}</div>` : ''}
</body>
</html>`;
  }
};

// آن را به آرایه اضافه کنید:
export const templates: Template[] = [
  // ... قالب‌های موجود ...
  myTemplate,
];
```

---

## 🐳 اجرا با Docker (اختیاری)

```dockerfile
FROM node:18-alpine
RUN apk add --no-cache chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

```bash
docker build -t islamic-image-bot .
docker run -e BOT_TOKEN=your_token islamic-image-bot
```

---

## 🛠 عیب‌یابی

**خطای Puppeteer در لینوکس:**
```bash
sudo apt-get install -y \
  libgbm-dev libxkbcommon-x11-0 libgtk-3-0 \
  libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1
```

**فونت فارسی نشان داده نمی‌شود:**
اطمینان حاصل کنید که Puppeteer به اینترنت دسترسی دارد تا Google Fonts را بارگذاری کند.

---

## 📜 لایسنس

MIT
# HtmlSnapBot
