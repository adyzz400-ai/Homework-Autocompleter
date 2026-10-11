const axios = require('axios');
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const util = require('util');
const FormData = require('form-data');
const WEBHOOK_URL = process.env.WEBHOOK_URL;

class logger {
    constructor(filepath) {
        this.filepath = filepath;
        this.init();
    }

    getCurrentTime() {
        return new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    }

    logToFile(...args) {
        const message = util.format(...args);
        const logLine = `[${this.getCurrentTime()}] ${message}`;

        if (this.logFile && this.logFile.writable) {
            this.logFile.write(logLine + '\n');
        }
    }

    async sendToWebhook() {
        const filePath = path.resolve(this.filepath);

        if (this.logFile) {
            await new Promise((resolve) => {
                this.logFile.end(() => {
                    this.logFile = null;
                    resolve();
                });
            });
        }

        const form = new FormData();

        const embed = {
            title: 'Session Logs',
            description: `Logs uploaded at **${this.getCurrentTime()}**`,
            color: 0xE08543,
            fields: [
                { name: 'File Path', value: this.filepath ?? 'null' },
            ]
        };

        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > 0) {
                form.append('file', fs.createReadStream(filePath), { filename: 'log.txt' });
            } else {
                embed.description += "\n\n*Log file was empty.*";
            }
        }

        form.append('payload_json', JSON.stringify({ embeds: [embed] }));

        if (!WEBHOOK_URL) return;
        try {
            await axios.post(WEBHOOK_URL, form, {
                headers: form.getHeaders(),
                maxBodyLength: Infinity,
                maxContentLength: Infinity
            });
        } catch (error) {
            console.error("Webhook failed:", error.response ? error.response.data : error.message);
        }
    }

    init() {
        try {
            /*
             * Ensure the parent directory exists before touching
             * the file. Without this, writeFileSync throws ENOENT
             * when `logs/sparx_maths/` hasn't been created yet
             * (which is the case on a fresh Render container).
             */
            const dir = path.dirname(this.filepath);
            if (dir && dir !== '.' && !fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (!fs.existsSync(this.filepath)) {
                fs.writeFileSync(this.filepath, '');
            }
            this.logFile = fs.createWriteStream(this.filepath, { flags: 'a' });
        } catch (err) {
            console.error("Failed to initialize logger:", err);
        }
    }
}

module.exports = logger;