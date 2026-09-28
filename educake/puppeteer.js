require('dotenv').config();

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const smartLogin =
    require('../utils/smartLogin');

const delay = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

puppeteer.use(StealthPlugin());

// Keep authenticated Educake browser sessions alive.
const browserSessions = new Map();

async function educakeLogin(
    username,
    password,
    loginType,
    on2FA
) {
    let browser = null;
    let keepBrowserOpen = false;

    try {
        console.log('[Educake] Starting Chrome...');

        browser = await puppeteer.launch({
            headless: true,
            timeout: 30000
        });

        console.log('[Educake] Chrome started.');

        const page =
            await browser.newPage();

        await page.setDefaultNavigationTimeout(
            30000
        );

        console.log(
            '[Educake] Opening Educake login page...'
        );

        try {
            const response =
                await page.goto(
                    'https://my.educake.co.uk/student-login',
                    {
                        waitUntil:
                            'domcontentloaded',
                        timeout: 30000
                    }
                );

            console.log(
                '[Educake] page.goto() finished.'
            );

            console.log(
                '[Educake] HTTP status:',
                response
                    ? response.status()
                    : 'no response'
            );

            console.log(
                '[Educake] Current URL:',
                page.url()
            );

        } catch (error) {
            console.error(
                '[Educake] page.goto() FAILED:'
            );

            console.error(error);

            throw error;
        }

        console.log(
            '[Educake] Login page loaded.'
        );

        // ==================================================
        // COOKIE BANNER
        // ==================================================

        console.log(
            '[Educake] Checking cookie banner...'
        );

        try {
            await page.waitForSelector(
                '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
                {
                    visible: true,
                    timeout: 5000
                }
            );

            console.log(
                '[Educake] Cookie banner found.'
            );

            await page.click(
                '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll'
            );

            console.log(
                '[Educake] Cookie consent accepted.'
            );

            await delay(500);

        } catch {
            console.log(
                '[Educake] No cookie banner found.'
            );
        }

        console.log(
            '[Educake] Continuing to login flow...'
        );

        // ==================================================
        // NORMAL LOGIN
        // ==================================================

        if (loginType === 'Normal') {
            console.log(
                '[Educake] Using Normal login...'
            );

            console.log(
                '[Educake] Waiting for username field...'
            );

            await page.waitForSelector(
                'input[name="username"]',
                {
                    visible: true,
                    timeout: 30000
                }
            );

            console.log(
                '[Educake] Username field found.'
            );

            await page.type(
                'input[name="username"]',
                username
            );

            console.log(
                '[Educake] Waiting for password field...'
            );

            await page.waitForSelector(
                'input[name="password"]',
                {
                    visible: true,
                    timeout: 30000
                }
            );

            console.log(
                '[Educake] Password field found.'
            );

            console.log(
                '[Educake] Filling password field...'
            );

            await page.$eval(
                'input[name="password"]',
                (element, value) => {
                    element.focus();

                    element.value = value;

                    element.dispatchEvent(
                        new Event('input', {
                            bubbles: true
                        })
                    );

                    element.dispatchEvent(
                        new Event('change', {
                            bubbles: true
                        })
                    );
                },
                password
            );

            console.log(
                '[Educake] Password field filled.'
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

            await page.click(
                loginButtonSelector
            );

            console.log(
                '[Educake] Login button clicked.'
            );

            console.log(
                '[Educake] Waiting for login to complete...'
            );

            await delay(3000);

            console.log(
                '[Educake] Login request has had time to complete.'
            );

            console.log(
                '[Educake] Current URL after login:',
                page.url()
            );

            const currentCookies =
                await page.cookies();

            console.log(
                `[Educake] Cookies after login: ${currentCookies.length}`
            );

            console.log(
                '[Educake] Cookie names:',
                currentCookies
                    .map(cookie => cookie.name)
                    .join(', ')
            );

        }

        // ==================================================
        // GOOGLE / MICROSOFT LOGIN
        // ==================================================

        else {
            console.log(
                `[Educake] Using ${loginType} login...`
            );

            const buttonIndex =
                loginType === 'Google'
                    ? 0
                    : 1;

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

            await page.evaluate(
                index => {
                    const buttons =
                        document.querySelectorAll(
                            '.sso-login.btn.white'
                        );

                    if (buttons[index]) {
                        buttons[index].click();
                    }
                },
                buttonIndex
            );

            console.log(
                '[Educake] SSO button clicked.'
            );

            const landedFunction =
                ({ url }) =>
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

        // ==================================================
        // COLLECT BROWSER COOKIES
        // ==================================================

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

        const cookiesMap =
            new Map(
                cookiesArray.map(
                    cookie => [
                        cookie.name,
                        `${cookie.name}=${cookie.value}`
                    ]
                )
            );

        const orderedCookies =
            desiredOrder
                .map(
                    name =>
                        cookiesMap.get(name)
                )
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

        // ==================================================
        // KEEP THE SAME BROWSER SESSION ALIVE
        // ==================================================

        browserSessions.set(
            cookieHeader,
            {
                browser,
                page,
                createdAt: Date.now()
            }
        );

        keepBrowserOpen = true;

        console.log(
            '[Educake] Authenticated browser session stored.'
        );

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
        // Only close the browser if login failed.
        // Successful sessions stay alive for API requests.
        if (
            browser &&
            !keepBrowserOpen
        ) {
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


// ==========================================================
// BROWSER SESSION REQUEST
// ==========================================================

async function browserRequest(
    cookies,
    url,
    headers = {},
    data = null,
    options = {}
) {
    const session =
        browserSessions.get(cookies);

    if (!session) {
        throw new Error(
            '[Educake] Authenticated browser session not found.'
        );
    }

    const {
        page
    } = session;

    if (
        !page ||
        page.isClosed()
    ) {
        browserSessions.delete(
            cookies
        );

        throw new Error(
            '[Educake] Authenticated browser page is closed.'
        );
    }

    const method =
        data !== null &&
        data !== undefined
            ? 'POST'
            : 'GET';

    console.log(
        '[Educake Browser] REQUEST:',
        method,
        url
    );

    const requestHeaders = {};

    if (Array.isArray(headers)) {
        headers.forEach(header => {
            const separator =
                header.indexOf(':');

            if (separator === -1) {
                return;
            }

            const key =
                header
                    .slice(0, separator)
                    .trim();

            const value =
                header
                    .slice(separator + 1)
                    .trim();

            requestHeaders[key] =
                value;
        });
    }

    const requestBody =
        Buffer.isBuffer(data)
            ? data.toString('base64')
            : data !== null &&
              data !== undefined
                ? typeof data === 'object'
                    ? JSON.stringify(data)
                    : String(data)
                : null;

    const result =
        await page.evaluate(
            async ({
                url,
                method,
                headers,
                body
            }) => {
                const controller =
                    new AbortController();

                const timeout =
                    setTimeout(
                        () =>
                            controller.abort(),
                        45000
                    );

                try {
                    const response =
                        await fetch(
                            url,
                            {
                                method,
                                headers,
                                body:
                                    method === 'POST'
                                        ? body
                                        : undefined,
                                credentials:
                                    'include',
                                signal:
                                    controller.signal
                            }
                        );

                    const responseBuffer =
                        await response.arrayBuffer();

                    let binary = '';

                    const bytes =
                        new Uint8Array(
                            responseBuffer
                        );

                    for (
                        let i = 0;
                        i < bytes.length;
                        i++
                    ) {
                        binary += String.fromCharCode(
                            bytes[i]
                        );
                    }

                    return {
                        status:
                            response.status,

                        headers:
                            Object.fromEntries(
                                response.headers.entries()
                            ),

                        body:
                            btoa(binary)
                    };

                } finally {
                    clearTimeout(timeout);
                }
            },
            {
                url,
                method,
                headers: requestHeaders,
                body: requestBody
            }
        );

    const bodyBuffer =
        Buffer.from(
            result.body || '',
            'base64'
        );

    let responseBody;

    if (
        options.responseType ===
        'arraybuffer'
    ) {
        responseBody =
            bodyBuffer;

    } else {
        const bodyString =
            bodyBuffer.toString(
                'utf8'
            );

        try {
            responseBody =
                JSON.parse(
                    bodyString
                );
        } catch {
            responseBody =
                bodyString;
        }
    }

    console.log(
        '[Educake Browser] HTTP status:',
        result.status
    );

    return {
        status:
            result.status,

        headers:
            result.headers || {},

        data:
            responseBody
    };
}


async function closeEducakeSession(
    cookies
) {
    const session =
        browserSessions.get(cookies);

    if (!session) {
        return;
    }

    browserSessions.delete(cookies);

    try {
        if (
            session.browser
        ) {
            await session.browser.close();
        }
    } catch (error) {
        console.error(
            '[Educake] Browser close error:',
            error.message
        );
    }
}


module.exports = {
    educakeLogin,
    browserRequest,
    closeEducakeSession
};
