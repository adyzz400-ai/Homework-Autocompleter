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

    console.log('[Educake] Chrome started.');
    console.log('[Educake] Opening Educake login page...');

    await page.goto('https://my.educake.co.uk/student-login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('[Educake] Login page loaded.');
    console.log('[Educake] Current URL:', page.url());

    const cookieButtonSelector =
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll';

    const cookieButton = await page.$(cookieButtonSelector);

    if (cookieButton) {
      console.log('[Educake] Cookie banner found.');

      await cookieButton.click();

      console.log('[Educake] Cookie consent accepted.');
    } else {
      console.log('[Educake] No cookie banner found.');
    }

    if (loginType === 'Normal') {
      console.log('[Educake] Login type: Normal.');
      console.log('[Educake] Waiting for username field...');

      await page.waitForSelector('input[name="username"]', {
        visible: true,
        timeout: 30000
      });

      console.log('[Educake] Username field found.');

      await page.type('input[name="username"]', username);

      console.log('[Educake] Username entered.');
      console.log('[Educake] Waiting for password field...');

      await page.waitForSelector('input[name="password"]', {
        visible: true,
        timeout: 30000
      });

      console.log('[Educake] Password field found.');

      await page.type('input[name="password"]', password);

      console.log('[Educake] Password entered.');
      console.log('[Educake] Waiting for login button...');

      const loginButtonSelector = 'button[type="submit"]';

      await page.waitForSelector(loginButtonSelector, {
        visible: true,
        timeout: 30000
      });

      console.log('[Educake] Login button found.');
      console.log('[Educake] Clicking login button...');

      await page.click(loginButtonSelector);

      console.log('[Educake] Login button clicked.');

      await page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: 30000
      }).catch(() => {
        console.log(
          '[Educake] Navigation timeout after login. Continuing...'
        );
      });

      console.log('[Educake] Post-login URL:', page.url());

    } else {
      console.log(`[Educake] Login type: ${loginType}.`);
      console.log('[Educake] Looking for SSO login button...');

      const buttonIndex = loginType === 'Google' ? 0 : 1;

      await page.waitForSelector('.sso-login.btn.white', {
        visible: true,
        timeout: 30000
      });

      console.log('[Educake] SSO buttons found.');

      await page.evaluate(index => {
        const buttons = document.querySelectorAll('.sso-login.btn.white');

        if (buttons[index]) {
          buttons[index].click();
        }
      }, buttonIndex);

      console.log('[Educake] SSO button clicked.');

      const landedFunction = ({ url }) =>
        url.includes('my.educake.co.uk/my-educake');

      console.log('[Educake] Starting SSO login handler...');

      await smartLogin(
        page,
        username,
        password,
        loginType,
        landedFunction,
        () => {},
        on2FA
      );

      console.log('[Educake] SSO login handler finished.');
      console.log('[Educake] Current URL:', page.url());
    }

    console.log('[Educake] Login flow completed.');
    console.log('[Educake] Waiting before collecting cookies...');

    await delay(3000);

    const cookiesArray = await page.cookies();

    console.log(
      `[Educake] Browser returned ${cookiesArray.length} cookies.`
    );

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
      `[Educake] Required cookies collected: ${orderedCookies.length}`
    );

    if (!cookieHeader) {
      console.log('[Educake] No required login cookies were found.');
      return false;
    }

    console.log('[Educake] Login successful.');

    return cookieHeader;

  } catch (err) {
    console.log('[Educake] Login error:');
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