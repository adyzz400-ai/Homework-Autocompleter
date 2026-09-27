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
     * Educake can return an unexpected response when there
     * are no quizzes or when the session/API response is invalid.
     * Do not call Object.keys() until attempts has been checked.
     */

    if (
        !latestQuizes ||
        !latestQuizes.attempts ||
        typeof latestQuizes.attempts !== 'object'
    ) {
        console.error(
            '[Educake] Invalid quiz response:',
            latestQuizes
        );

        const errorSection =
            new TextDisplayBuilder().setContent(
                `### ❌ Unable to Load Homework\nEducake did not return your homework list. Please try logging in again.`
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
        Object.keys(latestQuizes.attempts).length;

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

    const collector =
        message_sent.createMessageComponentCollector({
            time: 300_000
        });

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
                    this.selectedQuizzes.length > 0
                ) {
                    const startButton =
                        new ButtonBuilder()
                            .setCustomId(
                                'start_educake'
                            )
                            .setLabel('Start')
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

                await componentInteraction.editReply({
                    components: [
                        container
                    ]
                });

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
                        this.selectedQuizzes.length === 0
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
                        this.menuStage === 'old',
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
                            '[Educake] Invalid past quiz response:',
                            latestQuizes
                        );

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
                                        latestQuizes
                                            .attempts
                                    ).length || 1
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
                            '[Educake] Invalid current quiz response:',
                            latestQuizes
                        );

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
                                        latestQuizes
                                            .attempts
                                    ).length || 1
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

            container.addActionRowComponents(row);
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