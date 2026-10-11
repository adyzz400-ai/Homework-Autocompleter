const { checkAccount } = require('../database/accounts');

const DEFAULT_MATHS_SETTINGS = {
    min: 60,
    max: 100,
    model: '3.5-flash-lite',
    pdfSettings: {
        question: false,
        working_out: false
    }
};

function withDefaults(account) {
    /*
     * A Discord-only sparx login has no row in the `accounts`
     * table, so checkAccount() returns null. Rather than refuse
     * the settings flow, hand the platform handler a defaults
     * object so the container renders and the min/max can
     * still be saved.
     */
    if (account) return account;
    return {
        sparx_maths_settings: { ...DEFAULT_MATHS_SETTINGS }
    };
}

async function handleSettings(interaction) {
    const platform = interaction.fields.getField('platform').values[0];
    console.log(platform);
    const { handleSetting } = require(`./platforms/${platform}`);
    const account = await checkAccount(interaction.user.id);
    await handleSetting(interaction, withDefaults(account));
}

async function updateSettingEmbedRouter(interaction, platform) {
    const account = await checkAccount(interaction.user.id);
    const { updateSettingEmbed } = require(`./platforms/${platform}`);
    await updateSettingEmbed(interaction, withDefaults(account));
}

module.exports = { handleSettings, updateSettingEmbedRouter };