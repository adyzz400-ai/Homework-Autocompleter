require('dotenv').config();

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

puppeteer.use(StealthPlugin());

const smartLogin = require('../utils/smartLogin');

async function educakeLogin(username, password, loginType, on2FA) {
  console.log('[Educake] Starting Chrome...');

  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      '/opt/render/.cache/puppeteer/chrome/linux-142.0.7444.175/chrome-linux64/chrome'
  });

  try {
    const page = await browser.newPage();

    console.log('[Educake] Opening login page...');

    await page.goto('https://my.educake.co.uk/student-login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('[Educake] Login page loaded.');

    const cookieButtonSelector =
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll';

    const cookieButton = await page.$(cookieButtonSelector);

    if (cookieButton) {
      await cookieButton.click();
      console.log('[Educake] Cookie consent accepted!');
    }

    if (loginType === 'Normal') {
      console.log('[Educake] Using Normal login...');

      await page.waitForSelector('input[name="username"]', {
        visible: true,
        timeout: 30000
      });

      await page.type('input[name="username"]', username);

      await page.waitForSelector('input[name="password"]', {
        visible: true,
        timeout: 30000
      });

      await page.type('input[name="password"]', password);

      const loginButtonSelector = 'button[type="submit"]';

      await page.waitForSelector(loginButtonSelector, {
        visible: true,
        timeout: 30000
      });

      await page.click(loginButtonSelector);

      await page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: 30000
      }).catch(() => {
        console.log(
          '[Educake] Navigation after login timed out, continuing...'
        );
      });

    } else {
      console.log(`[Educake] Using ${loginType} login...`);

      await page.evaluate(index => {
        const buttons = document.querySelectorAll('.sso-login.btn.white');

        if (buttons[index]) {
          buttons[index].click();
        }
      }, loginType === 'Google' ? 0 : 1);

      const landedFunction = ({ url }) =>
        url.includes('my.educake.co.uk/my-educake');

      await smartLogin(
        page,
        username,
        password,
        loginType,
        landedFunction,
        () => {},
        on2FA
      );
    }

    console.log('[Educake] Login complete!');

    await delay(3000);

    const cookiesArray = await page.cookies();

    const desiredOrder = [
      'PHPSESSID',
      'cf_clearance',
      'XSRF-TOKEN',
      '_dd_s'
    ];

    const cookiesMap = new Map(
      cookiesArray.map(cookie => [
        cookie.name,
        `${cookie.name}=${cookie.value}`
      ])
    );

    const orderedCookies = desiredOrder
      .map(name => cookiesMap.get(name))
      .filter(Boolean);

    const cookieHeader = orderedCookies.join('; ');

    console.log(
      `[Educake] Cookies collected: ${orderedCookies.length}`
    );

    return cookieHeader;

  } catch (err) {
    console.log('[Educake] Login error');
    console.log(err);

    return false;

  } finally {
    await browser.close();
    console.log('[Educake] Browser closed.');
  }
}

module.exports = {
  educakeLogin
};