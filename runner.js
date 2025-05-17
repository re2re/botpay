// runner.js
import 'dotenv/config';
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';

const {
  API_ROOT,
  BOT_TOKEN,
  CHAT_MAIN,
  SITE_URL,
  SITE_LOGIN,
  SITE_PASSWORD,
  TERMINAL_ID
} = process.env;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Парсим CLI-аргументы
// node runner.js <PIN> <AMOUNT> [TERMINAL_ID]
const [,, CLI_PIN, CLI_AMOUNT, CLI_TERMINAL] = process.argv;
const isDebug = Boolean(CLI_PIN && CLI_AMOUNT);

if (isDebug) {
  console.log('⚙️  DEBUG MODE: получены аргументы:', {
    PIN: CLI_PIN,
    AMOUNT: CLI_AMOUNT,
    TERMINAL: CLI_TERMINAL ?? TERMINAL_ID
  });
}

async function fetchNextTicket() {
  if (isDebug) {
    // возвратим один фиктивный тикет
    return [{
      id:       0,
      terminal_id: Number(CLI_TERMINAL ?? TERMINAL_ID ?? 0),
      pin:      String(CLI_PIN).padStart(10, '0'),
      amount:   Number(CLI_AMOUNT)
    }];
  }

  // обычный режим — pull из API
  const res = await fetch(`${API_ROOT}/tickets/new`);
  if (!res.ok) throw new Error(`GET /tickets/new → ${res.status}`);
  return await res.json();
}

async function completeTicket(id) {
  if (isDebug) return; // не посылаем delete в debug-режиме
  const res = await fetch(`${API_ROOT}/tickets/${id}/complete`, {
    method: 'POST'
  });
  if (!res.ok) {
    console.error(`❌ completeTicket(${id}) →`, await res.text());
  }
}

async function processTicket(t) {
  const PIN    = String(t.pin).padStart(10, '0');
  const AMOUNT = t.amount;
  let status   = 'FAIL';

  console.log(`▶ Обработка тикета ${t.id} (терминал ${t.terminal_id}): PIN=${PIN}, AMOUNT=${AMOUNT}`);

  const browser = await puppeteer.launch({
    headless: false,               // для отладки увидите окно
    slowMo:   50,
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);

    console.log('1) Вход в систему');
    await page.goto(SITE_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.type('input[placeholder="Введите Ваш логин"]',  SITE_LOGIN,   { delay: 100 });
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
    await page.waitForTimeout(500);

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
  } finally {
    await browser.close();
  }

  // Отправляем Telegram-уведомление
  const text = status === 'SUCCESS'
    ? `✅ Платёж ${AMOUNT} ₽ (терминал ${t.terminal_id})`
    : `🛑 FAIL ${AMOUNT} ₽ (терминал ${t.terminal_id})`;

  console.log('▶ Telegram:', text);
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: CHAT_MAIN, text })
  });

  if (status === 'SUCCESS') {
    await completeTicket(t.id);
  }
}

async function main() {
  try {
    const tickets = await fetchNextTicket();
    if (!tickets.length) {
      console.log('ℹ️  Нет новых тикетов');
      return;
    }
    for (const t of tickets) {
      await processTicket(t);
    }
  } catch (err) {
    console.error('Runner error:', err.message);
  }
}

await main();
