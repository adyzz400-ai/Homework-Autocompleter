require('dotenv').config();;
const { createClient } = require('@supabase/supabase-js');
const config = require('../config.json');
const hashCompare = require('../utils/hashCompare');

const supabaseUrl = process.env.SUPABASEURL;
const supabaseKey = process.env.SUPABASEKEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function addToDb(discord_id, master_password, license) {

    console.log("Add to db activated");

    if ( (await checkAccount(discord_id)) !== null) return false;

    const { error } = await supabase
    .from('accounts')
    .insert([
        { discord_id, master_password, license, slots: config.slots[license] ?? 0},
    ]);

    console.log(error);
    console.log("Added to DB");
    return true;
}

async function resetAllUses() {
    const { data, error } = await supabase
        .from('accounts')
        .update({ uses: {}, used_main_account: false })
        .not('discord_id', 'is', null)
        .select();

    if (error) {
        console.error('Error updating accounts:', error);
        return null;
    }

    console.log('All accounts updated with empty uses');
    return data;
}

async function getAudit() {
    const { data, error } = await supabase
    .from('accounts')
    .select('discord_id, license, free_trial_start');

    if (error) {
    console.error('Error fetching accounts:', error);
    } else {
    console.log('Accounts audit fetched');
    }

    return data;
}

async function removeMainAccount(discordId, platform) {
    const { data, error } = await supabase
        .from('accounts')
        .select('main_accounts')
        .eq('discord_id', discordId)
        .single();

    if (error || !data) {
        console.error("Error fetching user:", error);
        return false;
    }

    const currentAccounts = data.main_accounts;

    if (currentAccounts && currentAccounts[platform]) {
        delete currentAccounts[platform];

        const { error: updateError } = await supabase
            .from('accounts')
            .update({ main_accounts: currentAccounts })
            .eq('discord_id', discordId);

        if (updateError) {
            console.error("Error updating database:", updateError);
            return false;
        }

        console.log(`Successfully removed ${platform} for user ${discordId}`);
        return true;
    }

    console.log(`Platform ${platform} not found for user ${discordId}`);
    return false;
}

async function checkDuplicatesMainAccounts(platform, accountId, discordId, checkSelf = false) {
    const { data } = await supabase
        .from('accounts')
        .select('discord_id, main_accounts');

    let matchDiscordId = null;

    for (const row of data) {
        if (row.main_accounts[platform] && (checkSelf || (row.discord_id !== discordId))) {

            const isMatch = await hashCompare(accountId, row.main_accounts[platform]);

            if (isMatch) {
                console.log(`Match with ${row.discord_id}`);
                matchDiscordId = row.discord_id;
                break;
            }
        }
    }
    return matchDiscordId;
}

async function addMainAccount(discord_id, platform, accountId) {
    const mainAccounts = (await checkAccount(discord_id)).main_accounts;
    if ( mainAccounts[platform]) return false;
    mainAccounts[platform] = accountId;
    const { error } = await supabase
    .from('accounts')
    .update({ main_accounts: mainAccounts })
    .eq('discord_id', discord_id);

    console.log("Add main account");
    console.log(error);

    return true;
}

async function activateFreeTrial(discord_id) {
    if ( (await checkAccount(discord_id)).free_trial_start !== null) return false;
    const { error } = await supabase
    .from('accounts')
    .update({ free_trial_start: new Date() })
    .eq('discord_id', discord_id);

    console.log("Free trial activated");
    console.log(error);
    return true;
}

async function updateDB(discord_id, data) {
    const { error } = await supabase
    .from('accounts')
    .update(data)
    .eq('discord_id', discord_id);

    console.log("DB updated");
    console.log(error);
}

async function clearSpecificService(service) {
  const { data: accounts, error: fetchError } = await supabase
    .from('accounts')
    .select('discord_id, main_accounts');

  if (fetchError) {
    console.error('Error fetching accounts:', fetchError);
    return;
  }

  const updates = accounts.map(async (account) => {
    const jsonData = account.main_accounts;

    if (jsonData && jsonData[service]) {

      delete jsonData[service];

      const { error: updateError } = await supabase
        .from('accounts')
        .update({ main_accounts: jsonData })
        .eq('discord_id', account.discord_id);

      if (updateError) console.error(`Failed to update account ${account.id}`, updateError);
    }
  });

  await Promise.all(updates);
  console.log(`Finished clearing ${service}.`);
}

async function checkAccount(discord_id, license) {
    const { data } = await supabase
        .from('accounts')
        .select('*')
        .eq('discord_id', discord_id)
        .single();

    if (data) {
        if (license !== undefined && data.license !== license) {
            const dataToChange = {license: license};
            if (!data.custom_slots && (data.slots !== config.slots[license])) dataToChange.slots = config.slots[license];
            await updateDB(discord_id, dataToChange);
            if (Number.isFinite(dataToChange.slots)) data.slots = dataToChange.slots;
            data.license = license;
        };
        return data;
    } else {
        return null;
    }
}

async function updateStats(discord_id, platform, time_saved) {
    /*
     * Discord-only sparx login has no `accounts` row, so
     * checkAccount() returns null. Without this guard,
     * `.total_usage` on null throws and the whole cleanup
     * path fails — which was stopping the session from
     * being terminated properly.
     */
    const account = await checkAccount(discord_id);

    if (!account) {
        console.log(
            `[updateStats] no accounts row for ${discord_id}; skipping`
        );
        return;
    }

    if (!account.total_usage) {
        account.total_usage = {};
    }

    if (!account.total_usage[platform]) {
        account.total_usage[platform] = {
            total_uses: 0,
            time_saved: 0
        };
    }

    account.total_usage[platform].total_uses += 1;
    account.total_usage[platform].time_saved += time_saved;

    await updateDB(discord_id, account);
}

module.exports = { addToDb, updateStats, removeMainAccount, getAudit, clearSpecificService, resetAllUses, checkDuplicatesMainAccounts, checkAccount, updateDB, addMainAccount, activateFreeTrial };