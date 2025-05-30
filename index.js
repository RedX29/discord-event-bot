const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// ─── Keep-alive endpoint (for UptimeRobot if you use it) ─────────────────
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(port, () => console.log(`🌐 Uptime monitor active on port ${port}`));

// ─── Discord & Persistence Setup ────────────────────────────────────────
const { Client, GatewayIntentBits, Events, ChannelType } = require('discord.js');
require('dotenv').config();

// GitHub Gist persistence
const fetch = require('node-fetch');               // ensure node-fetch@2 is installed
const GIST_ID  = process.env.GIST_ID;
const GH_TOKEN = process.env.GITHUB_TOKEN;

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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let activeEvent = null;

// ─── Resume any in-flight event on startup ───────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const saved = await loadEvent();
  if (saved.active) {
    // Rebuild activeEvent from gist
    activeEvent = {
      channel:       await client.channels.fetch(saved.channelId),
      endTime:       saved.endTime,
      winnersCount:  saved.winnersCount,
      prize:         saved.prize,
      participants:  new Set(Object.keys(saved.participants)),
      multiplierRoleId: saved.multiplierRoleId,
      multiplierCount:  saved.multiplierCount,
      timeout:       null
    };

    // Schedule the timeout for the remaining time
    const msLeft = saved.endTime - Date.now();
    if (msLeft > 0) {
      activeEvent.timeout = setTimeout(async () => {
        // reuse your existing end logic (you can factor into a function)
        const { channel, participants, winnersCount, prize } = activeEvent;
        const entrants = Array.from(participants);
        let msg;
        if (entrants.length === 0) {
          msg = '😢 Sadly, no one won the event :(';
        } else {
          const picked = [];
          const pool = [...entrants];
          for (let i = 0; i < Math.min(winnersCount, pool.length); i++) {
            const idx = Math.floor(Math.random() * pool.length);
            picked.push(pool.splice(idx, 1)[0]);
          }
          const mention = picked.map(id => `<@${id}>`).join(', ');
          msg = picked.length > 1
            ? `🎊 Congratulations ${mention}! You all won the **${prize}**!! 🥳`
            : `🎊 Congratulations ${mention}! You won the **${prize}**!! 🥳`;
        }
        await activeEvent.channel.send(msg);
        // lock channel
        try {
          const guild = await client.guilds.fetch(saved.guildId);
          await activeEvent.channel.permissionOverwrites.edit(
            guild.roles.everyone,
            { SendMessages: false, ViewChannel: true }
          );
        } catch {}
        // reset
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
      }, msLeft);
    } else {
      // If time already passed, end immediately
      console.log('⏰ Event expired while bot was offline—ending now.');
      client.emit(Events.InteractionCreate, {
        isChatInputCommand: () => true,
        commandName: 'endevent',
        reply: () => {}
      });
    }

    console.log(`🔔 Resumed event in #${saved.channelId}, ends in ${Math.round(msLeft/60000)} min`);
  }
});

// ─── Slash Command Handlers ──────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options, guildId } = interaction;

  if (commandName === 'startevent') {
    // ... your existing startevent logic, but call saveEvent(...) after setting activeEvent
    // e.g. await saveEvent({ active: true, channelId: channel.id, ... });

  } else if (commandName === 'endevent') {
    // ... your existing endevent logic, and then saveEvent({ active: false, ... });

  } else if (commandName === 'rerollwinner') {
    // ... existing reroll logic

  } else if (commandName === 'eventinfo') {
    // ... existing eventinfo logic
  }
});

// ─── Message Listener ────────────────────────────────────────────────────
client.on('messageCreate', async message => {
  if (
    activeEvent &&
    message.channel.id === activeEvent.channel.id &&
    !message.author.bot
  ) {
    const id = message.author.id;
    if (!activeEvent.participants.has(id)) {
      // assign entries (with multiplier if applicable)
      const hasRole = activeEvent.multiplierRoleId &&
                      message.member.roles.cache.has(activeEvent.multiplierRoleId);
      activeEvent.participants.add(id);
      // persist participants
      const toSave = {
        active: true,
        channelId: activeEvent.channel.id,
        endTime: activeEvent.endTime,
        winnersCount: activeEvent.winnersCount,
        prize: activeEvent.prize,
        participants: Object.fromEntries([...activeEvent.participants].map(u => [u, hasRole ? activeEvent.multiplierCount : 1])),
        guildId,
        multiplierRoleId: activeEvent.multiplierRoleId,
        multiplierCount: activeEvent.multiplierCount
      };
      await saveEvent(toSave);
    }
  }
});

client.login(process.env.TOKEN);
