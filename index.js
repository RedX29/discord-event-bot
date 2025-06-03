// Express keep-alive
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(port, () => console.log(`🌐 Uptime monitor on port ${port}`));

// Imports & Persistence Setup
const { Client, GatewayIntentBits, Events, ChannelType } = require('discord.js');
require('dotenv').config();
const fetch = require('node-fetch');

const GIST_ID  = process.env.GIST_ID;
const GH_TOKEN = process.env.GITHUB_TOKEN;

async function loadEvents() {
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { Authorization: `token ${GH_TOKEN}` }
    });
    const gist = await res.json();
    const content = JSON.parse(gist.files['event.json'].content);
    return content.events || {};
  } catch (err) {
    console.error('Error loading events from Gist:', err);
    return {};
  }
}

async function saveEvents(data) {
  try {
    await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: {
        Authorization: `token ${GH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        files: {
          'event.json': {
            content: JSON.stringify({ events: data }, null, 2)
          }
        }
      })
    });
  } catch (err) {
    console.error('Error saving events to Gist:', err);
  }
}

// Bot Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const activeEvents = {}; // channelId => eventData

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const savedEvents = await loadEvents();
  let didPrune = false;

  for (const [channelId, eventData] of Object.entries(savedEvents)) {
    const msLeft = eventData.endTime - Date.now();

    // If event has already expired, remove it from savedEvents
    if (msLeft <= 0) {
      delete savedEvents[channelId];
      didPrune = true;
      continue;
    }

    // Otherwise, try to fetch the channel to resume
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      // Channel no longer exists or isn't fetchable → remove it
      delete savedEvents[channelId];
      didPrune = true;
      continue;
    }

    const participants = new Set(Object.keys(eventData.participants));
    const timeout = setTimeout(() => client.emit('endEvent', channelId), msLeft);

    activeEvents[channelId] = {
      ...eventData,
      channel,
      participants,
      timeout
    };

    console.log(
      `🔔 Resumed event in #${channel.name}, ends in ${Math.ceil(msLeft / 60000)} min`
    );
  }

  if (didPrune) {
    await saveEvents(savedEvents);
  }
});

// Slash Command Handling
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options, guildId } = interaction;

  if (commandName === 'startevent') {
    const duration = options.getInteger('duration');
    const channel  = options.getChannel('channel');
    const winners  = options.getInteger('winners');
    const prize    = options.getString('prize');
    const role     = options.getRole('multiplierrole');
    const mul      = options.getInteger('multiplier') || 1;

    if (!channel || channel.type !== ChannelType.GuildText) {
      return interaction.reply({
        content: '❌ Please select a text channel!',
        ephemeral: true
      });
    }

    const endTime   = Date.now() + duration * 60000;
    const ts        = `<t:${Math.floor(endTime / 1000)}:R>`;
    const channelId = channel.id;

    const participants = new Set();
    const timeout = setTimeout(() => client.emit('endEvent', channelId), duration * 60000);

    activeEvents[channelId] = {
      channel,
      endTime,
      winnersCount: winners,
      prize,
      participants,
      multiplierRoleId: role?.id ?? null,
      multiplierCount: mul,
      timeout,
      guildId
    };

    const saved = await loadEvents();
    saved[channelId] = {
      channelId,
      endTime,
      winnersCount: winners,
      prize,
      participants: {},
      guildId,
      multiplierRoleId: role?.id ?? null,
      multiplierCount: mul
    };
    await saveEvents(saved);

    await channel.send(
      `🎉 THE EVENT HAS STARTED 🎉\n` +
      `The event will end ${ts} so, don’t forget to participate before the deadline.`
    );
    await interaction.reply({ content: '✅ Done! 🎉', ephemeral: true });

  } else if (commandName === 'endevent') {
    const channelId = interaction.channel.id;
    const event = activeEvents[channelId];

    if (!event) {
      return interaction.reply({
        content: '⚠️ No active event to end.',
        ephemeral: true
      });
    }

    clearTimeout(event.timeout);
    delete activeEvents[channelId];

    const saved = await loadEvents();
    delete saved[channelId];
    await saveEvents(saved);

    await interaction.reply({ content: '✅ Done! 🎉', ephemeral: true });
    event.channel.send('⚠️ The event was ended early by an administrator.');
  }

  else if (commandName === 'rerollwinner') {
    const channelId = interaction.channel.id;
    const event = activeEvents[channelId];
    if (!event) {
      return interaction.reply({
        content: '⚠️ No event data to reroll.',
        ephemeral: true
      });
    }
    const entrants = Array.from(event.participants);
    if (!entrants.length) {
      return interaction.reply({
        content: '⚠️ No participants to reroll.',
        ephemeral: true
      });
    }
    const winner = entrants[Math.floor(Math.random() * entrants.length)];
    interaction.reply({
      content: `🎉 New winner: <@${winner}>!`,
      ephemeral: true
    });
  }

  else if (commandName === 'eventinfo') {
    const channelId = interaction.channel.id;
    const event = activeEvents[channelId];
    if (!event) {
      return interaction.reply({
        content: '⚠️ No active event right now.',
        ephemeral: true
      });
    }
    const mins  = Math.max(0, Math.floor((event.endTime - Date.now()) / 60000));
    const count = event.participants.size;
    interaction.reply({
      content: `📊 Event info:\nParticipants: ${count}\nTime left: ${mins} minute(s)`,
      ephemeral: true
    });
  }
});

// Participant Listener
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const event = activeEvents[message.channel.id];
  if (!event) return;

  const userId = message.author.id;
  if (event.participants.has(userId)) return;

  const hasRole = event.multiplierRoleId &&
                  message.member.roles.cache.has(event.multiplierRoleId);
  event.participants.add(userId);

  const saved = await loadEvents();
  const eventData = saved[message.channel.id];
  if (eventData) {
    eventData.participants[userId] = hasRole ? event.multiplierCount : 1;
    await saveEvents(saved);
  }
});

// Event Ending Logic
client.on('endEvent', async channelId => {
  const event = activeEvents[channelId];
  if (!event) return;

  clearTimeout(event.timeout);
  const { channel, participants, winnersCount, prize } = event;
  const entrants = Array.from(participants);
  let msg;

  if (!entrants.length) {
    msg = '😢 Sadly, no one won the event :(';
  } else {
    const pool = [...entrants], picked = [];
    for (let i = 0; i < Math.min(winnersCount, pool.length); i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }
    const mention = picked.map(id => `<@${id}>`).join(', ');
    msg = picked.length > 1
      ? `🎊 Congratulations ${mention}! You all won the **${prize}**!! 🥳`
      : `🎊 Congratulations ${mention}! You won the **${prize}**!! 🥳`;
  }

  await channel.send(msg);

  delete activeEvents[channelId];
  const saved = await loadEvents();
  delete saved[channelId];
  await saveEvents(saved);
});

client.login(process.env.TOKEN);
