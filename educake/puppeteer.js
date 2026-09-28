require('dotenv').config();

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

puppeteer.use(StealthPlugin());

const smartLogin = require('../utils/smartLogin');

async function educakeLogin(username, password, loginType, on2FA) {
    console.log('[Educake] Starting Chrome...');

    const browser = await puppeteer.launch({
        headless: true
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

        // Cookie banner
        console.log('[Educake] Checking cookie banner...');

        try {
            await page.waitForSelector(
                '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
                {
                    visible: true,
                    timeout: 5000
                }
            );

            console.log('[Educake] Cookie banner found.');

            await page.click(
                '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll'
            );

            console.log('[Educake] Cookie consent accepted.');

            await delay(500);
        } catch {
            console.log('[Educake] No cookie banner found.');
        }

        console.log('[Educake] Continuing to login flow...');

        if (loginType === 'Normal') {
            console.log('[Educake] Using Normal login...');

            console.log('[Educake] Waiting for username field...');

            await page.waitForSelector('input[name="username"]', {
                visible: true,
                timeout: 30000
            });

            console.log('[Educake] Username field found.');

            await page.type('input[name="username"]', username);

            console.log('[Educake] Waiting for password field...');

            await page.waitForSelector('input[name="password"]', {
                visible: true,
                timeout: 30000
            });

            console.log('[Educake] Password field found.');

            await page.type('input[name="password"]', password);

            const loginButtonSelector = 'button[type="submit"]';

            console.log('[Educake] Waiting for login button...');

            await page.waitForSelector(loginButtonSelector, {
                visible: true,
                timeout: 30000
            });

            console.log('[Educake] Login button found.');
            console.log('[Educake] Clicking login button...');

            await page.click(loginButtonSelector);

            await page.waitForNavigation({
                waitUntil: 'domcontentloaded',
                timeout: 30000
            }).catch(() => {
                console.log(
                    '[Educake] Navigation after login timed out, continuing...'
                );
            });

            console.log(
                '[Educake] Current URL after login:',
                page.url()
            );
        } else {
            console.log(`[Educake] Using ${loginType} login...`);

            const buttonIndex =
                loginType === 'Google' ? 0 : 1;

            console.log(
                '[Educake] Waiting for SSO buttons...'
            );

            await page.waitForSelector(
                '.sso-login.btn.white',
                {
                    visible: true,
                    timeout: 30000
                }
            );

            console.log('[Educake] SSO buttons found.');

            await page.evaluate(index => {
                const buttons =
                    document.querySelectorAll(
                        '.sso-login.btn.white'
                    );

                if (buttons[index]) {
                    buttons[index].click();
                }
            }, buttonIndex);

            console.log('[Educake] SSO button clicked.');

            const landedFunction = ({ url }) =>
                url.includes(
                    'my.educake.co.uk/my-educake'
                );

            await smartLogin(
                page,
                username,
                password,
                loginType,
                landedFunction,
                () => {},
                on2FA
            );

            console.log('[Educake] SSO login completed.');
            console.log(
                '[Educake] Current URL:',
                page.url()
            );
        }

        console.log('[Educake] Login flow completed.');

        await delay(3000);

        console.log('[Educake] Collecting cookies...');

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

        const cookieHeader =
            orderedCookies.join('; ');

        console.log(
            `[Educake] Required cookies collected: ${orderedCookies.length}`
        );

        if (!cookieHeader) {
            console.log(
                '[Educake] No required cookies found.'
            );

            return false;
        }

        console.log('[Educake] Login successful.');

        return cookieHeader;

    } catch (err) {
        console.error('[Educake] Login error:');
        console.error(err);

        return false;

    } finally {
        await browser.close();

        console.log('[Educake] Browser closed.');
    }
}

module.exports = {
    educakeLogin
};
