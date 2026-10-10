const curlRequesticator = require('../../utils/curlRequesticator');

class Image_Requesticator extends curlRequesticator {
  constructor(cookies) {
    super(cookies);

    this.additionalHeaders = [];

    this.headers = [
      'accept: image/*,*/*;q=0.8',
      'accept-language: en-GB,en;q=0.9,en-US;q=0.8',
      'origin: https://maths.sparx-learning.com/',
      'priority: u=1, i',
      'referer: https://maths.sparx-learning.com/',
      'sec-ch-ua: "Not(A:Brand";v="8", "Chromium";v="144", "Microsoft Edge";v="144"',
      'sec-ch-ua-mobile: ?0',
      'sec-ch-ua-platform: "Windows"',
      'sec-fetch-dest: image',
      'sec-fetch-mode: no-cors',
      'sec-fetch-site: same-site',
      'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0'
    ];
  }

  async sendRequest(url, data) {
    const headers = [
      ...this.headers,
      ...this.additionalHeaders
    ];

    const body = data;

    return this._executeCurl(
      url,
      headers,
      body,
      { responseType: 'arraybuffer', returnHeaders: true }
    );
  }
}

module.exports = Image_Requesticator;