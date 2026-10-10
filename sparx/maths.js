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

    /*
     * ============================================================
     * Homework string classification
     *
     * The server's response contains a printable-strings channel
     * that carries everything the sparx web app renders. We use
     * that channel directly instead of decoding protobuf.
     *
     * Recognised shapes:
     *   "packages/<uuid>"         -> package start marker
     *   "assignments/<uuid>"      -> ignore
     *   "curriculums/<uuid>"      -> ignore
     *   "#Homework due <text>"    -> title + due (title/due split)
     *   "#<Title> due <text>"     -> title + due (title/due split)
     *   "Homework" / "homework "  -> title fallback
     *   everything else           -> ignore
     * ============================================================
     */

    classifyString(value) {

        const trimmed =
            String(value || '').trim();

        if (!trimmed) return null;

        // Package start marker
        const pkgMatch =
            trimmed.match(
                /^[-*]?\s*packages\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
            );

        if (pkgMatch) {
            return {
                kind: 'package',
                packageID: pkgMatch[1]
            };
        }

        // Ignore assignments + curriculums
        if (
            /^(?:[-*]\s*)?(?:assignments|curriculums)\//i.test(
                trimmed
            )
        ) {
            return { kind: 'ignore' };
        }

        // Title + due date (rendered by the web app)
        const dueMatch =
            trimmed.match(
                /^#?\s*(.+?)\s+due\s+(.+?)\s*$/i
            );

        if (dueMatch) {
            return {
                kind: 'titleDue',
                title: dueMatch[1].trim(),
                dueText: dueMatch[2].trim()
            };
        }

        // Bare title fallback
        if (/^#?\s*homework\s*$/i.test(trimmed)) {
            return {
                kind: 'titleOnly',
                title: 'Homework'
            };
        }

        return { kind: 'ignore' };
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

        const strings =
            this.extractPrintableStringsFromBytes(
                payload
            );

        console.log(
            '[Sparx] Modern package strings:',
            strings.length
        );

        /*
         * Walk the printable-strings list. Every time we see a
         * "packages/<uuid>" string, start a new package. The next
         * titleDue or titleOnly string that follows (before the
         * next package marker) sets the title and due text.
         */

        const packages = [];
        let currentPackage = null;

        for (const value of strings) {

            const classified =
                this.classifyString(value);

            if (!classified) continue;

            if (classified.kind === 'package') {

                if (currentPackage) {
                    packages.push(currentPackage);
                }

                currentPackage = {
                    packageID: classified.packageID,
                    title: 'Homework',
                    dueText: null,
                    // The counts are not present in the string
                    // channel; the dropdown shows 0% until we
                    // have a real protobuf decoder.
                    numTaskItems: 0,
                    numTaskItemsDone: 0,
                    numTasks: 0,
                    numTasksComplete: 0
                };

                continue;
            }

            if (!currentPackage) continue;

            if (classified.kind === 'titleDue') {

                // Only take the first titleDue line per package.
                if (!currentPackage.dueText) {
                    currentPackage.title =
                        classified.title;
                    currentPackage.dueText =
                        classified.dueText;
                }
                continue;
            }

            if (classified.kind === 'titleOnly') {

                // Fallback title, only if nothing better has been
                // captured yet for this package.
                if (
                    currentPackage.title ===
                        'Homework' &&
                    !currentPackage.dueText
                ) {
                    currentPackage.title =
                        classified.title;
                }
                continue;
            }
        }

        if (currentPackage) {
            packages.push(currentPackage);
        }

        // Deduplicate by packageID (the response often repeats
        // each package block across the two requests).
        const uniquePackages = [];
        const seen = new Set();

        for (const pkg of packages) {
            if (!pkg.packageID) continue;
            if (seen.has(pkg.packageID)) continue;
            seen.add(pkg.packageID);
            uniquePackages.push(pkg);
        }

        console.log(
            '[Sparx] Modern packages found:',
            uniquePackages.length
        );

        console.log(
            '[Sparx] Modern packages sample:',
            JSON.stringify(
                uniquePackages.slice(0, 10),
                null,
                2
            )
        );

        return {
            packages: uniquePackages,
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