const {
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');

const getProgressBar =
    require('./getProgressBar');

class progressTracker {
    constructor(
        interaction,
        getTimeField
    ) {
        this.interaction = interaction;
        this.user = interaction.user;

        this.targetMessage = null;
        this.embed = null;
        this.row = null;

        this.homeworksProgress = [];

        this.currentPage = 1;

        this.currentProgress = 0;
        this.progressMax = 1;

        this.currentHomeworkIndex = -1;

        this.getTimeField =
            getTimeField.bind(this);
    }

    getTimeEmbed() {
        return {
            name: '⏱️ Session',
            value: this.getTimeField(),
            inline: false
        };
    }

    getTotalPages() {
        return Math.max(
            1,
            Math.ceil(
                this.homeworksProgress.length / 5
            )
        );
    }

    getHomeworkText() {
        const start =
            (this.currentPage - 1) * 5;

        const pageHomeworks =
            this.homeworksProgress.slice(
                start,
                start + 5
            );

        if (!pageHomeworks.length) {
            return 'No homeworks available.';
        }

        return pageHomeworks
            .map((homework, index) => {
                const current =
                    Number(homework.current) || 0;

                const total =
                    Number(homework.total) || 0;

                const percentage =
                    total > 0
                        ? Math.round(
                              Math.max(
                                  0,
                                  Math.min(
                                      1,
                                      current / total
                                  )
                              ) * 100
                          )
                        : 0;

                const name =
                    homework.name ||
                    `Homework ${start + index + 1}`;

                const isCurrent =
                    start + index ===
                    this.currentHomeworkIndex;

                const icon =
                    isCurrent
                        ? '🟢'
                        : current >= total &&
                          total > 0
                        ? '✅'
                        : '⚪';

                return (
                    `${icon} **${name}** — ` +
                    `**${current}/${total || '?'}** ` +
                    `(${percentage}%)`
                );
            })
            .join('\n');
    }

    updatePageButtons() {
        if (!this.row) {
            return;
        }

        const totalPages =
            this.getTotalPages();

        for (
            const component
            of this.row.components
        ) {
            const customId =
                component.data?.custom_id;

            if (
                customId ===
                'sparx_progress_prev'
            ) {
                component.setDisabled(
                    this.currentPage <= 1
                );
            }

            if (
                customId ===
                'sparx_progress_next'
            ) {
                component.setDisabled(
                    this.currentPage >=
                    totalPages
                );
            }
        }
    }

    async changePage(direction) {
        const totalPages =
            this.getTotalPages();

        this.currentPage =
            Math.max(
                1,
                Math.min(
                    totalPages,
                    this.currentPage +
                        direction
                )
            );

        this.updatePageButtons();

        await this.editMessage();
    }

    async buildProgressAttachment() {
        const buffer =
            await getProgressBar(
                this.currentProgress,
                this.progressMax
            );

        return new AttachmentBuilder(
            buffer,
            {
                name: 'progress-bar.png'
            }
        );
    }

    async editMessage() {
        const attachment =
            await this.buildProgressAttachment();

        this.embed.setImage(
            'attachment://progress-bar.png'
        );

        await this.targetMessage.edit({
            embeds: [
                this.embed
            ],
            components: [
                this.row
            ],
            files: [
                attachment
            ]
        });
    }

    async end() {
        if (!this.row) {
            return;
        }

        for (
            const component
            of this.row.components
        ) {
            component.setDisabled(true);
        }

        await this.targetMessage.edit({
            embeds: [
                this.embed
            ],
            components: [
                this.row
            ]
        });
    }

    async updateEmbed(description) {
        const totalPages =
            this.getTotalPages();

        this.embed.setDescription(
`### 📚 Educake Progress

${description}

### 📖 Homeworks
Page **${this.currentPage}/${totalPages}**

${this.getHomeworkText()}`
        );

        this.embed.setFields(
            this.getTimeEmbed()
        );

        this.updatePageButtons();

        await this.editMessage();
    }

    async updateProgressBar(
        index,
        newProg,
        progMax = 1
    ) {
        this.currentProgress =
            Number(newProg) || 0;

        this.progressMax =
            Number(progMax) || 1;

        this.currentHomeworkIndex =
            index;

        /*
         * Keep the homework progress
         * synced with the real question
         * currently being processed.
         */
        if (
            this.homeworksProgress[index]
        ) {
            this.homeworksProgress[index]
                .current =
                this.currentProgress;

            this.homeworksProgress[index]
                .total =
                this.progressMax;
        }

        const homework =
            this.homeworksProgress[index];

        const homeworkName =
            homework?.name ||
            `Homework ${index + 1}`;

        const percentage =
            this.progressMax > 0
                ? Math.round(
                      (
                          this.currentProgress /
                          this.progressMax
                      ) * 100
                  )
                : 0;

        this.embed.setFields(
            {
                name:
                    '📝 Current Homework',

                value:
                    `**${homeworkName}**\n` +
                    `Question **${this.currentProgress} / ${this.progressMax}** ` +
                    `• **${percentage}%**`,

                inline: false
            },

            this.getTimeEmbed()
        );

        this.updatePageButtons();

        await this.editMessage();
    }

    async wait(
        time,
        message,
        notcancelFlag
    ) {
        const waitTime =
            Math.floor(
                Math.random() *
                (
                    time.max -
                    time.min +
                    1
                )
            ) +
            time.min;

        const waitTimeMs =
            waitTime * 1000;

        if (!waitTime) {
            return;
        }

        const interval = 3000;

        let elapsed = 0;

        await this.updateEmbed(
            `${message} — waiting ${waitTime}s`
        );

        while (
            elapsed < waitTimeMs &&
            notcancelFlag()
        ) {
            const timeLeft =
                waitTimeMs -
                elapsed;

            const sleep =
                Math.min(
                    interval,
                    timeLeft
                );

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        sleep
                    )
            );

            elapsed += sleep;
        }
    }

    async start(
        initialEmbed,
        row,
        homeworksProgress
    ) {
        this.embed =
            initialEmbed;

        this.row =
            row;

        this.homeworksProgress =
            Array.isArray(
                homeworksProgress
            )
                ? homeworksProgress
                : [];

        this.currentPage = 1;

        this.currentProgress = 0;
        this.progressMax = 1;

        this.currentHomeworkIndex = -1;

        this.embed.setTitle(
            '📚 Educake Autocompleter'
        );

        this.embed.setDescription(
`### 🟢 Starting

Preparing your Educake session...

### 📖 Homeworks
Page **1/${this.getTotalPages()}**

${this.getHomeworkText()}`
        );

        this.embed.setFields(
            {
                name:
                    '📊 Progress',

                value:
                    'Waiting to begin...',

                inline: false
            },

            this.getTimeEmbed()
        );

        this.updatePageButtons();

        try {
            const attachment =
                await this.buildProgressAttachment();

            this.embed.setImage(
                'attachment://progress-bar.png'
            );

            this.targetMessage =
                await this.user.send({
                    embeds: [
                        this.embed
                    ],

                    components: [
                        row
                    ],

                    files: [
                        attachment
                    ]
                });

        } catch (error) {
            console.error(
                '[ProgressTracker] DM error:',
                error
            );

            const noDMenabled =
                new EmbedBuilder()
                    .setTitle(
                        'Cannot Direct Message'
                    )
                    .setDescription(
                        'The progress tracker could not send you a DM because your Discord DMs are disabled.'
                    )
                    .setColor(
                        0xFF474D
                    );

            await this.interaction.followUp({
                embeds: [
                    noDMenabled
                ],

                ephemeral: true
            });

            return true;
        }

        return false;
    }
}

module.exports =
    progressTracker;