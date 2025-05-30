// ─── Express keep-alive (optional) ─────────────────────────────────────
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(port, () => console.log(`🌐 Uptime monitor on port ${port}`));

// ─── Imports & Persistence Setup ────────────────────────────────────────
const { Client, GatewayIntentBits, Events, ChannelType } = require('discord.js');
require('dotenv').config();
const fetch = require('node-fetch'); // make sure node-fetch@2 is installed

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
    body: JSON.stringify({ files: { 'event.json': { content: JSON.stringify(data, null, 2) } } })
  });
}

// ─── Bot Setup ─────────────────────────────────────────────────────────
const client = new Client({
  intents: [ 
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let activeEvent = null;

// ─── Resume Ongoing Event ──────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const saved = await loadEvent();
  if (saved.active) {
    // Rebuild the event in memory
    activeEvent = {
      channel:       await client.channels.fetch(saved.channelId),
      endTime:       saved.endTime,
      winnersCount:  saved.winnersCount,
      prize:         saved.prize,
      participants:  new Set(Object.keys(saved.participants)),
      multiplierRoleId: saved.multiplierRoleId,
      multiplierCount:  saved.multiplierCount,
      timeout:       null,
      guildId:       saved.guildId
    };

    const msLeft = saved.endTime - Date.now();
    if (msLeft > 0) {
      // schedule end
      activeEvent.timeout = setTimeout(async () => {
        // reuse your end logic below
        const { channel, participants, winnersCount, prize, guildId } = activeEvent;
        const entrants = Array.from(participants);
        let msg;
        if (!entrants.length) {
          msg = '😢 Sadly, no one won the event :(';
        } else {
          const pool = [...entrants];
          const picked = [];
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
        try {
          const guild = await client.guilds.fetch(guildId);
          await channel.permissionOverwrites.edit(
            guild.roles.everyone,
            { SendMessages: false, ViewChannel: true }
          );
        } catch {}
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
      }, msLeft);
      console.log(`🔔 Resumed event, ends in ${Math.ceil(msLeft/60000)} min`);
    } else {
      console.log('⚠️ Saved event already expired—skipping resume.');
    }
  }
});

// ─── Slash Command Handling ─────────────────────────────────────────────
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
      return interaction.reply({ content: '❌ Please select a text channel!', ephemeral: true });
    }

    const endTime = Date.now() + duration*60000;
    const ts      = `<t:${Math.floor(endTime/1000)}:R>`;

    activeEvent = {
      channel,
      endTime,
      winnersCount: winners,
      prize,
      participants: new Set(),
      multiplierRoleId: role?.id ?? null,
      multiplierCount: mul,
      timeout: null,
      guildId
    };

    // persist start
    await saveEvent({
      active: true,
      channelId: channel.id,
      endTime,
      winnersCount: winners,
      prize,
      participants: {},
      guildId,
      multiplierRoleId: role?.id ?? null,
      multiplierCount: mul
    });

    await channel.send(
      `@everyone\n🎉 THE EVENT HAS STARTED 🎉\n` +
      `The event will end ${ts} so, don’t forget to participate before the deadline.`
    );
    await interaction.reply({ content: '✅ Done! 🎉', ephemeral: true });

    // schedule end
    activeEvent.timeout = setTimeout(() => client.emit('endEvent'), duration*60000);

  } else if (commandName === 'endevent') {
    if (!activeEvent) {
      return interaction.reply({ content: '⚠️ No active event to end.', ephemeral: true });
    }
    clearTimeout(activeEvent.timeout);
    const channel = activeEvent.channel;
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
    await interaction.reply({ content: '✅ Done! 🎉', ephemeral: true });
    channel.send('⚠️ The event was ended early by an administrator.');
    try { await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false, ViewChannel: true }); }
    catch {}
  } else if (commandName === 'rerollwinner') {
    if (!activeEvent) {
      return interaction.reply({ content: '⚠️ No event data to reroll.', ephemeral: true });
    }
    const entrants = Array.from(activeEvent.participants);
    if (!entrants.length) {
      return interaction.reply({ content: '⚠️ No participants to reroll.', ephemeral: true });
    }
    const winner = entrants[Math.floor(Math.random()*entrants.length)];
    interaction.reply({ content: `🎉 New winner: <@${winner}>!`, ephemeral: true });
  } else if (commandName === 'eventinfo') {
    if (!activeEvent) {
      return interaction.reply({ content: '⚠️ No active event right now.', ephemeral: true });
    }
    const leftMs = activeEvent.endTime - Date.now();
    const mins   = Math.max(0, Math.floor(leftMs/60000));
    const count  = activeEvent.participants.size;
    interaction.reply({
      content: `📊 Event info:\nParticipants: ${count}\nTime left: ${mins} minute(s)`,
      ephemeral: true
    });
  }
});

// ─── Participant Listener ────────────────────────────────────────────────
client.on('messageCreate', async message => {
  if (
    activeEvent &&
    message.channel.id === activeEvent.channel.id &&
    !message.author.bot
  ) {
    const id = message.author.id;
    if (!activeEvent.participants.has(id)) {
      const hasRole = activeEvent.multiplierRoleId &&
                      message.member.roles.cache.has(activeEvent.multiplierRoleId);
      // assign entries
      activeEvent.participants.add(id);

      // persist new participant counts
      const toSave = {
        active: true,
        channelId: activeEvent.channel.id,
        endTime: activeEvent.endTime,
        winnersCount: activeEvent.winnersCount,
        prize: activeEvent.prize,
        participants: Object.fromEntries(
          [...activeEvent.participants].map(u => [u, hasRole ? activeEvent.multiplierCount : 1])
        ),
        guildId: activeEvent.guildId,
        multiplierRoleId: activeEvent.multiplierRoleId,
        multiplierCount: activeEvent.multiplierCount
      };
      await saveEvent(toSave);
    }
  }
});

// ─── Custom endEvent emitter ────────────────────────────────────────────
client.on('endEvent', async () => {
  if (activeEvent) {
    clearTimeout(activeEvent.timeout);
    const { channel, participants, winnersCount, prize, guildId } = activeEvent;
    const entrants = Array.from(participants);
    let msg;
    if (!entrants.length) msg = '😢 Sadly, no one won the event :(';
    else {
      const pool = [...entrants], picked = [];
      for (let i = 0; i < Math.min(winnersCount, pool.length); i++) {
        const idx = Math.floor(Math.random()*pool.length);
        picked.push(pool.splice(idx,1)[0]);
      }
      const mention = picked.map(id=>`<@${id}>`).join(', ');
      msg = picked.length>1
        ? `🎊 Congratulations ${mention}! You all won the **${prize}**!! 🥳`
        : `🎊 Congratulations ${mention}! You won the **${prize}**!! 🥳`;
    }
    await channel.send(msg);
    try {
      const guild = await client.guilds.fetch(guildId);
      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { SendMessages: false, ViewChannel: true }
      );
    } catch {}
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
  }
});

client.login(process.env.TOKEN);
