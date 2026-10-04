require('dotenv').config();

async function getClientSession(requesticator) {
    const url =
        "https://api.sparx-learning.com/sparx.messaging.server.v1.SWServerSession/ClientSession";

    // Empty gRPC-Web request.
    const body = Buffer.from([
        0x00,
        0x00,
        0x00,
        0x00,
        0x00
    ]);

    console.log(
        "[Sparx ClientSession] Sending request..."
    );

    const response = await requesticator.sendRequest(
        url,
        body
    );

    if (!response) {
        throw new Error(
            "[Sparx ClientSession] No response received"
        );
    }

    const status = response.status;

    console.log(
        `[Sparx ClientSession] HTTP status: ${status}`
    );

    /*
     * IMPORTANT:
     * Do not try to protobuf-decode an HTTP error response.
     */
    if (status !== 200) {
        let safeDetails = "";

        if (response.data) {
            if (Buffer.isBuffer(response.data)) {
                safeDetails =
                    `Response body length: ${response.data.length} bytes`;
            } else if (typeof response.data === "string") {
                safeDetails =
                    `Response body length: ${response.data.length} chars`;
            } else {
                safeDetails =
                    `Response body type: ${typeof response.data}`;
            }
        }

        throw new Error(
            `[Sparx ClientSession] ClientSession returned HTTP ${status}. ${safeDetails}`
        );
    }

    if (
        !response.data ||
        !Buffer.isBuffer(response.data)
    ) {
        throw new Error(
            "[Sparx ClientSession] Successful response did not contain binary data"
        );
    }

    console.log(
        `[Sparx ClientSession] Received ${response.data.length} bytes`
    );

    return response.data;
}

module.exports = {
    getClientSession
};