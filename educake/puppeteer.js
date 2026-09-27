require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
puppeteer.use(StealthPlugin());
const smartLogin = require('../utils/smartLogin'); // my-educake

async function educakeLogin(username, password, loginType, on2FA) {
  console.log('[Educake] Starting Chrome...');

  // Launch browser
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: puppeteer.executablePath()
  });

  console.log('[Educake] Chrome started');

  try {
    const page = await browser.newPage();

    console.log('[Educake] New page created');
    console.log('[Educake] Opening Educake login page...');

    // Go to a website
    await page.goto('https://my.educake.co.uk/student-login', {
      waitUntil: 'networkidle0',
      timeout: 5000
    });

    console.log('[Educake] Educake login page loaded');

    const cookieButtonSelector = '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll';

    console.log('[Educake] Checking cookie consent...');

    const cookieButton = await page.$(cookieButtonSelector);

    if (cookieButton) {
      await cookieButton.click();
      console.log('[Educake] Cookie consent accepted!');
    } else {
      console.log('[Educake] No cookie consent button found');
    }

    if (loginType === 'Normal') {
      console.log('[Educake] Using Normal login');
      console.log('[Educake] Waiting for username field...');

      // Wait until the username input appears
      await page.waitForSelector('input[name="username"]', {
        visible: true
      });

      console.log('[Educake] Username field found');

      // Type into the username field
      await page.type('input[name="username"]', username);

      console.log('[Educake] Username entered');
      console.log('[Educake] Waiting for password field...');

      await page.waitForSelector('input[name="password"]', {
        visible: true
      });

      console.log('[Educake] Password field found');

      await page.type('input[name="password"]', password);

      console.log('[Educake] Password entered');
      console.log('[Educake] Waiting for login button...');

      const loginButtonSelector = 'button[type="submit"]';

      await page.waitForSelector(loginButtonSelector, {
        visible: true
      });

      console.log('[Educake] Login button found');
      console.log('[Educake] Clicking login button...');

      // Click the button
      await page.click(loginButtonSelector);

      await page.evaluate(selector => {
        const btn = document.querySelector(selector);
        if (btn) btn.click();
      }, loginButtonSelector);

      console.log('[Educake] Login button clicked');
      console.log('[Educake] Waiting for navigation...');

      // Optional: wait for navigation or successful login indicator
      await page.waitForNavigation({
        waitUntil: 'networkidle0'
      });

      console.log('[Educake] Navigation completed');
    } else {
      console.log(`[Educake] Using ${loginType} login`);

      await page.evaluate((index) => {
        document.querySelectorAll('.sso-login.btn.white')[index].click();
      }, loginType === 'Google' ? 0 : 1);

      console.log('[Educake] SSO button clicked');
      console.log('[Educake] Starting smart login...');

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

      console.log('[Educake] Smart login completed');
    }

    console.log('[Educake] Login complete!');
    console.log('[Educake] Waiting 3 seconds...');

    await delay(3000);

    console.log('[Educake] Reading cookies...');

    // Take a screenshot
    // await page.screenshot({ path: 'example.png' });
    const cookiesArray = await page.cookies();

    console.log(`[Educake] Found ${cookiesArray.length} cookies`);

    const desiredOrder = [
      'PHPSESSID',
      'cf_clearance',
      'XSRF-TOKEN',
      '_dd_s'
    ];

    // Map cookies by name to their "NAME=VALUE"
    const cookiesMap = new Map(
      cookiesArray.map(c => [c.name, `${c.name}=${c.value}`])
    );

    // Build ordered array of cookies (skipping any missing)
    const orderedCookies = desiredOrder
      .map(name => cookiesMap.get(name))
      .filter(Boolean);

    // Join into single cookie header string
    const cookieHeader = orderedCookies.join('; ');

    console.log('[Educake] Cookie header created');

    return cookieHeader;
  } catch (err) {
    console.log('[Educake] Educake login error');
    console.log(err);
    return false;
  } finally {
    console.log('[Educake] Closing browser...');
    await browser.close();
    console.log('[Educake] Browser closed');
  }
}

module.exports = { educakeLogin };