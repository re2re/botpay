const puppeteer = require('puppeteer');

(async () => {
  const br = await puppeteer.launch({ headless:false, slowMo:200, devtools:true, defaultViewport:null });
  const page = await br.newPage();
  page.setDefaultTimeout(15000);

  try {
    console.log('STEP 1: login');
    await page.goto('https://robox.operatorka.com', { waitUntil:'networkidle0' });
    await page.waitForSelector('input[placeholder="Введите Ваш логин"][aria-label="textbox"]');
    await page.type('input[placeholder="Введите Ваш логин"]', 'Kassaonline');
    await page.type('input[placeholder="Введите Ваш пароль"]', '7vf4jJs9');
    await page.click('button.btn.btn-red');

    console.log('STEP 2: open form');
    const svgCard = await page.waitForSelector('svg[data-icon="credit-card"]');
    const btnCard = await svgCard.evaluateHandle(el => el.closest('button'));
    await (btnCard.asElement()).click();

    console.log('STEP 3: amount');
    await page.waitForSelector('input.e-numerictextbox');
    await page.click('input.e-numerictextbox', { clickCount:3 });
    await page.keyboard.press('Delete');
    await page.type('input.e-numerictextbox', '2');

    console.log('STEP 4: tab');
    await page.$$eval('div.e-tab-text', els => {
      const el = els.find(x => x.textContent?.trim() === 'Пополнение');
      if (el) el.click();
    });

    console.log('STEP 5: pin');
    await page.type('input[aria-label="textbox"]', '0267658654');

    console.log('STEP 6: submit');
    await page.$$eval('button.btn-red', els => {
      const el = els.find(x => x.textContent?.includes('Пополнить'));
      if (el) el.click();
    });

    console.log('STEP 7: success');
    await page.waitForSelector('p.text-justify');

    console.log('STEP 8: close popup');
    await page.$$eval('button.btn-red', els => {
      const el = els.find(x => x.textContent?.includes('Закрыть'));
      if (el) el.click();
    });

    console.log('STEP 9: logout');
    const svgOut = await page.waitForSelector('svg[data-icon="right-from-bracket"]');
    const btnOut = await svgOut.evaluateHandle(el => el.closest('button'));
    await (btnOut.asElement()).click();

    console.log('✔ DONE');
  } catch (e) {
    console.error('✖ ERROR', e);
  }
})();




