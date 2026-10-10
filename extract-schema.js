/*
 * One-shot schema extractor (curl_cffi edition).
 *
 * Uses the bot's own requesticator to fetch the sparx maths
 * bundle. Runs when EXTRACT_SCHEMA=1 and, if cookies are
 * available, when the first sparx maths session starts.
 *
 * Delete this file (and its require in index.js) when done.
 */

const curlRequesticator =
    require('./utils/curlRequesticator');

const TARGETS = [
    'PackageCompletion',
    'sparx.packages.v1.Package',
    'sparxweb.Package',
    'sparx.packages.v1.Task',
    'sparx.packages.v1.TaskItem',
    'google.protobuf.Timestamp'
];

let done = false;

function extractSuperCalls(source, name) {
    const out = [];
    let idx = 0;
    while (true) {
        const start = source.indexOf(`"${name}"`, idx);
        if (start === -1) break;

        const superIdx = source.lastIndexOf('super(', start);
        if (superIdx === -1) { idx = start + 1; continue; }

        const bracketStart = source.indexOf('[', start);
        if (bracketStart === -1) { idx = start + 1; continue; }

        let depth = 0, end = -1;
        for (let i = bracketStart; i < source.length; i++) {
            const c = source[i];
            if (c === '[') depth++;
            else if (c === ']') {
                depth--;
                if (depth === 0) { end = i + 1; break; }
            }
        }
        if (end === -1) { idx = start + 1; continue; }

        out.push(source.slice(superIdx, end));
        idx = end;
    }
    return out;
}

function extractFromHtml(html) {
    const re = /src="([^"]+\.js[^"]*)"/g;
    const urls = new Set();
    let m;
    while ((m = re.exec(html)) !== null) {
        const u = m[1];
        urls.add(
            u.startsWith('http')
                ? u
                : new URL(
                    u,
                    'https://maths.sparx-learning.com/'
                ).toString()
        );
    }
    return Array.from(urls);
}

async function extract(cookies) {

    if (done) return;
    done = true;

    console.log('[ExtractSchema] starting');
    console.log(
        `[ExtractSchema] cookies present: ${cookies ? 'yes' : 'no'}`
    );

    if (!cookies) {
        console.log(
            '[ExtractSchema] no cookies; skipping. call after sparx login.'
        );
        return;
    }

    const rc = new curlRequesticator(cookies);

    const chromeHeaders = [
        'accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language: en-GB,en;q=0.9',
        'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    ];

    let html;
    try {
        const res = await rc._executeCurl(
            'https://maths.sparx-learning.com/student',
            chromeHeaders,
            null,
            { responseType: 'arraybuffer', returnHeaders: true }
        );
        console.log(
            `[ExtractSchema] html status: ${res && res.status}`
        );
        html = Buffer.isBuffer(res.data)
            ? res.data.toString('utf8')
            : String(res.data);
    } catch (err) {
        console.log(
            '[ExtractSchema] html fetch failed:',
            err.message
        );
        return;
    }

    const urls = extractFromHtml(html);
    console.log(
        `[ExtractSchema] ${urls.length} script(s) to inspect`
    );

    const found = new Set();

    for (const url of urls) {
        let src;
        try {
            const res = await rc._executeCurl(
                url,
                chromeHeaders,
                null,
                { responseType: 'arraybuffer', returnHeaders: true }
            );
            src = Buffer.isBuffer(res.data)
                ? res.data.toString('utf8')
                : String(res.data);
            console.log(
                `[ExtractSchema] ${url} -> ${src.length} chars`
            );
        } catch (err) {
            console.log(
                `[ExtractSchema] skip ${url}: ${err.message}`
            );
            continue;
        }

        for (const target of TARGETS) {
            const hits = extractSuperCalls(src, target);
            for (const hit of hits) {
                const key = `${target}::${hit.length}`;
                if (found.has(key)) continue;
                found.add(key);
                console.log(
                    `[ExtractSchema] === ${target} ===`
                );
                console.log(hit);
            }
        }
    }

    console.log(
        `[ExtractSchema] done, ${found.size} unique hit(s)`
    );
}

module.exports = { extract };