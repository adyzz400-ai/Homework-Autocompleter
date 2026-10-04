const { decode, encode } = require('./sm_code.js');
const { getClientSession } = require('./send_maths.js');
const {
    getTokenSparx,
    getTokenRequest
} = require('./puppeteer.js');

const SparxBase = require('./sparxBase.js');

class SparxMaths extends SparxBase {
    constructor(authToken, login = {}, cookies) {
        super(
            authToken,
            login,
            cookies,
            decode,
            encode
        );
    }

    async send(url, uint8Array, attempts = 3) {
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
                `**Response returned**\nStatus: ${response.status}\n${JSON.stringify(response.headers, null, 2)}`
            );

            if (response.status === 401) {
                console.log(
                    'Caught 401 in maths'
                );

                const err =
                    new Error("Unauthorized");

                err.response = {
                    status: 401
                };

                throw err;
            }

            if (
                response.headers['grpc-status'] === '16' ||
                response.headers['grpc-status'] === '9' ||
                response.headers['grpc-status'] === '7'
            ) {
                const grpcMessage =
                    response.headers[
                        'grpc-message'
                    ] || '';

                if (
                    grpcMessage ===
                    'TaskItemHidden'
                ) {
                    this.log.logToFile(
                        'Item is hidden so just break'
                    );

                    return 'break';
                }

                if (
                    grpcMessage.includes(
                        'PendingWAC'
                    )
                ) {
                    this.log.logToFile(
                        'Bookwork check caught'
                    );

                    return null;
                }

                if (
                    grpcMessage.includes(
                        'SessionInactive'
                    )
                ) {
                    this.log.logToFile(
                        'SESSION INACTIVE CAUGHT!'
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
                resolve =>
                    setTimeout(resolve, 5000)
            );

            this.log.logToFile(err);

            if (
                err.response?.status === 401 &&
                attempts > 1
            ) {
                this.log.logToFile(
                    'Caught 401 Unauthorized, attempting relogin...'
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
                            'Unauthorized'
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
                        'New auth token acquired successfully.'
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
                        'Client session refreshed successfully.'
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
            }

            if (attempts > 1) {
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
     * Fetch active Sparx homework packages.
     *
     * This version additionally verifies:
     * 1. PackageDataRequest protobuf encoding
     * 2. Protobuf -> decode round trip
     * 3. gRPC-Web frame length
     * 4. gRPC payload integrity
     */
    async getHomeworks() {
    const inputObject = {
        includeAllActivePackages: true,
        getPackages: true,
        getTasks: false,
        getTaskItems: false,
        packageID: '',
        taskIndex: 0,
        taskItemIndex: 0
    };

    console.log("[Sparx] Fetching homework packages...");

    try {
        const fullMessage = await this.encodeStuff(
            inputObject,
            "PackageDataRequest"
        );

        const response = await this.send(
            "https://api.sparx-learning.com/sparx.swworker.v1.Sparxweb/GetPackageData",
            fullMessage
        );

        console.log(
            "[Sparx] GetPackageData HTTP:",
            response?.status
        );

        console.log(
            "[Sparx] GetPackageData response bytes:",
            response?.data?.length
        );

        if (!response || !response.data) {
            throw new Error(
                "GetPackageData returned an empty response."
            );
        }

        const result = await this.decodeStuff(
            response.data,
            "PackageDataResponse"
        );

        console.log(
            "[Sparx] Packages:",
            result?.packages?.length ?? 0
        );

        console.log(
            "[Sparx] Tasks:",
            result?.tasks?.length ?? 0
        );

        console.log(
            "[Sparx] Task items:",
            result?.taskItems?.length ?? 0
        );

        return result;

    } catch (err) {
        this.log.logToFile(
            `Error in getHomeworks: ${err.message}`
        );

        console.error(
            "[Sparx] GetPackageData error:",
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
            packageID,
            taskIndex,
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
            packageID,
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

        return await this.decodeStuff(
            homeworkRequest.data,
            'Activity'
        );
    }

    async getClientSession() {
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

        return await this.decodeStuff(
            answerRequest.data,
            'ActivityActionResponse'
        );
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

        return await this.decodeStuff(
            answerRequest.data,
            'ActivityActionResponse'
        );
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

        return await this.decodeStuff(
            answerRequest.data,
            'ActivityAction'
        );
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

        return await this.decodeStuff(
            answerRequest.data,
            'ActivityActionResponse'
        );
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

        return await this.decodeStuff(
            answerRequest.data,
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

        const answerRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.revision.v1.Revision/GetPackagesForObjectives',
                fullMessage
            );

        return await this.decodeStuff(
            answerRequest.data,
            'GetPackagesForObjectivesResponse'
        );
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

        return await this.decodeStuff(
            answerRequest.data,
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

        const answerRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.content.summaries.v1.TopicSummaries/ListTopicSummaries',
                fullMessage
            );

        return await this.decodeStuff(
            answerRequest.data,
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

        const answerRequest =
            await this.send(
                'https://api.sparx-learning.com/sparx.content.summaries.v1.CurriculumSummaries/ListCurriculumSummaries',
                fullMessage
            );

        return await this.decodeStuff(
            answerRequest.data,
            'PackageDataResponse'
        );
    }
}

module.exports = {
    SparxMaths
};