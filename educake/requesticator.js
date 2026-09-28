const { spawn } = require('child_process');
const path = require('path');
require('dotenv').config();

class SimpleMutex {
    constructor() {
        this.queue = [];
        this.locked = false;
    }

    async acquire() {
        return new Promise(resolve => {
            const release = () => {
                if (this.queue.length > 0) {
                    const next = this.queue.shift();
                    next();
                } else {
                    this.locked = false;
                }
            };

            if (!this.locked) {
                this.locked = true;
                resolve(release);
            } else {
                this.queue.push(() => resolve(release));
            }
        });
    }
}

class PythonWorker {
    constructor() {
        this.scriptPath = path.resolve(
            __dirname,
            '../tools/curl_cffi_script.py'
        );

        this.process = null;
        this.mutex = new SimpleMutex();
        this.currentResolver = null;
        this.buffer = '';
    }

    start() {
        if (this.process && !this.process.killed) {
            return;
        }

        console.log(
            '[PythonWorker] Starting Persistent Python Worker...'
        );

        const pythonCommand =
            process.platform === 'win32'
                ? 'python'
                : 'python3';

        this.process = spawn(
            pythonCommand,
            [this.scriptPath],
            {
                stdio: ['pipe', 'pipe', 'pipe']
            }
        );

        this.process.stdout.on(
            'data',
            data => {
                const output =
                    data.toString();

                console.log(
                    '[PythonWorker] stdout:',
                    output.trim()
                );

                this.buffer += output;

                this.processBuffer();
            }
        );

        this.process.stderr.on(
            'data',
            data => {
                console.error(
                    '[PythonWorker] stderr:',
                    data.toString().trim()
                );
            }
        );

        this.process.on(
            'error',
            error => {
                console.error(
                    '[PythonWorker] Process error:',
                    error.message
                );

                if (this.currentResolver) {
                    this.currentResolver.reject(
                        error
                    );

                    this.currentResolver = null;
                }
            }
        );

        this.process.on(
            'close',
            code => {
                console.log(
                    `[PythonWorker] Worker exited with code ${code}`
                );

                this.process = null;

                if (this.currentResolver) {
                    this.currentResolver.reject(
                        new Error(
                            'Python worker process exited unexpectedly'
                        )
                    );

                    this.currentResolver = null;
                }

                this.buffer = '';
            }
        );
    }

    processBuffer() {
        let newlineIndex;

        while (
            (
                newlineIndex =
                    this.buffer.indexOf('\n')
            ) !== -1
        ) {
            const line =
                this.buffer
                    .slice(0, newlineIndex)
                    .trim();

            this.buffer =
                this.buffer.slice(
                    newlineIndex + 1
                );

            if (
                line &&
                this.currentResolver
            ) {
                console.log(
                    '[PythonWorker] Response line received.'
                );

                this.currentResolver.resolve(
                    line
                );

                this.currentResolver = null;
            }
        }
    }

    async execute(requestData) {
        if (!this.process) {
            this.start();
        }

        const release =
            await this.mutex.acquire();

        try {
            return await new Promise(
                (resolve, reject) => {
                    this.currentResolver = {
                        resolve,
                        reject
                    };

                    console.log(
                        '[PythonWorker] Sending request to Python:',
                        requestData.method,
                        requestData.url
                    );

                    const written =
                        this.process.stdin.write(
                            JSON.stringify(
                                requestData
                            ) + '\n'
                        );

                    if (!written) {
                        this.process.stdin.once(
                            'drain',
                            () => {
                                console.log(
                                    '[PythonWorker] stdin drained.'
                                );
                            }
                        );
                    }
                }
            );
        } finally {
            release();
        }
    }
}

const globalPythonWorker =
    new PythonWorker();

class curlRequesticator {
    constructor(cookies) {
        this.cookies = cookies;
    }

    async _executeCurl(
        url,
        headers,
        data = null,
        options = {}
    ) {
        console.log(
            '[curlRequesticator] REQUEST:',
            data ? 'POST' : 'GET',
            url
        );

        const requestData = {
            url,
            method: data ? 'POST' : 'GET',
            headers: {},
            cookies: this.cookies,
            data: null,
            is_binary_data: false
        };

        if (Array.isArray(headers)) {
            headers.forEach(header => {
                const parts =
                    header.split(':');

                if (parts.length >= 2) {
                    const key =
                        parts[0]
                            .trim()
                            .toLowerCase();

                    const value =
                        parts
                            .slice(1)
                            .join(':')
                            .trim();

                    requestData.headers[key] =
                        value;
                }
            });
        }

        if (Buffer.isBuffer(data)) {
            requestData.data =
                data.toString('base64');

            requestData.is_binary_data =
                true;

        } else if (data !== null && data !== undefined) {
            requestData.data =
                typeof data === 'object'
                    ? JSON.stringify(data)
                    : data;
        }

        console.log(
            '[curlRequesticator] Sending request to Python worker...'
        );

        try {
            const responseLine =
                await globalPythonWorker.execute(
                    requestData
                );

            console.log(
                '[curlRequesticator] Python response received.'
            );

            let result;

            try {
                result =
                    JSON.parse(responseLine);
            } catch (error) {
                console.error(
                    '[curlRequesticator] Invalid JSON from Python worker.'
                );

                throw error;
            }

            if (result.error) {
                console.error(
                    '[curlRequesticator] Python returned an error:',
                    result.error
                );

                throw new Error(
                    result.error
                );
            }

            console.log(
                '[curlRequesticator] HTTP status:',
                result.statusCode
            );

            const bodyBuffer =
                Buffer.from(
                    result.body || '',
                    'base64'
                );

            let responseBody;

            if (
                options.responseType ===
                'arraybuffer'
            ) {
                responseBody =
                    bodyBuffer;

            } else {
                const bodyString =
                    bodyBuffer.toString(
                        'utf8'
                    );

                try {
                    responseBody =
                        JSON.parse(
                            bodyString
                        );
                } catch {
                    responseBody =
                        bodyString;
                }
            }

            console.log(
                '[curlRequesticator] Response processed successfully.'
            );

            if (options.returnHeaders) {
                return {
                    status:
                        result.statusCode,

                    headers:
                        result.headers || {},

                    data:
                        responseBody
                };
            }

            return responseBody;

        } catch (error) {
            console.error(
                '[curlRequesticator] Python Request Failed:',
                error.message
            );

            throw error;
        }
    }
}


// ==========================================================
// EDUCAKE REQUESTICATOR
// ==========================================================

class Educake_Requesticator
    extends curlRequesticator {

    constructor(
        cookies,
        login = {}
    ) {
        super(cookies);

        this.login = login;
        this.sessionToken = null;
    }

    getHeaders() {
        const headers = [
            'accept: application/json;version=2',
            'accept-language: en-GB,en;q=0.9,en-US;q=0.8',
            'content-type: application/json',
            'origin: https://my.educake.co.uk',
            'referer: https://my.educake.co.uk/my-educake/',
            'sec-fetch-dest: empty',
            'sec-fetch-mode: cors',
            'sec-fetch-site: same-origin',
            'user-agent: Mozilla/5.0'
        ];

        if (this.sessionToken) {
            headers.push(
                `authorization: Bearer ${this.sessionToken}`
            );
        }

        return headers;
    }

    async sendDetailedRequest(
        url,
        data = null
    ) {
        console.log(
            '[Educake_Requesticator] Detailed request:',
            url
        );

        const response =
            await this._executeCurl(
                url,
                this.getHeaders(),
                data,
                {
                    returnHeaders: true
                }
            );

        if (!response) {
            console.error(
                '[Educake_Requesticator] Empty response.'
            );

            return null;
        }

        console.log(
            '[Educake_Requesticator] HTTP status:',
            response.status
        );

        console.log(
            '[Educake_Requesticator] Response type:',
            typeof response.data
        );

        if (
            response.data &&
            typeof response.data === 'object' &&
            !Buffer.isBuffer(response.data)
        ) {
            console.log(
                '[Educake_Requesticator] Response keys:',
                Object.keys(response.data)
            );
        } else {
            console.log(
                '[Educake_Requesticator] Response is not a JSON object.'
            );
        }

        if (response.headers) {
            console.log(
                '[Educake_Requesticator] Response header names:',
                Object.keys(response.headers)
            );
        }

        return response;
    }

    async sendRequest(
        url,
        data = null
    ) {
        console.log(
            '[Educake_Requesticator] sendRequest:',
            url
        );

        const response =
            await this._executeCurl(
                url,
                this.getHeaders(),
                data,
                {
                    returnHeaders: true
                }
            );

        if (!response) {
            return null;
        }

        console.log(
            '[Educake_Requesticator] HTTP status:',
            response.status
        );

        return response.data;
    }
}

module.exports =
    Educake_Requesticator;
