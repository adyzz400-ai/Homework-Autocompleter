const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
require('dotenv').config();
const { execSync } = require('child_process');

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

      const requesticator = new curlRequesticator(cookies);

      const headers = [
        "accept: */*",
        "accept-language: en-GB,en;q=0.9",
        "content-type: application/json",
        "Referer: https://app.sparx-learning.com/"
      ];

      const response = await requesticator._executeCurl(
        "https://api.sparx-learning.com/token",
        headers
      );

      if (response === null || response === undefined) {
        throw new Error("Empty response from Sparx token endpoint");
      }

      const token =
        typeof response === "string"
          ? response.trim()
          : JSON.stringify(response);

      if (!token) {
        throw new Error("Sparx token response was empty");
      }

      console.log(
        `[Sparx Token] Token response received (${token.length} chars)`
      );

      return token;

    } catch (error) {
      console.error(
        `[Sparx Token] Attempt ${attempt} failed: ${error.message}`
      );

      if (attempt < attempts) {
        console.log("[Sparx Token] Retrying in 1.5 seconds...");
        await delay(1500);
      }
    }
  }

  console.error("[Sparx Token] All token request attempts failed.");
  return null;
}


// ============================================================
// VIDEO CONVERTER
// ============================================================

async function convertWebmToMp4(vid_path) {
  try {
    const mp4Path =
      vid_path.replace('.webm', '.mp4');

    await execAsync(
      `ffmpeg -i "${vid_path}" -c:v libx264 -preset ultrafast -movflags faststart "${mp4Path}"`
    );

    fs.unlinkSync(vid_path);

    return mp4Path;

  } catch (err) {
    console.log(
      'Video conversion failed:',
      err.message
    );

    return vid_path;
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
  const start = Date.now();

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

async function findSchoolInput(page, timeout = 30000) {
  const selectors = [
    'input[placeholder*="Start typing your school" i]',
    'input[placeholder*="school" i]',
    'input[aria-label*="school" i]',
    'input[name*="school" i]'
  ];

  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, {
        timeout: 10000,
        visible: false
      });

      await page.waitForFunction(
        selector => {
          const el = document.querySelector(selector);

          if (!el) return false;

          const style = window.getComputedStyle(el);

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

      const input = await page.$(selector);

      if (input) {
        console.log(
          `Found school input using selector: ${selector}`
        );

        return input;
      }

    } catch {}
  }

  // Diagnostic information if Sparx changed the input.
  const diagnostics = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    readyState: document.readyState,

    inputs: [...document.querySelectorAll('input')]
      .map(el => ({
        type: el.type,
        placeholder: el.placeholder || '',
        ariaLabel:
          el.getAttribute('aria-label') || '',
        name: el.name || '',
        id: el.id || '',
        disabled: el.disabled,
        visible:
          !!(
            el.offsetWidth ||
            el.offsetHeight ||
            el.getClientRects().length
          )
      })),

    bodyText:
      document.body?.innerText?.slice(0, 1500) || ''
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

async function selectSchoolResult(page, school, timeout = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const result = await page.$(
        'div[class*="SchoolResult_"]'
      );

      if (!result) {
        await delay(200);
        continue;
      }

      const details = await result.evaluate(el => ({
        text: el.innerText?.trim() || '',
        className: el.className,
        visible: el.offsetParent !== null
      }));

      if (
        !details.visible ||
        !details.text
          .toLowerCase()
          .includes(school.trim().toLowerCase())
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

    } catch (err) {
      await delay(200);
    }
  }

  throw new Error(
    `School result for "${school}" was not found`
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

    let schoolStatus = false;
    let loginTypeStatus = false;
    let emailTypeStatus = false;
    let passTypeStatus = false;

    let smartLoginVar = {
      filledEmail: false,
      filledPassword: false
    };

    let browser;
    let page;
    let recorder = null;

    let vid_path =
      `videos/recording-${Date.now()}.webm`;

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


      // --------------------------------------------------------
      // Existing page setup
      // --------------------------------------------------------

      await page.evaluateOnNewDocument(() => {
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
            get: () => [1, 2, 3, 4, 5]
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
          window.navigator.permissions.query;

        window.navigator.permissions.query =
          parameters =>
            parameters.name ===
            'notifications'
              ? Promise.resolve({
                  state:
                    Notification.permission
                })
              : originalQuery(parameters);

        Object.defineProperty(
          navigator,
          'platform',
          {
            get: () => 'Win32'
          }
        );
      });


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


      // --------------------------------------------------------
      // Screencast
      // --------------------------------------------------------

      if (page.screencast) {
        recorder =
          await page.screencast({
            path: vid_path
          }).catch(() => null);

        if (recorder) {
          addLog(
            `Screencast started -> ${vid_path}`
          );
        }
      }


      // --------------------------------------------------------
      // SCHOOL PAGE
      // --------------------------------------------------------

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


      await page.evaluate(() => {
        const el =
          document.getElementById(
            'cookiescript_injected_wrapper'
          );

        if (el) {
          el.remove();
        }
      }).catch(() => {});


      // --------------------------------------------------------
      // IMPORTANT FIX:
      // Don't keep the original ElementHandle.
      // Sparx can re-render the input.
      // --------------------------------------------------------

      const schoolInput = await findSchoolInput(
  page,
  30000
);

addLog(
  'Found Sparx school search input.'
);

addLog(
  'About to inspect school input...'
);

const schoolInputInfo =
  await schoolInput.evaluate(el => ({
    value: el.value || '',
    placeholder: el.placeholder || '',
    disabled: el.disabled,
    visible: !!(
      el.offsetWidth ||
      el.offsetHeight ||
      el.getClientRects().length
    )
  }));

addLog(
  `School input state: ${JSON.stringify(schoolInputInfo)}`
);

addLog(
  'About to type school name...'
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


const selectedSchoolDiagnostic = await page.evaluate(() => {
  const elements = [...document.querySelectorAll('*')];

  return elements
    .filter(el => {
      const text = el.innerText?.trim() || '';

      return (
        text === 'Heston Community School' ||
        text.startsWith('Heston Community School')
      );
    })
    .slice(0, 10)
    .map(el => ({
      tag: el.tagName,
      text: el.innerText?.trim(),
      role: el.getAttribute('role'),
      ariaSelected: el.getAttribute('aria-selected'),
      className: el.className,
      disabled: el.disabled ?? null
    }));
});

addLog(
  `Selected school diagnostic: ${JSON.stringify(selectedSchoolDiagnostic)}`
);

const schoolState = await page.evaluate(() => {
  const input = document.querySelector(
    'input[placeholder*="Start typing your school"]'
  );

  const buttons = [...document.querySelectorAll('button')];

  const continueButton = buttons.find(
    b => b.innerText?.trim() === 'Continue'
  );

  return {
    inputValue: input?.value || '',
    continueDisabled: continueButton?.disabled ?? null,
    continueAriaDisabled:
      continueButton?.getAttribute('aria-disabled') || null
  };
});

addLog(
  `School selection state: ${JSON.stringify(schoolState)}`
);

// Your existing Continue-button code comes after this

      schoolStatus = true;


      // --------------------------------------------------------
      // CONTINUE BUTTON DIAGNOSTIC
      // --------------------------------------------------------

addLog('Preparing to click Continue...');

// Capture JavaScript errors from the Sparx page.
page.on('pageerror', err => {
  addLog(`PAGE ERROR: ${err.message}`);
});

page.on('console', msg => {
  if (msg.type() === 'error') {
    addLog(`BROWSER CONSOLE ERROR: ${msg.text()}`);
  }
});

const continueButtons =
  await page.$$('button');

let continueButton = null;

for (const button of continueButtons) {
  const text = await button.evaluate(
    el => el.innerText?.trim()
  );

  if (
    text?.toLowerCase() === 'continue'
  ) {
    continueButton = button;
    break;
  }
}

if (!continueButton) {
  throw new Error(
    'Continue button was not found.'
  );
}

const continueState = await continueButton.evaluate(el => ({
  text: el.innerText?.trim(),
  disabled: el.disabled,
  type: el.getAttribute('type'),
  className: el.className,
  outerHTML: el.outerHTML,
  formAction: el.form?.action || null,
  formMethod: el.form?.method || null
}));

addLog(
  `Continue state: ${JSON.stringify(continueState)}`
);

if (continueState.text !== 'Continue') {
  throw new Error(
    `Expected Continue button, found "${continueState.text}".`
  );
}

if (continueState.disabled) {
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

const oldUrl = page.url();

await Promise.all([
  page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout: 15000
  }).catch(() => null),

  continueButton.click()
]);

await delay(1000);

const newUrl = page.url();

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
  () => document.readyState !== 'loading',
  {
    timeout: 10000
  }
).catch(() => {});

addLog(
  `Destination page ready: ${page.url()}`
);

addLog(
  `Post-click URL: ${page.url()}`
);

addLog(
  `Post-click title: ${await page.title()}`
);


if (
  page.url().includes(
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

      // --------------------------------------------------------
      // COOKIE POPUP
      // --------------------------------------------------------

      try {
        await page.waitForSelector(
          '#cookiescript_injected_wrapper',
          {
            timeout: 5000
          }
        );

        await page.evaluate(() => {
          const el =
            document.getElementById(
              'cookiescript_injected_wrapper'
            );

          if (el) {
            el.remove();
          }
        });

      } catch {}


      // --------------------------------------------------------
      // SSO
      // --------------------------------------------------------

      if (
        loginType &&
        loginType.toLowerCase() !==
          'normal'
      ) {
        await safeClick(
          page,
          '.sm-button.sso-login-button'
        );

        addLog(
          'Clicked SSO login button.'
        );

        loginTypeStatus = true;


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

        // ------------------------------------------------------
        // NORMAL LOGIN
        // ------------------------------------------------------

        const inputs =
          await page.$$('.sm-input');

        if (inputs.length < 2) {
          throw new Error(
            'Normal login inputs not found.'
          );
        }


        const emailValue =
          await inputs[0].evaluate(
            el => el.value || ''
          );


        if (!emailValue.trim()) {
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


        emailTypeStatus = true;


        const passValue =
          await inputs[1].evaluate(
            el => el.value || ''
          );


        if (!passValue.trim()) {
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


        passTypeStatus = true;
        loginTypeStatus = true;


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


      // --------------------------------------------------------
      // SESSION
      // --------------------------------------------------------

      await delay(1500);


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


      const cookieString =
        `live_ssoprovider_session=${live?.value || ''}; spxlrn_session=${spx?.value || ''}`;


      if (
        cookieString.length <= 42
      ) {
        throw new Error(
          'Login failed - no valid cookies found'
        );
      }


      if (recorder) {
        await recorder.stop();
      }


      await browser.close();


      if (
        fs.existsSync(vid_path)
      ) {
        convertWebmToMp4(
          vid_path
        ).catch(console.error);
      }


      addLog(
        'Login successful, cookies validated.'
      );


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


      if (recorder) {
        await recorder.stop()
          .catch(() => {});
      }


      if (browser) {
        await browser.close()
          .catch(() => {});
      }


      if (
        fs.existsSync(vid_path)
      ) {
        vid_path =
          await convertWebmToMp4(
            vid_path
          );
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
        passTypeStatus,
        vid_path
      };

    } finally {

      if (
        browser &&
        browser.isConnected()
      ) {
        await browser.close()
          .catch(() => {});
      }
    }
  }
}


// ============================================================
// EXPORTED
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
    cookiesString?.status === 'error'
  ) {
    return cookiesString;
  }


  console.log('Starting Sparx token request...');

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
    cookies: cookiesString
  };
}


module.exports = {
  getTokenSparx,
  getTokenRequest
};