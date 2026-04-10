/**
 * Endfield Daily Check-in Integration
 * Handles automatic daily check-ins for Endfield game accounts
 * Matches the original working Google Apps Script logic
 */

import { getEndfieldProfiles } from './db.js';
import dotenv from 'dotenv';
dotenv.config();
import { Client, GatewayIntentBits } from 'discord.js';
import fetch from 'node-fetch';
import crypto from 'crypto';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.login(process.env.DISCORD_TOKEN);

const discord_notify = true;
const myDiscordID = process.env.MY_DISCORD_ID || "";
const discordWebhook = process.env.DISCORD_WEBHOOK_URL || "";

const attendanceUrl = 'https://zonai.skport.com/web/v1/game/endfield/attendance';

// ======== MAIN ========

async function main() {
    console.log('[Endfield Check-in] Starting daily check-in process...');

    const profiles = getEndfieldProfiles();

    if (profiles.length === 0) {
        console.log('[Endfield Check-in] No profiles configured');
        return;
    }

    console.log(`[Endfield Check-in] Found ${profiles.length} profile(s)`);

    const results = await Promise.all(profiles.map(profile =>
        autoClaimFunction({
            cred: profile.cred.replace(/^<|>$/g, ''),
            skGameRole: profile.sk_game_role.replace(/^<|>$/g, ''),
            platform: profile.platform.replace(/^<|>$/g, ''),
            vName: profile.v_name.replace(/^<|>$/g, ''),
            accountName: profile.account_name.replace(/^<|>$/g, ''),
        })
    ));

    if (discord_notify && discordWebhook) {
        await postWebhook(results);
    }

    console.log('[Endfield Check-in] Daily check-in process completed');
}

// ======== AUTO CLAIM ========

async function autoClaimFunction({ cred, skGameRole, platform, vName, accountName }) {
    console.log(`[${accountName}] Checking credentials and performing check-in...`);

    const timestamp = Math.floor(Date.now() / 1000).toString();

    let token = "";
    try {
        token = await refreshToken(cred, platform, vName);
        console.log(`[${accountName}] Token refreshed successfully.`);
    } catch (e) {
        console.error(`[${accountName}] Token refresh failed: ${e.message}`);
    }

    const sign = generateSign('/web/v1/game/endfield/attendance', '', timestamp, token, platform, vName);

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Referer': 'https://game.skport.com/',
        'Content-Type': 'application/json',
        'sk-language': 'en',
        'sk-game-role': skGameRole,
        'cred': cred,
        'platform': platform,
        'vName': vName,
        'timestamp': timestamp,
        'sign': sign,
        'Origin': 'https://game.skport.com',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site'
    };

    let result = {
        name: accountName,
        success: false,
        status: "",
        rewards: ""
    };

    try {
        const response = await fetch(attendanceUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({})
        });
        console.log(`[${accountName}] HTTP status:`, response.status);
        const rawText = await response.text();
        console.log(`[${accountName}] Raw response:`, rawText);
        const responseJson = JSON.parse(rawText);

        console.log(`[${accountName}] API Response Code: ${responseJson.code}`);

        if (responseJson.code === 0) {
            result.success = true;
            result.status = "✅ Check-in Successful";

            if (responseJson.data && responseJson.data.awardIds) {
                const awards = responseJson.data.awardIds.map(award => {
                    const resource = responseJson.data.resourceInfoMap ? responseJson.data.resourceInfoMap[award.id] : null;
                    return resource ? `${resource.name} x${resource.count}` : (award.id || "Unknown Item");
                }).join('\n');
                result.rewards = awards;
            } else {
                result.rewards = "No detailed reward info.";
            }
        } else if (responseJson.code === 10001) {
            result.success = true;
            result.status = "👌 Already Checked In";
            result.rewards = "Nothing to claim";
        } else {
            result.success = false;
            result.status = `❌ Error (Code: ${responseJson.code})`;
            result.rewards = responseJson.message || "Unknown Error";
        }
    } catch (error) {
        result.success = false;
        result.status = "💥 Exception";
        result.rewards = error.message;
        console.error(`[${accountName}] Exception: ${error.message}`);
    }

    return result;
}

// ======== WEBHOOK ========

async function postWebhook(results) {
    console.log('Posting to Discord webhook...');

    const allSuccess = results.every(r => r.success);
    const embedColor = allSuccess ? 5763719 : 15548997;

    const fields = results.map(r => ({
        name: `👤 ${r.name}`,
        value: `**Status:** ${r.status}\n**Rewards:**\n${r.rewards || 'None'}`,
        inline: true,
    }));

    const payload = {
        username: "Endfield Assistant",
        avatar_url: "https://pbs.twimg.com/profile_images/1984225639407529984/2_3-HRTS_400x400.jpg",
        embeds: [{
            title: "📡 Endfield Daily Check-in Report",
            color: embedColor,
            fields: fields,
            footer: {
                text: `Time: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} (UTC)`,
                icon_url: "https://assets.skport.com/assets/favicon.ico"
            }
        }]
    };

    if (!allSuccess && myDiscordID) {
        payload.content = `<@${myDiscordID}> Script encountered an error, please check logs!`;
    }

    try {
        const channel = await client.channels.fetch(process.env.DISCORD_CHECKIN_CHANNEL_ID);
        await channel.send(payload);
        console.log('[Endfield Check-in] Message sent to channel successfully');
    } catch (e) {
        console.error('Failed to send Discord message: ' + e.message);
    }
}

// ======== HELPERS ========

async function refreshToken(cred, platform, vName) {
    const refreshUrl = 'https://zonai.skport.com/web/v1/auth/refresh';

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'cred': cred,
        'platform': platform,
        'vName': vName,
        'Origin': 'https://game.skport.com',
        'Referer': 'https://game.skport.com/'
    };

    const response = await fetch(refreshUrl, { method: 'GET', headers });
    const json = await response.json();

    if (json.code === 0 && json.data && json.data.token) {
        return json.data.token;
    } else {
        throw new Error(`Refresh Failed (Code: ${json.code}, Msg: ${json.message})`);
    }
}

function generateSign(path, body, timestamp, token, platform, vName) {
    let str = path + body + timestamp;
    const headerJson = `{"platform":"${platform}","timestamp":"${timestamp}","dId":"","vName":"${vName}"}`;
    str += headerJson;

    const hmacHex = crypto.createHmac('sha256', token || '').update(str).digest('hex');
    const md5Hex = crypto.createHash('md5').update(hmacHex).digest('hex');
    return md5Hex;
}

// ======== EXPORTS ========

export { main };

if (process.argv[1] && process.argv[1].endsWith('endfield_checkin.js')) {
    main().catch(console.error);
}
