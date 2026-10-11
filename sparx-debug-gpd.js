/*
 * One-shot GetPackageData fuzzer.
 *
 * Runs the sparx maths session, then tries every plausible
 * PackageDataRequest flag/value combination against
 * Sparxweb/GetPackageData. Logs which one returns grpc-status 0.
 *
 * Delete this file when done.
 */

const { createClient } = require('@supabase/supabase-js');
const { decode, encode } = require('./sparx/sm_code.js');
const { getTokenSparx } = require('./sparx/puppeteer.js');
const curlRequesticator = require('./utils/curlRequesticator');
const { getClientSession } = require('./sparx/send_maths.js');

async function main() {

    const school = process.env.DEBUG_SPARX_SCHOOL;
    const email = process.env.DEBUG_SPARX_EMAIL;
    const password = process.env.DEBUG_SPARX_PASSWORD;
    const pkgID = process.env.DEBUG_PACKAGE_ID;

    if (!school || !email || !password || !pkgID) {
        console.log('[GPD-FUZZ] missing env vars; skipping');
        return;
    }

    console.log('[GPD-FUZZ] starting');

    const loginResult = await getTokenSparx(
        school, email, password, 'Normal', 'maths'
    );

    if (!loginResult || !loginResult.token) {
        console.log('[GPD-FUZZ] login failed');
        return;
    }

    const token = loginResult.token;
    const cookies = loginResult.cookies;

    const rc = new curlRequesticator(cookies);

    rc.headers = [
        'accept: */*',
        'accept-language: en-GB,en;q=0.9',
        `authorization: ${token}`,
        'content-type: application/grpc-web+proto',
        'origin: https://maths.sparx-learning.com',
        'referer: https://maths.sparx-learning.com/',
        'x-grpc-web: 1'
    ];

    // get a session id
    const sessionBody = Buffer.from([0,0,0,0,0]);
    const sessionResp = await rc.sendRequest(
        'https://api.sparx-learning.com/sparx.messaging.server.v1.SWServerSession/ClientSession',
        sessionBody
    );

    const sessionBytes = new Uint8Array(sessionResp.data).slice(5);
    const sessionDecoded = await decode(sessionBytes, 'ClientSessionResponse');
    const sessionId = sessionDecoded.sessionId;

    console.log('[GPD-FUZZ] session id:', sessionId);

    rc.headers.push(`x-session-id: ${sessionId}`);

    const variants = [];

    // try both UUID forms
    for (const idForm of [pkgID, `packages/${pkgID}`]) {
        // try both flags for includeAllActivePackages
        for (const includeAll of [false, true]) {
            // try both getPackages values
            for (const getPackages of [false, true]) {
                // try both getTasks values
                for (const getTasks of [false, true]) {
                    // only include the always-true combination once
                    if (!getTasks) continue;

                    variants.push({
                        includeAllActivePackages: includeAll,
                        getPackages,
                        getTasks,
                        getTaskItems: false,
                        packageID: idForm,
                        taskIndex: 0,
                        taskItemIndex: 0
                    });
                }
            }
        }
    }

    const gpdUrl =
        'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetPackageData';

    for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];

        console.log(
            `[GPD-FUZZ] ${i + 1}/${variants.length}:`,
            JSON.stringify(variant)
        );

        let encoded;
        try {
            encoded = await encode(variant, 'PackageDataRequest');
        } catch (e) {
            console.log('[GPD-FUZZ] encode failed:', e.message);
            continue;
        }

        // gRPC-Web frame
        const header = Buffer.alloc(5);
        header.writeUInt8(0, 0);
        header.writeUInt32BE(encoded.length, 1);
        const body = Buffer.concat([header, encoded]);

        try {
            const resp = await rc.sendRequest(gpdUrl, body);
            const status =
                resp?.headers?.['grpc-status'] || 'n/a';
            const message =
                resp?.headers?.['grpc-message'] || 'n/a';
            console.log(
                `[GPD-FUZZ] result: grpc-status=${status} grpc-message=${message}`
            );

            if (status === '0') {
                console.log(
                    '[GPD-FUZZ] *** WORKING VARIANT ***'
                );
                console.log(
                    '[GPD-FUZZ]',
                    JSON.stringify(variant, null, 2)
                );
                return;
            }
        } catch (e) {
            console.log('[GPD-FUZZ] request error:', e.message);
        }
    }

    console.log('[GPD-FUZZ] no working variant found');
}

module.exports = main;