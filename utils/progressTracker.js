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
        this.interaction =
            interaction;

        this.user =
            interaction.user;

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
            value:
                this.getTimeField(),
            inline: false
        };
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
                name:
                    'progress-bar.png'
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
            component.setDisabled(
                true
            );
        }

        await this.targetMessage.edit({
            embeds: [this.embed],
            components: [this.row]
        });
    }

    async updateEmbed(
        description
    ) {
        this.embed.setDescription(
            `**${description}**`
        );

        this.embed.setFields(
            this.getTimeEmbed()
        );

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
                    `Quiz ${quizNumber}`,
                value:
                    `Question **${newProg} / ${progMax}**`,
                inline: false
            },
            this.getTimeEmbed()
        );

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

        this.row = row;

        this.sectionsProgress =
            sectionsProgress;

        this.currentProgress = 0;
        this.progressMax = 1;

        this.embed.setFields(
            {
                name: 'Progress',
                value:
                    'Starting autocompleter...',
                inline: false
            },
            this.getTimeEmbed()
        );

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