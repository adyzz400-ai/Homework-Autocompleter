/*
 * One-shot schema extractor.
 *
 * Fetches the sparx maths web bundle, greps for the
 * `super("...")` protobuf message definitions, and logs
 * them. Runs once at startup when EXTRACT_SCHEMA=1 is set.
 *
 * Delete this file (and its require in index.js) when done.
 */

const https = require('https');
const { URL } = require('url');

const TARGETS = [
    'PackageCompletion',
    'sparx.packages.v1.Package',
    'sparxweb.Package',
    'sparx.packages.v1.Task',
    'sparx.packages.v1.TaskItem',
    'google.protobuf.Timestamp'
];

function fetchText(url, depth = 0) {
    if (depth > 6) return Promise.reject(
        new Error('too many redirects')
    );
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'accept-language': 'en-GB,en;q=0.9'
            }
        }, (res) => {
            if (
                res.statusCode >= 300 &&
                res.statusCode < 400 &&
                res.headers.location
            ) {
                res.resume();
                return fetchText(
                    new URL(
                        res.headers.location,
                        url
                    ).toString(),
                    depth + 1
                ).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(
                    new Error(
                        `HTTP ${res.statusCode} for ${url}`
                    )
                );
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () =>
                resolve(Buffer.concat(chunks).toString('utf8'))
            );
        }).on('error', reject);
    });
}

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

async function main() {
    console.log('[ExtractSchema] starting');

    let html;
    try {
        html = await fetchText(
            'https://maths.sparx-learning.com/student'
        );
    } catch (err) {
        console.log(
            '[ExtractSchema] html fetch failed:',
            err.message
        );
        return;
    }

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

    console.log(
        `[ExtractSchema] ${urls.size} script(s) to inspect`
    );

    const found = new Set();

    for (const url of urls) {
        let src;
        try {
            src = await fetchText(url);
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

        // Also look for className maps
        const mapHits = src.match(
            /className\s*=\s*\{[\s\S]{0,4000}\}/g
        );
        if (mapHits) {
            for (const hit of mapHits) {
                const key = `MAP::${hit.length}`;
                if (found.has(key)) continue;
                found.add(key);
                console.log(
                    `[ExtractSchema] === className map ===`
                );
                console.log(hit.slice(0, 4000));
            }
        }
    }

    console.log(
        `[ExtractSchema] done, ${found.size} unique hit(s)`
    );
}

module.exports = main;
