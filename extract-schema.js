/*
 * One-shot schema extractor (curl_cffi edition).
 *
 * Fetches the sparx maths web bundle through the bot's own
 * authenticated session, then probes the JS for protobuf
 * schema definitions. Modern Rolldown / Vite builds do not
 * use `super("...")`, so we run wider probes instead.
 *
 * Delete this file (and its hook in sparx/maths.js) when done.
 */

const curlRequesticator =
    require('./utils/curlRequesticator');

/*
 * Targets we look for, in the priority order we want them
 * printed. The exact class name in the build may differ
 * (PackageCompletion, Package, PackageSummary, ...) — the
 * extractor prints excerpts around every occurrence so we can
 * see which one actually has the field definitions.
 */
const TARGETS = [
    'sparx.packageactivity.v1.PackageCompletion',
    'sparx.packages.v1.PackageCompletion',
    'sparx.packageactivity.v1.Package',
    'sparx.packages.v1.Package',
    'PackageCompletion',
    'sparxweb.Package',
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

function probeMarkers(src, url) {
    const markers = [
        'MessageType',
        'fieldNo',
        'wireType',
        'toBinary',
        'fromBinary',
        'PackageCompletion',
        'packageactivity',
        'ListStudentPackages',
        'numTaskItems',
        'numTaskItemsDone',
        'numTasks',
        'numTasksComplete'
    ];
    const summary = [];
    for (const marker of markers) {
        const n =
            (src.match(new RegExp(marker, 'g')) || []).length;
        if (n > 0) summary.push(`${marker} x${n}`);
    }
    if (summary.length) {
        console.log(
            `[ExtractSchema] markers in ${url}: ${summary.join(', ')}`
        );
    }
}

function probeExcerpts(src, url, found) {

    for (const target of TARGETS) {

        let idx = 0;
        let printed = 0;

        while (true) {
            const at = src.indexOf(target, idx);
            if (at === -1) break;
            idx = at + target.length;

            // Slice a generous window around the hit so we catch
            // either a super(...) call, a new MessageType(...)
            // call, or a class body that references the name.
            const before = Math.max(0, at - 400);
            const after = Math.min(
                src.length,
                at + target.length + 1400
            );
            const excerpt = src.slice(before, after);

            const key =
                `${url}::${target}::${at}`;
            if (found.has(key)) continue;
            found.add(key);

            console.log(
                `[ExtractSchema] === ${target} @ ${at} in ${url} ===`
            );
            console.log(excerpt);

            printed++;
            if (printed >= 3) break;
            if (found.size > 120) return;
        }
    }
}

function probeSuperCalls(src, url, found) {
    // Legacy pattern: super("name", [ {no:...}, ... ]).
    for (const target of TARGETS) {
        const hits = extractSuperCalls(src, target);
        for (const hit of hits) {
            const key = `${url}::super::${target}::${hit.length}`;
            if (found.has(key)) continue;
            found.add(key);
            console.log(
                `[ExtractSchema] === super() hit: ${target} ===`
            );
            console.log(hit);
            if (found.size > 120) return;
        }
    }
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
            '[ExtractSchema] no cookies; skipping.'
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

        // Sanity: what protobuf-ish markers exist in this file?
        probeMarkers(src, url);

        // Legacy super(...) form.
        probeSuperCalls(src, url, found);

        // Modern MessageType / class-body form: print excerpts
        // around every occurrence of the target names.
        probeExcerpts(src, url, found);

        if (found.size > 120) {
            console.log(
                '[ExtractSchema] cap reached, stopping early'
            );
            break;
        }
    }

    console.log(
        `[ExtractSchema] done, ${found.size} unique hit(s)`
    );
}

module.exports = { extract };