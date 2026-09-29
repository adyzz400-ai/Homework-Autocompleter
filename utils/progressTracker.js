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

        this.sectionsProgress = [];
        this.currentPage = 1;

        this.currentProgress = 0;
        this.progressMax = 1;

        this.getTimeField =
            getTimeField.bind(this);
    }

    getTimeEmbed() {
        return {
            name: '\u200B',
            value: this.getTimeField(),
            inline: false
        };
    }

    getTotalPages() {
        return Math.max(
            1,
            Math.ceil(
                this.sectionsProgress.length / 5
            )
        );
    }

    getSectionText() {
        const totalPages =
            this.getTotalPages();

        const start =
            (this.currentPage - 1) * 5;

        const pageSections =
            this.sectionsProgress.slice(
                start,
                start + 5
            );

        if (!pageSections.length) {
            return 'No sections available.';
        }

        return pageSections
            .map((section, index) => {
                const current =
                    Number(section.current) || 0;

                const total =
                    Number(section.total) || 1;

                const percentage =
                    Math.round(
                        Math.max(
                            0,
                            Math.min(
                                1,
                                current / total
                            )
                        ) * 100
                    );

                return (
                    `**${start + index + 1}. ${section.name}** — ${percentage}%`
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

            if (customId === 'sparx_progress_prev') {
                component.setDisabled(
                    this.currentPage <= 1
                );
            }

            if (customId === 'sparx_progress_next') {
                component.setDisabled(
                    this.currentPage >= totalPages
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
                    this.currentPage + direction
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
            embeds: [this.embed],
            components: [this.row],
            files: [attachment]
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
            embeds: [this.embed],
            components: [this.row]
        });
    }

    async updateEmbed(description) {
        const totalPages =
            this.getTotalPages();

        this.embed.setDescription(
`**${description}**

### 📚 Sections — Page ${this.currentPage}/${totalPages}

${this.getSectionText()}`
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
            newProg;

        this.progressMax =
            progMax;

        const quizNumber =
            index + 1;

        this.embed.setFields(
            {
                name:
                    `📝 Section ${quizNumber}`,
                value:
                    `Question **${newProg} / ${progMax}**`,
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
        sectionsProgress
    ) {
        this.embed =
            initialEmbed;

        this.row =
            row;

        this.sectionsProgress =
            sectionsProgress;

        this.currentPage = 1;
        this.currentProgress = 0;
        this.progressMax = 1;

        this.embed.setDescription(
`🪄 **Preparing your Sparx Maths session...**

### 📚 Sections — Page 1/${this.getTotalPages()}

${this.getSectionText()}`
        );

        this.embed.setFields(
            {
                name: '📊 Progress',
                value:
                    'Starting autocompleter...',
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
                        'The autocompleter could not send you the progress tracker because your Discord DMs are disabled.'
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