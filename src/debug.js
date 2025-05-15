// debug.js — локальная отладка runner.ts без D1 и Telegram
import puppeteer from 'puppeteer';

const PIN    = process.argv[2]?.padStart(10, '0');
const AMOUNT = Number(process.argv[3]);

if (!PIN || !AMOUNT) {
  console.error('Usage: node debug.js <PIN> <AMOUNT>');
  process.exit(1);
}

const SITE_URL      = process.env.SITE_URL;
const SITE_LOGIN    = process.env.SITE_LOGIN;
const SITE_PASSWORD = process.env.SITE_PASSWORD;
const TELEGRAM_HOOK = process.env.TELEGRAM_HOOK; // для отправки ошибки

if (!SITE_URL || !SITE_LOGIN || !SITE_PASSWORD) {
  console.error('Set SITE_URL, SITE_LOGIN, SITE_PASSWORD env vars');
  process.exit(1);
}

const SPEED = parseInt(process.env.SPEED || '200', 10);
const WAIT  = parseInt(process.env.WAIT  || '500', 10);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function notifyTelegram(msg) {
  if (!TELEGRAM_HOOK) return;
  try {
    await fetch(TELEGRAM_HOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg }),
    });
  } catch (e) {
    console.error('Telegram notify failed:', e);
  }
}

const browser = await puppeteer.launch({ headless: false });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  console.log('▶ login');
  await page.goto(SITE_URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.type('input[placeholder="Введите Ваш логин"]',  SITE_LOGIN, { delay: SPEED });
  await sleep(WAIT);
  await page.type('input[placeholder="Введите Ваш пароль"]', SITE_PASSWORD, { delay: SPEED });
  await sleep(WAIT);
  await page.click('button.btn.btn-red');
  await sleep(WAIT);

  console.log('▶ open Пополнение');
  const svgCard = await page.waitForSelector('svg[data-icon="credit-card"]');
  await (await svgCard.evaluateHandle(el => el.closest('button'))).click();
  await sleep(WAIT);

  console.log('▶ clear и ввод суммы (этап 1)');
  const field1 = await page.waitForSelector('input.e-numerictextbox');
  await field1.click({ clickCount: 3 });
  await page.keyboard.press('Delete');
  await sleep(WAIT);
  await page.type('input.e-numerictextbox', String(AMOUNT), { delay: SPEED });
  await sleep(WAIT);

  await page.$$eval('div.e-tab-text', els => {
    const el = els.find(e => e.textContent?.trim() === 'Пополнение');
    if (el) el.click();
  });
  await sleep(WAIT);

  console.log('▶ ввод PIN');
  await page.waitForSelector('input[aria-label="textbox"]');
  await page.type('input[aria-label="textbox"]', PIN, { delay: SPEED });
  await sleep(WAIT);

  console.log('▶ проверка активности поля суммы');
  const field2 = await page.waitForSelector('input.e-numerictextbox');
  const disabled = await field2.evaluate(el => el.disabled);
  if (disabled) {
    const msg = `❌ Неверный PIN: ${PIN} — поле суммы неактивно`;
    console.log(msg);
    await notifyTelegram(msg);
    throw new Error(msg);
  }

  console.log('▶ подтверждение суммы (этап 2)');
  await field2.click({ clickCount: 3 });
  await page.keyboard.press('Delete');
  await sleep(WAIT);
  await page.type('input.e-numerictextbox', String(AMOUNT), { delay: SPEED });

  await page.$$eval('button.btn-red', els => {
    const el = els.find(e => e.textContent?.includes('Пополнить'));
    if (el) el.click();
  });
  await sleep(WAIT);

  const popup = await page.waitForSelector('p.text-justify', { timeout: 25000 });
  const text = await popup.evaluate(el => el.textContent ?? '');
  console.log('▶ popup:', text);

  if (!text.includes(String(AMOUNT)) || !text.includes(PIN)) {
    await notifyTelegram(`⚠️ PIN ${PIN} / сумма ${AMOUNT} — не подтверждены в popup: "${text}"`);
  }

  await page.$$eval('button.btn-red', els => {
    const el = els.find(e => e.textContent?.includes('Закрыть'));
    if (el) el.click();
  });
  await sleep(WAIT);

  const svgOut = await page.waitForSelector('svg[data-icon="right-from-bracket"]');
  await (await svgOut.evaluateHandle(el => el.closest('button'))).click();

  console.log('✅ DEBUG OK');
} catch (err) {
  console.error('🔥 DEBUG FAIL', err);
} finally {
  await browser.close();
}