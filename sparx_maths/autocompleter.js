const {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ComponentType,
    AttachmentBuilder,
    ContainerBuilder,
    FileBuilder,
    TextDisplayBuilder
} = require('discord.js');

const {
    emojis,
    footerText,
    footerIcon
} = require('../startEmbeds/info.js');

const fs = require('fs');
const path = require('path');

const {
    parser,
    parseBookwork,
    parseBookworkData,
    parseQuestion
} = require('./parser');

const {
    getBookworks,
    addToDbBookwork
} = require('../database/bookwork.js');

const {
    addToDb,
    checkAnswer,
    getWorkingOut,
    addWorkingOut
} = require('../database/maths.js');

const {
    getBookworkCheckAnswer
} = require('./bookwork.js');

const {
    convertToPDF
} = require('./latexPDF.js');

const {
    logError
} = require('../utils/errorLogger.js');

const progressTracker =
    require('../utils/progressTracker.js');

const formatTime =
    require('../utils/formatTime');

const getProgressBar =
    require('../utils/getProgressBar');

const getAIanswer =
    require('../utils/getAIanswer.js');

const {
    updateStats
} = require('../database/accounts.js');

const logger =
    require('../utils/logger.js');

const userAutocompleters = {};

const {
    ai
} = require('../config.json');

const convertAItoObject =
    require('../utils/convertAItoObject.js');

const {
    checkAccount
} = require('../database/accounts.js');

function stripWorkingOut(obj) {
    const result = {};

    for (const [key, value] of Object.entries(obj)) {
        if (
            typeof value === "object" &&
            value !== null &&
            "answer" in value &&
            "working_out" in value
        ) {
            result[key] = value.answer;
        } else {
            result[key] = value;
        }
    }

    return result;
}

function getWorkingOutData(arr) {
    const index =
        arr.findIndex(
            item => item.key === 'WORKING OUT'
        );

    let workingOut;

    if (index !== -1) {
        workingOut = arr[index].value;
        arr.splice(index, 1);
    }

    return workingOut;
}

function parseBookworksColumn(raw) {
    if (raw === null || raw === undefined) {
        return {};
    }

    if (typeof raw === 'object' && !Array.isArray(raw)) {
        return raw;
    }

    if (Array.isArray(raw)) {
        console.warn(
            '[Sparx Maths] bookworks column is an array; falling back to {}'
        );
        return {};
    }

    try {
        const parsed = JSON.parse(String(raw));
        if (
            parsed &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed)
        ) {
            return parsed;
        }
        return {};
    } catch (err) {
        console.error(
            '[Sparx Maths] Failed to parse bookworks JSON:',
            err
        );
        return {};
    }
}

class sparxMathsAutocompleter {

    constructor(
        sparxMaths,
        interaction,
        packageID,
        timeSettings,
        log,
        pdfSettings
    ) {
        this.sparxMaths = sparxMaths;
        this.interaction = interaction;
        this.packageID = packageID;
        this.log = log;
        this.currentBookmark = null;
        this.bookmarks = {};
        this.pdfSettings = pdfSettings;
        this.timeSettings = timeSettings;
        this.lastSubmitAt = null;
        this.totalFakeTime = 0;
    }

    async sendBookWork() {

        const bookworkRow =
            await getBookworks(
                this.packageID
            );

        const bookworksObj =
            parseBookworksColumn(
                bookworkRow && bookworkRow.bookworks
            );

        const pdfAttachment =
            await convertToPDF(
                bookworksObj,
                this.packageID,
                this.pdfSettings.working_out,
                this.pdfSettings.question
            );

        try {

            if (
                pdfAttachment &&
                fs.existsSync(pdfAttachment)
            ) {

                const attachment =
                    new AttachmentBuilder(
                        pdfAttachment,
                        {
                            name: 'results.pdf'
                        }
                    );

                const container =
                    new ContainerBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder()
                                .setContent(
                                    '# Session Finished!'
                                ).data
                        )
                        .addFileComponents(
                            new FileBuilder()
                                .setURL(
                                    'attachment://results.pdf'
                                )
                        );

                await this.interaction.user.send({
                    files: [attachment],
                    components: [container],
                    flags: 32768
                });

                fs.unlinkSync(
                    pdfAttachment
                );

            } else {

                await this.interaction.user.send({
                    components: [
                        new ContainerBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder()
                                    .setContent(
                                        '# Session Finished!\nCould not generate a PDF of the bookwork codes.'
                                    ).data
                            )
                    ]
                });
            }

        } catch (e) {
            console.log(
                "Failed to send feedback DM:",
                e
            );
        }
    }

    async addAnswer(answer) {

        this.bookmarks[
            this.currentBookmark
        ] = answer;

        await addToDbBookwork(
            this.packageID,
            {
                [this.currentBookmark]:
                    this.bookmarks[
                        this.currentBookmark
                    ]
            }
        );
    }

    async readyBookwork(activityIndex) {

        const readyObj = {
            "activityIndex": activityIndex,
            "action": {
                "oneofKind": "wac",
                "wac": {
                    "actionType": 0,
                    "extraData": {}
                }
            },
            "timestamp": this.getTimestamp()
        };

        await this.sparxMaths.readyQuestion(
            readyObj
        );
    }

    async readyQuestion(
        questionIndex,
        activityIndex
    ) {

        const readyObj = {
            "activityIndex": activityIndex,
            "action": {
                "oneofKind": "question",
                "question": {
                    "questionIndex": questionIndex,
                    "actionType": 0
                }
            },
            "timestamp": this.getTimestamp()
        };

        return await this.sparxMaths.readyQuestion(
            readyObj
        );
    }

    async waitBetweenQuestions(
        index,
        taskTitle,
        progressUpdater,
        cancelledFlag
    ) {

        const min = Number(this.timeSettings?.min);
        const max = Number(this.timeSettings?.max);

        const minOk =
            Number.isInteger(min) && min >= 0;
        const maxOk =
            Number.isInteger(max) && max >= 0;

        if (!minOk || !maxOk || max <= 0) {
            return;
        }

        if (min > max) {
            console.error(
                `[Sparx Maths] invalid time settings: min=${min} > max=${max}; no wait applied`
            );
            return;
        }

        const targetGapSec =
            Math.floor(
                Math.random() * (max - min + 1)
            ) + min;

        if (targetGapSec <= 0) {
            return;
        }

        const now = Date.now();
        let waitMs;

        if (
            this.lastSubmitAt === null ||
            this.lastSubmitAt === undefined
        ) {
            waitMs = targetGapSec * 1000;
        } else {
            const elapsed = now - this.lastSubmitAt;
            waitMs = Math.max(
                0,
                (targetGapSec * 1000) - elapsed
            );
        }

        if (waitMs <= 0) {
            return;
        }

        const waitSec = Math.ceil(waitMs / 1000);
        const interval = 3000;
        let elapsedLoop = 0;

        await progressUpdater.updateEmbed(
            `⏳ Waiting to submit Question ${index} at ${taskTitle} \`<t:${Math.floor(Date.now() / 1000) + waitSec}:R>\`...`
        );

        while (
            elapsedLoop < waitMs &&
            !cancelledFlag()
        ) {
            const timeLeft = waitMs - elapsedLoop;
            const sleep = Math.min(interval, timeLeft);

            await new Promise(
                resolve => setTimeout(resolve, sleep)
            );

            elapsedLoop += sleep;
        }
    }

    async answerQuestion(
        answerObject,
        sparxMathsExecuter,
        working_out,
        question
    ) {

        const answerResponse =
            await this.sparxMaths.answerQuestion(
                answerObject
            );

        this.log.logToFile('---');
        this.log.logToFile(answerResponse);

        if (
            !answerResponse ||
            !answerResponse.response ||
            typeof answerResponse.response !== 'object'
        ) {
            this.log.logToFile(
                '[Sparx Maths] answerQuestion: malformed response (no .response)'
            );
            return false;
        }

        if (
            answerResponse.response.status !== 'SUCCESS'
        ) {
            return false;
        }

        this.lastSubmitAt = Date.now();

        if (
            answerObject.action.oneofKind === 'wac'
        ) {
            return true;
        }

        const given =
            answerResponse.response.givenAnswerXML;

        if (typeof given !== 'string') {
            this.log.logToFile(
                '[Sparx Maths] answerQuestion: SUCCESS with no givenAnswerXML -> partial'
            );
            return 'partial';
        }

        const result =
            given
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

        await sparxMathsExecuter.addAnswer({
            answer: result,
            working_out,
            question
        });

        return true;
    }

    async answerTimesTable(activityIndex) {

        const timesTableInput = {
            "activityIndex": activityIndex,
            "action": {
                "oneofKind": "game",
                "game": {
                    "action": {
                        "oneofKind": "tablesAnswer",
                        "tablesAnswer": {
                            "answers": [
                                {
                                    "questionText": "6x5=?,30",
                                    "answerText": "30",
                                    "correct": true,
                                    "timedOut": false,
                                    "timeTaken": 2.959,
                                    "game": "100club",
                                    "enterCorrectionPhase": false,
                                    "leaveCorrectionPhase": false,
                                    "inputString": "0",
                                    "questionGap": 1000,
                                    "badData": false,
                                    "questionSetID": "tables",
                                    "deliveryMechanism": "basicKeypad",
                                    "target": false,
                                    "numPendingTalkAndLearns": 0,
                                    "context": 1,
                                    "didNotKnow": false,
                                    "indexWithinQuiz": 0,
                                    "talPromptType": "",
                                    "secondChance": false,
                                    "talCycleCount": 0,
                                    "indexWithinGameSession": 0,
                                    "isEndOfQuiz": false,
                                    "answerTime": this.getTimestamp()
                                }
                            ]
                        }
                    }
                }
            },
            "timestamp": this.getTimestamp()
        };

        await this.sparxMaths.answerTimesTable(
            timesTableInput
        );
    }

    async startTimesTable(
        packageId,
        taskIndex
    ) {

        const timesTableInput = {
            "activityType": 3,
            "payload": {
                "oneofKind": "gameID",
                "gameID": "HundredClub"
            },
            "method": 0,
            "clientFeatureFlags": {},
            "taskItem": {
                "packageID": packageId,
                "taskIndex": taskIndex,
                "taskItemIndex": 0,
                "taskState": 0
            },
            "timestamp": this.getTimestamp()
        };

        const timestableStarted =
            await this.sparxMaths.startTimesTable(
                timesTableInput
            );

        return timestableStarted.activityIndex;
    }

    getTimestamp(addToUser) {
        return {
            "seconds": Math.floor(Date.now() / 1000),
            "nanos": 0
        };
    }
}

async function checkDB(
    question,
    activityIndex,
    questionIndex,
    interaction
) {

    const answer = await checkAnswer(question);

    if (!answer) {
        return answer;
    }

    const answerObject = {
        "activityIndex": activityIndex,
        "action": {
            "oneofKind": "question",
            "question": {
                "questionIndex": questionIndex,
                "actionType": 1,
                "answer": {
                    "components": answer,
                    "hash": ""
                }
            }
        },
        "timestamp":
            userAutocompleters[
                interaction.user.id
            ].getTimestamp(true)
    };

    return answerObject;
}

async function sparxMathsAutocomplete(
    interaction,
    packageID,
    sparxMaths,
    timeSettings
) {

    const apikey =
        (
            await checkAccount(
                interaction.user.id
            )
        ).apikey;

    const ai =
        convertAItoObject(
            timeSettings.model
        );

    const log = new logger(
        `logs/sparx_maths/${interaction.user.id}.txt`
    );

    sparxMaths.log = log;

    log.logToFile('Logging Start');
    log.logToFile(
        `**Settings**\nMin Time: ${timeSettings.min}\nMax Time: ${timeSettings.max}\nPDF Settings: ${JSON.stringify(timeSettings.pdfSettings, null, 2)}`
    );

    const {
        queueMaths
    } = require('../queues/queue');

    const taskTimer = process.hrtime();

    const previousPage = new ButtonBuilder()
        .setCustomId('sparx_progress_prev')
        .setLabel('Previous')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary);

    const nextPage = new ButtonBuilder()
        .setCustomId('sparx_progress_next')
        .setLabel('Next')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary);

    const cancel = new ButtonBuilder()
        .setCustomId('cancel')
        .setLabel('Cancel')
        .setEmoji(emojis.x)
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder()
        .addComponents(previousPage, nextPage, cancel);

    const initialEmbed = new EmbedBuilder()
        .setColor(0xE53935)
        .setTitle('✨ Sparx Maths — Progress')
        .setDescription(' Preparing your homework session...');

    const wantWorkingOut =
        timeSettings.pdfSettings.working_out;

    const sparxMathsExecuter =
        new sparxMathsAutocompleter(
            sparxMaths,
            interaction,
            packageID,
            {
                min: timeSettings.min,
                max: timeSettings.max
            },
            log,
            timeSettings.pdfSettings
        );

    userAutocompleters[
        interaction.user.id
    ] = sparxMathsExecuter;

    let errorOccured = false;

    const tasks =
        await sparxMaths.getTasks(packageID);

    const sectionsProgress = [];
    let currentGroup = [];

    for (const task of tasks.tasks) {

        let progressEntry = { name: task.title };

        if (task.title.endsWith('Times Tables')) {
            progressEntry.current =
                Number(task.completion.progress.C) || 0;
            progressEntry.total =
                Number(task.completion.size) || 1;
        } else {
            progressEntry.current =
                Number(task.numTaskItemsDone) || 0;
            progressEntry.total =
                Number(task.numTaskItems) || 1;
        }

        progressEntry.value =
            await getProgressBar(
                progressEntry.current,
                progressEntry.total
            );

        currentGroup.push(progressEntry);

        if (currentGroup.length === 5) {
            sectionsProgress.push(currentGroup);
            currentGroup = [];
        }
    }

    if (currentGroup.length > 0) {
        sectionsProgress.push(currentGroup);
    }

    const getTimeField = function () {
        return `> **Time Spent**: ${formatTime(
            (process.hrtime(taskTimer))[0]
        )}`;
    };

    const progressUpdater = new progressTracker(
        interaction,
        getTimeField
    );

    let collector = null;

    try {

        let cancelled = false;

        if (
            await progressUpdater.start(
                initialEmbed,
                row,
                sectionsProgress
            )
        ) {
            return;
        }

        collector = progressUpdater.targetMessage
            .createMessageComponentCollector({
                componentType: ComponentType.Button
            });

        collector.on('collect', async (buttonInteraction) => {

            await buttonInteraction.deferUpdate();

            if (buttonInteraction.customId === 'cancel') {
                cancelled = true;
                await progressUpdater.updateEmbed(
                    `🛑 Cancelling...`
                );
                return;
            }

            if (buttonInteraction.customId === 'sparx_progress_prev') {
                await progressUpdater.changePage(-1);
                return;
            }

            if (buttonInteraction.customId === 'sparx_progress_next') {
                await progressUpdater.changePage(1);
                return;
            }
        });

        for (const task of tasks.tasks) {

            if (cancelled) break;

            await progressUpdater.updateEmbed(
                `📚 Moving on to ${task.title}...`
            );

            if (cancelled) break;

            log.logToFile(
                `📚 Moving on to ${task.title}...`
            );

            if (
                task.title.endsWith('Times Tables') &&
                (
                    task.completion.size >
                    (task.completion?.progress?.C ?? 0)
                )
            ) {

                log.logToFile('Timestable detected');

                await progressUpdater.updateEmbed(
                    `Completing Times Table...`
                );

                if (cancelled) break;

                let activityIndex =
                    await sparxMathsExecuter.startTimesTable(
                        packageID,
                        task.taskIndex
                    );

                if (cancelled) break;

                for (let i = 0; i < 50; i++) {
                    if (cancelled) break;
                    await sparxMathsExecuter.answerTimesTable(
                        activityIndex
                    );
                }

                await progressUpdater.updateProgressBar(
                    task.taskIndex - 1,
                    1,
                    1
                );

                continue;
            }

            const taskItems =
                await sparxMaths.getTasksItems(
                    packageID,
                    task.taskIndex
                );

            if (cancelled) break;

            let index = 1;

            while (true) {

                if (cancelled) break;

                if (taskItems[index - 1]?.status === 1) {
                    index++;
                    continue;
                } else if (
                    taskItems[index - 1]?.status === undefined
                ) {
                    break;
                }

                const item =
                    await sparxMaths.getActivity(
                        sparxMathsExecuter.getTimestamp(),
                        packageID,
                        task.taskIndex,
                        index
                    );

                if (cancelled) break;
                if (item === 'break') break;

                async function completeBookwork(item) {

                    if (
                        !item ||
                        item?.payload?.oneofKind === undefined
                    ) {

                        const bookworkInitialData =
                            await sparxMaths.getActivity(
                                sparxMathsExecuter.getTimestamp(),
                                packageID,
                                task.taskIndex,
                                index,
                                1
                            );

                        if (cancelled) return true;

                        const folderPath = path.join(
                            __dirname,
                            'tasks_temp'
                        );

                        const filePath = path.join(
                            folderPath,
                            `${index}_bookwork_${task.taskIndex}.json`
                        );

                        fs.mkdirSync(
                            path.dirname(filePath),
                            { recursive: true }
                        );

                        fs.writeFileSync(
                            filePath,
                            JSON.stringify(
                                bookworkInitialData,
                                null,
                                1
                            ),
                            'utf8'
                        );

                        let activityIndex =
                            bookworkInitialData.activityIndex;

                        await progressUpdater.updateEmbed(
                            `Answering Bookwork Check...`
                        );

                        if (cancelled) return true;

                        const bookworkRow =
                            await getBookworks(packageID);

                        if (cancelled) return true;

                        const bookmarks =
                            stripWorkingOut(
                                parseBookworksColumn(
                                    bookworkRow &&
                                        bookworkRow.bookworks
                                )
                            );

                        const bookmarksCorrectAnswer =
                            await parseBookworkData(
                                bookworkInitialData
                                    .payload
                                    .wac,
                                bookmarks
                            );

                        if (cancelled) return true;

                        if (bookmarksCorrectAnswer) {

                            log.logToFile(
                                bookmarksCorrectAnswer
                            );

                            const bookworkAnswer =
                                parseBookwork(
                                    activityIndex,
                                    bookmarksCorrectAnswer,
                                    interaction
                                );

                            await sparxMathsExecuter
                                .readyBookwork(activityIndex);

                            if (cancelled) return true;

                            await sparxMathsExecuter
                                .answerQuestion(
                                    bookworkAnswer,
                                    sparxMathsExecuter
                                );

                            return true;
                        }

                        log.logToFile(
                            "Bookwork not found in the stuff"
                        );

                        let commonAnswersPrevious = [];
                        let counterComplete = 0;

                        while (
                            commonAnswersPrevious.length !== 1 &&
                            counterComplete < 15
                        ) {

                            if (cancelled) break;

                            const data =
                                await sparxMaths.getActivity(
                                    sparxMathsExecuter.getTimestamp(),
                                    packageID,
                                    task.taskIndex,
                                    index,
                                    1
                                );

                            if (cancelled) break;

                            activityIndex = data.activityIndex;

                            const commonAnswers =
                                getBookworkCheckAnswer(
                                    data,
                                    commonAnswersPrevious
                                );

                            commonAnswersPrevious =
                                commonAnswers;
                            counterComplete++;
                        }

                        if (cancelled) return true;

                        if (
                            !commonAnswersPrevious ||
                            commonAnswersPrevious.length === 0
                        ) {
                            log.logToFile(
                                '[Sparx Maths] bookwork convergence failed; skipping'
                            );
                            return true;
                        }

                        const bookworkAnswer =
                            parseBookwork(
                                activityIndex,
                                commonAnswersPrevious[0],
                                interaction
                            );

                        await sparxMathsExecuter
                            .readyBookwork(activityIndex);

                        if (cancelled) return true;

                        await sparxMathsExecuter
                            .answerQuestion(
                                bookworkAnswer,
                                sparxMathsExecuter
                            );

                        return true;
                    }

                    return false;
                }

                if (await completeBookwork(item)) continue;

                if (cancelled) break;

                await progressUpdater.updateEmbed(
                    `📝 Starting Question ${index} at ${task.title}...`
                );

                if (cancelled) break;

                log.logToFile(
                    `📝 Starting Question ${index} at ${task.title}...`
                );

                if (taskItems[index - 1]?.status === 1) {

                    await progressUpdater.updateEmbed(
                        `Question ${index} at ${task.title} already finished, moving onto next question...`
                    );

                    log.logToFile(
                        `✅ Question ${index} at ${task.title} is already finished, moving onto the next question...`
                    );

                    index++;
                    continue;
                }

                sparxMathsExecuter.currentBookmark =
                    item.payload.question.bookworkCode;

                async function attemptQuestion(attempts = 1) {

                    if (cancelled) return 'break';

                    const item =
                        await sparxMaths.getActivity(
                            sparxMathsExecuter.getTimestamp(),
                            packageID,
                            task.taskIndex,
                            index
                        );

                    if (cancelled) return 'break';
                    if (item === 'break') return 'break';

                    if (await completeBookwork(item)) {
                        return 'continue';
                    }

                    if (cancelled) return 'break';

                    const model = ai[attempts - 1];

                    if (!model && attempts > 1) {
                        return 'blank';
                    }

                    const activityIndex = item.activityIndex;
                    const questionIndex =
                        item.payload.question.questionIndex;
                    const questionLayout =
                        JSON.parse(
                            item.payload.question.questionSpec
                        );

                    const folderPath = path.join(
                        __dirname,
                        'tasks_temp'
                    );

                    const filePath = path.join(
                        folderPath,
                        `${index}_${task.taskIndex}.json`
                    );

                    fs.mkdirSync(
                        path.dirname(filePath),
                        { recursive: true }
                    );

                    fs.writeFileSync(
                        filePath,
                        JSON.stringify(
                            questionLayout,
                            null,
                            1
                        ),
                        'utf8'
                    );

                    log.logToFile(item);

                    await sparxMathsExecuter.readyQuestion(
                        questionIndex,
                        activityIndex
                    );

                    if (cancelled) return 'break';

                    let workingOut;

                    let questionObjectSend =
                        await checkDB(
                            item.payload.question.questionSpec,
                            activityIndex,
                            questionIndex,
                            interaction
                        );

                    if (cancelled) return 'break';

                    if (questionObjectSend) {
                        workingOut =
                            await getWorkingOut(
                                item.payload.question.questionSpec
                            );

                        if (cancelled) return 'break';
                    }

                    let alreadyInDB = true;

                    if (!questionObjectSend && !ai[0]) {
                        return 'blank';
                    }

                    if (
                        !questionObjectSend ||
                        (
                            !workingOut &&
                            wantWorkingOut &&
                            ai[0]
                        )
                    ) {

                        alreadyInDB = false;

                        questionObjectSend =
                            await getAIanswer(
                                () =>
                                    parser(
                                        apikey,
                                        questionLayout[0],
                                        activityIndex,
                                        questionIndex,
                                        model,
                                        interaction
                                    ),
                                queueMaths,
                                interaction,
                                progressUpdater,
                                60000,
                                3000,
                                () => cancelled
                            );

                        if (cancelled) return 'break';
                    } else {

                        questionObjectSend
                            .action
                            .question
                            .answer
                            .components =
                            questionObjectSend
                                .action
                                .question
                                .answer
                                .components
                                .map(JSON.parse);
                    }

                    if (questionObjectSend === 'break') {
                        return 'break';
                    }

                    if (wantWorkingOut) {
                        workingOut = getWorkingOutData(
                            questionObjectSend
                                .action
                                .question
                                .answer
                                .components
                        );
                    }

                    log.logToFile(
                        questionObjectSend?.action?.question?.answer?.components,
                        'Working out',
                        workingOut
                    );

                    if (attempts === 1) {

                        await sparxMathsExecuter
                            .waitBetweenQuestions(
                                index,
                                task.title,
                                progressUpdater,
                                () => cancelled
                            );

                        if (cancelled) return 'break';
                    }

                    const questionSuccess =
                        await sparxMathsExecuter
                            .answerQuestion(
                                questionObjectSend,
                                sparxMathsExecuter,
                                workingOut,
                                parseQuestion(questionLayout[0])
                            );

                    if (cancelled) return 'break';

                    const isFullSuccess =
                        questionSuccess === true;

                    if (isFullSuccess) {
                        task.numTaskItemsDone++;
                    }

                    await progressUpdater.updateProgressBar(
                        task.taskIndex - 1,
                        task.numTaskItemsDone,
                        task.numTaskItems
                    );

                    if (cancelled) return 'break';

                    if (isFullSuccess && !alreadyInDB) {

                        await addToDb(
                            item.payload.question.questionSpec,
                            questionObjectSend
                                .action
                                .question
                                .answer
                                .components
                        );

                        if (cancelled) return 'break';

                        if (workingOut) {
                            await addWorkingOut(
                                item.payload.question.questionSpec,
                                workingOut
                            );

                            if (cancelled) return 'break';
                        }
                    }

                    if (!isFullSuccess && attempts < 3) {

                        if (attempts === 1) {
                            await progressUpdater.updateEmbed(
                                `🔄 Retrying Question ${index} at ${task.title}...`
                            );
                        } else if (attempts === 2) {
                            await progressUpdater.updateEmbed(
                                `🔄 Retrying Question ${index} at ${task.title}...`
                            );
                        }

                        if (cancelled) return 'break';

                        return await attemptQuestion(
                            attempts + 1
                        );
                    }

                    if (!isFullSuccess && attempts >= 3) {
                        log.logToFile(
                            `[Sparx Maths] question ${index} at ${task.title} failed after ${attempts} attempts (last=${questionSuccess})`
                        );
                        await progressUpdater.updateEmbed(
                            `⚠️ Question ${index} at ${task.title} failed after 3 attempts, moving on...`
                        );
                        return 'blank';
                    }
                }

                await progressUpdater.updateEmbed(
                    `📝 Answering Question ${index} at ${task.title}...`
                );

                if (cancelled) break;

                const attemptQuestionResponse =
                    await attemptQuestion();

                if (attemptQuestionResponse === 'break') {
                    break;
                } else if (
                    attemptQuestionResponse === 'continue'
                ) {
                    continue;
                }

                index++;
            }

            await progressUpdater.updateEmbed(
                `✅ Completed ${task.title}`
            );
        }

    } catch (err) {

        log.logToFile(err);
        logError(err, null, 'Sparx Maths');
        errorOccured = true;

    } finally {

        if (collector) {
            try { collector.stop(); } catch (e) {
                console.error('[Sparx Maths] collector.stop failed:', e);
            }
        }

        try { await log.sendToWebhook(); } catch (e) {
            console.error('[Sparx Maths] log.sendToWebhook failed:', e);
        }

        try { await sparxMathsExecuter.sendBookWork(); } catch (e) {
            console.error('[Sparx Maths] sendBookWork failed:', e);
        }

        try {
            if (errorOccured) {
                await progressUpdater.updateEmbed(
                    `An Unexpected Error has occured!`
                );
            } else {
                await progressUpdater.updateEmbed(`Finished`);
            }
        } catch (e) {
            console.error(
                '[Sparx Maths] progressUpdater.updateEmbed (final) failed:', e
            );
        }

        try { await progressUpdater.end(); } catch (e) {
            console.error('[Sparx Maths] progressUpdater.end failed:', e);
        }

        try {
            await updateStats(
                interaction.user.id,
                'maths',
                (process.hrtime(taskTimer))[0]
            );
        } catch (e) {
            console.error('[Sparx Maths] updateStats failed:', e);
        }

        try {
            delete userAutocompleters[interaction.user.id];
        } catch (e) {
            console.error(
                '[Sparx Maths] delete userAutocompleters failed:', e
            );
        }

        try {
            await queueMaths.terminateSession(
                interaction.user.id
            );
        } catch (e) {
            console.error(
                '[Sparx Maths] queueMaths.terminateSession failed:', e
            );
        }
    }
}

module.exports = {
    sparxMathsAutocomplete,
    userAutocompleters
};