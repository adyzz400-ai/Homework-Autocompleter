const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');

require('dotenv').config();

const smartLogin = require('../utils/smartLogin');
const curlRequesticator = require('../utils/curlRequesticator');

puppeteer.use(StealthPlugin());

const delay = ms =>
  new Promise(resolve => setTimeout(resolve, ms));


// ============================================================
// TOKEN REQUEST
// ============================================================

async function getTokenRequest(cookies, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(
        `[Sparx Token] Request attempt ${attempt}/${attempts}...`
      );

      const requesticator =
        new curlRequesticator(cookies);

      const headers = [
        'accept: */*',
        'accept-language: en-GB,en;q=0.9',
        'content-type: application/json',
        'Referer: https://app.sparx-learning.com/'
      ];

      const response =
        await requesticator._executeCurl(
          'https://api.sparx-learning.com/token',
          headers
        );

      if (
        response === null ||
        response === undefined
      ) {
        throw new Error(
          'Empty response from Sparx token endpoint'
        );
      }

      let token;

      if (typeof response === 'string') {
        const trimmed =
          response.trim();

        try {
          const parsed =
            JSON.parse(trimmed);

          if (typeof parsed === 'string') {
            token =
              parsed.trim();
          } else if (
            parsed &&
            typeof parsed === 'object'
          ) {
            token =
              parsed.token ||
              parsed.access_token ||
              parsed.id_token ||
              parsed.accessToken;
          }
        } catch {
          token = trimmed;
        }
      } else if (
        typeof response === 'object'
      ) {
        token =
          response.token ||
          response.access_token ||
          response.id_token ||
          response.accessToken;
      }

      if (
        !token ||
        typeof token !== 'string'
      ) {
        throw new Error(
          'Could not extract a token from the Sparx token response'
        );
      }

      token =
        token.trim();

      console.log(
        `[Sparx Token] Token extracted successfully (${token.length} chars)`
      );

      return token;

    } catch (error) {
      console.error(
        `[Sparx Token] Attempt ${attempt} failed: ${error.message}`
      );

      if (
        attempt >= attempts
      ) {
        throw error;
      }

      await delay(1000);
    }
  }
}


// ============================================================
// SAFE CLICK
// ============================================================

async function safeClick(
  page,
  selector,
  maxAttempts = 2
) {
  for (
    let attempt = 0;
    attempt < maxAttempts;
    attempt++
  ) {
    try {
      const el =
        await page.$(selector);

      if (el) {
        const visible =
          await el.isIntersectingViewport();

        if (visible) {
          await el.click();
          return true;
        }
      }

      const clicked =
        await page.evaluate(sel => {
          const element =
            document.querySelector(sel);

          if (
            element &&
            element.offsetParent !== null
          ) {
            element.click();
            return true;
          }

          return false;
        }, selector);

      if (clicked) {
        return true;
      }

    } catch {}

    if (
      attempt <
      maxAttempts - 1
    ) {
      await delay(200);
    }
  }

  throw new Error(
    `Failed to click ${selector}`
  );
}


// ============================================================
// CLICK BUTTON BY TEXT
// ============================================================

async function clickButtonWithText(
  page,
  text,
  timeout = 15000
) {
  const start =
    Date.now();

  while (
    Date.now() - start <
    timeout
  ) {
    try {
      const clicked =
        await page.evaluate(
          textValue => {
            const buttons =
              Array.from(
                document.querySelectorAll(
                  'button'
                )
              );

            const wanted =
              textValue
                .toLowerCase()
                .trim();

            const button =
              buttons.find(button => {
                const content =
                  button.textContent
                    ?.trim()
                    .toLowerCase() || '';

                return (
                  content.includes(wanted) &&
                  button.offsetParent !== null
                );
              });

            if (button) {
              button.click();
              return true;
            }

            return false;
          },
          text
        );

      if (clicked) {
        return true;
      }

    } catch {}

    await delay(150);
  }

  throw new Error(
    `Button with text "${text}" not found`
  );
}


// ============================================================
// FIND SCHOOL INPUT
// ============================================================

async function findSchoolInput(
  page,
  timeout = 30000
) {
  const selectors = [
    'input[placeholder*="Start typing your school" i]',
    'input[placeholder*="school" i]',
    'input[aria-label*="school" i]',
    'input[name*="school" i]'
  ];

  for (
    const selector of
    selectors
  ) {
    try {
      await page.waitForSelector(
        selector,
        {
          timeout: 10000,
          visible: false
        }
      );

      await page.waitForFunction(
        selector => {
          const el =
            document.querySelector(
              selector
            );

          if (!el) {
            return false;
          }

          const style =
            window.getComputedStyle(
              el
            );

          return (
            !el.disabled &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        },
        {
          timeout: 10000
        },
        selector
      );

      const input =
        await page.$(selector);

      if (input) {
        console.log(
          `Found school input using selector: ${selector}`
        );

        return input;
      }

    } catch {}
  }

  const diagnostics =
    await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      readyState:
        document.readyState,

      inputs:
        [...document.querySelectorAll('input')]
          .map(el => ({
            type: el.type,
            placeholder:
              el.placeholder || '',
            ariaLabel:
              el.getAttribute(
                'aria-label'
              ) || '',
            name:
              el.name || '',
            id:
              el.id || '',
            disabled:
              el.disabled,
            visible:
              !!(
                el.offsetWidth ||
                el.offsetHeight ||
                el.getClientRects().length
              )
          })),

      bodyText:
        document.body?.innerText
          ?.slice(0, 1500) || ''
    }));

  console.log(
    `School input diagnostic: ${JSON.stringify(diagnostics)}`
  );

  throw new Error(
    'Sparx school search input not found after checking all known selectors.'
  );
}


// ============================================================
// SELECT SCHOOL RESULT
// ============================================================

async function selectSchoolResult(
  page,
  school,
  timeout = 15000
) {
  const start =
    Date.now();

  while (
    Date.now() - start <
    timeout
  ) {
    try {
      const result =
        await page.$(
          'div[class*="SchoolResult_"]'
        );

      if (!result) {
        await delay(200);
        continue;
      }

      const details =
        await result.evaluate(
          el => ({
            text:
              el.innerText?.trim() || '',
            className:
              el.className,
            visible:
              el.offsetParent !== null
          })
        );

      if (
        !details.visible ||
        !details.text
          .toLowerCase()
          .includes(
            school
              .trim()
              .toLowerCase()
          )
      ) {
        await delay(200);
        continue;
      }

      await result.click();

      console.log(
        `School result clicked: ${JSON.stringify(details)}`
      );

      await delay(1000);

      return true;

    } catch {
      await delay(200);
    }
  }

  throw new Error(
    `School result for "${school}" was not found`
  );
}


// ============================================================
// REQUEST / RESPONSE SNIFFER HELPERS
// ============================================================

function stripGrpcFrame(body) {
  if (
    !body ||
    body.length < 5
  ) {
    return body;
  }
  const messageLength =
    body.readUInt32BE(1);
  if (
    messageLength <=
    body.length - 5
  ) {
    return body.subarray(
      5,
      5 + messageLength
    );
  }
  return body;
}

function isNoiseAsset(url) {
  return /\.(js|mjs|css|png|jpg|jpeg|svg|gif|webp|woff2?|ico|map|webmanifest|txt|json)(\?|$)/i.test(url)
    && !/site\.webmanifest/i.test(url);
}

function attachNetworkSniffer(page, addLog) {

  // ----------------------------------------------------------
  // CATCH-ALL: log every request to *.sparx-learning.com
  // ----------------------------------------------------------

  page.on(
    'request',
    request => {
      const url =
        request.url();

      let host;
      try {
        host = new URL(url).hostname;
      } catch {
        return;
      }

      const isSparx =
        host === 'sparx-learning.com' ||
        host.endsWith('.sparx-learning.com');

      if (!isSparx) return;

      const method =
        request.method();

      if (
        method !== 'GET' &&
        method !== 'POST' &&
        method !== 'OPTIONS'
      ) {
        return;
      }

      const isApiHost =
        host === 'api.sparx-learning.com' ||
        host.startsWith('api.');

      if (!isApiHost && isNoiseAsset(url)) return;

      addLog(
        `[Sparx SNIFF] ${method} ${url}`
      );
    }
  );

  // ----------------------------------------------------------
  // FOCUSED: ListStudentPackages + GetPackageData
  // ----------------------------------------------------------

  page.on(
    'request',
    request => {
      const url =
        request.url();

      const isListStudentPackages =
        url.includes(
          '/maths/sparx.packageactivity.v1.Packages/ListStudentPackages'
        );

      const isGetPackageData =
        url.includes(
          'Sparxweb/GetPackageData'
        );

      if (
        !isListStudentPackages &&
        !isGetPackageData
      ) {
        return;
      }

      const tag =
        isGetPackageData
          ? 'GetPackageData'
          : 'ListStudentPackages';

      try {
        const postData = request.postData();
        const body = postData
          ? Buffer.from(postData, 'binary')
          : null;

        addLog(
          `[Sparx ${tag}] REQUEST detected`
        );
        addLog(
          `[Sparx ${tag}] request-method=${request.method()}`
        );
        addLog(
          `[Sparx ${tag}] request-content-type=${
            request.headers()['content-type'] || 'unknown'
          }`
        );
        addLog(
          `[Sparx ${tag}] request-size=${
            body ? body.length : 0
          }`
        );

        if (body) {
          const payload =
            stripGrpcFrame(body);

          addLog(
            `[Sparx ${tag}] request-payload-size=${payload.length}`
          );
          addLog(
            `[Sparx ${tag}] request-payload-hex=${payload.toString('hex')}`
          );
          addLog(
            `[Sparx ${tag}] request-payload-base64=${payload.toString('base64')}`
          );
          addLog(
            `[Sparx ${tag}] request-first-bytes=${payload.subarray(0, 64).toString('hex')}`
          );
        }

      } catch (error) {
        addLog(
          `[Sparx ${tag}] request diagnostic error: ${error.message}`
        );
      }
    }
  );

  // ----------------------------------------------------------
  // RESPONSES
  // ----------------------------------------------------------

  page.on(
    'response',
    async response => {
      const url =
        response.url();

      let host;
      try {
        host = new URL(url).hostname;
      } catch {
        return;
      }

      const isSparx =
        host === 'sparx-learning.com' ||
        host.endsWith('.sparx-learning.com');

      if (!isSparx) return;

      const isListStudentPackages =
        url.includes(
          '/maths/sparx.packageactivity.v1.Packages/ListStudentPackages'
        );

      const isGetPackageData =
        url.includes(
          'Sparxweb/GetPackageData'
        );

      const isGetCurrentSession =
        url.includes(
          'sparx.maths.sessions.v1.Sessions/GetCurrentSession'
        );

      const isApiHost =
        host === 'api.sparx-learning.com' ||
        host.startsWith('api.');

      if (
        !isListStudentPackages &&
        !isGetPackageData &&
        !isGetCurrentSession &&
        !isApiHost
      ) {
        return;
      }

      if (!isApiHost && isNoiseAsset(url)) {
        return;
      }

      const tag =
        isGetPackageData
          ? 'GetPackageData'
          : isListStudentPackages
            ? 'ListStudentPackages'
            : null;

      try {
        const body =
          await response.buffer();

        if (tag) {
          addLog(
            `[Sparx ${tag}] RESPONSE detected`
          );
          addLog(
            `[Sparx ${tag}] status=${response.status()}`
          );
          addLog(
            `[Sparx ${tag}] content-type=${
              response.headers()['content-type'] || 'unknown'
            }`
          );
          addLog(
            `[Sparx ${tag}] response-size=${body.length}`
          );
        }

        const payload =
          stripGrpcFrame(body);

        const text =
          payload.toString('utf8');

        const strings =
          text.match(
            /[ -~]{4,}/g
          ) || [];

        const uniqueStrings =
          [
            ...new Set(
              strings
            )
          ].slice(
            0,
            80
          );

        if (tag) {
          addLog(
            `[Sparx ${tag}] printable-fields=${JSON.stringify(
              uniqueStrings
            )}`
          );
        }

        if (isApiHost && !tag) {
          const shortUrl =
            url.replace(
              'https://api.sparx-learning.com/',
              ''
            );
          addLog(
            `[Sparx API] ${response.status()} ${shortUrl} size=${body.length} sample=${JSON.stringify(uniqueStrings.slice(0, 12))}`
          );
        }

        if (isGetPackageData) {
          addLog(
            `[Sparx ${tag}] response-hex=${payload
              .slice(0, 512)
              .toString('hex')}`
          );
        }

        // ----------------------------------------------------
        // FULL DUMP of GetCurrentSession. Fires on every page
        // load; we now know it's the session + feature-flag
        // envelope, not the task source — kept here so future
        // debugging has the body without another code change.
        // ----------------------------------------------------
        if (isGetCurrentSession) {
          const b64 = body.toString('base64');
          const hexHead =
            body.slice(0, 2048).toString('hex');

          addLog(
            `[Sparx SESSION] size=${body.length}`
          );
          addLog(
            `[Sparx SESSION] hex-head=${hexHead}`
          );

          for (
            let i = 0;
            i < b64.length;
            i += 16000
          ) {
            addLog(
              `[Sparx SESSION] b64[${i}]=${b64.slice(i, i + 16000)}`
            );
          }
        }

      } catch (error) {
        if (tag) {
          addLog(
            `[Sparx ${tag}] response diagnostic error: ${error.message}`
          );
        }
      }
    }
  );
}


// ============================================================
// MAIN LOGIN
// ============================================================

async function getCookies(
  school,
  email,
  password,
  loginType,
  app,
  on2FA
) {
  const addLog =
    msg => console.log(msg);

  for (
    let attempt = 1;
    attempt <= 1;
    attempt++
  ) {
    addLog(
      `Attempt ${attempt} started: school='${school}', app='${app}', loginType='${loginType}'`
    );

    try {
      try {
        execSync(
          'rm -rf /tmp/puppeteer_*',
          {
            stdio: 'ignore'
          }
        );

        addLog(
          'Cache cleared.'
        );

      } catch (err) {
        addLog(
          `Cache clear failed: ${err.message}`
        );
      }

      let schoolStatus =
        false;

      let loginTypeStatus =
        false;

      let emailTypeStatus =
        false;

      let passTypeStatus =
        false;

      let smartLoginVar = {
        filledEmail: false,
        filledPassword: false
      };

      let browser;
      let page;

      try {
        browser =
          await puppeteer.launch({
            headless: true,

            args: [
              '--start-maximized',
              '--no-first-run',
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--ignore-certificate-errors',
              '--disable-blink-features=AutomationControlled',
              '--disable-features=IsolateOrigins,site-per-process',
              '--ignore-certificate-errors-spki-list'
            ]
          });

        page =
          await browser.newPage();

        addLog(
          'Browser launched and new page created.'
        );

        addLog(
          'Screencast disabled.'
        );

        // ======================================================
        // NETWORK SNIFFER
        // ======================================================

        attachNetworkSniffer(page, addLog);

        // ======================================================
        // PAGE ERROR DIAGNOSTICS
        // ======================================================

        page.on(
          'pageerror',
          error => {
            addLog(
              `PAGE ERROR: ${error.message}`
            );
          }
        );

        page.on(
          'console',
          msg => {
            if (
              msg.type() ===
              'error'
            ) {
              addLog(
                `BROWSER CONSOLE ERROR: ${msg.text()}`
              );
            }
          }
        );


        // ======================================================
        // BROWSER FINGERPRINT SETUP
        // ======================================================

        await page.evaluateOnNewDocument(
          () => {
            Object.defineProperty(
              navigator,
              'webdriver',
              {
                get: () => false
              }
            );

            Object.defineProperty(
              navigator,
              'plugins',
              {
                get: () => [
                  1,
                  2,
                  3,
                  4,
                  5
                ]
              }
            );

            Object.defineProperty(
              navigator,
              'languages',
              {
                get: () => [
                  'en-US',
                  'en'
                ]
              }
            );

            window.chrome = {
              runtime: {}
            };

            const originalQuery =
              window.navigator
                .permissions
                .query;

            window.navigator
              .permissions
              .query =
              parameters =>
                parameters.name ===
                'notifications'
                  ? Promise.resolve({
                      state:
                        Notification.permission
                    })
                  : originalQuery(
                      parameters
                    );

            Object.defineProperty(
              navigator,
              'platform',
              {
                get: () =>
                  'Win32'
              }
            );
          }
        );


        const userAgents = [
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.71',

          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',

          'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',

          'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',

          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0'
        ];

        await page.setUserAgent(
          userAgents[
            Math.floor(
              Math.random() *
              userAgents.length
            )
          ]
        );


        // ======================================================
        // SCHOOL PAGE
        // ======================================================

        await page.goto(
          `https://selectschool.sparx-learning.com/?app=sparx_${app}`,
          {
            waitUntil:
              'domcontentloaded',
            timeout: 30000
          }
        );

        addLog(
          'Navigated to select school page.'
        );


        await page.evaluate(
          () => {
            const el =
              document.getElementById(
                'cookiescript_injected_wrapper'
              );

            if (el) {
              el.remove();
            }
          }
        ).catch(() => {});


        // ======================================================
        // SCHOOL INPUT
        // ======================================================

        const schoolInput =
          await findSchoolInput(
            page,
            30000
          );

        addLog(
          'Found Sparx school search input.'
        );

        const schoolInputInfo =
          await schoolInput.evaluate(
            el => ({
              value:
                el.value || '',
              placeholder:
                el.placeholder || '',
              disabled:
                el.disabled,
              visible:
                !!(
                  el.offsetWidth ||
                  el.offsetHeight ||
                  el.getClientRects()
                    .length
                )
            })
          );

        addLog(
          `School input state: ${JSON.stringify(
            schoolInputInfo
          )}`
        );

        await schoolInput.click({
          clickCount: 3
        });

        await schoolInput.press(
          'Backspace'
        );

        await schoolInput.type(
          school,
          {
            delay: 25
          }
        );

        addLog(
          `School name typed: ${school}`
        );

        await delay(1000);

        addLog(
          'Waiting for school results...'
        );

        await selectSchoolResult(
          page,
          school,
          30000
        );

        addLog(
          'School result selected.'
        );


        // ======================================================
        // SCHOOL SELECTION DIAGNOSTIC
        // ======================================================

        const selectedSchoolDiagnostic =
          await page.evaluate(
            () => {
              const elements =
                [
                  ...document.querySelectorAll(
                    '*'
                  )
                ];

              return elements
                .filter(el => {
                  const text =
                    el.innerText
                      ?.trim() || '';

                  return (
                    text ===
                      'Heston Community School' ||
                    text.startsWith(
                      'Heston Community School'
                    )
                  );
                })
                .slice(
                  0,
                  10
                )
                .map(
                  el => ({
                    tag:
                      el.tagName,
                    text:
                      el.innerText
                        ?.trim(),
                    role:
                      el.getAttribute(
                        'role'
                      ),
                    ariaSelected:
                      el.getAttribute(
                        'aria-selected'
                      ),
                    className:
                      el.className,
                    disabled:
                      el.disabled ??
                      null
                  })
                );
            }
          );

        addLog(
          `Selected school diagnostic: ${JSON.stringify(
            selectedSchoolDiagnostic
          )}`
        );


        const schoolState =
          await page.evaluate(
            () => {
              const input =
                document.querySelector(
                  'input[placeholder*="Start typing your school"]'
                );

              const buttons =
                [
                  ...document.querySelectorAll(
                    'button'
                  )
                ];

              const continueButton =
                buttons.find(
                  b =>
                    b.innerText
                      ?.trim() ===
                    'Continue'
                );

              return {
                inputValue:
                  input?.value ||
                  '',
                continueDisabled:
                  continueButton
                    ?.disabled ??
                  null,
                continueAriaDisabled:
                  continueButton?.getAttribute(
                    'aria-disabled'
                  ) || null
              };
            }
          );

        addLog(
          `School selection state: ${JSON.stringify(
            schoolState
          )}`
        );

        schoolStatus =
          true;


        // ======================================================
        // CONTINUE BUTTON
        // ======================================================

        addLog(
          'Preparing to click Continue...'
        );

        const continueButtons =
          await page.$$('button');

        let continueButton =
          null;

        for (
          const button of
          continueButtons
        ) {
          const text =
            await button.evaluate(
              el =>
                el.innerText?.trim()
            );

          if (
            text?.toLowerCase() ===
            'continue'
          ) {
            continueButton =
              button;
            break;
          }
        }

        if (!continueButton) {
          throw new Error(
            'Continue button was not found.'
          );
        }

        const continueState =
          await continueButton.evaluate(
            el => ({
              text:
                el.innerText?.trim(),
              disabled:
                el.disabled,
              type:
                el.getAttribute(
                  'type'
                ),
              className:
                el.className
            })
          );

        addLog(
          `Continue state: ${JSON.stringify(
            continueState
          )}`
        );

        if (
          continueState.disabled
        ) {
          throw new Error(
            'Continue button is disabled.'
          );
        }

        addLog(
          'Waiting for Sparx page JavaScript to finish settling...'
        );

        await delay(1000);

        addLog(
          'Clicking Continue and waiting for navigation...'
        );

        const oldUrl =
          page.url();

        await Promise.all([
          page.waitForNavigation({
            waitUntil:
              'domcontentloaded',
            timeout: 15000
          }).catch(() => null),

          continueButton.click()
        ]);

        await delay(1000);

        const newUrl =
          page.url();

        addLog(
          `URL before Continue: ${oldUrl}`
        );

        addLog(
          `URL after Continue: ${newUrl}`
        );

        if (
          newUrl.includes(
            'selectschool.sparx-learning.com'
          )
        ) {
          throw new Error(
            'Continue was clicked, but Sparx remained on the school-selection page.'
          );
        }

        addLog(
          'Sparx left the school-selection page.'
        );

        await page.waitForFunction(
          () =>
            document.readyState !==
            'loading',
          {
            timeout: 10000
          }
        ).catch(() => {});

        addLog(
          `Destination page ready: ${page.url()}`
        );


        // ======================================================
        // COOKIE POPUP
        // ======================================================

        try {
          await page.waitForSelector(
            '#cookiescript_injected_wrapper',
            {
              timeout: 5000
            }
          );

          await page.evaluate(
            () => {
              const el =
                document.getElementById(
                  'cookiescript_injected_wrapper'
                );

              if (el) {
                el.remove();
              }
            }
          );

        } catch {}


        // ======================================================
        // LOGIN
        // ======================================================

        if (
          loginType &&
          loginType
            .toLowerCase() !==
            'normal'
        ) {

          await safeClick(
            page,
            '.sm-button.sso-login-button'
          );

          addLog(
            'Clicked SSO login button.'
          );

          loginTypeStatus =
            true;

          const ssoNavigation =
            page.waitForNavigation({
              waitUntil:
                'domcontentloaded',
              timeout: 10000
            }).catch(() => null);

          await Promise.race([
            ssoNavigation,
            delay(1500)
          ]);

          const landedFunction =
            ({ url }) =>
              [
                'science',
                'reader',
                'maths',
                'app'
              ].some(
                sub =>
                  url.includes(
                    sub +
                    '.sparx-learning.com'
                  )
              );

          smartLoginVar =
            await smartLogin(
              page,
              email,
              password,
              loginType,
              landedFunction,
              addLog,
              on2FA
            );

          addLog(
            `smartLogin finished: emailFilled=${smartLoginVar.filledEmail}, passFilled=${smartLoginVar.filledPassword}`
          );

        } else {

          // ----------------------------------------------------
          // NORMAL LOGIN
          // ----------------------------------------------------

          const inputs =
            await page.$$('.sm-input');

          if (
            inputs.length < 2
          ) {
            throw new Error(
              'Normal login inputs not found.'
            );
          }

          const emailValue =
            await inputs[0].evaluate(
              el =>
                el.value || ''
            );

          if (
            !emailValue.trim()
          ) {
            await inputs[0].click({
              clickCount: 3
            });

            await inputs[0].press(
              'Backspace'
            );

            await inputs[0].type(
              email,
              {
                delay: 25
              }
            );

            addLog(
              'Typed email in normal login.'
            );
          }

          emailTypeStatus =
            true;

          const passValue =
            await inputs[1].evaluate(
              el =>
                el.value || ''
            );

          if (
            !passValue.trim()
          ) {
            await inputs[1].click({
              clickCount: 3
            });

            await inputs[1].press(
              'Backspace'
            );

            await inputs[1].type(
              password,
              {
                delay: 25
              }
            );

            addLog(
              'Typed password in normal login.'
            );
          }

          passTypeStatus =
            true;

          loginTypeStatus =
            true;

          const loginNavigation =
            page.waitForNavigation({
              waitUntil:
                'domcontentloaded',
              timeout: 10000
            }).catch(() => null);

          await safeClick(
            page,
            '.sm-button.login-button'
          );

          addLog(
            'Clicked login button.'
          );

          await Promise.race([
            loginNavigation,
            delay(1500)
          ]);

          addLog(
            'Finished post-login navigation.'
          );
        }


        // ======================================================
        // DO NOT NAVIGATE TO MATHS MANUALLY
        // ======================================================

        addLog(
          `Post-login URL: ${page.url()}`
        );

        await delay(2500);

        addLog(
          `Post-login settled URL: ${page.url()}`
        );


        // ======================================================
        // COOKIE VALIDATION
        // ======================================================

        const cookies =
          await page.cookies();

        const live =
          cookies.find(
            c =>
              c.name ===
              'live_ssoprovider_session'
          );

        const spx =
          cookies.find(
            c =>
              c.name ===
              'spxlrn_session'
          );

        addLog(
          `Cookie check: live=${!!live}, spxlrn=${!!spx}`
        );

        if (
          !live ||
          !spx
        ) {
          throw new Error(
            'Login failed - no valid cookies found'
          );
        }

        const cookieString =
          `live_ssoprovider_session=${live.value}; spxlrn_session=${spx.value}`;

        addLog(
          'Login successful, cookies validated.'
        );


        // ======================================================
        // TRIGGER MODERN HOMEWORK REQUEST
        // ======================================================

        addLog(
          '[Sparx Packages] Reloading authenticated Maths page...'
        );

        try {

          await page.reload({
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });

          addLog(
            `[Sparx Packages] Authenticated Maths page reloaded: ${page.url()}`
          );

        } catch (error) {

          addLog(
            `[Sparx Packages] Maths reload warning: ${error.message}`
          );

        }

        addLog(
          '[Sparx Packages] Waiting for ListStudentPackages response...'
        );

        await delay(10000);

        addLog(
          `[Sparx Packages] Final browser URL: ${page.url()}`
        );


        // ======================================================
        // ENTER THE PACKAGE VIA REAL MOUSE CLICK
        //
        // The homework card is a React node. Programmatic .click()
        // on the wrapper is ignored by React's synthetic event
        // system. A real mouse event dispatched at the card's
        // on-screen coordinates triggers the route transition.
        // ======================================================

        try {

          const firstPackageId =
            '92078a5d-1e9d-4b32-8987-ca6a14b63fcc';

          addLog(
            `[Sparx Detail] Finding homework card for ${firstPackageId}`
          );

          await page.goto(
            'https://maths.sparx-learning.com/student/homework?pkg_type=homework',
            { waitUntil: 'networkidle2', timeout: 30000 }
          );
          await delay(4000);

          const cardBox =
            await page.evaluate(uuid => {
              function bboxFor(el) {
                const r = el.getBoundingClientRect();
                if (r.width < 20 || r.height < 20) return null;
                return {
                  x: r.x + r.width / 2,
                  y: r.y + r.height / 2,
                  w: Math.round(r.width),
                  h: Math.round(r.height)
                };
              }

              // 1. any node with the uuid in any attribute
              const all = [...document.querySelectorAll('*')];
              for (const n of all) {
                const attrs = n.getAttributeNames?.() || [];
                for (const k of attrs) {
                  const v = n.getAttribute(k);
                  if (v && v.includes(uuid)) {
                    const b = bboxFor(n);
                    if (b) return { hit: 'uuid-attr', attr: k, tag: n.tagName, box: b };
                  }
                }
              }

              // 2. anchor href containing uuid
              for (const a of document.querySelectorAll('a[href]')) {
                if (a.href.includes(uuid)) {
                  const b = bboxFor(a);
                  if (b) return { hit: 'anchor', href: a.href, box: b };
                }
              }

              // 3. fallback: first visible card-shaped element with "due"
              const cards = [...document.querySelectorAll('div,article,li')]
                .filter(n => {
                  const t = (n.innerText || '');
                  return /due/i.test(t) && t.length < 400;
                });
              for (const c of cards) {
                const b = bboxFor(c);
                if (b) return { hit: 'due-card', tag: c.tagName, box: b };
              }

              return null;
            }, firstPackageId);

          addLog(
            `[Sparx Detail] card box: ${JSON.stringify(cardBox)}`
          );

          if (cardBox) {

            await page.mouse.move(cardBox.box.x, cardBox.box.y);
            await delay(150);
            await page.mouse.click(cardBox.box.x, cardBox.box.y);

            addLog(
              `[Sparx Detail] real mouse click at ${cardBox.box.x},${cardBox.box.y}`
            );

            await delay(8000);

            addLog(
              `[Sparx Detail] after mouse click URL: ${page.url()}`
            );

            const routeOk =
              page.url().includes(`/student/homework/${firstPackageId}`);
            addLog(`[Sparx Detail] route entered package? ${routeOk}`);

            if (routeOk) {
              const startBox = await page.evaluate(() => {
                const nodes =
                  [...document.querySelectorAll('button, a, [role="button"]')];
                const hit = nodes.find(n => {
                  const t = (n.innerText || '').trim();
                  return /^(start|continue|resume|begin)\b/i.test(t) && !n.disabled;
                });
                if (!hit) return null;
                const r = hit.getBoundingClientRect();
                if (r.width < 10 || r.height < 10) return null;
                return {
                  x: r.x + r.width / 2,
                  y: r.y + r.height / 2,
                  text: (hit.innerText || '').trim()
                };
              });
              addLog(
                `[Sparx Detail] start button: ${JSON.stringify(startBox)}`
              );
              if (startBox) {
                await page.mouse.move(startBox.x, startBox.y);
                await delay(150);
                await page.mouse.click(startBox.x, startBox.y);
                addLog(`[Sparx Detail] clicked Start`);
                await delay(10000);
                addLog(
                  `[Sparx Detail] post-start URL: ${page.url()}`
                );
              }
            }

          } else {

            addLog('[Sparx Detail] no card found; dumping page state');

            const state = await page.evaluate(() => ({
              url: location.href,
              buttons:
                [...document.querySelectorAll('button,a,[role=button]')]
                  .map(b => ({
                    t: (b.innerText || '').trim().slice(0, 60),
                    href: b.href || null
                  }))
                  .filter(x => x.t),
              bodyHead: (document.body.innerText || '').slice(0, 600)
            }));

            addLog(
              `[Sparx Detail] page state: ${JSON.stringify(state)}`
            );
          }

        } catch (error) {

          addLog(
            `[Sparx Detail] real-click enter failed: ${error.message}`
          );

        }


        // ======================================================
        // CLOSE BROWSER AND RETURN COOKIES
        // ======================================================

        await browser.close();

        browser =
          null;

        return cookieString;

      } catch (err) {

        const attemptMsg =
          `Attempt ${attempt} failed: ${err.message}`;

        console.log(
          attemptMsg
        );

        addLog(
          attemptMsg
        );

        if (browser) {
          await browser.close()
            .catch(() => {});

          browser =
            null;
        }

        emailTypeStatus =
          smartLoginVar.filledEmail;

        passTypeStatus =
          smartLoginVar.filledPassword;

        return {
          status: 'error',
          schoolStatus,
          loginTypeStatus,
          emailTypeStatus,
          passTypeStatus
        };
      }

    } catch (err) {

      console.error(
        '[Sparx Login] Unexpected error:',
        err
      );

      return {
        status: 'error',
        schoolStatus: false,
        loginTypeStatus: false,
        emailTypeStatus: false,
        passTypeStatus: false
      };
    }
  }
}


// ============================================================
// GET SPARX TOKEN
// ============================================================

async function getTokenSparx(
  school,
  email,
  password,
  loginType,
  app,
  on2FA
) {
  const cookiesString =
    await getCookies(
      school,
      email,
      password,
      loginType,
      app,
      on2FA
    );

  if (
    !cookiesString ||
    cookiesString?.status ===
      'error'
  ) {
    return cookiesString;
  }

  console.log(
    'Starting Sparx token request...'
  );

  const token =
    await getTokenRequest(
      cookiesString
    );

  console.log(
    `Sparx token response received: ${
      token
        ? `length=${String(token).length}`
        : 'NULL'
    }`
  );

  return {
    token,
    cookies:
      cookiesString
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getTokenSparx,
  getTokenRequest
};