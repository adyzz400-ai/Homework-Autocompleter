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

/*
 * ============================================================
 * Minimal protobuf wire-format decoder for ListStudentPackages.
 *
 * The server response is a repeated PackageCompletion message.
 * The generated sm_code.js doesn't include the modern protobuf
 * definitions, so we walk the wire format by hand.
 *
 * Field map (from the client PackageCompletion shape):
 *
 *   1  packageID        (string)
 *   2  startDate        (Timestamp: {1:seconds, 2:nanos})
 *   3  endDate          (Timestamp: {1:seconds, 2:nanos})
 *   4  title            (string)
 *   5  packageType      (string)
 *   6  numTasks         (int32)
 *   7  numTaskItems     (int32)
 *   8  numTaskItemsDone (int32)
 *  10  numTasksComplete (int32)
 *
 * If any of those numbers are wrong the debug log will show it
 * and the map gets patched — see the `[PackageDecode]` lines.
 * ============================================================
 */

class WireReader {

    constructor(bytes) {
        this.bytes =
            bytes instanceof Uint8Array
                ? bytes
                : new Uint8Array(bytes);
        this.pos = 0;
    }

    eof() {
        return this.pos >= this.bytes.length;
    }

    readVarint() {
        let result = 0;
        let shift = 0;
        let byte;
        do {
            if (this.pos >= this.bytes.length) {
                throw new Error(
                    'truncated varint'
                );
            }
            byte = this.bytes[this.pos++];
            result +=
                (byte & 0x7f) * Math.pow(2, shift);
            shift += 7;
        } while (byte & 0x80 && shift < 64);
        return result;
    }

    readTag() {
        const tag = this.readVarint();
        const fieldNumber = tag >>> 3;
        const wireType = tag & 0x07;
        return { fieldNumber, wireType };
    }

    readBytes(length) {
        const slice =
            this.bytes.subarray(
                this.pos,
                this.pos + length
            );
        this.pos += length;
        return slice;
    }

    readString() {
        const length = this.readVarint();
        const slice = this.readBytes(length);
        return Buffer.from(slice).toString('utf8');
    }

    skip(wireType) {
        switch (wireType) {
            case 0:
                this.readVarint();
                break;
            case 1:
                this.pos += 8;
                break;
            case 2: {
                const length = this.readVarint();
                this.pos += length;
                break;
            }
            case 5:
                this.pos += 4;
                break;
            default:
                throw new Error(
                    `unsupported wire type ${wireType}`
                );
        }
    }
}

/*
 * ============================================================
 * Timestamp submessage
 * ============================================================
 */

function parseTimestamp(buffer) {
    const reader = new WireReader(buffer);
    const out = { seconds: 0, nanos: 0 };
    while (!reader.eof()) {
        const { fieldNumber, wireType } =
            reader.readTag();
        if (fieldNumber === 1 && wireType === 0) {
            out.seconds = reader.readVarint();
        } else if (
            fieldNumber === 2 &&
            wireType === 0
        ) {
            out.nanos = reader.readVarint();
        } else {
            reader.skip(wireType);
        }
    }
    return out;
}

/*
 * ============================================================
 * PackageCompletion
 * ============================================================
 */

function parsePackageCompletion(
    buffer,
    debug = false,
    debugTag = ''
) {
    const reader = new WireReader(buffer);

    const pkg = {
        packageID: null,
        title: null,
        startDate: null,
        endDate: null,
        packageType: null,
        numTasks: 0,
        numTaskItems: 0,
        numTaskItemsDone: 0,
        numTasksComplete: 0
    };

    while (!reader.eof()) {

        let tag;
        try {
            tag = reader.readTag();
        } catch (err) {
            break;
        }

        const { fieldNumber, wireType } = tag;

        if (debug) {
            // log field number, wire type, and a short peek of
            // the raw value — helps us map unknown field numbers
            const peekStart = reader.pos;
            console.log(
                `[PackageDecode]${debugTag} field=${fieldNumber} wire=${wireType} peekStart=${peekStart}`
            );
        }

        try {
            switch (fieldNumber) {

                case 1: // packageID (string)
                    pkg.packageID = reader.readString();
                    break;

                case 2: // startDate (Timestamp)
                case 3: { // endDate (Timestamp)
                    const length =
                        reader.readVarint();
                    const sub =
                        reader.readBytes(length);
                    const ts = parseTimestamp(sub);
                    if (fieldNumber === 2) {
                        pkg.startDate = ts;
                    } else {
                        pkg.endDate = ts;
                    }
                    break;
                }

                case 4: // title (string)
                    pkg.title = reader.readString();
                    break;

                case 5: // packageType (string)
                    pkg.packageType =
                        reader.readString();
                    break;

                case 6: // numTasks (int32)
                    pkg.numTasks =
                        reader.readVarint();
                    break;

                case 7: // numTaskItems (int32)
                    pkg.numTaskItems =
                        reader.readVarint();
                    break;

                case 8: // numTaskItemsDone (int32)
                    pkg.numTaskItemsDone =
                        reader.readVarint();
                    break;

                case 10: // numTasksComplete (int32)
                    pkg.numTasksComplete =
                        reader.readVarint();
                    break;

                default:
                    reader.skip(wireType);
                    break;
            }
        } catch (err) {
            // if we mis-guess a field, log and bail out of this
            // package rather than corrupting the rest
            if (debug) {
                console.log(
                    `[PackageDecode] parse error at field ${fieldNumber}: ${err.message}`
                );
            }
            break;
        }
    }

    return pkg;
}

/*
 * ============================================================
 * ListStudentPackagesResponse
 *
 * The response is a single top-level message with repeated
 * PackageCompletion entries. If the outer message wraps them
 * in a named field, we detect that here by checking wire types.
 * ============================================================
 */

function parseListStudentPackagesResponse(
    buffer,
    debug = false
) {
    const reader = new WireReader(buffer);
    const packages = [];

    // Top-level: repeated field, most likely 1 (packages),
    // each a length-delimited PackageCompletion.
    // Other fields are skipped.

    while (!reader.eof()) {

        let tag;
        try {
            tag = reader.readTag();
        } catch (err) {
            break;
        }

        const { fieldNumber, wireType } = tag;

        if (debug) {
            console.log(
                `[PackageDecode] topLevel field=${fieldNumber} wire=${wireType} pos=${reader.pos}`
            );
        }

        if (wireType === 2) {
            const length = reader.readVarint();
            const sub = reader.readBytes(length);

            // Assume any length-delimited top-level field is a
            // PackageCompletion entry. The debug log will tell
            // us if that's wrong.
            const pkg = parsePackageCompletion(
                sub,
                debug && packages.length < 3,
                ` pkg=${packages.length}`
            );

            if (pkg.packageID) {
                packages.push(pkg);
            }
        } else {
            reader.skip(wireType);
        }
    }

    return { packages };
}

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

    extractPrintableStringsFromBytes(bytes) {

        const strings = [];

        let current = [];

        const flush = () => {

            if (
                current.length < 2
            ) {

                current = [];

                return;
            }

            const value =
                Buffer
                    .from(current)
                    .toString('utf8')
                    .replace(
                        /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
                        ''
                    )
                    .trim();

            if (
                value.length >= 2
            ) {

                strings.push(
                    value
                );
            }

            current = [];
        };

        for (
            const byte of bytes
        ) {

            if (
                byte >= 32 &&
                byte <= 126
            ) {

                current.push(
                    byte
                );

            } else {

                flush();
            }
        }

        flush();

        return strings;
    }

    async getHomeworks() {

        console.log(
            '[Sparx] ========================================'
        );

        console.log(
            '[Sparx] MODERN HOMEWORK API'
        );

        console.log(
            '[Sparx] ========================================'
        );

        if (
            !this.sessionId
        ) {

            console.log(
                '[Sparx] No ClientSession found. Creating one...'
            );

            await this.getClientSession();
        }

        const request =
            Buffer.from([
                0x00,
                0x00,
                0x00,
                0x00,
                0x00
            ]);

        console.log(
            '[Sparx] Calling ListStudentPackages...'
        );

        const response =
            await this.send(
                'https://api.sparx-learning.com/maths/sparx.packageactivity.v1.Packages/ListStudentPackages',
                request
            );

        console.log(
            '[Sparx] ListStudentPackages HTTP:',
            response?.status
        );

        console.log(
            '[Sparx] ListStudentPackages bytes:',
            response?.data?.length || 0
        );

        if (
            !response?.data
        ) {

            console.log(
                '[Sparx] ListStudentPackages returned no data.'
            );

            return {
                packages: [],
                tasks: [],
                taskItems: []
            };
        }

        // Strip the 5-byte gRPC-Web frame before parsing.
        let payload = response.data;
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
                payload = payload.slice(
                    5,
                    5 + messageLength
                );
            }
        }

        console.log(
            '[Sparx] payload bytes after gRPC frame:',
            payload.length
        );

        const debugThisRun = true;

        let parsedPackages = [];

        try {
            const parsed =
                parseListStudentPackagesResponse(
                    payload,
                    debugThisRun
                );
            parsedPackages = parsed.packages;
        } catch (err) {
            console.error(
                '[Sparx] protobuf decode failed:',
                err.message
            );
        }

        console.log(
            '[Sparx] Decoded packages:',
            parsedPackages.length
        );

        console.log(
            '[Sparx] Decoded sample:',
            JSON.stringify(
                parsedPackages.slice(0, 5),
                null,
                2
            )
        );

        // Also keep the old string-scraper output for cross-check.
        const strings =
            this.extractPrintableStringsFromBytes(
                payload
            );

        console.log(
            '[Sparx] Modern package strings count:',
            strings.length
        );

        return {
            packages: parsedPackages,
            tasks: [],
            taskItems: []
        };
    }

    async getTasksItems(
        packageID,
        taskIndex
    ) {

        const inputObject = {

            includeAllActivePackages:
                false,

            getPackages:
                false,

            getTasks:
                false,

            getTaskItems:
                true,

            packageID,

            taskIndex,

            taskItemIndex:
                0
        };

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'PackageDataRequest'
            );

        const response =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetPackageData',
                fullMessage
            );

        if (
            !response?.data
        ) {

            return [];
        }

        const result =
            await this.decodeStuff(
                response.data,
                'PackageDataResponse'
            );

        return result?.taskItems || [];
    }

    async getTasks(
        packageID
    ) {

        const inputObject = {

            includeAllActivePackages:
                false,

            getPackages:
                true,

            getTasks:
                true,

            getTaskItems:
                false,

            packageID,

            taskIndex:
                0,

            taskItemIndex:
                0
        };

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'PackageDataRequest'
            );

        const response =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetPackageData',
                fullMessage
            );

        if (
            !response?.data
        ) {

            return {
                packages: [],
                tasks: [],
                taskItems: []
            };
        }

        return await this.decodeStuff(
            response.data,
            'PackageDataResponse'
        );
    }

    async getActivity(
        timestamp,
        packageID,
        taskIndex,
        taskItemIndex,
        activityType = 0
    ) {

        const inputObject = {

            activityType,

            payload: {},

            method: 0,

            clientFeatureFlags: {},

            taskItem: {

                packageID,

                taskIndex,

                taskItemIndex,

                taskState: 0
            },

            timestamp
        };

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'GetActivityRequest'
            );

        const response =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetActivity',
                fullMessage
            );

        if (
            !response ||
            response === 'break' ||
            !response.data
        ) {

            return response;
        }

        return await this.decodeStuff(
            response.data,
            'Activity'
        );
    }

    async searchIndependantLearning(
        inputObject
    ) {

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'Query'
            );

        const response =
            await this.send(
                'https://api.sparx-learning.com/sparx.content.search.v1.Search/Search',
                fullMessage
            );

        if (
            !response?.data
        ) {

            return null;
        }

        return await this.decodeStuff(
            response.data,
            'Result'
        );
    }

    async getPackagesIndependantLearning(
        inputObject
    ) {

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'GetPackagesForObjectivesRequest'
            );

        const response =
            await this.send(
                'https://api.sparx-learning.com/sparx.revision.v1.Revision/GetPackagesForObjectives',
                fullMessage
            );

        if (
            !response?.data
        ) {

            return null;
        }

        return await this.decodeStuff(
            response.data,
            'GetPackagesForObjectivesResponse'
        );
    }

    async getActivePackages(
        inputObject
    ) {

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'GetActivePackagesRequest'
            );

        const response =
            await this.send(
                'https://api.sparx-learning.com/sparx.revision.v1.Revision/GetActivePackages',
                fullMessage
            );

        if (
            !response?.data
        ) {

            return null;
        }

        return await this.decodeStuff(
            response.data,
            'GetActivePackagesResponse'
        );
    }

    async listTopicSummariesRequest(
        inputObject
    ) {

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'ListTopicSummariesRequest'
            );

        const response =
            await this.send(
                'https://api.sparx-learning.com/sparx.content.summaries.v1.TopicSummaries/ListTopicSummaries',
                fullMessage
            );

        if (
            !response?.data
        ) {

            return null;
        }

        return await this.decodeStuff(
            response.data,
            'ListTopicSummariesResponse'
        );
    }

    async listCurriculumSummaries(
        inputObject
    ) {

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'ListCurriculumSummariesRequest'
            );

        const response =
            await this.send(
                'https://api.sparx-learning.com/sparx.content.summaries.v1.CurriculumSummaries/ListCurriculumSummaries',
                fullMessage
            );

        if (
            !response?.data
        ) {

            return null;
        }

        return await this.decodeStuff(
            response.data,
            'PackageDataResponse'
        );
    }
}

module.exports = {
    SparxMaths
};