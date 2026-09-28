const {
    StringSelectMenuOptionBuilder,
    LabelBuilder,
    SeparatorSpacingSize,
    SeparatorBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonStyle,
    EmbedBuilder,
    StringSelectMenuBuilder,
    ComponentType
} = require('discord.js');

const { emojis, footerText, footerIcon } = require('../startEmbeds/info.js');
const getProgressBar = require('../utils/getProgressBar');
const formatTime = require('../utils/formatTime');
const { checkAccount, updateDB, updateStats } = require('../database/accounts');
const { addToDbEducake, checkAnswer } = require('../database/educake');
const { educakeLogin } = require('./puppeteer');
const { geminiAnswer } = require('../gemini/educake/main');
const progressTracker = require('../utils/progressTracker');
const dueDate = require('../utils/dueDate');
const Educake_Requesticator = require('./requesticator.js');
const userSessions = {};
const shorten = require('../utils/shorten');
const { validAccount, useUpSlot } = require('../handlers/accountHandler');
const getAIanswer = require('../utils/getAIanswer');
const puppetQueue = require('../queues/puppeteerQueue.js');
const config = require('../config.json');

const EMBED_COLOR = 0x7a5b99;

const saveAccountBtn = new ButtonBuilder()
    .setCustomId('save_account')
    .setLabel('Save Account')
    .setEmoji(emojis.save_account)
    .setStyle(ButtonStyle.Secondary);

const seperator = new SeparatorBuilder({
    spacing: SeparatorSpacingSize.Small
});

async function educake_autocompleter(
    interaction,
    userSession,
    retake,
    timeSettings,
    selectedQuizzes
) {
    if (!selectedQuizzes || selectedQuizzes.length === 0) return;

    const cancel = new ButtonBuilder()
        .setCustomId('cancel')
        .setLabel('Cancel')
        .setEmoji(emojis.x)
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(cancel);

    const initialEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Educake Autocompleter')
        .setDescription(`\`Starting...\``);

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
                      (totalCorrectCount / totalQuestionsCount) * 100
                  )
                : 0
        }%\n> **Time Spent**: ${formatTime(
            process.hrtime(taskTimer)[0]
        )}`;
    };

    const progressUpdater = new progressTracker(
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
        progressUpdater.targetMessage.createMessageComponentCollector({
            componentType: ComponentType.Button
        });

    collector.on('collect', async (interaction) => {
        await interaction.deferUpdate();

        if (interaction.customId === 'cancel') {
            cancelled = true;
            await progressUpdater.updateEmbed(`Cancelling...`);
        }
    });

    for (
        let quizIdx = 0;
        quizIdx < selectedQuizzes.length;
        quizIdx++
    ) {
        if (cancelled) break;

        let quizId = selectedQuizzes[quizIdx];

        const quizAnswers = await userSession.sendRequest(
            `https://my.educake.co.uk/api/student/quiz/${quizId}${
                retake ? '/retake' : ''
            }`
        );

        quizId = Object.values(quizAnswers.attempt)[0].id;

        const assessmentId =
            quizAnswers.attempt[quizId].assessmentId;

        await userSession.sendRequest(
            'https://my.educake.co.uk/api/insights/quiz',
            {
                assessmentId: Number(assessmentId),
                attemptId: Number(quizId),
                questionId: 0,
                phase: 'start',
                active: 0,
                passive: 0,
                offScreen: 0
            }
        );

        const questionMap =
            quizAnswers.attempt[quizId].questionMap;

        const unansweredQuestions =
            quizAnswers.attempt[quizId].questions.filter(
                (questionId) =>
                    !questionMap[questionId].answer
            );

        totalQuestionsCount += unansweredQuestions.length;

        for (
            const [index, questionId] of unansweredQuestions.entries()
        ) {
            if (cancelled) break;

            const question = questionMap[questionId];

            const waitTime =
                Math.floor(
                    Math.random() *
                        (timeSettings.max -
                            timeSettings.min +
                            1)
                ) + timeSettings.min;

            const waitTimeMs = waitTime * 1000;

            if (waitTime) {
                const interval = 3000;
                let elapsed = 0;

                await progressUpdater.updateEmbed(
                    `Waiting to Complete Question ${
                        index + 1
                    } for Quiz ${
                        quizIdx + 1
                    }/${selectedQuizzes.length} \`<t:${
                        Math.floor(Date.now() / 1000) +
                        waitTime
                    }:R>...`
                );

                while (
                    elapsed < waitTimeMs &&
                    !cancelled
                ) {
                    const timeLeft =
                        waitTimeMs - elapsed;

                    await new Promise((res) =>
                        setTimeout(
                            res,
                            Math.min(interval, timeLeft)
                        )
                    );

                    elapsed += Math.min(
                        interval,
                        timeLeft
                    );
                }

                if (cancelled) break;
            }

            await progressUpdater.updateProgressBar(
                quizIdx,
                index + 1,
                unansweredQuestions.length || 1
            );

            await progressUpdater.updateEmbed(
                `Running Question ${
                    index + 1
               } /${unansweredQuestions.length} for Quiz ${
                    quizIdx + 1
                }/${selectedQuizzes.length}`
            );

            let DBanswer = await checkAnswer(questionId);
            let aiModel = '2.5-flash-lite';
            let givenAnswer = null;

            if (DBanswer === false) {
                aiModel = '2.5-pro';
            } else if (DBanswer === true) {
                givenAnswer = false;
            } else if (DBanswer !== null) {
                givenAnswer = DBanswer;
            }

            if (givenAnswer === null) {
                givenAnswer = await getAIanswer(
                    () =>
                        geminiAnswer.answerQuestion(
                            question,
                            aiModel
                        ),
                    {
                        stillUsing: async () => true
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

            if (questionResult?.answer?.result) {
                totalCorrectCount++;

                if (
                    [false, true, null].includes(DBanswer)
                ) {
                    await addToDbEducake(
                        questionId,
                        givenAnswer,
                        aiModel === '2.5-pro'
                    );
                }
            } else if (
                [false, true, null].includes(DBanswer)
            ) {
                await addToDbEducake(
                    questionId,
                    null,
                    aiModel === '2.5-pro'
                );
            }
        }

        await progressUpdater.updateProgressBar(
            quizIdx,
            unansweredQuestions.length,
            unansweredQuestions.length || 1
        );
    }

    await progressUpdater.updateEmbed(`Finished`);

    await updateStats(
        interaction.user.id,
        'educake',
        process.hrtime(taskTimer)[0]
    );

    await progressUpdater.end();
}

class educakeMainMenu {
    constructor(interaction, timeSettings) {
        this.interaction = interaction;
        this.itemsPerPage = 10;
        this.totalPages = 0;
        this.menuStage = 'current';
        this.timeSettings = timeSettings;
        this.mainMenuSection = this.createMainMenu();
        this.container = null;
        this.accountId = null;
    }

    createMainMenu() {
        return new TextDisplayBuilder().setContent(
            `### Educake Homework Selection
Select one of the homeworks below and it will automatically be completed for you!

**❓ What is Time?**
Time is the amount of time the bot will wait for each question. This is **PER QUESTION**, not per homework. Recommended time is 5-10 Seconds per question.

**⏰ Time**: ${this.timeSettings.min}-${this.timeSettings.max} Seconds Per Question

**Important: Retry the Homework a second time to get a better accuracy**`
        );
    }

    async updateMainMenu() {
        this.mainMenuSection = this.createMainMenu();

        this.container.components[0].data.content =
            this.mainMenuSection.data.content;

        await this.interaction.editReply({
            components: [this.container]
        });
    }

    createNavigationButtons(page, disabled = false) {
        const skipBackButton = new ButtonBuilder()
            .setCustomId('menu_skip_back')
            .setLabel('◀◀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(
                disabled || page === 0
            );

        const prevButton = new ButtonBuilder()
            .setCustomId('menu_prev')
            .setLabel('Previous')
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(
                disabled || page === 0
            );

        const nextButton = new ButtonBuilder()
            .setCustomId('menu_next')
            .setLabel('Next')
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(
                disabled ||
                    page >= this.totalPages - 1
            );

        const skipForwardButton = new ButtonBuilder()
            .setCustomId('menu_skip_forward')
            .setLabel('▶▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(
                disabled ||
                    page >= this.totalPages - 1
            );

        const timeBtn = new ButtonBuilder()
            .setCustomId('set_time')
            .setLabel('Set Time')
            .setEmoji(emojis.queue)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled);

        let quizzesButton;

        switch (this.menuStage) {
            case 'current':
                quizzesButton = new ButtonBuilder()
                    .setCustomId('past_quizzes')
                    .setLabel('Past Quizzes')
                    .setEmoji('📊')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(disabled);
                break;

            case 'old':
                quizzesButton = new ButtonBuilder()
                    .setCustomId('current_quizzes')
                    .setLabel('Current Quizzes')
                    .setEmoji('📊')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(disabled);
                break;
        }

        const saveAccountBtnCopy =
            ButtonBuilder.from(saveAccountBtn);

        saveAccountBtnCopy.setDisabled(disabled);

        return [
            new ActionRowBuilder().addComponents(
                skipBackButton,
                prevButton,
                nextButton,
                skipForwardButton
            ),

            new ActionRowBuilder().addComponents(
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
        const itemsPerPage = 10;

        if (
            !latestQuizes ||
            !latestQuizes.attempts ||
            typeof latestQuizes.attempts !== 'object'
        ) {
            console.error(
                '[Educake] Invalid quiz response passed to educakeMenu:',
                latestQuizes
            );

            const errorSection =
                new TextDisplayBuilder().setContent(
                    `### ❌ Unable to Load Homework
Educake did not return a valid homework list. Please try logging in again.`
                );

            const errorContainer =
                new ContainerBuilder()
                    .setAccentColor(0xFF474D)
                    .addTextDisplayComponents(
                        errorSection.data
                    );

            await this.interaction.editReply({
                flags: 32768 | 64,
                components: [errorContainer]
            });

            return null;
        }

        const quizzes = Object.values(
            latestQuizes.attempts
        );

        const totalPages = Math.max(
            1,
            Math.ceil(
                quizzes.length /
                    itemsPerPage
            )
        );

        this.totalPages = totalPages;

        function createMenuDropdown(page) {
            const start = page * itemsPerPage;
            const end = start + itemsPerPage;

            const pageQuizzes = quizzes.slice(
                start,
                end
            );

            select = new StringSelectMenuBuilder()
                .setCustomId('educake_homework')
                .setPlaceholder(
                    `Choose up to ${
                        config.max_homework_selection
                            ?.educake || 6
                    } Homeworks (Page ${
                        page + 1
                    }/${totalPages})`
                )
                .setMinValues(0)
                .setMaxValues(
                    Math.min(
                        config.max_homework_selection
                            ?.educake || 6,
                        pageQuizzes.length || 1
                    )
                )
                .setDisabled(disabledAll);

            for (const quiz of pageQuizzes) {
                const option =
                    new StringSelectMenuOptionBuilder()
                        .setLabel(
                            shorten(quiz.name, 100)
                        )
                        .setDescription(
                            `${quiz.questionCount
                                ? Math.round(
                                      (quiz.correctCount /
                                          quiz.questionCount) *
                                          100
                                  )
                                : 0}% • ${
                                quiz.isRetake
                                    ? '(Retake)'
                                    : dueDate(
                                          new Date(
                                              quiz.dueDate
                                          )
                                      )
                            }`
                        )
                        .setValue(String(quiz.id));

                select.addOptions(option);
            }

            return select;
        }

        const selectRow =
            new ActionRowBuilder().addComponents(
                createMenuDropdown(currentPage)
            );

        const buttonRows =
            this.createNavigationButtons(
                currentPage,
                disabledAll
            );

        const container = new ContainerBuilder()
            .setAccentColor(0x7a5b99)
            .addTextDisplayComponents(
                this.mainMenuSection.data
            );

        container.addSeparatorComponents(
            seperator
        );

        if (selectRow.components[0].options.length) {
            container.addActionRowComponents(
                selectRow
            );
        }

        buttonRows.forEach((row) =>
            container.addActionRowComponents(row)
        );

        this.container = container;

        const message_sent =
            await this.interaction.editReply({
                flags: 32768 | 64,
                components: [container]
            });

        return message_sent;
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

        console.log('[Educake] Getting account information...');

        const userInfo =
            await userSession.sendRequest(
                'https://my.educake.co.uk/api/me'
            );

        if (!userInfo || !userInfo.id) {
            throw new Error(
                '[Educake] Educake API returned invalid account information.'
            );
        }

        this.accountId = String(userInfo.id);

        console.log('[Educake] Account ID received.');

        console.log('[Educake] Getting current quizzes...');

        let latestQuizes =
            await userSession.sendRequest(
                'https://my.educake.co.uk/api/student/quiz?type=teacher&subject=0&completed=0&excludeRetakes=0&includeArchived=0'
            );

        /*
         * Defensive check:
         * Educake may return an unexpected response instead of
         * { attempts: ... }. Never call Object.keys/Object.values
         * until attempts has been verified.
         */
        if (
            !latestQuizes ||
            !latestQuizes.attempts ||
            typeof latestQuizes.attempts !== 'object'
        ) {
            console.error(
                '[Educake] Invalid current quiz response.'
            );

            console.error(
                '[Educake] Response type:',
                typeof latestQuizes
            );

            if (
                latestQuizes &&
                typeof latestQuizes === 'object'
            ) {
                console.error(
                    '[Educake] Response keys:',
                    Object.keys(latestQuizes)
                );
            }

            const errorSection =
                new TextDisplayBuilder().setContent(
                    `### ❌ Unable to Load Homework
Educake did not return your homework list. Please try logging in again.`
                );

            const errorContainer =
                new ContainerBuilder()
                    .setAccentColor(0xFF474D)
                    .addTextDisplayComponents(
                        errorSection.data
                    );

            await this.interaction.editReply({
                flags: 32768 | 64,
                components: [errorContainer]
            });

            return;
        }

        const quizCount =
            Object.keys(
                latestQuizes.attempts
            ).length;

        console.log(
            `[Educake] Current quizzes received: ${quizCount}`
        );

        let select =
            new StringSelectMenuBuilder()
                .setCustomId('educake_homework')
                .setPlaceholder(
                    `Choose up to ${
                        config.max_homework_selection
                            ?.educake || 6
                    } homeworks`
                )
                .setMinValues(0)
                .setMaxValues(
                    Math.min(
                        config.max_homework_selection
                            ?.educake || 6,
                        quizCount || 1
                    )
                );

        let currentPage = 0;

        const message_sent =
            await this.educakeMenu(
                select,
                latestQuizes,
                currentPage
            );

        if (!message_sent) {
            return;
        }

        const collector =
            message_sent.createMessageComponentCollector(
                {
                    time: 300_000
                }
            );

        collector.on(
            'collect',
            async (componentInteraction) => {
                if (
                    componentInteraction.isStringSelectMenu()
                ) {
                    await componentInteraction.deferUpdate();

                    this.selectedQuizzes =
                        componentInteraction.values;

                    const latestAttempts =
                        latestQuizes.attempts || {};

                    const disabledSelect =
                        new StringSelectMenuBuilder()
                            .setCustomId(
                                'educake_homework'
                            )
                            .setPlaceholder(
                                `Choose up to ${
                                    config
                                        .max_homework_selection
                                        ?.educake || 6
                                } homeworks`
                            )
                            .setMinValues(0)
                            .setMaxValues(
                                Math.min(
                                    config
                                        .max_homework_selection
                                        ?.educake || 6,
                                    Object.keys(
                                        latestAttempts
                                    ).length || 1
                                )
                            );

                    const itemsPerPage = 10;

                    const quizzes =
                        Object.values(
                            latestAttempts
                        );

                    const start =
                        currentPage *
                        itemsPerPage;

                    const end =
                        start + itemsPerPage;

                    const pageQuizzes =
                        quizzes.slice(
                            start,
                            end
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
                                    `0% • ${
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
                                    String(quiz.id)
                                );

                        if (
                            componentInteraction.values.includes(
                                String(quiz.id)
                            )
                        ) {
                            option.setDefault(true);
                        }

                        disabledSelect.addOptions(
                            option
                        );
                    }

                    const container =
                        new ContainerBuilder()
                            .setAccentColor(
                                0x7a5b99
                            )
                            .addTextDisplayComponents(
                                this.mainMenuSection
                                    .data
                            )
                            .addSeparatorComponents(
                                seperator
                            )
                            .addActionRowComponents(
                                new ActionRowBuilder().addComponents(
                                    disabledSelect
                                )
                            );

                    this.createNavigationButtons(
                        currentPage,
                        false
                    ).forEach((row) => {
                        container.addActionRowComponents(
                            row
                        );
                    });

                    if (
                        this.selectedQuizzes &&
                        this.selectedQuizzes.length >
                            0
                    ) {
                        const startButton =
                            new ButtonBuilder()
                                .setCustomId(
                                    'start_educake'
                                )
                                .setLabel(
                                    'Start'
                                )
                                .setStyle(
                                    ButtonStyle.Success
                                )
                                .setEmoji(
                                    emojis.tick
                                );

                        container.addActionRowComponents(
                            new ActionRowBuilder().addComponents(
                                startButton
                            )
                        );
                    }

                    select = disabledSelect;

                    await componentInteraction.editReply(
                        {
                            components: [
                                container
                            ]
                        }
                    );
                } else if (
                    componentInteraction.isButton()
                ) {
                    console.log(
                        componentInteraction.customId
                    );

                    if (
                        componentInteraction.customId ===
                        'start_educake'
                    ) {
                        if (
                            !this.selectedQuizzes ||
                            this.selectedQuizzes.length ===
                                0
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
                    } else if (
                        componentInteraction.customId ===
                        'past_quizzes'
                    ) {
                        await componentInteraction.deferUpdate();

                        latestQuizes =
                            await userSession.sendRequest(
                                'https://my.educake.co.uk/api/student/quiz?type=teacher&subject=0&completed=1&excludeRetakes=0&includeArchived=0'
                            );

                        if (
                            !latestQuizes ||
                            !latestQuizes.attempts ||
                            typeof latestQuizes.attempts !== 'object'
                        ) {
                            console.error(
                                '[Educake] Invalid past quiz response.'
                            );

                            console.error(
                                '[Educake] Response type:',
                                typeof latestQuizes
                            );

                            if (
                                latestQuizes &&
                                typeof latestQuizes === 'object'
                            ) {
                                console.error(
                                    '[Educake] Response keys:',
                                    Object.keys(latestQuizes)
                                );
                            }

                            return;
                        }

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
                                    } homeworks`
                                )
                                .setMinValues(0)
                                .setMaxValues(
                                    Math.min(
                                        config
                                            .max_homework_selection
                                            ?.educake ||
                                            6,
                                        Object.keys(
                                            latestQuizes
                                                .attempts
                                        ).length ||
                                            1
                                    )
                                );

                        this.menuStage = 'old';
                        currentPage = 0;

                        await this.educakeMenu(
                            select,
                            latestQuizes,
                            currentPage
                        );

                    } else if (
                        componentInteraction.customId ===
                        'current_quizzes'
                    ) {
                        await componentInteraction.deferUpdate();

                        latestQuizes =
                            await userSession.sendRequest(
                                'https://my.educake.co.uk/api/student/quiz?type=teacher&subject=0&completed=0&excludeRetakes=0&includeArchived=0'
                            );

                        if (
                            !latestQuizes ||
                            !latestQuizes.attempts ||
                            typeof latestQuizes.attempts !== 'object'
                        ) {
                            console.error(
                                '[Educake] Invalid current quiz response.'
                            );

                            console.error(
                                '[Educake] Response type:',
                                typeof latestQuizes
                            );

                            if (
                                latestQuizes &&
                                typeof latestQuizes === 'object'
                            ) {
                                console.error(
                                    '[Educake] Response keys:',
                                    Object.keys(latestQuizes)
                                );
                            }

                            return;
                        }

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
                                    } homeworks`
                                )
                                .setMinValues(0)
                                .setMaxValues(
                                    Math.min(
                                        config
                                            .max_homework_selection
                                            ?.educake ||
                                            6,
                                        Object.keys(
                                            latestQuizes
                                                .attempts
                                        ).length ||
                                            1
                                    )
                                );

                        this.menuStage =
                            'current';

                        currentPage = 0;

                        await this.educakeMenu(
                            select,
                            latestQuizes,
                            currentPage
                        );

                    } else if (
                        componentInteraction.customId.startsWith(
                            'menu'
                        )
                    ) {
                        await componentInteraction.deferUpdate();

                        if (
                            componentInteraction.customId ===
                            'menu_prev'
                        ) {
                            currentPage = Math.max(
                                0,
                                currentPage - 1
                            );
                        } else if (
                            componentInteraction.customId ===
                            'menu_skip_back'
                        ) {
                            currentPage = 0;
                        } else if (
                            componentInteraction.customId ===
                            'menu_next'
                        ) {
                            currentPage = Math.min(
                                this.totalPages - 1,
                                currentPage + 1
                            );
                        } else if (
                            componentInteraction.customId ===
                            'menu_skip_forward'
                        ) {
                            currentPage =
                                this.totalPages - 1;
                        }

                        await this.educakeMenu(
                            select,
                            latestQuizes,
                            currentPage
                        );

                    } else if (
                        componentInteraction.customId ===
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
                                .setRequired(true);

                        modal.addComponents(
                            new ActionRowBuilder().addComponents(
                                input
                            )
                        );

                        await componentInteraction.showModal(
                            modal
                        );

                    } else if (
                        componentInteraction.customId ===
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
                                .setRequired(true);

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
                                .setRequired(true);

                        modal.addComponents(
                            new ActionRowBuilder().addComponents(
                                input
                            ),
                            new ActionRowBuilder().addComponents(
                                input1
                            )
                        );

                        await componentInteraction.showModal(
                            modal
                        );
                    }
                }
            }
        );

        collector.on('end', async () => {
            select.setDisabled(true);

            const row =
                new ActionRowBuilder().addComponents();

            const container =
                new ContainerBuilder()
                    .setAccentColor(0x7a5b99)
                    .addTextDisplayComponents(
                        this.mainMenuSection.data
                    )
                    .addSeparatorComponents(
                        seperator
                    );

            if (select.options.length) {
                row.addComponents(select);

                container.addActionRowComponents(
                    row
                );
            }

            const buttonRow =
                this.createNavigationButtons(
                    currentPage,
                    true
                );

            container.addActionRowComponents(
                buttonRow
            );

            this.container = container;

            await this.interaction.editReply({
                components: [container]
            });
        });
    }
}

const userMenus = {};

async function educake_model_executor(interaction) {
    if (
        !interaction.deferred &&
        !interaction.replied &&
        interaction.customId.startsWith(
            'educake_login'
        )
    ) {
        await interaction.deferReply({
            flags: 64
        });
    }

    if (
        interaction.customId.startsWith(
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
        } else if (
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

        const Loadingsection =
            new TextDisplayBuilder().setContent(
                `### Logging In... :hourglass:\nAttempting to log in to your account...`
            );

        const Loadingcontainer =
            new ContainerBuilder()
                .setAccentColor(0x7a5b99)
                .addTextDisplayComponents(
                    Loadingsection.data
                );

        await interaction.editReply({
            components: [
                Loadingcontainer
            ],
            flags: 32768 | 64
        });

        console.log('[Educake] Calling educakeLogin...');

        const cookie = await puppetQueue.add(
            () =>
                educakeLogin(
                    username,
                    password,
                    loginType
                )
        );

        console.log(
            '[Educake] educakeLogin returned:',
            cookie ? 'COOKIE' : 'FALSE'
        );

        if (
            cookie === false ||
            cookie.length < 50
        ) {
            const section =
                new TextDisplayBuilder().setContent(
                    `### ❌ Login Failed\nUnable to Login. Please check your login details and try again.`
                );

            const container =
                new ContainerBuilder()
                    .setAccentColor(0xFF474D)
                    .addTextDisplayComponents(
                        section.data
                    );

            await interaction.editReply({
                flags: 32768 | 64,
                components: [container]
            });

            return;
        }

        const loginSuccessSection =
            new TextDisplayBuilder().setContent(
                `### ✅ Login Successful\nSuccessfully logged into your Educake account. Loading...`
            );

        const loginSuccessContainer =
            new ContainerBuilder()
                .setAccentColor(0x90EE90)
                .addTextDisplayComponents(
                    loginSuccessSection.data
                );

        await interaction.editReply({
            flags: 32768 | 64,
            components: [
                loginSuccessContainer
            ],
            fetchReply: true
        });

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

        const authToken =
            await educake_Request.sendRequest(
                'https://my.educake.co.uk/session-token'
            );

        educake_Request.sessionToken =
            authToken.accessToken;

        userSessions[
            interaction.user.id
        ] = educake_Request;

        const account =
            await checkAccount(
                interaction.user.id
            );

        const educakeSettings =
            account?.educake_settings ?? {
                min: 5,
                max: 10
            };

        const educakeMainmenuer =
            new educakeMainMenu(
                interaction,
                educakeSettings
            );

        userMenus[
            interaction.user.id
        ] = educakeMainmenuer;

        await educakeMainmenuer.main();

    } else if (
        interaction.customId ===
        'educake_set_time'
    ) {
        if (
            !interaction.deferred &&
            !interaction.replied
        ) {
            await interaction.deferUpdate();
        }

        const minTime = Number(
            interaction.fields.getTextInputValue(
                'time_min'
            )
        );

        const maxTime = Number(
            interaction.fields.getTextInputValue(
                'time_max'
            )
        );

        if (
            isNaN(minTime) ||
            minTime < 0 ||
            maxTime < 0 ||
            isNaN(maxTime) ||
            minTime > maxTime ||
            maxTime > 180
        ) {
            return;
        }

        const userSession =
            userMenus[
                interaction.user.id
            ];

        await updateDB(
            interaction.user.id,
            {
                educake_settings: {
                    min: minTime,
                    max: maxTime
                }
            }
        );

        userSession.timeSettings = {
            min: minTime,
            max: maxTime
        };

        await userSession.updateMainMenu();
    }
}

async function educake_collector(message_sent) {
    const collector =
        message_sent.createMessageComponentCollector(
            {
                componentType:
                    ComponentType.Button
            }
        );

    collector.on(
        'collect',
        async (interaction) => {
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
                    .setEmoji(emojis.login)
                    .setStyle(
                        ButtonStyle.Success
                    );

            const row =
                new ActionRowBuilder().addComponents(
                    loginBtn
                );

            const seperator =
                new SeparatorBuilder({
                    spacing:
                        SeparatorSpacingSize.Small
                });

            const section =
                new TextDisplayBuilder().setContent(
                    `### Educake Login\nLogin by simply inputting your username and password!`
                );

            const container =
                new ContainerBuilder()
                    .setAccentColor(
                        0x7a5b99
                    )
                    .addTextDisplayComponents(
                        section.data
                    )
                    .addSeparatorComponents(
                        seperator
                    )
                    .addActionRowComponents(
                        row
                    );

            try {
                const message_sent =
                    await interaction.reply({
                        flags:
                            32768 | 64,
                        components: [
                            container
                        ],
                        fetchReply: true
                    });

                const collector =
                    message_sent.createMessageComponentCollector(
                        {
                            componentType:
                                ComponentType.Button
                        }
                    );

                collector.on(
                    'collect',
                    async (
                        componentInteraction
                    ) => {
                        try {
                            if (
                                componentInteraction.customId ===
                                'educake_login'
                            ) {
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
                                            'Normal/Microsoft/Google'
                                        )
                                        .addOptions(
                                            {
                                                label: 'Normal',
                                                value: 'Normal',
                                                emoji: '🔐'
                                            },
                                            {
                                                label: 'Microsoft',
                                                value: 'Microsoft',
                                                emoji: '🪟'
                                            },
                                            {
                                                label: 'Google',
                                                value: 'Google',
                                                emoji: '🔵'
                                            }
                                        );

                                const typeLabel =
                                    new LabelBuilder({
                                        label: 'Login Type',
                                        component:
                                            typeInput
                                    });

                                const usernameRow =
                                    new ActionRowBuilder().addComponents(
                                        usernameInput
                                    );

                                const passwordRow =
                                    new ActionRowBuilder().addComponents(
                                        passwordInput
                                    );

                                modal.addComponents(
                                    usernameRow,
                                    passwordRow
                                );

                                modal.addLabelComponents(
                                    typeLabel
                                );

                                await componentInteraction.showModal(
                                    modal
                                );
                            }
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
                                'Error in Educake inner collector:',
                                error
                            );
                        }
                    }
                );
            } catch (error) {
                if (
                    error.code === 40060 ||
                    error.code === 10062
                ) {
                    return;
                }

                console.error(
                    'Error in Educake collector:',
                    error
                );
            }
        }
    );
}

module.exports = {
    educake_collector,
    educake_model_executor,
    userSessions
};