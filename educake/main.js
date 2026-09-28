const {
    EmbedBuilder,
    StringSelectMenuOptionBuilder,
    LabelBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonStyle,
    StringSelectMenuBuilder,
    ComponentType
} = require('discord.js');

const {
    emojis,
    footerText,
    footerIcon
} = require('../startEmbeds/info.js');

const getProgressBar =
    require('../utils/getProgressBar');

const formatTime =
    require('../utils/formatTime');

const {
    checkAccount,
    updateDB,
    updateStats
} = require('../database/accounts');

const {
    addToDbEducake,
    checkAnswer
} = require('../database/educake');

const {
    educakeLogin
} = require('./puppeteer');

const {
    geminiAnswer
} = require('../gemini/educake/main');

const progressTracker =
    require('../utils/progressTracker');

const dueDate =
    require('../utils/dueDate');

const Educake_Requesticator =
    require('./requesticator.js');

const shorten =
    require('../utils/shorten');

const {
    validAccount,
    useUpSlot
} = require('../handlers/accountHandler');

const getAIanswer =
    require('../utils/getAIanswer');

const puppetQueue =
    require('../queues/puppeteerQueue.js');

const config =
    require('../config.json');

const userSessions = {};
const userMenus = {};

const EMBED_COLOR = 0x7a5b99;


// ==========================================================
// SAVE ACCOUNT BUTTON
// ==========================================================

const saveAccountBtn = new ButtonBuilder()
    .setCustomId('save_account')
    .setLabel('Save Account')
    .setEmoji(emojis.save_account)
    .setStyle(ButtonStyle.Secondary);


// ==========================================================
// EDUCAKE AUTOCOMPLETER
// ==========================================================

async function educake_autocompleter(
    interaction,
    userSession,
    retake,
    timeSettings,
    selectedQuizzes
) {
    if (
        !selectedQuizzes ||
        selectedQuizzes.length === 0
    ) {
        return;
    }

    const cancel = new ButtonBuilder()
        .setCustomId('cancel')
        .setLabel('Cancel')
        .setEmoji(emojis.x)
        .setStyle(ButtonStyle.Danger);

    const row =
        new ActionRowBuilder()
            .addComponents(cancel);

    const initialEmbed =
        new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle('Educake Autocompleter')
            .setDescription('`Starting...`');

    if (footerText) {
        initialEmbed.setFooter({
            text: footerText,
            iconURL: footerIcon || undefined
        });
    }

    const sectionsProgress = [];
    let currentGroup = [];

    for (const qId of selectedQuizzes) {
        currentGroup.push({
            name: `Quiz ${qId}`,
            value: getProgressBar(0, 1)
        });

        if (currentGroup.length === 5) {
            sectionsProgress.push(currentGroup);
            currentGroup = [];
        }
    }

    if (currentGroup.length > 0) {
        sectionsProgress.push(currentGroup);
    }

    let totalCorrectCount = 0;
    let totalQuestionsCount = 0;

    const taskTimer = process.hrtime();

    const getTimeField = function () {
        return `> **Accuracy**: ${
            totalQuestionsCount
                ? Math.round(
                      (totalCorrectCount /
                          totalQuestionsCount) *
                          100
                  )
                : 0
        }%\n> **Time Spent**: ${formatTime(
            process.hrtime(taskTimer)[0]
        )}`;
    };

    const progressUpdater =
        new progressTracker(
            interaction,
            getTimeField
        );

    if (
        await progressUpdater.start(
            initialEmbed,
            row,
            sectionsProgress
        )
    ) {
        return;
    }

    let cancelled = false;

    const collector =
        progressUpdater.targetMessage
            .createMessageComponentCollector({
                componentType:
                    ComponentType.Button
            });

    collector.on(
        'collect',
        async componentInteraction => {
            await componentInteraction.deferUpdate();

            if (
                componentInteraction.customId ===
                'cancel'
            ) {
                cancelled = true;

                await progressUpdater.updateEmbed(
                    'Cancelling...'
                );
            }
        }
    );

    for (
        let quizIdx = 0;
        quizIdx < selectedQuizzes.length;
        quizIdx++
    ) {
        if (cancelled) {
            break;
        }

        let quizId =
            selectedQuizzes[quizIdx];

        const quizAnswers =
            await userSession.sendRequest(
                `https://my.educake.co.uk/api/student/quiz/${quizId}${
                    retake ? '/retake' : ''
                }`
            );

        if (
            !quizAnswers ||
            !quizAnswers.attempt
        ) {
            throw new Error(
                '[Educake] Invalid quiz response.'
            );
        }

        const attemptIds =
            Object.values(
                quizAnswers.attempt
            );

        if (!attemptIds.length) {
            throw new Error(
                '[Educake] No quiz attempt found.'
            );
        }

        quizId = attemptIds[0].id;

        const attempt =
            quizAnswers.attempt[quizId];

        if (!attempt) {
            throw new Error(
                '[Educake] Quiz attempt data missing.'
            );
        }

        const assessmentId =
            attempt.assessmentId;

        await userSession.sendRequest(
            'https://my.educake.co.uk/api/insights/quiz',
            {
                assessmentId:
                    Number(assessmentId),
                attemptId:
                    Number(quizId),
                questionId: 0,
                phase: 'start',
                active: 0,
                passive: 0,
                offScreen: 0
            }
        );

        const questionMap =
            attempt.questionMap;

        const unansweredQuestions =
            attempt.questions.filter(
                questionId =>
                    !questionMap[
                        questionId
                    ].answer
            );

        totalQuestionsCount +=
            unansweredQuestions.length;

        for (
            const [
                index,
                questionId
            ] of unansweredQuestions.entries()
        ) {
            if (cancelled) {
                break;
            }

            const question =
                questionMap[questionId];

            const waitTime =
                Math.floor(
                    Math.random() *
                        (
                            timeSettings.max -
                            timeSettings.min +
                            1
                        )
                ) +
                timeSettings.min;

            const waitTimeMs =
                waitTime * 1000;

            if (waitTime) {
                const interval = 3000;
                let elapsed = 0;

                await progressUpdater.updateEmbed(
                    `Waiting to Complete Question ${
                        index + 1
                    } for Quiz ${
                        quizIdx + 1
                    }/${
                        selectedQuizzes.length
                    } \`<t:${
                        Math.floor(
                            Date.now() / 1000
                        ) + waitTime
                    }:R>...`
                );

                while (
                    elapsed <
                        waitTimeMs &&
                    !cancelled
                ) {
                    const timeLeft =
                        waitTimeMs -
                        elapsed;

                    await new Promise(
                        resolve =>
                            setTimeout(
                                resolve,
                                Math.min(
                                    interval,
                                    timeLeft
                                )
                            )
                    );

                    elapsed += Math.min(
                        interval,
                        timeLeft
                    );
                }

                if (cancelled) {
                    break;
                }
            }

            await progressUpdater
                .updateProgressBar(
                    quizIdx,
                    index + 1,
                    unansweredQuestions.length ||
                        1
                );

            await progressUpdater.updateEmbed(
                `Running Question ${
                    index + 1
                } /${
                    unansweredQuestions.length
                } for Quiz ${
                    quizIdx + 1
                }/${
                    selectedQuizzes.length
                }`
            );

            let DBanswer =
                await checkAnswer(
                    questionId
                );

            let aiModel =
                '2.5-flash-lite';

            let givenAnswer = null;

            if (DBanswer === false) {
                aiModel = '2.5-pro';
            } else if (DBanswer === true) {
                givenAnswer = false;
            } else if (DBanswer !== null) {
                givenAnswer = DBanswer;
            }

            if (givenAnswer === null) {
                givenAnswer =
                    await getAIanswer(
                        () =>
                            geminiAnswer.answerQuestion(
                                question,
                                aiModel
                            ),
                        {
                            stillUsing:
                                async () => true
                        },
                        interaction,
                        progressUpdater,
                        60000,
                        3000,
                        () => cancelled
                    );
            }

            const questionResult =
                await userSession.sendRequest(
                    `https://my.educake.co.uk/api/attempt/${quizId}/quiztion/${question.testQuestionId}/variant/${questionId}/answer`,
                    {
                        givenAnswer
                    }
                );

            if (
                questionResult?.answer?.result
            ) {
                totalCorrectCount++;

                if (
                    [
                        false,
                        true,
                        null
                    ].includes(DBanswer)
                ) {
                    await addToDbEducake(
                        questionId,
                        givenAnswer,
                        aiModel ===
                            '2.5-pro'
                    );
                }
            } else if (
                [
                    false,
                    true,
                    null
                ].includes(DBanswer)
            ) {
                await addToDbEducake(
                    questionId,
                    null,
                    aiModel ===
                        '2.5-pro'
                );
            }
        }

        await progressUpdater
            .updateProgressBar(
                quizIdx,
                unansweredQuestions.length,
                unansweredQuestions.length ||
                    1
            );
    }

    await progressUpdater.updateEmbed(
        'Finished'
    );

    await updateStats(
        interaction.user.id,
        'educake',
        process.hrtime(taskTimer)[0]
    );

    await progressUpdater.end();
}


// ==========================================================
// EDUCAKE MENU
// ==========================================================

class educakeMainMenu {
    constructor(
        interaction,
        timeSettings
    ) {
        this.interaction =
            interaction;

        this.itemsPerPage = 10;

        this.totalPages = 0;

        this.menuStage =
            'current';

        this.timeSettings =
            timeSettings;

        this.mainMenuEmbed =
            this.createMainMenu();

        this.accountId = null;

        this.selectedQuizzes = [];
    }

    createMainMenu() {
        const embed =
            new EmbedBuilder()
                .setColor(EMBED_COLOR)
                .setTitle(
                    'Educake Homework Selection'
                )
                .setDescription(
                    `Select one of the homeworks below and it will automatically be completed for you!

**❓ What is Time?**
Time is the amount of time the bot will wait for each question. This is **PER QUESTION**, not per homework. Recommended time is 5-10 Seconds per question.

**⏰ Time**: ${this.timeSettings.min}-${this.timeSettings.max} Seconds Per Question

**Important: Retry the Homework a second time to get a better accuracy**`
                );

        if (footerText) {
            embed.setFooter({
                text: footerText,
                iconURL: footerIcon || undefined
            });
        }

        return embed;
    }

    async updateMainMenu() {
        this.mainMenuEmbed =
            this.createMainMenu();

        if (!this.lastComponents) {
            return;
        }

        await this.interaction.editReply({
            embeds: [
                this.mainMenuEmbed
            ],
            components:
                this.lastComponents
        });
    }

    createNavigationButtons(
        page,
        disabled = false
    ) {
        const skipBackButton =
            new ButtonBuilder()
                .setCustomId(
                    'menu_skip_back'
                )
                .setLabel('◀◀')
                .setStyle(
                    ButtonStyle.Secondary
                )
                .setDisabled(
                    disabled ||
                        page === 0
                );

        const prevButton =
            new ButtonBuilder()
                .setCustomId(
                    'menu_prev'
                )
                .setLabel('Previous')
                .setEmoji('◀️')
                .setStyle(
                    ButtonStyle.Secondary
                )
                .setDisabled(
                    disabled ||
                        page === 0
                );

        const nextButton =
            new ButtonBuilder()
                .setCustomId(
                    'menu_next'
                )
                .setLabel('Next')
                .setEmoji('▶️')
                .setStyle(
                    ButtonStyle.Secondary
                )
                .setDisabled(
                    disabled ||
                        page >=
                            this.totalPages -
                                1
                );

        const skipForwardButton =
            new ButtonBuilder()
                .setCustomId(
                    'menu_skip_forward'
                )
                .setLabel('▶▶')
                .setStyle(
                    ButtonStyle.Secondary
                )
                .setDisabled(
                    disabled ||
                        page >=
                            this.totalPages -
                                1
                );

        const timeBtn =
            new ButtonBuilder()
                .setCustomId('set_time')
                .setLabel('Set Time')
                .setEmoji(emojis.queue)
                .setStyle(
                    ButtonStyle.Primary
                )
                .setDisabled(disabled);

        let quizzesButton;

        if (
            this.menuStage ===
            'current'
        ) {
            quizzesButton =
                new ButtonBuilder()
                    .setCustomId(
                        'past_quizzes'
                    )
                    .setLabel(
                        'Past Quizzes'
                    )
                    .setEmoji('📊')
                    .setStyle(
                        ButtonStyle.Secondary
                    )
                    .setDisabled(
                        disabled
                    );
        } else {
            quizzesButton =
                new ButtonBuilder()
                    .setCustomId(
                        'current_quizzes'
                    )
                    .setLabel(
                        'Current Quizzes'
                    )
                    .setEmoji('📊')
                    .setStyle(
                        ButtonStyle.Secondary
                    )
                    .setDisabled(
                        disabled
                    );
        }

        const saveAccountBtnCopy =
            ButtonBuilder.from(
                saveAccountBtn
            );

        saveAccountBtnCopy.setDisabled(
            disabled
        );

        return [
            new ActionRowBuilder()
                .addComponents(
                    skipBackButton,
                    prevButton,
                    nextButton,
                    skipForwardButton
                ),

            new ActionRowBuilder()
                .addComponents(
                    timeBtn,
                    saveAccountBtnCopy,
                    quizzesButton
                )
        ];
    }

    async educakeMenu(
        select,
        latestQuizes,
        currentPage,
        disabledAll = false
    ) {
        if (
            !latestQuizes ||
            !latestQuizes.attempts ||
            typeof latestQuizes.attempts !==
                'object'
        ) {
            console.error(
                '[Educake] Invalid quiz response:',
                latestQuizes
            );

            const embed =
                new EmbedBuilder()
                    .setColor(0xff474d)
                    .setTitle(
                        '❌ Unable to Load Homework'
                    )
                    .setDescription(
                        'Educake did not return a valid homework list. Please try logging in again.'
                    );

            await this.interaction.editReply({
                embeds: [embed],
                components: []
            });

            return null;
        }

        const quizzes =
            Object.values(
                latestQuizes.attempts
            );

        const totalPages =
            Math.max(
                1,
                Math.ceil(
                    quizzes.length /
                        this.itemsPerPage
                )
            );

        this.totalPages =
            totalPages;

        const createMenuDropdown =
            page => {
                const start =
                    page *
                    this.itemsPerPage;

                const end =
                    start +
                    this.itemsPerPage;

                const pageQuizzes =
                    quizzes.slice(
                        start,
                        end
                    );

                select =
                    new StringSelectMenuBuilder()
                        .setCustomId(
                            'educake_homework'
                        )
                        .setPlaceholder(
                            `Choose up to ${
                                config
                                    .max_homework_selection
                                    ?.educake ||
                                6
                            } Homeworks (Page ${
                                page + 1
                            }/${totalPages})`
                        )
                        .setMinValues(0)
                        .setMaxValues(
                            Math.min(
                                config
                                    .max_homework_selection
                                    ?.educake ||
                                    6,
                                pageQuizzes.length ||
                                    1
                            )
                        )
                        .setDisabled(
                            disabledAll
                        );

                for (
                    const quiz of pageQuizzes
                ) {
                    const option =
                        new StringSelectMenuOptionBuilder()
                            .setLabel(
                                shorten(
                                    quiz.name,
                                    100
                                )
                            )
                            .setDescription(
                                `${
                                    quiz.questionCount
                                        ? Math.round(
                                              (quiz.correctCount /
                                                  quiz.questionCount) *
                                                  100
                                          )
                                        : 0
                                }% • ${
                                    quiz.isRetake
                                        ? '(Retake)'
                                        : dueDate(
                                              new Date(
                                                  quiz.dueDate
                                              )
                                          )
                                }`
                            )
                            .setValue(
                                String(
                                    quiz.id
                                )
                            );

                    select.addOptions(
                        option
                    );
                }

                return select;
            };

        const selectRow =
            new ActionRowBuilder()
                .addComponents(
                    createMenuDropdown(
                        currentPage
                    )
                );

        const buttonRows =
            this.createNavigationButtons(
                currentPage,
                disabledAll
            );

        const components = [
            selectRow,
            ...buttonRows
        ];

        this.lastComponents =
            components;

        return await this.interaction.editReply({
            embeds: [
                this.mainMenuEmbed
            ],
            components
        });
    }

    async main() {
        const userSession =
            userSessions[
                this.interaction.user.id
            ];

        if (!userSession) {
            throw new Error(
                '[Educake] No active Educake session found.'
            );
        }

        console.log(
            '[Educake] Getting account information...'
        );

        const userInfo =
            await userSession.sendRequest(
                'https://my.educake.co.uk/api/me'
            );

        if (
            !userInfo ||
            !userInfo.id
        ) {
            throw new Error(
                '[Educake] Invalid Educake account response.'
            );
        }

        this.accountId =
            String(userInfo.id);

        console.log(
            '[Educake] Account ID received.'
        );

        console.log(
            '[Educake] Getting current quizzes...'
        );

        const latestQuizes =
            await userSession.sendRequest(
                'https://my.educake.co.uk/api/student/quiz?type=teacher&subject=0&completed=0&excludeRetakes=0&includeArchived=0'
            );

        if (
            !latestQuizes ||
            !latestQuizes.attempts ||
            typeof latestQuizes.attempts !==
                'object'
        ) {
            console.error(
                '[Educake] Invalid current quiz response:',
                latestQuizes
            );

            throw new Error(
                '[Educake] Educake returned an invalid homework list.'
            );
        }

        const quizCount =
            Object.keys(
                latestQuizes.attempts
            ).length;

        console.log(
            `[Educake] Current quizzes received: ${quizCount}`
        );

        const select =
            new StringSelectMenuBuilder()
                .setCustomId(
                    'educake_homework'
                )
                .setPlaceholder(
                    `Choose up to ${
                        config
                            .max_homework_selection
                            ?.educake ||
                        6
                    } homeworks`
                )
                .setMinValues(0)
                .setMaxValues(
                    Math.min(
                        config
                            .max_homework_selection
                            ?.educake ||
                        6,
                        quizCount || 1
                    )
                );

        let currentPage = 0;

        const messageSent =
            await this.educakeMenu(
                select,
                latestQuizes,
                currentPage
            );

        if (!messageSent) {
            return;
        }

        const collector =
            messageSent.createMessageComponentCollector(
                {
                    time: 300000
                }
            );

        collector.on(
            'collect',
            async componentInteraction => {
                try {
                    if (
                        componentInteraction.isStringSelectMenu()
                    ) {
                        await componentInteraction.deferUpdate();

                        this.selectedQuizzes =
                            componentInteraction.values;

                        const latestAttempts =
                            latestQuizes.attempts ||
                            {};

                        const quizzes =
                            Object.values(
                                latestAttempts
                            );

                        const start =
                            currentPage *
                            this.itemsPerPage;

                        const pageQuizzes =
                            quizzes.slice(
                                start,
                                start +
                                    this.itemsPerPage
                            );

                        const disabledSelect =
                            new StringSelectMenuBuilder()
                                .setCustomId(
                                    'educake_homework'
                                )
                                .setPlaceholder(
                                    'Homework selected'
                                )
                                .setMinValues(0)
                                .setMaxValues(
                                    Math.min(
                                        config
                                            .max_homework_selection
                                            ?.educake ||
                                            6,
                                        pageQuizzes.length ||
                                            1
                                    )
                                );

                        for (
                            const quiz of pageQuizzes
                        ) {
                            const option =
                                new StringSelectMenuOptionBuilder()
                                    .setLabel(
                                        shorten(
                                            quiz.name,
                                            100
                                        )
                                    )
                                    .setDescription(
                                        `${
                                            quiz.questionCount
                                                ? Math.round(
                                                      (quiz.correctCount /
                                                          quiz.questionCount) *
                                                          100
                                                  )
                                                : 0
                                        }% • ${
                                            quiz.isRetake
                                                ? '(Retake)'
                                                : dueDate(
                                                      new Date(
                                                          quiz.dueDate
                                                      )
                                                  )
                                        }`
                                    )
                                    .setValue(
                                        String(
                                            quiz.id
                                        )
                                    );

                            if (
                                componentInteraction.values.includes(
                                    String(
                                        quiz.id
                                    )
                                )
                            ) {
                                option.setDefault(
                                    true
                                );
                            }

                            disabledSelect.addOptions(
                                option
                            );
                        }

                        const components = [
                            new ActionRowBuilder()
                                .addComponents(
                                    disabledSelect
                                ),
                            ...this.createNavigationButtons(
                                currentPage,
                                false
                            )
                        ];

                        if (
                            this.selectedQuizzes
                                .length > 0
                        ) {
                            const startButton =
                                new ButtonBuilder()
                                    .setCustomId(
                                        'start_educake'
                                    )
                                    .setLabel(
                                        'Start'
                                    )
                                    .setEmoji(
                                        emojis.tick
                                    )
                                    .setStyle(
                                        ButtonStyle.Success
                                    );

                            components.push(
                                new ActionRowBuilder()
                                    .addComponents(
                                        startButton
                                    )
                            );
                        }

                        this.lastComponents =
                            components;

                        await componentInteraction.editReply({
                            embeds: [
                                this.mainMenuEmbed
                            ],
                            components
                        });
                    }

                    else if (
                        componentInteraction.isButton()
                    ) {
                        const customId =
                            componentInteraction.customId;

                        console.log(
                            '[Educake] Button:',
                            customId
                        );

                        if (
                            customId ===
                            'start_educake'
                        ) {
                            if (
                                !this.selectedQuizzes
                                    ?.length
                            ) {
                                return;
                            }

                            await componentInteraction.deferUpdate();

                            await this.educakeMenu(
                                select,
                                latestQuizes,
                                currentPage,
                                true
                            );

                            if (
                                await useUpSlot(
                                    componentInteraction,
                                    'educake',
                                    this.accountId
                                )
                            ) {
                                return;
                            }

                            await educake_autocompleter(
                                componentInteraction,
                                userSession,
                                this.menuStage ===
                                    'old',
                                this.timeSettings,
                                this.selectedQuizzes
                            );
                        }

                        else if (
                            customId ===
                            'past_quizzes'
                        ) {
                            await componentInteraction.deferUpdate();

                            const pastQuizzes =
                                await userSession.sendRequest(
                                    'https://my.educake.co.uk/api/student/quiz?type=teacher&subject=0&completed=1&excludeRetakes=0&includeArchived=0'
                                );

                            if (
                                !pastQuizzes?.attempts
                            ) {
                                console.error(
                                    '[Educake] Invalid past quiz response.'
                                );
                                return;
                            }

                            this.menuStage =
                                'old';

                            currentPage = 0;

                            const newSelect =
                                new StringSelectMenuBuilder()
                                    .setCustomId(
                                        'educake_homework'
                                    )
                                    .setPlaceholder(
                                        'Choose past homeworks'
                                    )
                                    .setMinValues(0)
                                    .setMaxValues(
                                        Math.min(
                                            config
                                                .max_homework_selection
                                                ?.educake ||
                                                6,
                                            Object.keys(
                                                pastQuizzes.attempts
                                            ).length ||
                                                1
                                        )
                                    );

                            await this.educakeMenu(
                                newSelect,
                                pastQuizzes,
                                currentPage
                            );
                        }

                        else if (
                            customId ===
                            'current_quizzes'
                        ) {
                            await componentInteraction.deferUpdate();

                            const currentQuizzes =
                                await userSession.sendRequest(
                                    'https://my.educake.co.uk/api/student/quiz?type=teacher&subject=0&completed=0&excludeRetakes=0&includeArchived=0'
                                );

                            if (
                                !currentQuizzes?.attempts
                            ) {
                                console.error(
                                    '[Educake] Invalid current quiz response.'
                                );
                                return;
                            }

                            this.menuStage =
                                'current';

                            currentPage = 0;

                            const newSelect =
                                new StringSelectMenuBuilder()
                                    .setCustomId(
                                        'educake_homework'
                                    )
                                    .setPlaceholder(
                                        'Choose current homeworks'
                                    )
                                    .setMinValues(0)
                                    .setMaxValues(
                                        Math.min(
                                            config
                                                .max_homework_selection
                                                ?.educake ||
                                                6,
                                            Object.keys(
                                                currentQuizzes.attempts
                                            ).length ||
                                                1
                                        )
                                    );

                            await this.educakeMenu(
                                newSelect,
                                currentQuizzes,
                                currentPage
                            );
                        }

                        else if (
                            customId.startsWith(
                                'menu'
                            )
                        ) {
                            await componentInteraction.deferUpdate();

                            if (
                                customId ===
                                'menu_prev'
                            ) {
                                currentPage =
                                    Math.max(
                                        0,
                                        currentPage -
                                            1
                                    );
                            }

                            else if (
                                customId ===
                                'menu_skip_back'
                            ) {
                                currentPage = 0;
                            }

                            else if (
                                customId ===
                                'menu_next'
                            ) {
                                currentPage =
                                    Math.min(
                                        this.totalPages -
                                            1,
                                        currentPage +
                                            1
                                    );
                            }

                            else if (
                                customId ===
                                'menu_skip_forward'
                            ) {
                                currentPage =
                                    this.totalPages -
                                    1;
                            }

                            await this.educakeMenu(
                                select,
                                latestQuizes,
                                currentPage
                            );
                        }

                        else if (
                            customId ===
                            'save_account'
                        ) {
                            const modal =
                                new ModalBuilder()
                                    .setCustomId(
                                        'save_account_educake'
                                    )
                                    .setTitle(
                                        'Save Account'
                                    );

                            const input =
                                new TextInputBuilder()
                                    .setCustomId(
                                        'master_password'
                                    )
                                    .setLabel(
                                        'Master Password'
                                    )
                                    .setStyle(
                                        TextInputStyle.Short
                                    )
                                    .setRequired(
                                        true
                                    );

                            modal.addComponents(
                                new ActionRowBuilder()
                                    .addComponents(
                                        input
                                    )
                            );

                            await componentInteraction.showModal(
                                modal
                            );
                        }

                        else if (
                            customId ===
                            'set_time'
                        ) {
                            const modal =
                                new ModalBuilder()
                                    .setCustomId(
                                        'educake_set_time'
                                    )
                                    .setTitle(
                                        'Set Time'
                                    );

                            const input =
                                new TextInputBuilder()
                                    .setCustomId(
                                        'time_min'
                                    )
                                    .setLabel(
                                        'Time Min'
                                    )
                                    .setStyle(
                                        TextInputStyle.Short
                                    )
                                    .setPlaceholder(
                                        '0-180'
                                    )
                                    .setRequired(
                                        true
                                    );

                            const input1 =
                                new TextInputBuilder()
                                    .setCustomId(
                                        'time_max'
                                    )
                                    .setLabel(
                                        'Time Max'
                                    )
                                    .setStyle(
                                        TextInputStyle.Short
                                    )
                                    .setPlaceholder(
                                        '0-180'
                                    )
                                    .setRequired(
                                        true
                                    );

                            modal.addComponents(
                                new ActionRowBuilder()
                                    .addComponents(
                                        input
                                    ),
                                new ActionRowBuilder()
                                    .addComponents(
                                        input1
                                    )
                            );

                            await componentInteraction.showModal(
                                modal
                            );
                        }
                    }
                } catch (error) {
                    console.error(
                        '[Educake] Menu interaction error:',
                        error
                    );
                }
            }
        );

        collector.on(
            'end',
            async () => {
                try {
                    select.setDisabled(true);

                    const row =
                        new ActionRowBuilder()
                            .addComponents(
                                select
                            );

                    const components = [
                        row,
                        ...this.createNavigationButtons(
                            currentPage,
                            true
                        )
                    ];

                    this.lastComponents =
                        components;

                    await this.interaction.editReply({
                        embeds: [
                            this.mainMenuEmbed
                        ],
                        components
                    });
                } catch (error) {
                    console.error(
                        '[Educake] Homework menu collector error:',
                        error
                    );
                }
            }
        );
    }
}


// ==========================================================
// MAIN EDUCAKE EXECUTOR
// ==========================================================

async function educake_model_executor(
    interaction
) {
    const customId =
        interaction.customId || '';

    if (
        !interaction.deferred &&
        !interaction.replied &&
        customId.startsWith(
            'educake_login'
        )
    ) {
        await interaction.deferReply({
            flags: 64
        });
    }

    if (
        customId.startsWith(
            'educake_login'
        )
    ) {
        let username;
        let password;
        let loginType;

        if (
            interaction.customId ===
            'educake_login_modal'
        ) {
            username =
                interaction.fields.getTextInputValue(
                    'educake_username'
                );

            password =
                interaction.fields.getTextInputValue(
                    'educake_password'
                );

            loginType =
                interaction.fields
                    .getField('type')
                    .values[0];
        }

        else if (
            interaction.customId ===
            'educake_login_account'
        ) {
            username =
                interaction.loginDetails.email;

            password =
                interaction.loginDetails.password;

            loginType =
                interaction.loginDetails.loginType;
        }

        const loadingEmbed =
            new EmbedBuilder()
                .setColor(EMBED_COLOR)
                .setTitle(
                    'Logging In... :hourglass:'
                )
                .setDescription(
                    'Attempting to log in to your account...'
                );

        await interaction.editReply({
            embeds: [
                loadingEmbed
            ],
            components: []
        });

        console.log(
            '[Educake] Calling educakeLogin...'
        );

        let cookie;

        try {
            cookie =
                await puppetQueue.add(
                    () =>
                        educakeLogin(
                            username,
                            password,
                            loginType
                        )
                );
        } catch (error) {
            console.error(
                '[Educake] Puppeteer queue error:',
                error
            );

            cookie = false;
        }

        console.log(
            '[Educake] educakeLogin returned:',
            cookie
                ? 'COOKIE'
                : 'FALSE'
        );

        if (
            !cookie ||
            typeof cookie !== 'string' ||
            cookie.length < 50
        ) {
            const embed =
                new EmbedBuilder()
                    .setColor(0xff474d)
                    .setTitle(
                        '❌ Login Failed'
                    )
                    .setDescription(
                        'Unable to log in to your Educake account. Please check your login details and try again.'
                    );

            await interaction.editReply({
                embeds: [embed],
                components: []
            });

            return;
        }

        console.log(
            '[Educake] Login really completed.'
        );

        // ==================================================
        // CREATE EDUCAKE REQUESTICATOR
        // ==================================================

        const educake_Request =
            new Educake_Requesticator(
                cookie,
                {
                    email: username,
                    password,
                    loginType,
                    app: 'educake'
                }
            );

        // ==================================================
        // GET EDUCAKE SESSION TOKEN
        // ==================================================

        console.log(
            '[Educake] Getting Educake session token...'
        );

        let sessionResponse;

        try {
            console.log(
                '[Educake] Requesting /session-token...'
            );

            sessionResponse =
                await educake_Request.sendDetailedRequest(
                    'https://my.educake.co.uk/session-token'
                );

        } catch (error) {
            console.error(
                '[Educake] SESSION TOKEN REQUEST FAILED'
            );

            console.error(
                '[Educake] Error name:',
                error?.name
            );

            console.error(
                '[Educake] Error message:',
                error?.message
            );

            console.error(
                '[Educake] Error stack:',
                error?.stack
            );

            const embed =
                new EmbedBuilder()
                    .setColor(0xff474d)
                    .setTitle(
                        '❌ Session Error'
                    )
                    .setDescription(
                        'Login succeeded, but the Educake session-token request failed.'
                    );

            await interaction.editReply({
                embeds: [embed],
                components: []
            });

            return;
        }

        if (!sessionResponse) {
            console.error(
                '[Educake] Session response was completely empty.'
            );

            const embed =
                new EmbedBuilder()
                    .setColor(0xff474d)
                    .setTitle(
                        '❌ Session Error'
                    )
                    .setDescription(
                        'Educake returned an empty session response.'
                    );

            await interaction.editReply({
                embeds: [embed],
                components: []
            });

            return;
        }

        console.log(
            '[Educake] Session HTTP status:',
            sessionResponse.status
        );

        console.log(
            '[Educake] Session response type:',
            typeof sessionResponse.data
        );

        if (
            sessionResponse.data &&
            typeof sessionResponse.data ===
                'object' &&
            !Buffer.isBuffer(
                sessionResponse.data
            )
        ) {
            console.log(
                '[Educake] Session response keys:',
                Object.keys(
                    sessionResponse.data
                )
            );
        }

        console.log(
            '[Educake] Session response received.'
        );

        const sessionData =
            sessionResponse.data;

        let accessToken = null;

        if (
            sessionData &&
            typeof sessionData ===
                'object'
        ) {
            accessToken =
                sessionData.accessToken ||
                sessionData.access_token ||
                sessionData.sessionToken ||
                sessionData.token ||
                sessionData.data?.accessToken ||
                sessionData.data?.access_token ||
                sessionData.data?.sessionToken ||
                sessionData.data?.token ||
                null;
        }

        else if (
            typeof sessionData ===
                'string'
        ) {
            accessToken =
                sessionData.trim();
        }

        if (
            !accessToken ||
            typeof accessToken !==
                'string'
        ) {
            console.error(
                '[Educake] No usable session token was found.'
            );

            if (
                sessionData &&
                typeof sessionData ===
                    'object'
            ) {
                console.error(
                    '[Educake] Available response keys:',
                    Object.keys(
                        sessionData
                    )
                );
            }

            const embed =
                new EmbedBuilder()
                    .setColor(0xff474d)
                    .setTitle(
                        '❌ Session Error'
                    )
                    .setDescription(
                        'Educake login succeeded, but the session-token response did not contain a usable session token.'
                    );

            await interaction.editReply({
                embeds: [embed],
                components: []
            });

            return;
        }

        console.log(
            '[Educake] Session token received successfully.'
        );

        educake_Request.sessionToken =
            accessToken;

        userSessions[
            interaction.user.id
        ] = educake_Request;

        console.log(
            '[Educake] Educake session stored successfully.'
        );

        // ==================================================
        // LOAD ACCOUNT
        // ==================================================

        let account;

        try {
            account =
                await checkAccount(
                    interaction.user.id
                );
        } catch (error) {
            console.error(
                '[Educake] Account lookup error:',
                error
            );

            account = null;
        }

        const educakeSettings =
            account?.educake_settings ??
            {
                min: 5,
                max: 10
            };

        // ==================================================
        // LOGIN SUCCESS
        // ==================================================

        const loginSuccessEmbed =
            new EmbedBuilder()
                .setColor(0x90ee90)
                .setTitle(
                    '✅ Login Successful'
                )
                .setDescription(
                    'Successfully logged into your Educake account. Loading homework...'
                );

        await interaction.editReply({
            embeds: [
                loginSuccessEmbed
            ],
            components: []
        });

        // ==================================================
        // LOAD HOMEWORK
        // ==================================================

        console.log(
            '[Educake] Loading homework menu...'
        );

        try {
            const educakeMainmenuer =
                new educakeMainMenu(
                    interaction,
                    educakeSettings
                );

            userMenus[
                interaction.user.id
            ] = educakeMainmenuer;

            await educakeMainmenuer.main();

            console.log(
                '[Educake] Homework menu loaded.'
            );

        } catch (error) {
            console.error(
                '[Educake] Homework loading failed:',
                error
            );

            const embed =
                new EmbedBuilder()
                    .setColor(0xff474d)
                    .setTitle(
                        '❌ Homework Loading Failed'
                    )
                    .setDescription(
                        "Your Educake login worked, but I couldn't retrieve your homework."
                    );

            await interaction.editReply({
                embeds: [embed],
                components: []
            });
        }

        return;
    }

    // ======================================================
    // SET TIME
    // ======================================================

    if (
        interaction.customId ===
        'educake_set_time'
    ) {
        if (
            !interaction.deferred &&
            !interaction.replied
        ) {
            await interaction.deferUpdate();
        }

        const minTime =
            Number(
                interaction.fields.getTextInputValue(
                    'time_min'
                )
            );

        const maxTime =
            Number(
                interaction.fields.getTextInputValue(
                    'time_max'
                )
            );

        if (
            Number.isNaN(minTime) ||
            Number.isNaN(maxTime) ||
            minTime < 0 ||
            maxTime < 0 ||
            minTime > maxTime ||
            maxTime > 180
        ) {
            return;
        }

        const userMenu =
            userMenus[
                interaction.user.id
            ];

        if (!userMenu) {
            return;
        }

        await updateDB(
            interaction.user.id,
            {
                educake_settings: {
                    min: minTime,
                    max: maxTime
                }
            }
        );

        userMenu.timeSettings = {
            min: minTime,
            max: maxTime
        };

        await userMenu.updateMainMenu();
    }
}


// ==========================================================
// EDUCAKE LOGIN COLLECTOR
// ==========================================================

async function educake_collector(
    message_sent
) {
    const collector =
        message_sent.createMessageComponentCollector(
            {
                componentType:
                    ComponentType.Button
            }
        );

    collector.on(
        'collect',
        async interaction => {
            try {
                if (
                    await validAccount(
                        interaction,
                        'educake',
                        false
                    )
                ) {
                    return;
                }

                const loginBtn =
                    new ButtonBuilder()
                        .setCustomId(
                            'educake_login'
                        )
                        .setLabel('Login')
                        .setEmoji(
                            emojis.login
                        )
                        .setStyle(
                            ButtonStyle.Success
                        );

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            loginBtn
                        );

                const loginEmbed =
                    new EmbedBuilder()
                        .setColor(
                            EMBED_COLOR
                        )
                        .setTitle(
                            'Educake Login'
                        )
                        .setDescription(
                            'Login by simply inputting your username and password!'
                        );

                const message =
                    await interaction.reply({
                        ephemeral: true,
                        embeds: [
                            loginEmbed
                        ],
                        components: [
                            row
                        ],
                        withResponse: true
                    });

                let responseMessage =
                    message?.resource?.message;

                if (!responseMessage) {
                    responseMessage =
                        await interaction.fetchReply();
                }

                if (!responseMessage) {
                    console.error(
                        '[Educake] Could not get login message.'
                    );
                    return;
                }

                const innerCollector =
                    responseMessage.createMessageComponentCollector(
                        {
                            componentType:
                                ComponentType.Button
                        }
                    );

                innerCollector.on(
                    'collect',
                    async componentInteraction => {
                        try {
                            if (
                                componentInteraction.customId !==
                                'educake_login'
                            ) {
                                return;
                            }

                            const modal =
                                new ModalBuilder()
                                    .setCustomId(
                                        'educake_login_modal'
                                    )
                                    .setTitle(
                                        'Educake Login'
                                    );

                            const usernameInput =
                                new TextInputBuilder()
                                    .setCustomId(
                                        'educake_username'
                                    )
                                    .setLabel(
                                        'Username'
                                    )
                                    .setStyle(
                                        TextInputStyle.Short
                                    )
                                    .setRequired(
                                        true
                                    );

                            const passwordInput =
                                new TextInputBuilder()
                                    .setCustomId(
                                        'educake_password'
                                    )
                                    .setLabel(
                                        'Password'
                                    )
                                    .setStyle(
                                        TextInputStyle.Short
                                    )
                                    .setRequired(
                                        true
                                    );

                            const typeInput =
                                new StringSelectMenuBuilder()
                                    .setCustomId(
                                        'type'
                                    )
                                    .setPlaceholder(
                                        'Select login type'
                                    )
                                    .setMinValues(1)
                                    .setMaxValues(1)
                                    .addOptions(
                                        {
                                            label:
                                                'Normal',
                                            value:
                                                'Normal',
                                            emoji:
                                                '🔐'
                                        },
                                        {
                                            label:
                                                'Microsoft',
                                            value:
                                                'Microsoft',
                                            emoji:
                                                '🪟'
                                        },
                                        {
                                            label:
                                                'Google',
                                            value:
                                                'Google',
                                            emoji:
                                                '🔵'
                                        }
                                    );

                            const typeLabel =
                                new LabelBuilder({
                                    label:
                                        'Login Type',
                                    component:
                                        typeInput
                                });

                            modal.addComponents(
                                new ActionRowBuilder()
                                    .addComponents(
                                        usernameInput
                                    ),
                                new ActionRowBuilder()
                                    .addComponents(
                                        passwordInput
                                    )
                            );

                            modal.addLabelComponents(
                                typeLabel
                            );

                            await componentInteraction.showModal(
                                modal
                            );

                        } catch (error) {
                            if (
                                error.code ===
                                    40060 ||
                                error.code ===
                                    10062
                            ) {
                                return;
                            }

                            console.error(
                                '[Educake] Login modal error:',
                                error
                            );
                        }
                    }
                );

            } catch (error) {
                if (
                    error.code ===
                        40060 ||
                    error.code ===
                        10062
                ) {
                    return;
                }

                console.error(
                    '[Educake] Collector error:',
                    error
                );
            }
        }
    );
}


// ==========================================================
// EXPORTS
// ==========================================================

module.exports = {
    educake_collector,
    educake_model_executor,
    userSessions
};
