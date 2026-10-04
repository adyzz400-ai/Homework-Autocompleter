const { decode, encode } = require('./sm_code.js');

const { getClientSession } =
    require('./send_maths.js');

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

            if (response.status === 401) {

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


                    if (result?.cookies) {

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


                if (newAuthToken) {

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
             * Retry normal transient errors.
             */

            if (attempts > 1) {

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
         * Remove an old session ID.
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
         * Install the new session ID.
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
     * HOMEWORK DIAGNOSTIC
     *
     * IMPORTANT:
     * We are deliberately NOT pretending that the old
     * GetPackageData endpoint is the modern homework endpoint.
     *
     * The browser capture showed:
     *
     * /sparx.packageactivity.v1.Packages/ListStudentPackages
     *
     * but the uploaded sm_code.js does not contain that method's
     * protobuf definition.
     *
     * Therefore this method only tests the existing protobuf
     * definitions and gives us clean diagnostic output.
     * ============================================================
     */

    async getHomeworks() {

        console.log(
            '[Sparx] ========================================'
        );

        console.log(
            '[Sparx] HOMEWORK DIAGNOSTIC START'
        );

        console.log(
            '[Sparx] ========================================'
        );


        /*
         * Make absolutely sure ClientSession exists.
         */

        if (!this.sessionId) {

            console.log(
                '[Sparx] No ClientSession found. Creating one...'
            );

            await this.getClientSession();
        }


        /*
         * --------------------------------------------------------
         * OLD PackageData endpoint
         * --------------------------------------------------------
         *
         * This is retained ONLY as a diagnostic comparison.
         */

        const inputObject = {

            includeAllActivePackages: true,

            getPackages: true,

            getTasks: false,

            getTaskItems: false,

            packageID: '',

            taskIndex: 0,

            taskItemIndex: 0
        };


        console.log(
            '[Sparx] Encoding PackageDataRequest...'
        );


        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'PackageDataRequest'
            );


        console.log(
            '[Sparx] PackageDataRequest bytes:',
            fullMessage.length
        );


        const response =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetPackageData',
                fullMessage
            );


        console.log(
            '[Sparx] Old GetPackageData HTTP:',
            response?.status
        );


        console.log(
            '[Sparx] Old GetPackageData bytes:',
            response?.data?.length
        );


        if (
            response?.data
        ) {

            const result =
                await this.decodeStuff(
                    response.data,
                    'PackageDataResponse'
                );


            console.log(
                '[Sparx] OLD API decoded result:'
            );

            console.log(
                JSON.stringify(
                    {
                        packageCount:
                            result?.packages?.length || 0,

                        taskCount:
                            result?.tasks?.length || 0,

                        taskItemCount:
                            result?.taskItems?.length || 0
                    },
                    null,
                    2
                )
            );


            /*
             * Show only safe structural information.
             * Do not dump cookies, tokens or credentials.
             */

            if (
                result?.packages?.length
            ) {

                console.log(
                    '[Sparx] Old API packages found.'
                );

                console.log(
                    JSON.stringify(
                        result.packages.slice(
                            0,
                            5
                        ),
                        null,
                        2
                    )
                );

            } else {

                console.log(
                    '[Sparx] Old API returned ZERO packages.'
                );
            }


            /*
             * Return the structure expected by the current
             * executor so the rest of the bot does not crash.
             */

            return {

                packages:
                    result?.packages || [],

                tasks:
                    result?.tasks || [],

                taskItems:
                    result?.taskItems || []

            };
        }


        console.log(
            '[Sparx] GetPackageData returned no data.'
        );


        return {

            packages: [],

            tasks: [],

            taskItems: []

        };
    }


    /*
     * ============================================================
     * OLD TASK METHODS
     * ============================================================
     *
     * These remain untouched for now.
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
     *
     * Kept for compatibility with the existing project.
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