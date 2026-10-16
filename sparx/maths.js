const { decode, encode } = require('./sm_code.js');

const {
    getClientSession
} = require('./send_maths.js');

const {
    getTokenSparx,
    getTokenRequest
} = require('./puppeteer.js');

const SparxBase =
    require('./sparxBase.js');

class SparxMaths extends SparxBase {

    constructor(
        authToken,
        login = {},
        cookies
    ) {
        super(
            authToken,
            login,
            cookies,
            decode,
            encode
        );
    }

    async send(
        url,
        uint8Array,
        attempts = 3
    ) {

        try {

            this.log.logToFile(
                `Sending request to ${url}`
            );

            const response =
                await this.curlRequests.sendRequest(
                    url,
                    uint8Array
                );

            this.log.logToFile(
                `**Response returned**\nStatus: ${response.status}\n${JSON.stringify(
                    response.headers,
                    null,
                    2
                )}`
            );

            if (
                response.status === 401
            ) {

                console.log(
                    '[Sparx] HTTP 401'
                );

                const err =
                    new Error(
                        'Unauthorized'
                    );

                err.response = {
                    status: 401
                };

                throw err;
            }

            const grpcStatus =
                response.headers?.[
                    'grpc-status'
                ];

            const grpcMessage =
                response.headers?.[
                    'grpc-message'
                ] || '';

            if (
                grpcStatus === '16' ||
                grpcStatus === '9' ||
                grpcStatus === '7'
            ) {

                if (
                    grpcMessage ===
                    'TaskItemHidden'
                ) {

                    this.log.logToFile(
                        'Item is hidden.'
                    );

                    return 'break';
                }

                if (
                    grpcMessage.includes(
                        'PendingWAC'
                    )
                ) {

                    this.log.logToFile(
                        'Bookwork check caught.'
                    );

                    return null;
                }

                if (
                    grpcMessage.includes(
                        'SessionInactive'
                    )
                ) {

                    console.log(
                        '[Sparx] Session inactive. Refreshing ClientSession...'
                    );

                    await this.getClientSession();

                    return await this.send(
                        url,
                        uint8Array,
                        attempts
                    );
                }

                const error =
                    new Error(
                        JSON.stringify(
                            response.headers,
                            null,
                            2
                        )
                    );

                error.response = {
                    status: 401
                };

                throw error;
            }

            return response;

        } catch (err) {

            if (
                err.response?.status === 401 &&
                attempts > 1
            ) {

                console.log(
                    '[Sparx] Re-authenticating after 401...'
                );

                let newAuthToken;

                if (
                    this.login?.school
                ) {

                    const result =
                        await getTokenSparx(
                            this.login.school,
                            this.login.email,
                            this.login.password,
                            this.login.loginType,
                            this.login.app
                        );

                    if (
                        result?.cookies
                    ) {

                        this.cookies =
                            result.cookies;

                        this.curlRequests.cookies =
                            result.cookies;
                    }

                    if (
                        result?.token &&
                        !result.token.includes(
                            'Unauthorized'
                        )
                    ) {

                        newAuthToken =
                            result.token;
                    }

                } else {

                    newAuthToken =
                        await getTokenRequest(
                            this.cookies
                        );

                    if (
                        newAuthToken.includes(
                            'Unauthorized'
                        )
                    ) {

                        throw err;
                    }
                }

                if (
                    newAuthToken
                ) {

                    this.authToken =
                        newAuthToken;

                    this.curlRequests.headers =
                        this.curlRequests.headers.map(
                            header => {

                                if (
                                    header
                                        .toLowerCase()
                                        .startsWith(
                                            'authorization:'
                                        )
                                ) {

                                    return `authorization: ${this.authToken}`;
                                }

                                return header;
                            }
                        );

                    await this.getClientSession();

                    console.log(
                        '[Sparx] ClientSession refreshed.'
                    );
                }

                return await this.send(
                    url,
                    uint8Array,
                    attempts - 1
                );
            }

            if (
                attempts > 1
            ) {

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            1500
                        )
                );

                return await this.send(
                    url,
                    uint8Array,
                    attempts - 1
                );
            }

            throw err;
        }
    }

    async getClientSession() {

        console.log(
            '[Sparx ClientSession] Sending request...'
        );

        const responseBuffer =
            await getClientSession(
                this.curlRequests
            );

        const response =
            await this.decodeStuff(
                responseBuffer,
                'ClientSessionResponse'
            );

        if (
            !response ||
            !response.sessionId
        ) {

            throw new Error(
                'Sparx ClientSession did not return a session ID.'
            );
        }

        this.sessionId =
            response.sessionId;

        this.curlRequests.headers =
            this.curlRequests.headers.filter(
                header =>
                    !header
                        .toLowerCase()
                        .startsWith(
                            'x-session-id:'
                        )
            );

        this.curlRequests.headers.push(
            `x-session-id: ${this.sessionId}`
        );

        console.log(
            '[Sparx ClientSession] Session ID installed.'
        );

        return this.sessionId;
    }

    /* ------------------------------------------------------------------ */
    /*  Pure-JS protobuf raw walker                                       */
    /* ------------------------------------------------------------------ */

    readVarint(buf, offset) {
        let result = 0n;
        let shift = 0n;
        let pos = offset;
        while (pos < buf.length) {
            const byte = buf[pos++];
            result |= BigInt(byte & 0x7f) << shift;
            if ((byte & 0x80) === 0) break;
            shift += 7n;
            if (shift > 70n) throw new Error('varint too long');
        }
        return { value: result, next: pos };
    }

    encodeVarintBytes(n) {
        const bytes = [];
        let v = BigInt(n);
        while (v > 0x7fn) {
            bytes.push(Number(v & 0x7fn) | 0x80);
            v >>= 7n;
        }
        bytes.push(Number(v));
        return Buffer.from(bytes);
    }

    walkProtobuf(buf, depth = 0, maxDepth = 6) {
        const fields = [];
        let pos = 0;
        const end = buf.length;

        while (pos < end) {
            try {
                const tagRes = this.readVarint(buf, pos);
                pos = tagRes.next;
                const tag = Number(tagRes.value);
                const fieldNumber = tag >>> 3;
                const wireType = tag & 0x7;

                if (wireType === 0) {
                    const v = this.readVarint(buf, pos);
                    pos = v.next;
                    fields.push({
                        fieldNumber,
                        wireType: 0,
                        value: Number(v.value),
                        big: v.value
                    });
                } else if (wireType === 1) {
                    if (pos + 8 > end) break;
                    const slice = buf.subarray(pos, pos + 8);
                    pos += 8;
                    const hex = Buffer.from(slice).toString('hex');
                    let asDouble = null;
                    try { asDouble = Buffer.from(slice).readDoubleLE(0); } catch (_) {}
                    fields.push({
                        fieldNumber,
                        wireType: 1,
                        hex,
                        double: asDouble
                    });
                } else if (wireType === 2) {
                    const lenRes = this.readVarint(buf, pos);
                    pos = lenRes.next;
                    const len = Number(lenRes.value);
                    if (len < 0 || pos + len > end) break;
                    const slice = buf.subarray(pos, pos + len);
                    pos += len;

                    let asString = null;
                    try {
                        const s = Buffer.from(slice).toString('utf8');
                        if (
                            s.length > 0 &&
                            !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(s)
                        ) {
                            asString = s;
                        }
                    } catch (_) {}

                    const entry = {
                        fieldNumber,
                        wireType: 2,
                        length: len,
                        string: asString,
                        bytes: null,
                        nested: null
                    };

                    if (!asString && depth < maxDepth && len > 0) {
                        try {
                            entry.nested = this.walkProtobuf(
                                slice,
                                depth + 1,
                                maxDepth
                            );
                        } catch (_) {}
                    }

                    if (!asString && (!entry.nested || entry.nested.length === 0)) {
                        entry.bytes = Buffer.from(slice).toString('base64');
                    }

                    fields.push(entry);
                } else if (wireType === 5) {
                    if (pos + 4 > end) break;
                    const slice = buf.subarray(pos, pos + 4);
                    pos += 4;
                    fields.push({
                        fieldNumber,
                        wireType: 5,
                        hex: Buffer.from(slice).toString('hex')
                    });
                } else {
                    break;
                }
            } catch (_) {
                break;
            }
        }
        return fields;
    }

    timestampFromField(field) {
        if (!field || !field.nested) return null;
        for (const sub of field.nested) {
            if (sub.fieldNumber === 1 && sub.wireType === 0) {
                const secs = sub.value;
                if (
                    typeof secs === 'number' &&
                    secs > 1_600_000_000 &&
                    secs < 2_200_000_000
                ) {
                    return new Date(secs * 1000);
                }
            }
        }
        return null;
    }

    formatDue(date) {
        if (!date) return null;
        const days = [
            'Sunday', 'Monday', 'Tuesday', 'Wednesday',
            'Thursday', 'Friday', 'Saturday'
        ];
        const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        const day = date.getUTCDate();
        const ord =
            day % 10 === 1 && day !== 11 ? 'st' :
            day % 10 === 2 && day !== 12 ? 'nd' :
            day % 10 === 3 && day !== 13 ? 'rd' : 'th';
        let hour = date.getUTCHours();
        const ampm = hour >= 12 ? 'pm' : 'am';
        hour = hour % 12;
        if (hour === 0) hour = 12;
        return `${days[date.getUTCDay()]} ${day}${ord} ${months[date.getUTCMonth()]} ${hour}${ampm}`;
    }

    packagesFromRawWalk(fields) {

        const packages = [];

        for (const top of fields) {

            if (top.fieldNumber !== 1 || !top.nested) continue;

            const pkg = {
                packageID: null,
                title: 'Homework',
                dueText: null,
                dueDate: null,
                startDate: null,
                packageType: null,
                numTaskItems: 0,
                numTaskItemsDone: 0,
                numTasks: 0,
                numTasksComplete: 0,
                percent: 0
            };

            let targetXp = null;
            let doneXp = null;

            for (const f of top.nested) {

                if (f.fieldNumber === 1 && f.string) {
                    const m = f.string.match(
                        /packages\/([0-9a-f-]{36})/i
                    );
                    if (m) pkg.packageID = m[1];
                    continue;
                }

                if (f.fieldNumber === 2 && f.string) {
                    const raw = f.string.trim();
                    const dueMatch = raw.match(/^(.+?)\s+due\s+(.+)$/i);
                    if (dueMatch) {
                        pkg.title =
                            dueMatch[1]
                                .replace(/^[^A-Za-z0-9]+/, '')
                                .trim() || 'Homework';
                        pkg.dueText = dueMatch[2].trim();
                    } else if (raw) {
                        pkg.title = raw;
                    }
                    continue;
                }

                if (f.fieldNumber === 3 && f.string) {
                    pkg.packageType = f.string;
                    continue;
                }

                if (f.fieldNumber === 8 && f.nested) {
                    const d = this.timestampFromField(f);
                    if (d) pkg.startDate = d;
                    continue;
                }

                if (f.fieldNumber === 9 && f.nested) {
                    const d = this.timestampFromField(f);
                    if (d) pkg.dueDate = d;
                    continue;
                }

                if (f.fieldNumber === 6 && f.nested) {
                    for (const s of f.nested) {
                        if (s.fieldNumber === 1 && s.nested) {
                            for (const t of s.nested) {
                                if (
                                    t.fieldNumber === 1 &&
                                    t.wireType === 1 &&
                                    typeof t.double === 'number'
                                ) {
                                    targetXp = t.double;
                                }
                                if (t.fieldNumber === 3 && t.nested) {
                                    let key = null;
                                    let val = null;
                                    for (const u of t.nested) {
                                        if (u.fieldNumber === 1 && u.string) key = u.string;
                                        if (
                                            u.fieldNumber === 2 &&
                                            u.wireType === 1 &&
                                            typeof u.double === 'number'
                                        ) {
                                            val = u.double;
                                        }
                                    }
                                    if (key === 'C' && val != null) doneXp = val;
                                }
                            }
                        }
                    }
                    continue;
                }
            }

            if (pkg.dueDate && !pkg.dueText) {
                pkg.dueText = this.formatDue(pkg.dueDate);
            }

            if (targetXp && targetXp > 0) {
                pkg.numTaskItems = Math.round(targetXp);
                pkg.numTasks = pkg.numTaskItems;
                if (doneXp != null) {
                    pkg.numTaskItemsDone = Math.round(doneXp);
                    pkg.numTasksComplete = pkg.numTaskItemsDone;
                    pkg.percent = Math.min(
                        100,
                        Math.round((doneXp / targetXp) * 100)
                    );
                }
            }

            if (pkg.packageID) {
                packages.push(pkg);
            }
        }

        return packages;
    }

    extractPrintableStringsFromBytes(bytes) {

        const strings = [];
        let current = [];

        const flush = () => {
            if (current.length < 2) {
                current = [];
                return;
            }
            const value =
                Buffer.from(current)
                    .toString('utf8')
                    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
                    .trim();
            if (value.length >= 2) strings.push(value);
            current = [];
        };

        for (const byte of bytes) {
            if (byte >= 32 && byte <= 126) {
                current.push(byte);
            } else {
                flush();
            }
        }
        flush();
        return strings;
    }

    async getHomeworks() {

        console.log('[Sparx] ========================================');
        console.log('[Sparx] MODERN HOMEWORK API');
        console.log('[Sparx] ========================================');

        if (!this.sessionId) {
            console.log('[Sparx] No ClientSession found. Creating one...');
            await this.getClientSession();
        }

        const request = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);

        console.log('[Sparx] Calling ListStudentPackages...');

        const response = await this.send(
            'https://api.sparx-learning.com/maths/sparx.packageactivity.v1.Packages/ListStudentPackages',
            request
        );

        console.log('[Sparx] ListStudentPackages HTTP:', response?.status);
        console.log(
            '[Sparx] ListStudentPackages bytes:',
            response?.data?.length || 0
        );

        if (!response?.data) {
            console.log('[Sparx] ListStudentPackages returned no data.');
            return { packages: [], tasks: [], taskItems: [] };
        }

        let payload = response.data;
        if (!Buffer.isBuffer(payload)) payload = Buffer.from(payload);

        if (payload.length >= 5) {
            const view = new DataView(
                payload.buffer,
                payload.byteOffset,
                payload.byteLength
            );
            const messageLength = view.getUint32(1);
            if (
                payload[0] === 0 &&
                messageLength <= payload.length - 5
            ) {
                payload = payload.subarray(5, 5 + messageLength);
            }
        }

        console.log(
            '[Sparx] payload bytes after gRPC frame:',
            payload.length
        );

        let rawFields = [];
        try {
            rawFields = this.walkProtobuf(payload);
        } catch (err) {
            console.log('[Sparx][RAW] walk failed:', err.message);
        }

        let packages = this.packagesFromRawWalk(rawFields);

        if (packages.length === 0) {
            console.log(
                '[Sparx] raw walk produced 0 packages — string scrape fallback'
            );
            const strings = this.extractPrintableStringsFromBytes(payload);
            let currentPackage = null;
            for (const value of strings) {
                const pkgMatch = value.match(
                    /^[-*]?\s*packages\/([0-9a-f-]{36})/i
                );
                if (pkgMatch) {
                    if (currentPackage) packages.push(currentPackage);
                    currentPackage = {
                        packageID: pkgMatch[1],
                        title: 'Homework',
                        dueText: null,
                        dueDate: null,
                        numTaskItems: 0,
                        numTaskItemsDone: 0,
                        numTasks: 0,
                        numTasksComplete: 0,
                        percent: 0
                    };
                    continue;
                }
                if (!currentPackage) continue;
                const dueMatch = value.match(
                    /^[^A-Za-z0-9]*#?\s*(.+?)\s+due\s+(.+?)\s*$/i
                );
                if (dueMatch && !currentPackage.dueText) {
                    currentPackage.title =
                        dueMatch[1].replace(/^[^A-Za-z0-9]+/, '').trim() ||
                        'Homework';
                    currentPackage.dueText = dueMatch[2].trim();
                    currentPackage.dueDate = this.parseDueText(
                        currentPackage.dueText
                    );
                }
            }
            if (currentPackage) packages.push(currentPackage);
        }

        const uniquePackages = [];
        const seen = new Set();
        for (const pkg of packages) {
            if (!pkg.packageID) continue;
            if (seen.has(pkg.packageID)) continue;
            seen.add(pkg.packageID);
            uniquePackages.push(pkg);
        }

        const now = Date.now();
        const windowStart = now - 14 * 24 * 60 * 60 * 1000;
        const windowEnd = now + 60 * 24 * 60 * 60 * 1000;

        const inWindow = uniquePackages.filter((p) => {
            if (
                p.packageType &&
                p.packageType !== 'homework' &&
                p.packageType !== 'onboarding'
            ) {
                return false;
            }
            if (!p.dueDate) return false;
            const t = p.dueDate.getTime();
            return t >= windowStart && t <= windowEnd;
        });

        const sorted = inWindow.sort(
            (a, b) => a.dueDate.getTime() - b.dueDate.getTime()
        );

        const trimmed = sorted.slice(0, 25);

        console.log(
            '[Sparx] Modern packages found:',
            uniquePackages.length,
            'in-window:',
            inWindow.length,
            'trimmed:',
            trimmed.length
        );

        console.log(
            '[Sparx] Modern packages sample:',
            JSON.stringify(trimmed.slice(0, 10), null, 2)
        );

        return { packages: trimmed, tasks: [], taskItems: [] };
    }

    parseDueText(text) {
        if (!text) return null;
        const cleaned = String(text)
            .replace(
                /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+/i,
                ''
            )
            .trim();
        const monthMap = {
            jan: 0, january: 0, feb: 1, february: 1,
            mar: 2, march: 2, apr: 3, april: 3,
            may: 4, jun: 5, june: 5, jul: 6, july: 6,
            aug: 7, august: 7, sep: 8, sept: 8, september: 8,
            oct: 9, october: 9, nov: 10, november: 10,
            dec: 11, december: 11
        };
        const m = cleaned.match(
            /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s*(.*)?$/i
        );
        if (!m) return null;
        const day = parseInt(m[1], 10);
        const month = monthMap[String(m[2] || '').toLowerCase()];
        if (month === undefined) return null;
        let hour = 0, minute = 0;
        const tail = (m[3] || '').trim();
        const timeMatch = tail.match(
            /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i
        );
        if (timeMatch) {
            hour = parseInt(timeMatch[1], 10);
            minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
            const ampm = (timeMatch[3] || '').toLowerCase();
            if (ampm === 'pm' && hour < 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;
        }
        const now = new Date();
        const year = now.getFullYear();
        let candidate = new Date(year, month, day, hour, minute, 0, 0);
        if (Number.isNaN(candidate.getTime())) return null;
        if (candidate.getTime() < now.getTime()) {
            candidate = new Date(year + 1, month, day, hour, minute, 0, 0);
        }
        return Number.isNaN(candidate.getTime()) ? null : candidate;
    }

    /* ------------------------------------------------------------------ */
    /*  GetPackage — the modern package task endpoint                     */
    /*                                                                    */
    /*  Endpoint: POST /maths/sparx.packageactivity.v1.Packages/GetPackage */
    /*                                                                    */
    /*  Request: proper gRPC-web frame.                                   */
    /*    byte 0: 0x00 (uncompressed)                                     */
    /*    bytes 1-4: big-endian length of the protobuf body               */
    /*    bytes 5+: GetPackageRequest protobuf:                           */
    /*      field 1 (string, "packages/<uuid>") = the package path        */
    /*                                                                    */
    /*  Response: gRPC-web framed protobuf, parsed via walkProtobuf.      */
    /* ------------------------------------------------------------------ */

    buildGetPackageBody(packageID) {
        const pathValue = Buffer.from(
            `packages/${packageID}`,
            'utf8'
        );

        const tag = Buffer.from([0x0a]);
        const lengthVarint =
            this.encodeVarintBytes(pathValue.length);
        const body = Buffer.concat([
            tag,
            lengthVarint,
            pathValue
        ]);

        const header = Buffer.alloc(5);
        header.writeUInt8(0x00, 0);
        header.writeUInt32BE(body.length, 1);

        return Buffer.concat([header, body]);
    }

    async getTasks(packageID) {
        const body = this.buildGetPackageBody(packageID);

        console.log(
            '[getTasks] → POST Packages/GetPackage for',
            `packages/${packageID}`,
            'body bytes =',
            body.length
        );

        const response = await this.send(
            'https://api.sparx-learning.com/maths/sparx.packageactivity.v1.Packages/GetPackage',
            body
        );

        console.log(
            '[getTasks] ← status =',
            response?.status,
            'grpc-status =',
            response?.headers?.['grpc-status'],
            'grpc-message =',
            response?.headers?.['grpc-message'],
            'data bytes =',
            response?.data?.length || 0
        );

        if (!response?.data) {
            return { packages: [], tasks: [], taskItems: [] };
        }

        let payload = response.data;
        if (!Buffer.isBuffer(payload)) payload = Buffer.from(payload);

        if (payload.length >= 5 && payload[0] === 0) {
            const messageLength = payload.readUInt32BE(1);
            if (messageLength <= payload.length - 5) {
                payload = payload.subarray(5, 5 + messageLength);
            }
        }

        console.log(
            '[getTasks] payload bytes after frame strip =',
            payload.length
        );

        const raw = this.walkProtobuf(payload);

        console.log(
            '[getTasks] raw top-level tags =',
            raw
                .slice(0, 20)
                .map(f => `${f.fieldNumber}:${f.wireType}`)
                .join(',')
        );

        // diagnostic: top-level field histogram inside the package submessage
        if (raw[0] && raw[0].nested) {
            const counts = {};
            for (const f of raw[0].nested) {
                const k = `${f.fieldNumber}:${f.wireType}`;
                counts[k] = (counts[k] || 0) + 1;
            }
            console.log(
                '[getTasks] field histogram inside package =',
                JSON.stringify(counts)
            );
        }

        // diagnostic: report field-11 entries' shape
if (raw[0] && raw[0].nested) {
    const elevens = raw[0].nested.filter(f => f.fieldNumber === 11);
    console.log(
        '[getTasks] field 11 entries =',
        elevens.length,
        'first entry keys =',
        JSON.stringify(
            elevens[0]
                ? {
                    hasNested: !!elevens[0].nested,
                    nestedLen: elevens[0].nested
                        ? elevens[0].nested.length
                        : 0,
                    hasString: !!elevens[0].string,
                    stringValue: elevens[0].string
                        ? elevens[0].string.slice(0, 80)
                        : null,
                    hasBytes: !!elevens[0].bytes,
                    bytesLen: elevens[0].bytes
                        ? elevens[0].bytes.length
                        : 0
                  }
                : null
        )
    );

    if (elevens[0] && elevens[0].nested) {
        const taskCounts = {};
        for (const f of elevens[0].nested) {
            const k = `${f.fieldNumber}:${f.wireType}`;
            taskCounts[k] = (taskCounts[k] || 0) + 1;
        }
        console.log(
            '[getTasks] field histogram inside first task =',
            JSON.stringify(taskCounts)
        );
    }
}

    /* ------------------------------------------------------------------ */
    /*  Decode a GetPackage response into { packages, tasks, taskItems }  */
    /*    1 = repeated Package                                            */
    /*    2 = repeated Task                                               */
    /*    3 = repeated TaskItem                                           */
    /* ------------------------------------------------------------------ */

    packageDataFromRawWalk(topFields) {
        const out = { packages: [], tasks: [], taskItems: [] };

        for (const top of topFields) {
            if (!top.nested) continue;

            if (top.fieldNumber === 1) {
                const pkg = {
                    packageID:          null,
                    title:              null,
                    packageType:        null,
                    status:             null,
                    numTasks:           0,
                    numTaskItems:       0,
                    numTaskItemsDone:   0,
                    numTasksComplete:   0,
                    numTasksInProgress: 0,
                    hasBeenComplete:    false,
                    xPoints:            0,
                    taskIds:            [],
                    labels:             {},
                    percent:            0
                };
                for (const f of top.nested) {
                    if (f.fieldNumber === 1 && f.string) {
                        const m = f.string.match(/packages\/([0-9a-f-]{36})/i);
                        if (m) pkg.packageID = m[1];
                    } else if (f.fieldNumber === 4 && f.string) {
                        pkg.title = f.string;
                    } else if (f.fieldNumber === 5 && f.string) {
                        pkg.packageType = f.string;
                    } else if (f.fieldNumber === 6 && f.wireType === 0) {
                        pkg.numTasks = f.value;
                    } else if (f.fieldNumber === 7 && f.wireType === 0) {
                        pkg.numTaskItems = f.value;
                    } else if (f.fieldNumber === 8 && f.wireType === 0) {
                        pkg.numTaskItemsDone = f.value;
                    } else if (f.fieldNumber === 9 && f.wireType === 0) {
                        pkg.hasBeenComplete = !!f.value;
                    } else if (f.fieldNumber === 10 && f.wireType === 0) {
                        pkg.numTasksComplete = f.value;
                    } else if (f.fieldNumber === 11 && f.wireType === 0) {
                        pkg.numTasksInProgress = f.value;
                    } else if (f.fieldNumber === 12 && f.string) {
                        pkg.status = f.string;
                    } else if (f.fieldNumber === 13 && f.wireType === 0) {
                        pkg.xPoints = f.value;
                    } else if (f.fieldNumber === 15 && f.string) {
                        const m = f.string.match(/tasks\/([0-9a-f-]{36})/i);
                        if (m) pkg.taskIds.push(m[1]);
                    } else if (f.fieldNumber === 14 && f.nested) {
                        for (const s of f.nested) {
                            if (s.fieldNumber === 3 && s.nested) {
                                let key = null, val = null;
                                for (const u of s.nested) {
                                    if (u.fieldNumber === 1 && u.string) key = u.string;
                                    if (u.fieldNumber === 2 &&
                                        (u.wireType === 1 || u.wireType === 5)) {
                                        val = u.double ?? null;
                                    }
                                }
                                if (key === 'C' && val != null) {
                                    pkg.percent = val;
                                }
                            }
                        }
                    }
                }
                out.packages.push(pkg);
            }

            if (top.fieldNumber === 2) {
                const task = {
                    packageID:            null,
                    taskIndex:            0,
                    title:                null,
                    taskType:             null,
                    numTaskItems:         0,
                    numTaskItemsDone:     0,
                    numTaskItemsWrong:    0,
                    hasBeenComplete:      false,
                    doNotWAC:             false,
                    completion:           null,
                    completionStore:      null,
                    labels:               {},
                    fixedQuestionDelivery: false,
                    secondChanceDelivery:  false
                };
                for (const f of top.nested) {
                    if (f.fieldNumber === 1 && f.string) {
                        const m = f.string.match(/packages\/([0-9a-f-]{36})/i);
                        if (m) task.packageID = m[1];
                    } else if (f.fieldNumber === 2 && f.wireType === 0) {
                        task.taskIndex = f.value;
                    } else if (f.fieldNumber === 3 && f.string) {
                        task.title = f.string;
                    } else if (f.fieldNumber === 4 && f.string) {
                        task.taskType = f.string;
                    } else if (f.fieldNumber === 6 && f.wireType === 0) {
                        task.numTaskItems = f.value;
                    } else if (f.fieldNumber === 7 && f.wireType === 0) {
                        task.numTaskItemsDone = f.value;
                    } else if (f.fieldNumber === 8 && f.wireType === 0) {
                        task.hasBeenComplete = !!f.value;
                    } else if (f.fieldNumber === 9 && f.wireType === 0) {
                        task.numTaskItemsWrong = f.value;
                    } else if (f.fieldNumber === 10 && f.wireType === 0) {
                        task.doNotWAC = !!f.value;
                    } else if (f.fieldNumber === 11 && f.nested) {
                        task.completion = f.nested;
                    } else if (f.fieldNumber === 12 && f.string) {
                        task.completionStore = f.string;
                    } else if (f.fieldNumber === 14 && f.wireType === 0) {
                        task.fixedQuestionDelivery = !!f.value;
                    } else if (f.fieldNumber === 15 && f.wireType === 0) {
                        task.secondChanceDelivery = !!f.value;
                    }
                }
                out.tasks.push(task);
            }

            if (top.fieldNumber === 3) {
                const item = {
                    packageID:          null,
                    taskIndex:          0,
                    taskItemIndex:      0,
                    status:             0,
                    numCorrectAnswers:  0,
                    numWrongAnswers:    0,
                    numVideoWatched:    0,
                    lastAnsweredAt:     null,
                    name:               null,
                    useStatus:          false,
                    numSkillQuestions:  0,
                    swappedInForIndex:  null,
                    videoPlayed:        0,
                    videoOpenDuration:  0
                };
                for (const f of top.nested) {
                    if (f.fieldNumber === 1 && f.string) {
                        const m = f.string.match(/packages\/([0-9a-f-]{36})/i);
                        if (m) item.packageID = m[1];
                    } else if (f.fieldNumber === 2 && f.wireType === 0) {
                        item.taskIndex = f.value;
                    } else if (f.fieldNumber === 3 && f.wireType === 0) {
                        item.taskItemIndex = f.value;
                    } else if (f.fieldNumber === 4 && f.wireType === 0) {
                        item.status = f.value;
                    } else if (f.fieldNumber === 5 && f.wireType === 0) {
                        item.numCorrectAnswers = f.value;
                    } else if (f.fieldNumber === 6 && f.wireType === 0) {
                        item.numWrongAnswers = f.value;
                    } else if (f.fieldNumber === 7 && f.wireType === 0) {
                        item.numVideoWatched = f.value;
                    } else if (f.fieldNumber === 9 && f.string) {
                        item.name = f.string;
                    } else if (f.fieldNumber === 15 && f.wireType === 0) {
                        item.useStatus = !!f.value;
                    } else if (f.fieldNumber === 19 && f.wireType === 0) {
                        item.numSkillQuestions = f.value;
                    } else if (f.fieldNumber === 20 && f.wireType === 0) {
                        item.swappedInForIndex = f.value;
                    } else if (f.fieldNumber === 21 && f.wireType === 0) {
                        item.videoPlayed = f.value;
                    } else if (f.fieldNumber === 22 &&
                               (f.wireType === 1 || f.wireType === 5)) {
                        item.videoOpenDuration = f.double ?? 0;
                    }
                }
                out.taskItems.push(item);
            }
        }

        return out;
    }

    async getPackageData(inputObject) {
        const fullMessage = await this.encodeStuff(
            inputObject,
            'PackageDataRequest'
        );
        const response = await this.send(
            'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetPackageData',
            fullMessage
        );
        if (!response?.data) return null;
        return await this.decodeStuff(
            response.data,
            'PackageDataResponse'
        );
    }

    async getActivity(inputObject) {
        const fullMessage = await this.encodeStuff(
            inputObject,
            'GetActivityRequest'
        );
        const response = await this.send(
            'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetActivity',
            fullMessage
        );
        if (!response?.data) return null;
        return await this.decodeStuff(response.data, 'Result');
    }

    async getPackagesIndependantLearning(inputObject) {
        const fullMessage = await this.encodeStuff(
            inputObject,
            'GetPackagesForObjectivesRequest'
        );
        const response = await this.send(
            'https://api.sparx-learning.com/sparx.revision.v1.Revision/GetPackagesForObjectives',
            fullMessage
        );
        if (!response?.data) return null;
        return await this.decodeStuff(
            response.data,
            'GetPackagesForObjectivesResponse'
        );
    }

    async getActivePackages(inputObject) {
        const fullMessage = await this.encodeStuff(
            inputObject,
            'GetActivePackagesRequest'
        );
        const response = await this.send(
            'https://api.sparx-learning.com/sparx.revision.v1.Revision/GetActivePackages',
            fullMessage
        );
        if (!response?.data) return null;
        return await this.decodeStuff(
            response.data,
            'GetActivePackagesResponse'
        );
    }

    async listTopicSummariesRequest(inputObject) {
        const fullMessage = await this.encodeStuff(
            inputObject,
            'ListTopicSummariesRequest'
        );
        const response = await this.send(
            'https://api.sparx-learning.com/sparx.content.summaries.v1.TopicSummaries/ListTopicSummaries',
            fullMessage
        );
        if (!response?.data) return null;
        return await this.decodeStuff(
            response.data,
            'ListTopicSummariesResponse'
        );
    }

    async listCurriculumSummaries(inputObject) {
        const fullMessage = await this.encodeStuff(
            inputObject,
            'ListCurriculumSummariesRequest'
        );
        const response = await this.send(
            'https://api.sparx-learning.com/sparx.content.summaries.v1.CurriculumSummaries/ListCurriculumSummaries',
            fullMessage
        );
        if (!response?.data) return null;
        return await this.decodeStuff(
            response.data,
            'ListCurriculumSummariesResponse'
        );
    }
}

module.exports = { SparxMaths };