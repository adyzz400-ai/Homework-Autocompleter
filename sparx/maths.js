const { decode, encode } = require('./sm_code.js');
const { getClientSession } = require('./send_maths.js');
const { getTokenSparx, getTokenRequest } = require('./puppeteer.js');
const SparxBase = require('./sparxBase.js');

class SparxMaths extends SparxBase {
    constructor(authToken, login = {}, cookies) {
        super(authToken, login, cookies, decode, encode);
    }

    async send(url, uint8Array, attempts = 3) {
        try {
            this.log.logToFile(`Sending request to ${url}`);

            const response =
                await this.curlRequests.sendRequest(
                    url,
                    uint8Array
                );

            this.log.logToFile(
                `**Response returned**\nStatus: ${response.status}\n${JSON.stringify(response.headers, null, 2)}`
            );

            if (response.status == 401) {
                console.log('Caught 401 in maths');

                const err =
                    new Error("Unauthorized");

                err.response = {
                    status: 401
                };

                throw err;
            }

            /*
             * Check for gRPC error status
             */
            if (
                response.headers['grpc-status'] === '16' ||
                response.headers['grpc-status'] === '9' ||
                response.headers['grpc-status'] === '7'
            ) {
                if (
                    response.headers['grpc-message'] ===
                    'TaskItemHidden'
                ) {
                    this.log.logToFile(
                        'Item is hidden so just break'
                    );

                    return 'break';
                }

                if (
                    response.headers['grpc-message'] &&
                    response.headers['grpc-message'].includes(
                        'PendingWAC'
                    )
                ) {
                    this.log.logToFile(
                        "Bookwork check caught"
                    );

                    return null;
                }

                if (
                    response.headers['grpc-message'] &&
                    response.headers['grpc-message'].includes(
                        'SessionInactive'
                    )
                ) {
                    this.log.logToFile(
                        "SESSION INACTIVE CAUGHT!"
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
            await new Promise(
                res => setTimeout(res, 5000)
            );

            this.log.logToFile(err);

            if (
                err.response?.status === 401 &&
                attempts > 1
            ) {
                this.log.logToFile(
                    "Caught 401 Unauthorized, handling it attempting relogin..."
                );

                let newAuthToken;

                if (this.login?.school) {
                    const newAuthTokenN =
                        await getTokenSparx(
                            this.login.school,
                            this.login.email,
                            this.login.password,
                            this.login.loginType,
                            this.login.app
                        );

                    if (newAuthTokenN?.cookies) {
                        this.cookies =
                            newAuthTokenN.cookies;
                    }

                    if (
                        newAuthTokenN?.token &&
                        !newAuthTokenN.token.includes(
                            "Unauthorized"
                        )
                    ) {
                        newAuthToken =
                            newAuthTokenN.token;
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
                        throw new Error(err);
                    }
                }

                if (newAuthToken) {
                    this.log.logToFile(
                        'The new authtoken has been successfully acquired!'
                    );

                    this.authToken =
                        newAuthToken;

                    this.curlRequests.headers =
                        this.curlRequests.headers.map(
                            header =>
                                header
                                    .toLowerCase()
                                    .startsWith(
                                        'authorization:'
                                    )
                                    ? `authorization: ${this.authToken}`
                                    : header
                        );

                    await this.getClientSession();

                    console.log(
                        "Client session success"
                    );

                } else {
                    this.log.logToFile(
                        'Unable to login after 401 status code'
                    );
                }

                return await this.send(
                    url,
                    uint8Array,
                    attempts - 1
                );

            } else if (attempts > 1) {

                return await this.send(
                    url,
                    uint8Array,
                    attempts - 1
                );

            } else {
                throw new Error(err);
            }
        }
    }

    async getHomeworks() {
        const inputObject = {
            includeAllActivePackages: true,
            getPackages: true,
            getTasks: false,
            getTaskItems: false,
            packageID: "",
            taskIndex: 0,
            taskItemIndex: 0
        };

        try {
            const fullMessage =
                await this.encodeStuff(
                    inputObject,
                    'PackageDataRequest'
                );

            console.log(
                "[Sparx GetPackageData] Sending request..."
            );

            const homeworkRequest =
                await this.send(
                    'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetPackageData',
                    fullMessage
                );

            /*
             * Safe diagnostics.
             * These do NOT print the account token,
             * password, cookies or homework contents.
             */
            console.log(
                "[Sparx GetPackageData] HTTP:",
                homeworkRequest?.status
            );

            console.log(
                "[Sparx GetPackageData] Bytes:",
                Buffer.isBuffer(
                    homeworkRequest?.data
                )
                    ? homeworkRequest.data.length
                    : "NOT BUFFER"
            );

            console.log(
                "[Sparx GetPackageData] grpc-status:",
                homeworkRequest?.headers?.[
                    "grpc-status"
                ]
            );

            console.log(
                "[Sparx GetPackageData] grpc-message:",
                homeworkRequest?.headers?.[
                    "grpc-message"
                ]
            );

            if (
                !homeworkRequest ||
                !homeworkRequest.data
            ) {
                throw new Error(
                    "Failed to fetch homeworks: Empty response"
                );
            }

            const homeworkResponse =
                await this.decodeStuff(
                    homeworkRequest.data,
                    'PackageDataResponse'
                );

            console.log(
                "[Sparx GetPackageData] Decoded package count:",
                Array.isArray(
                    homeworkResponse?.packages
                )
                    ? homeworkResponse.packages.length
                    : "NOT ARRAY"
            );

            console.log(
                "[Sparx GetPackageData] Decoded task count:",
                Array.isArray(
                    homeworkResponse?.tasks
                )
                    ? homeworkResponse.tasks.length
                    : "NOT ARRAY"
            );

            console.log(
                "[Sparx GetPackageData] Decoded taskItem count:",
                Array.isArray(
                    homeworkResponse?.taskItems
                )
                    ? homeworkResponse.taskItems.length
                    : "NOT ARRAY"
            );

            return homeworkResponse;

        } catch (err) {
            this.log.logToFile(
                `Error in getHomeworks: ${err.message}`
            );

            console.error(
                'Error in getHomeworks:',
                err
            );

            throw err;
        }
    }

    async getTasksItems(
        packageID,
        taskIndex
    ) {
        const inputObject = {
            includeAllActivePackages: false,
            getPackages: false,
            getTasks: false,
            getTaskItems: true,
            packageID: packageID,
            taskIndex: taskIndex,
            taskItemIndex: 0
        };

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'PackageDataRequest'
            );

        const homeworkRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetPackageData',
                fullMessage
            );

        const homeworkResponse =
            await this.decodeStuff(
                homeworkRequest.data,
                'PackageDataResponse'
            );

        return homeworkResponse.taskItems;
    }

    async getTasks(packageID) {
        const inputObject = {
            includeAllActivePackages: false,
            getPackages: false,
            getTasks: true,
            getTaskItems: false,
            packageID: packageID,
            taskIndex: 0,
            taskItemIndex: 0
        };

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'PackageDataRequest'
            );

        const homeworkRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetPackageData',
                fullMessage
            );

        const homeworkResponse =
            await this.decodeStuff(
                homeworkRequest.data,
                'PackageDataResponse'
            );

        return homeworkResponse;
    }

    async getActivity(
        timestamp,
        packageID,
        taskIndex,
        taskItemIndex,
        activityType = 0
    ) {
        const inputObject = {
            activityType: activityType,
            payload: {},
            method: 0,
            clientFeatureFlags: {},
            taskItem: {
                packageID: packageID,
                taskIndex: taskIndex,
                taskItemIndex: taskItemIndex,
                taskState: 0
            },
            timestamp: timestamp
        };

        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'GetActivityRequest'
            );

        const homeworkRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetActivity',
                fullMessage
            );

        if (
            !homeworkRequest ||
            homeworkRequest === 'break'
        ) {
            return homeworkRequest;
        }

        const homeworkResponse =
            await this.decodeStuff(
                homeworkRequest.data,
                'Activity'
            );

        return homeworkResponse;
    }

    async getClientSession() {
        const responseBuffer =
            await getClientSession(
                this.curlRequests
            );

        const response =
            await this.decodeStuff(
                responseBuffer,
                "ClientSessionResponse"
            );

        if (
            !response ||
            !response.sessionId
        ) {
            throw new Error(
                "Sparx ClientSession did not return a session ID."
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
                            "x-session-id:"
                        )
            );

        /*
         * Add the CURRENT session ID.
         */
        this.curlRequests.headers.push(
            `x-session-id: ${this.sessionId}`
        );

        console.log(
            "[Sparx ClientSession] Session ID installed."
        );

        return this.sessionId;
    }

    async answerQuestion(inputObject) {
        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'ActivityAction'
            );

        const answerRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/ActivityAction',
                fullMessage
            );

        const answerResponse =
            await this.decodeStuff(
                answerRequest.data,
                'ActivityActionResponse'
            );

        return answerResponse;
    }

    async readyQuestion(inputObject) {
        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'ActivityAction'
            );

        const answerRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/ActivityAction',
                fullMessage
            );

        const answerResponse =
            await this.decodeStuff(
                answerRequest.data,
                'ActivityActionResponse'
            );

        return answerResponse;
    }

    async startTimesTable(inputObject) {
        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'GetActivityRequest'
            );

        const answerRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetActivity',
                fullMessage
            );

        const answerResponse =
            await this.decodeStuff(
                answerRequest.data,
                'ActivityAction'
            );

        return answerResponse;
    }

    async answerTimesTable(inputObject) {
        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'ActivityAction'
            );

        const answerRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/ActivityAction',
                fullMessage
            );

        const answerResponse =
            await this.decodeStuff(
                answerRequest.data,
                'ActivityActionResponse'
            );

        return answerResponse;
    }

    async searchIndependantLearning(inputObject) {
        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'Query'
            );

        const answerRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.content.search.v1.Search/Search',
                fullMessage
            );

        const answerResponse =
            await this.decodeStuff(
                answerRequest.data,
                'Result'
            );

        return answerResponse;
    }

    async getPackagesIndependantLearning(
        inputObject
    ) {
        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'GetPackagesForObjectivesRequest'
            );

        const answerRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.revision.v1.Revision/GetPackagesForObjectives',
                fullMessage
            );

        const answerResponse =
            await this.decodeStuff(
                answerRequest.data,
                'GetPackagesForObjectivesResponse'
            );

        return answerResponse;
    }

    async getActivePackages(inputObject) {
        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'GetActivePackagesRequest'
            );

        const answerRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.revision.v1.Revision/GetActivePackages',
                fullMessage
            );

        const answerResponse =
            await this.decodeStuff(
                answerRequest.data,
                'GetActivePackagesResponse'
            );

        return answerResponse;
    }

    async listTopicSummariesRequest(
        inputObject
    ) {
        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'ListTopicSummariesRequest'
            );

        const answerRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.content.summaries.v1.TopicSummaries/ListTopicSummaries',
                fullMessage
            );

        const answerResponse =
            await this.decodeStuff(
                answerRequest.data,
                'ListTopicSummariesResponse'
            );

        return answerResponse;
    }

    async listCurriculumSummaries(
        inputObject
    ) {
        const fullMessage =
            await this.encodeStuff(
                inputObject,
                'ListCurriculumSummariesRequest'
            );

        const answerRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.content.summaries.v1.CurriculumSummaries/ListCurriculumSummaries',
                fullMessage
            );

        const answerResponse =
            await this.decodeStuff(
                answerRequest.data,
                'ListCurriculumSummariesResponse'
            );

        return answerResponse;
    }
}

module.exports = {
    SparxMaths
};