// ─── Imports & Env setup ────────────────────────────────────────────────
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

const fetch = require('node-fetch');              // npm install node-fetch@2
const { Client, GatewayIntentBits, Events, ChannelType } = require('discord.js');
require('dotenv').config();
// ────────────────────────────────────────────────────────────────────────

// ─── GitHub Gist persistence setup ─────────────────────────────────────
const GIST_ID   = process.env.GIST_ID;            // from your Gist URL
const GH_TOKEN  = process.env.GITHUB_TOKEN;       // PAT with gist scope

async function loadEvent() {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: { Authorization: `token ${GH_TOKEN}` }
  });
  const gist = await res.json();
  return JSON.parse(gist.files['event.json'].content);
}

async function saveEvent(data) {
  await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `token ${GH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      files: {
        'event.json': { content: JSON.stringify(data, null, 2) }
      }
    })
  });
}
// ────────────────────────────────────────────────────────────────────────

// Express keep-alive endpoint
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(port, () => console.log(`🌐 Uptime monitor active on port ${port}`));

// ─── Discord client setup ───────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let activeEvent = null;
let eventTimeout = null;

// ─── Helper: end the event ──────────────────────────────────────────────
async function endEvent() {
  if (!activeEvent) return;

  const { channelId, participants, winnersCount, prize, guildId } = activeEvent;
  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (channel) {
    // build weighted pool
    const pool = [];
    for (const [userId, count] of Object.entries(participants)) {
      for (let i = 0; i < count; i++) pool.push(userId);
    }

    if (pool.length === 0) {
      await channel.send('😢 No one joined.');
    } else {
      const picked = [];
      for (let i = 0; i < Math.min(winnersCount, pool.length); i++) {
        const idx = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(idx, 1)[0]);
      }
      const mention = [...new Set(picked)].map(id => `<@${id}>`).join(', ');
      const msg = picked.length > 1
        ? `🎊 Congrats ${mention}! You all won **${prize}**! 🎉`
        : `🎊 Congrats ${mention}! You won **${prize}**! 🎉`;
      await channel.send(msg);
    }

    // lock channel
    try {
      const guild = await client.guilds.fetch(guildId);
      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { SendMessages: false, ViewChannel: true }
      );
    } catch (err) {
      console.error('Lock channel failed:', err);
    }
  }

  // reset and persist
  activeEvent = null;
  await saveEvent({
    active: false,
    channelId: null,
    endTime: null,
    winnersCount: 1,
    prize: null,
    participants: {},
    guildId: null,
    multiplierRoleId: null,
    multiplierCount: 1
  });
  clearTimeout(eventTimeout);
  eventTimeout = null;
}

// ─── Helper: schedule event end ─────────────────────────────────────────
function setupEventTimeout() {
  if (!activeEvent) return;
  const msLeft = activeEvent.endTime - Date.now();
  if (msLeft <= 0) return endEvent();
  clearTimeout(eventTimeout);
  eventTimeout = setTimeout(endEvent, msLeft);
}

// ─── On ready: load & resume any active event ───────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const saved = await loadEvent();
  if (saved.active) {
    activeEvent = {
      channelId:        saved.channelId,
      endTime:          saved.endTime,
      winnersCount:     saved.winnersCount,
      prize:            saved.prize,
      participants:     saved.participants,
      guildId:          saved.guildId,
      multiplierRoleId: saved.multiplierRoleId,
      multiplierCount:  saved.multiplierCount
    };
    console.log(`🔔 Resuming event in #${activeEvent.channelId}, ends at ${new Date(activeEvent.endTime).toLocaleString()}`);
    setupEventTimeout();
  }
});

// ─── Interaction handler (slash commands) ───────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options, guildId } = interaction;

  if (commandName === 'startevent') {
    if (activeEvent && activeEvent.endTime > Date.now()) {
      return interaction.reply({ content: '⚠️ Already running!', ephemeral: true });
    }
    const duration        = options.getInteger('duration');
    const channel         = options.getChannel('channel');
    const winners         = options.getInteger('winners');
    const prize           = options.getString('prize');
    const role            = options.getRole('multiplierrole');
    const multiplierCount = options.getInteger('multiplier') || 1;

    if (!channel || channel.type !== ChannelType.GuildText) {
      return interaction.reply({ content: '❌ Select a text channel!', ephemeral: true });
    }

    const endTime = Date.now() + duration * 60000;
    activeEvent = {
      channelId:        channel.id,
      endTime,
      winnersCount:     winners,
      prize,
      participants:     {},      // userId → entry count
      guildId,
      multiplierRoleId: role?.id ?? null,
      multiplierCount
    };

    await saveEvent(activeEvent);

    await channel.send(
      `@everyone\n🎉 EVENT STARTED! 🎉\n` +
      `Ends <t:${Math.floor(endTime/1000)}:R>\n` +
      (role
        ? `Members with the @${role.name} role get **${multiplierCount}×** entries!`
        : '')
    );
    await interaction.reply({ content: '✅ Event started!', ephemeral: true });
    setupEventTimeout();

  } else if (commandName === 'endevent') {
    if (!activeEvent) {
      return interaction.reply({ content: '⚠️ No active event.', ephemeral: true });
    }
    clearTimeout(eventTimeout);
    await endEvent();
    await interaction.reply({ content: '✅ Event ended early.', ephemeral: true });

  } else if (commandName === 'rerollwinner') {
    if (!activeEvent) {
      return interaction.reply({ content: '⚠️ No event to reroll.', ephemeral: true });
    }
    const pool = [];
    for (const [userId, count] of Object.entries(activeEvent.participants)) {
      for (let i = 0; i < count; i++) pool.push(userId);
    }
    if (pool.length === 0) {
      return interaction.reply({ content: '⚠️ No participants.', ephemeral: true });
    }
    const winner = pool[Math.floor(Math.random() * pool.length)];
    await interaction.reply({ content: `🎉 New winner: <@${winner}>!`, ephemeral: true });

  } else if (commandName === 'eventinfo') {
    if (!activeEvent) {
      return interaction.reply({ content: '⚠️ No active event.', ephemeral: true });
    }
    const totalEntries = Object.values(activeEvent.participants).reduce((a,b) => a+b, 0);
    const uniqueCount  = Object.keys(activeEvent.participants).length;
    const secsLeft     = Math.max(0, Math.floor((activeEvent.endTime - Date.now())/1000));
    await interaction.reply({
      content:
        `👥 Unique participants: **${uniqueCount}**\n` +
        `🎟️ Total entries: **${totalEntries}**\n` +
        `⏳ Time left: <t:${Math.floor(Date.now()/1000 + secsLeft)}:R>`,
      ephemeral: true
    });
  }
});

// ─── Message listener: collect participants ──────────────────────────────
client.on('messageCreate', async message => {
  if (
    activeEvent &&
    message.channel.id === activeEvent.channelId &&
    !message.author.bot
  ) {
    const id = message.author.id;
    if (!(id in activeEvent.participants)) {
      const hasRole = activeEvent.multiplierRoleId &&
                      message.member.roles.cache.has(activeEvent.multiplierRoleId);
      activeEvent.participants[id] = hasRole
        ? activeEvent.multiplierCount
        : 1;
      await saveEvent(activeEvent);
    }
  }
});

// ─── Start the bot ───────────────────────────────────────────────────────
client.login(process.env.TOKEN);
