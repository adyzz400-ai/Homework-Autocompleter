require('dotenv').config();

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const smartLogin =
    require('../utils/smartLogin');

const delay = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

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
    timeout: 30000,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
    ]
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
    const cookieButton = await page.evaluate(() => {
        const elements = Array.from(
            document.querySelectorAll('button, input[type="button"], input[type="submit"]')
        );

        const button = elements.find(element =>
            (element.innerText || element.value || '')
                .trim()
                .toLowerCase() === 'yes, allow all'
        );

        if (button) {
            button.click();
            return true;
        }

        return false;
    });

    if (cookieButton) {
        console.log(
            '[Educake] Cookie consent accepted.'
        );

        await delay(1000);
    } else {
        console.log(
            '[Educake] No cookie banner found.'
        );
    }

} catch (error) {
    console.log(
        '[Educake] Cookie banner handling failed:',
        error.message
    );
}

        // ==================================================
        // NORMAL LOGIN
        // ==================================================

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

    await page.click(
        'input[name="username"]'
    );

    await page.type(
        'input[name="username"]',
        username
    );

    console.log(
        '[Educake] Username filled.'
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

    await page.click(
        'input[name="password"]'
    );

    await page.type(
        'input[name="password"]',
        password
    );

    console.log(
        '[Educake] Password filled.'
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

    // ----------------------------------------------
    // Monitor network responses during login
    // ----------------------------------------------

    const loginResponses = [];

    const responseListener = response => {
        try {
            const request = response.request();

            if (
                request.method() === 'POST' &&
                response.url().includes('educake.co.uk')
            ) {
                loginResponses.push({
                    url: response.url(),
                    status: response.status()
                });

                console.log(
                    '[Educake] Login POST response:',
                    response.status(),
                    response.url()
                );
            }
        } catch (error) {
            console.log(
                '[Educake] Could not inspect response:',
                error.message
            );
        }
    };

    page.on(
        'response',
        responseListener
    );

    console.log(
        '[Educake] Clicking login button...'
    );

    try {
        await page.click(
            loginButtonSelector
        );
    } finally {
        // Give the login request time to finish.
        await delay(5000);

        page.off(
            'response',
            responseListener
        );
    }

    console.log(
        '[Educake] Login click completed.'
    );

    // ----------------------------------------------
    // Check final page state
    // ----------------------------------------------

    console.log(
        '[Educake] Checking login result...'
    );

    const loginResult =
        await page.evaluate(() => {
            const usernameField =
                document.querySelector(
                    'input[name="username"]'
                );

            const passwordField =
                document.querySelector(
                    'input[name="password"]'
                );

            return {
                url: window.location.href,

                loginFormVisible:
                    !!(
                        usernameField ||
                        passwordField
                    ),

                pageText:
                    (
                        document.body.innerText ||
                        ''
                    ).slice(0, 3000)
            };
        });

    console.log(
        '[Educake] Final URL:',
        loginResult.url
    );

    console.log(
        '[Educake] Login form still visible:',
        loginResult.loginFormVisible
    );

    console.log(
        '[Educake] Login POST responses:',
        loginResponses.length
    );

    if (loginResponses.length > 0) {
        console.log(
            '[Educake] Login response summary:',
            JSON.stringify(loginResponses)
        );
    }

    console.log(
        '[Educake] Page text after login:',
        loginResult.pageText
    );

    if (
        loginResult.url.includes(
            '/student-login'
        ) &&
        loginResult.loginFormVisible
    ) {
        console.log(
            '[Educake] Login did not complete.'
        );
    } else {
        console.log(
            '[Educake] Login appears to have completed.'
        );
    }
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

async function verifyEducakeSession(cookies) {
    const session = browserSessions.get(cookies);

    if (!session) {
        throw new Error(
            '[Educake] Authenticated browser session not found.'
        );
    }

    const { page } = session;

    if (!page || page.isClosed()) {
        throw new Error(
            '[Educake] Authenticated browser page is closed.'
        );
    }

    console.log(
        '[Educake] Verifying authenticated browser session...'
    );

    const result = await page.evaluate(async () => {
        const response = await fetch(
            'https://my.educake.co.uk/student-login',
            {
                method: 'GET',
                credentials: 'include'
            }
        );

        return {
            status: response.status,
            url: window.location.href,
            hasUsernameField:
                !!document.querySelector(
                    'input[name="username"]'
                ),
            hasPasswordField:
                !!document.querySelector(
                    'input[name="password"]'
                )
        };
    });

    console.log(
        '[Educake] Session verification status:',
        result.status
    );

    console.log(
        '[Educake] Session verification URL:',
        result.url
    );

    console.log(
        '[Educake] Login form still present:',
        result.hasUsernameField ||
        result.hasPasswordField
    );

    if (
        result.hasUsernameField ||
        result.hasPasswordField
    ) {
        throw new Error(
            '[Educake] Browser session is still on the login page.'
        );
    }

    return true;
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
    verifyEducakeSession,
    closeEducakeSession
};
