// runner.ts — полноценный процессинг тикетов с веб-оплатой и проверками
import puppeteer from '@cloudflare/puppeteer';
import { Env } from './env.ts';
import { notify } from './telegram.ts';

export async function scheduled(_e: ScheduledController, env: Env) {
  const SPEED = 200;
  const WAIT = 500;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const { results } = await env.DB
    .prepare(
      `UPDATE tickets SET status='PROCESSING'
       WHERE id = (SELECT id FROM tickets WHERE status='NEW' LIMIT 1)
       RETURNING *`
    )
    .run();

  if (!results?.length) return;
  const t = results[0];
  const PIN = String(t.pin).padStart(10, '0');
  const AMOUNT = t.amount;

  const browser = await puppeteer.launch(env.MYBROWSER);
  let status = 'FAIL_ATTEMPTS';
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log('▶ login');
        await page.goto(env.SITE_URL, { waitUntil: 'networkidle0', timeout: 60000 });
        await page.type('input[placeholder="Введите Ваш логин"]', env.SITE_LOGIN, { delay: SPEED });
        await sleep(WAIT);
        await page.type('input[placeholder="Введите Ваш пароль"]', env.SITE_PASSWORD, { delay: SPEED });
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
          await notify(env, msg);
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
          await notify(env, `⚠️ PIN ${PIN} / сумма ${AMOUNT} — не подтверждены в popup: "${text}"`);
        }

        await page.$$eval('button.btn-red', els => {
          const el = els.find(e => e.textContent?.includes('Закрыть'));
          if (el) el.click();
        });
        await sleep(WAIT);

        const svgOut = await page.waitForSelector('svg[data-icon="right-from-bracket"]');
        await (await svgOut.evaluateHandle(el => el.closest('button'))).click();

        status = 'SUCCESS';
        break;
      } catch (err) {
        if (attempt < 3) await sleep(30000);
      }
    }
  } finally {
    await browser.close();
  }

  if (status === 'SUCCESS') {
    await notify(env, `✅ Платёж ${AMOUNT} ₽ (терминал ${t.terminal_id})`);
  } else {
    await notify(env, `🛑 FAIL (3/3) ${AMOUNT} ₽ (терминал ${t.terminal_id})`);
  }
  await env.DB.prepare('DELETE FROM tickets WHERE id=?').bind(t.id).run();
}
