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


    /*
     * ============================================================
     * GENERIC SPARX REQUEST
     * ============================================================
     */

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


            /*
             * Normal HTTP 401.
             */

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


            /*
             * gRPC errors.
             */

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

            /*
             * Re-authenticate after 401.
             */

            if (
                err.response?.status === 401 &&
                attempts > 1
            ) {

                console.log(
                    '[Sparx] Re-authenticating after 401...'
                );


                let newAuthToken;


                /*
                 * Full login information available.
                 */

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

                    /*
                     * Existing cookies.
                     */

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


            /*
             * Retry transient errors.
             */

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


    /*
     * ============================================================
     * CLIENT SESSION
     * ============================================================
     */

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


        /*
         * Remove any previous session ID.
         */

        this.curlRequests.headers =
            this.curlRequests.headers.filter(
                header =>
                    !header
                        .toLowerCase()
                        .startsWith(
                            'x-session-id:'
                        )
            );


        /*
         * Install the current session ID.
         */

        this.curlRequests.headers.push(
            `x-session-id: ${this.sessionId}`
        );


        console.log(
            '[Sparx ClientSession] Session ID installed.'
        );


        return this.sessionId;
    }


    /*
     * ============================================================
     * MODERN HOMEWORK API
     * ============================================================
     *
     * Sparx now loads student homework through:
     *
     * /sparx.packageactivity.v1.Packages/ListStudentPackages
     *
     * The generated sm_code.js in this project does not contain
     * the modern protobuf definitions.
     *
     * Therefore the response is read as raw protobuf data and
     * the package metadata strings are extracted from it.
     * ============================================================
     */

    extractModernPackageStrings(buffer) {

        const bytes =
            buffer instanceof Uint8Array
                ? buffer
                : new Uint8Array(buffer);


        /*
         * Remove the 5-byte gRPC-Web message header.
         */

        if (
            bytes.length >= 5
        ) {

            const view =
                new DataView(
                    bytes.buffer,
                    bytes.byteOffset,
                    bytes.byteLength
                );


            const messageLength =
                view.getUint32(
                    1
                );


            if (
                bytes[0] === 0 &&
                messageLength <=
                    bytes.length - 5
            ) {

                return this.extractPrintableStringsFromBytes(
                    bytes.slice(
                        5,
                        5 + messageLength
                    )
                );
            }
        }


        return this.extractPrintableStringsFromBytes(
            bytes
        );
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


        /*
         * Make sure ClientSession exists.
         */

        if (
            !this.sessionId
        ) {

            console.log(
                '[Sparx] No ClientSession found. Creating one...'
            );

            await this.getClientSession();
        }


        /*
         * Empty protobuf request.
         *
         * gRPC-Web frame:
         *
         * byte 0    = data frame
         * bytes 1-4 = message length = 0
         */

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


        const strings =
            this.extractModernPackageStrings(
                response.data
            );


        console.log(
            '[Sparx] Modern package strings:',
            strings.length
        );


        /*
         * The response contains entries similar to:
         *
         * packages/<UUID>
         *
         * followed by package metadata.
         */

        const packages = [];

        let currentPackage = null;


        for (
            const value of strings
        ) {

            const packageMatch =
                value.match(
                    /(?:^|[^a-zA-Z0-9])packages\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
                );


            if (
                packageMatch
            ) {

                if (
                    currentPackage
                ) {

                    packages.push(
                        currentPackage
                    );
                }


                currentPackage = {

                    packageID:
                        packageMatch[1],

                    title:
                        'Homework',

                    numTaskItems:
                        0,

                    numTaskItemsDone:
                        0,

                    numTasks:
                        0,

                    numTasksComplete:
                        0

                };


                continue;
            }


            /*
             * Capture homework titles.
             */

            if (
                currentPackage &&
                (
                    /^#?Homework\b/i.test(
                        value
                    ) ||
                    /\bHomework\b/i.test(
                        value
                    )
                )
            ) {

                const cleaned =
                    value
                        .replace(
                            /^#/,
                            ''
                        )
                        .trim();


                if (
                    cleaned.length > 0 &&
                    cleaned.length < 250
                ) {

                    currentPackage.title =
                        cleaned;
                }
            }
        }


        if (
            currentPackage
        ) {

            packages.push(
                currentPackage
            );
        }


        /*
         * Remove duplicate package IDs.
         */

        const uniquePackages = [];

        const seen =
            new Set();


        for (
            const pkg of packages
        ) {

            if (
                !pkg.packageID ||
                seen.has(
                    pkg.packageID
                )
            ) {

                continue;
            }


            seen.add(
                pkg.packageID
            );


            uniquePackages.push(
                pkg
            );
        }


        console.log(
            '[Sparx] Modern packages found:',
            uniquePackages.length
        );


        console.log(
            JSON.stringify(
                uniquePackages.slice(
                    0,
                    10
                ),
                null,
                2
            )
        );


        return {

            packages:
                uniquePackages,

            tasks: [],

            taskItems: []

        };
    }


    /*
     * ============================================================
     * OLD TASK METHODS
     * ============================================================
     *
     * These are kept for compatibility with the existing project.
     * ============================================================
     */

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


    /*
     * ============================================================
     * ACTIVITY
     * ============================================================
     */

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


    /*
     * ============================================================
     * ACTIVITY ACTIONS
     * ============================================================
     */

    async answerQuestion(
        inputObject
    ) {

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'ActivityAction'
            );


        const response =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/ActivityAction',
                fullMessage
            );


        if (
            !response?.data
        ) {

            return null;
        }


        return await this.decodeStuff(
            response.data,
            'ActivityActionResponse'
        );
    }


    async readyQuestion(
        inputObject
    ) {

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'ActivityAction'
            );


        const response =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/ActivityAction',
                fullMessage
            );


        if (
            !response?.data
        ) {

            return null;
        }


        return await this.decodeStuff(
            response.data,
            'ActivityActionResponse'
        );
    }


    async startTimesTable(
        inputObject
    ) {

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
            !response?.data
        ) {

            return null;
        }


        return await this.decodeStuff(
            response.data,
            'ActivityAction'
        );
    }


    async answerTimesTable(
        inputObject
    ) {

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'ActivityAction'
            );


        const response =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/ActivityAction',
                fullMessage
            );


        if (
            !response?.data
        ) {

            return null;
        }


        return await this.decodeStuff(
            response.data,
            'ActivityActionResponse'
        );
    }


    /*
     * ============================================================
     * INDEPENDENT LEARNING
     * ============================================================
     */

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


    /*
     * ============================================================
     * CONTENT SUMMARIES
     * ============================================================
     */

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