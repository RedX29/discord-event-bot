// ─── Auto-create event.json ────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const EVENT_FILE = path.join(__dirname, 'event.json');
if (!fs.existsSync(EVENT_FILE)) {
  const defaultEvent = {
    active: false,
    channelId: null,
    endTime: null,
    winnersCount: 1,
    prize: null,
    participants: {},        // userId -> entryCount
    guildId: null,
    multiplierRoleId: null,  // NEW
    multiplierCount: 1       // NEW
  };
  fs.writeFileSync(EVENT_FILE, JSON.stringify(defaultEvent, null, 2));
}
// ───────────────────────────────────────────────────────────────────────

const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(port, () => console.log(`🌐 Uptime on port ${port}`));

const { Client, GatewayIntentBits, Events, ChannelType } = require('discord.js');
require('dotenv').config();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ─── Persistence Helpers ──────────────────────────────────────────────
function loadEvent() {
  try {
    return JSON.parse(fs.readFileSync(EVENT_FILE, 'utf-8'));
  } catch {
    return { active: false };
  }
}
function saveEvent(data) {
  fs.writeFileSync(EVENT_FILE, JSON.stringify(data, null, 2));
}
// ───────────────────────────────────────────────────────────────────────

let activeEvent = null;
let eventTimeout = null;

// ─── End Event Logic ──────────────────────────────────────────────────
async function endEvent() {
  if (!activeEvent) return;
  const {
    channelId,
    participants,
    winnersCount,
    prize,
    guildId
  } = activeEvent;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel) {
    // Build weighted pool
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

    // Lock channel
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

  // reset
  activeEvent = null;
  saveEvent({
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
  eventTimeout = null;
}

function setupEventTimeout() {
  if (!activeEvent) return;
  const msLeft = activeEvent.endTime - Date.now();
  if (msLeft <= 0) return endEvent();
  if (eventTimeout) clearTimeout(eventTimeout);
  eventTimeout = setTimeout(endEvent, msLeft);
}
// ───────────────────────────────────────────────────────────────────────

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // resume any in-flight event
  const saved = loadEvent();
  if (saved.active) {
    activeEvent = {
      channelId: saved.channelId,
      endTime: saved.endTime,
      winnersCount: saved.winnersCount,
      prize: saved.prize,
      participants: saved.participants,      // object
      guildId: saved.guildId,
      multiplierRoleId: saved.multiplierRoleId,
      multiplierCount: saved.multiplierCount
    };
    console.log(
      `🔔 Resuming event in #${activeEvent.channelId}, ends at ${new Date(activeEvent.endTime).toLocaleString()}`
    );
    setupEventTimeout();
  }
});

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
    const role            = options.getRole('multiplierrole');  // NEW
    const multiplierCount = options.getInteger('multiplier') || 1; // NEW

    if (!channel || channel.type !== ChannelType.GuildText) {
      return interaction.reply({ content: '❌ Select a text channel!', ephemeral: true });
    }

    const endTime = Date.now() + duration * 60000;
    activeEvent = {
      channelId: channel.id,
      endTime,
      winnersCount: winners,
      prize,
      participants: {},       // reset
      guildId,
      multiplierRoleId: role?.id ?? null,
      multiplierCount
    };

    saveEvent(activeEvent);

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
    if (eventTimeout) clearTimeout(eventTimeout);
    await endEvent();
    return interaction.reply({ content: '✅ Ended early.', ephemeral: true });

  } else if (commandName === 'rerollwinner') {
    if (!activeEvent) {
      return interaction.reply({ content: '⚠️ No event to reroll.', ephemeral: true });
    }
    const pool = [];
    for (const [userId, count] of Object.entries(activeEvent.participants || {})) {
      for (let i = 0; i < count; i++) pool.push(userId);
    }
    if (pool.length === 0) {
      return interaction.reply({ content: '⚠️ No participants.', ephemeral: true });
    }
    const winner = pool[Math.floor(Math.random() * pool.length)];
    return interaction.reply({ content: `🎉 New winner: <@${winner}>!`, ephemeral: true });

  } else if (commandName === 'eventinfo') {
    if (!activeEvent) {
      return interaction.reply({ content: '⚠️ No active event.', ephemeral: true });
    }
    const totalEntries = Object.values(activeEvent.participants).reduce((a, b) => a + b, 0);
    const uniqueCount  = Object.keys(activeEvent.participants).length;
    const secsLeft     = Math.max(0, Math.floor((activeEvent.endTime - Date.now()) / 1000));
    return interaction.reply({
      content:
        `👥 Unique participants: **${uniqueCount}**\n` +
        `🎟️ Total entries: **${totalEntries}**\n` +
        `⏳ Time left: <t:${Math.floor(Date.now()/1000 + secsLeft)}:R>`,
      ephemeral: true
    });
  }
});

client.on('messageCreate', message => {
  if (
    activeEvent &&
    message.channel.id === activeEvent.channelId &&
    !message.author.bot
  ) {
    const id = message.author.id;
    if (!(id in activeEvent.participants)) {
      // first-time join: assign 1× or multiplier× entries
      const hasRole = activeEvent.multiplierRoleId &&
                      message.member.roles.cache.has(activeEvent.multiplierRoleId);
      activeEvent.participants[id] = hasRole
        ? activeEvent.multiplierCount
        : 1;
      saveEvent(activeEvent);
    }
  }
});

client.login(process.env.TOKEN);
