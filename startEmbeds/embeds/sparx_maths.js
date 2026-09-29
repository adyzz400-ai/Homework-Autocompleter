const {
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ThumbnailBuilder,
    SectionBuilder
} = require('discord.js');

const info = require('../info');

const seperator = new SeparatorBuilder({
    spacing: SeparatorSpacingSize.Small
});

const section = new SectionBuilder()
    .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
`# ✨ Sparx Maths

Automate your Sparx Maths homework through a simple guided Discord workflow.

Log in to your Sparx Maths account, choose the homework you want to work on, and follow the progress as each section is processed.

## 🌟 Features

- 🔐 **Guided Login** — Log in using your Sparx Maths school account.
- 📚 **Real Homework Selection** — Your actual Sparx homework is loaded into Discord.
- 🧠 **AI-Assisted Answers** — Supported questions are processed through the configured AI system.
- ⏰ **Timed Sessions** — The existing Sparx timing system is preserved.
- 📊 **Live Progress** — See your current section, question progress and simulated time.
- 🪄 **Separate Stages** — Login, homework selection, progress and completion each have their own screen.
- ✨ **Progress Tracking** — Your homework sections are displayed while the session is running.`
        )
    )
    .setThumbnailAccessory(
        new ThumbnailBuilder({
            media: {
                url: 'https://i.postimg.cc/cJQg4QDt/library-book.webp'
            }
        })
    );

const mathButtons = new ActionRowBuilder()
    .addComponents(
        new ButtonBuilder()
            .setCustomId('sparx_maths_show_login')
            .setLabel('Login')
            .setStyle(ButtonStyle.Success)
            .setEmoji(info.emojis.login),

        new ButtonBuilder()
            .setCustomId('check_queue_maths')
            .setLabel('Check Queue')
            .setStyle(ButtonStyle.Primary)
            .setEmoji(info.emojis.queue)
    );

const container = new ContainerBuilder()
    .setAccentColor(0xE53935)
    .addSectionComponents(section)
    .addSeparatorComponents(seperator)
    .addActionRowComponents(mathButtons);

module.exports = container;