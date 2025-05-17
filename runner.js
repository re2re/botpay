import 'dotenv/config';
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';

const {
  API_ROOT,
  BOT_TOKEN,
  CHAT_MAIN,
  SITE_URL,
  SITE_LOGIN,
  SITE_PASSWORD
} = process.env;

if (!BOT_TOKEN || !CHAT_MAIN) {
  console.error('Missing Telegram configuration: BOT_TOKEN or CHAT_MAIN is not set');
}

// Хелпер для паузы в async-функциях
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Функция отправки сообщения в Telegram с логированием ошибок
async function notify(msg) {
  console.log('Notify:', msg);
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_MAIN, text: msg })
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Telegram send failed: ${res.status} - ${text}`);
    }
  } catch (err) {
    console.error('Telegram notify error:', err);
  }
}

// Глобальный экземпляр браузера
let browser;

async function initBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--renderer-process-limit=1'
      ],
      timeout: 60000
    });
  }
  return browser;
}

// Получение тикетов с retry
async function fetchNextTicket() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API_ROOT}/tickets/new`);
      if (!res.ok) throw new Error(`GET /tickets/new → ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error(`Invalid tickets response: ${JSON.stringify(data)}`);
      return data;
    } catch (err) {
      console.error(`fetchNextTicket attempt ${attempt} failed:`, err.message);
      if (attempt < 3) {
        await sleep(1000 * attempt);
      } else {
        throw err;
      }
    }
  }
}

async function completeTicket(id) {
  try {
    const res = await fetch(`${API_ROOT}/tickets/${id}/complete`, { method: 'POST' });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Failed to complete ticket ${id}: ${res.status} - ${text}`);
      await notify(`Error completing ticket ${id}: ${res.status}`);
    }
  } catch (err) {
    console.error(`Error completing ticket ${id}:`, err);
    await notify(`Error completing ticket ${id}: ${err.message}`);
  }
}

async function processTicket(t) {
  const PIN    = String(t.pin).padStart(10, '0');
  const AMOUNT = t.amount;
  let status   = 'FAIL';

  const browser = await initBrowser();
  const page    = await browser.newPage();
  page.setDefaultTimeout(20000);

  try {
    console.log('1) Вход в систему');
    await page.goto(SITE_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.type('input[placeholder="Введите Ваш логин"]', SITE_LOGIN, { delay: 100 });
    await page.type('input[placeholder="Введите Ваш пароль"]', SITE_PASSWORD, { delay: 100 });
    await page.click('button.btn.btn-red');
    await sleep(500);

    console.log('2) Открываем раздел Пополнение');
    const svgCard = await page.waitForSelector('svg[data-icon="credit-card"]');
    await (await svgCard.evaluateHandle(el => el.closest('button'))).click();
    await sleep(500);

    console.log('3) Ввод суммы');
    const field1 = await page.waitForSelector('input.e-numerictextbox');
    await field1.click({ clickCount: 3 });
    await page.keyboard.press('Delete');
    await page.type('input.e-numerictextbox', String(AMOUNT), { delay: 50 });
    await sleep(500);

    console.log('4) Выбор вкладки Пополнение');
    await page.$$eval('div.e-tab-text', els => {
      const el = els.find(e => e.textContent?.trim() === 'Пополнение');
      el?.click();
    });
    await sleep(500);

    console.log('5) Ввод PIN');
    await page.waitForSelector('input[aria-label="textbox"]');
    await page.type('input[aria-label="textbox"]', PIN, { delay: 50 });
    await sleep(500);

    console.log('6) Проверка активности поля суммы');
    const field2 = await page.waitForSelector('input.e-numerictextbox');
    if (await field2.evaluate(el => el.disabled)) {
      throw new Error(`Неверный PIN: ${PIN}`);
    }

    console.log('7) Подтверждение суммы');
    await field2.click({ clickCount: 3 });
    await page.keyboard.press('Delete');
    await page.type('input.e-numerictextbox', String(AMOUNT), { delay: 50 });
    await sleep(500);

    console.log('8) Клик Пополнить');
    await page.$$eval('button.btn-red', els => {
      const el = els.find(e => e.textContent?.includes('Пополнить'));
      el?.click();
    });
    await sleep(1000);

    console.log('9) Ждём попап и проверяем содержимое');
    const popup = await page.waitForSelector('p.text-justify', { timeout: 25000 });
    const txt   = await popup.evaluate(el => el.textContent ?? '');
    console.log('▶ popup text:', txt);
    if (!txt.includes(String(AMOUNT)) || !txt.includes(PIN)) {
      console.warn(`⚠️ Popup не подтвердил (PIN/AMOUNT): "${txt}"`);
    }

    console.log('10) Закрываем попап');
    await page.$$eval('button.btn-red', els => {
      const el = els.find(e => e.textContent?.includes('Закрыть'));
      el?.click();
    });
    await sleep(500);

    console.log('11) Выход из системы');
    const svgOut = await page.waitForSelector('svg[data-icon="right-from-bracket"]');
    await (await svgOut.evaluateHandle(el => el.closest('button'))).click();

    status = 'SUCCESS';
    console.log('✅ Успешно обработано');
  } catch (err) {
    console.error('🔥 Ошибка в процессе:', err.message);
    await notify(`🛑 Ошибка обработки тикета ${t.id}: ${err.message}`);
  } finally {
    await page.close();
  }

  const msg = status === 'SUCCESS'
    ? `✅ Платёж ${AMOUNT} ₽ (терминал ${t.terminal_id})`
    : `🛑 FAIL ${AMOUNT} ₽ (терминал ${t.terminal_id})`;

  await notify(msg);

  if (status === 'SUCCESS') {
    await completeTicket(t.id);
  }
}

async function main() {
  try {
    const tickets = await fetchNextTicket();
    if (!tickets.length) {
      console.log('No new tickets');
      return;
    }
    for (const t of tickets) {
      console.log('Processing ticket', t.id);
      await processTicket(t);
    }
  } catch (err) {
    console.error('Runner error:', err.message);
    await notify(`🛑 Runner error: ${err.message}`);
  }
}

// Корректное завершение процесса – закрыть browser
process.on('SIGINT',  async () => { if (browser) await browser.close(); process.exit(0); });
process.on('SIGTERM', async () => { if (browser) await browser.close(); process.exit(0); });

// Главный цикл: выполняем main(), ждём 5 сек, повторяем
(async function runLoop() {
  while (true) {
    await main().catch(async err => {
      console.error('Fatal runner error:', err);
      await notify(`❌ Fatal runner error: ${err.message}`);
    });
    await sleep(5000);
  }
})();
