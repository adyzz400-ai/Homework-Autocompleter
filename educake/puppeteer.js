require('dotenv').config();

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

puppeteer.use(StealthPlugin());

const smartLogin = require('../utils/smartLogin');

async function educakeLogin(username, password, loginType, on2FA) {
    let browser = null;

    try {
        console.log('[Educake] Starting Chrome...');

        browser = await puppeteer.launch({
            headless: true,
            timeout: 30000
        });

        console.log('[Educake] Chrome started.');

        const page = await browser.newPage();

        console.log('[Educake] Opening Educake login page...');

        try {
            const response = await page.goto(
                'https://my.educake.co.uk/student-login',
                {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                }
            );

            console.log('[Educake] page.goto() finished.');

            console.log(
                '[Educake] HTTP status:',
                response ? response.status() : 'no response'
            );

            console.log(
                '[Educake] Current URL:',
                page.url()
            );

        } catch (error) {
            console.error('[Educake] page.goto() FAILED:');
            console.error(error);

            throw error;
        }

        console.log('[Educake] Login page loaded.');

        // --------------------------------------------------
        // COOKIE BANNER
        // --------------------------------------------------

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

        // --------------------------------------------------
        // NORMAL LOGIN
        // --------------------------------------------------

        if (loginType === 'Normal') {
            console.log('[Educake] Using Normal login...');

            console.log('[Educake] Waiting for username field...');

            await page.waitForSelector(
                'input[name="username"]',
                {
                    visible: true,
                    timeout: 30000
                }
            );

            console.log('[Educake] Username field found.');

            await page.type(
                'input[name="username"]',
                username
            );

            console.log('[Educake] Waiting for password field...');

            await page.waitForSelector(
                'input[name="password"]',
                {
                    visible: true,
                    timeout: 30000
                }
            );

            console.log('[Educake] Password field found.');

            await page.type(
                'input[name="password"]',
                password
            );

            const loginButtonSelector =
                'button[type="submit"]';

            console.log(
                '[Educake] Waiting for login button...'
            );

            await page.waitForSelector(
                loginButtonSelector,
                {
                    visible: true,
                    timeout: 30000
                }
            );

            console.log(
                '[Educake] Login button found.'
            );

            console.log(
                '[Educake] Clicking login button...'
            );

            await page.click(loginButtonSelector);

            console.log(
                '[Educake] Login button clicked.'
            );

            console.log(
                '[Educake] Waiting for login to complete...'
            );

            try {
                await page.waitForFunction(
                    () =>
                        window.location.href.includes(
                            '/my-educake'
                        ),
                    {
                        timeout: 15000
                    }
                );

                console.log(
                    '[Educake] Login redirect detected.'
                );

            } catch {
                console.log(
                    '[Educake] No redirect detected.'
                );
            }

            await delay(2000);

            console.log(
                '[Educake] Current URL after login:',
                page.url()
            );
        }

        // --------------------------------------------------
        // GOOGLE / MICROSOFT LOGIN
        // --------------------------------------------------

        else {
            console.log(
                `[Educake] Using ${loginType} login...`
            );

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

            console.log(
                '[Educake] SSO buttons found.'
            );

            await page.evaluate(index => {
                const buttons =
                    document.querySelectorAll(
                        '.sso-login.btn.white'
                    );

                if (buttons[index]) {
                    buttons[index].click();
                }
            }, buttonIndex);

            console.log(
                '[Educake] SSO button clicked.'
            );

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

            console.log(
                '[Educake] SSO login completed.'
            );

            console.log(
                '[Educake] Current URL:',
                page.url()
            );
        }

        // --------------------------------------------------
        // VERIFY LOGIN
        // --------------------------------------------------

        console.log(
            '[Educake] Login flow completed.'
        );

        await delay(2000);

        console.log(
            '[Educake] Collecting cookies...'
        );

        const cookiesArray =
            await page.cookies();

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

        console.log(
            '[Educake] Login successful.'
        );

        return cookieHeader;

    } catch (error) {
        console.error(
            '[Educake] Login error:'
        );

        console.error(error);

        return false;

    } finally {
        if (browser) {
            try {
                await browser.close();

                console.log(
                    '[Educake] Browser closed.'
                );

            } catch (error) {
                console.error(
                    '[Educake] Browser close error:',
                    error.message
                );
            }
        }
    }
}

module.exports = {
    educakeLogin
};
