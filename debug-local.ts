// debug-local.ts
//
// Локальный запуск сценария “пополнение” с видимым окном Chrome.
// 1.  npm i puppeteer
// 2.  npx ts-node debug-local.ts   или   ts-node-esm debug-local.ts
//
// Если селектор не найден – скрипт бросит ошибку и окно остановится
// на «неуспешном» шаге: можно глянуть DevTools и поправить селектор.

import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: false,         // показать окно
    devtools: true,          // сразу открыть DevTools
    slowMo: 200,             // замедлить действия (мс)
    defaultViewport: null,   // полноразмерное окно
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);      // общий тайм-аут на поиск селектора

  try {
    /* 1. Авторизация */
    console.log('STEP 1: login');
    await page.goto('https://robox.operatorka.com');
    await page.type('input[placeholder="Введите Ваш логин"]', 'Kassaonline');
    await page.type('input[placeholder="Введите Ваш пароль"]', '7vf4jJs9');
    await page.click('button.btn.btn-red:has-text("Авторизация")');
    await page.waitForSelector('button[data-icon="credit-card"]');

    /* 2. Кнопка «Пополнить» на главной */
    console.log('STEP 2: open top-up form');
    await page.click('button[data-icon="credit-card"]');

    /* 3. Вкладка «Пополнение» */
    console.log('STEP 3: switch tab "Пополнение"');
    await page.click('div.e-tab-text:has-text("Пополнение")');

    /* 4. Ввод PIN */
    console.log('STEP 4: type PIN');
    await page.waitForSelector('input[aria-label="textbox"]');
    await page.type('input[aria-label="textbox"]', '0267658654');

    /* 5. Ввод суммы */
    console.log('STEP 5: type amount');
    await page.click('input.e-numerictextbox', { clickCount: 3 });
    await page.keyboard.press('Delete');
    await page.type('input.e-numerictextbox', '2');

    /* 6. Submit */
    console.log('STEP 6: submit');
    await page.click('button.btn-red:has-text("Пополнить")');

    /* 7. Ждём всплывашку */
    console.log('STEP 7: wait success popup');
    await page.waitForSelector('p.text-justify:has-text("зачислено")', { timeout: 10_000 });

    /* 8. Закрыть */
    console.log('STEP 8: close popup');
    await page.click('button.btn-red:has-text("Закрыть")');

    /* 9. Выход */
    console.log('STEP 9: logout');
    await page.click('button[data-icon="right-from-bracket"]');

    console.log('✔ DONE: success flow completed');
  } catch (err) {
    console.error('✖ ERROR: ', err);
  }
  // оставляем окно открытым для изучения
})();