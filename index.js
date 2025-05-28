// UptimeRobot web server setup
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(port, () => {
  console.log(`🌐 Uptime monitor active on port ${port}`);
});

// Discord bot code
const { Client, GatewayIntentBits, Events, ChannelType } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let activeEvent = null;

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options } = interaction;

  if (commandName === 'startevent') {
    const duration = options.getInteger('duration');
    const channel = options.getChannel('channel');
    const winners = options.getInteger('winners');
    const prize = options.getString('prize');

    if (!channel || channel.type !== ChannelType.GuildText) {
      return interaction.reply({ content: '❌ Please select a text channel!', ephemeral: true });
    }

    const endTime = Date.now() + duration * 60 * 1000;
    const discordTimestamp = `<t:${Math.floor(endTime / 1000)}:R>`;

    activeEvent = {
      channel,
      endTime,
      winnersCount: winners,
      prize,
      participants: new Set(),
      timeout: null
    };

    await channel.send(
      `@everyone\n` +
      `🎉 THE EVENT HAS STARTED 🎉\n` +
      `The event will end ${discordTimestamp} so, don’t forget to participate before the deadline..`
    );

    await interaction.reply({ content: '✅ Done! 🎉', ephemeral: true });

    activeEvent.timeout = setTimeout(async () => {
      const { channel, participants, winnersCount, prize } = activeEvent;
      activeEvent = null;

      const entrants = Array.from(participants);
      if (entrants.length === 0) {
        return channel.send('😢 Sadly, no one won the event :(');
      }

      const picked = [];
      for (let i = 0; i < Math.min(winnersCount, entrants.length); i++) {
        const idx = Math.floor(Math.random() * entrants.length);
        picked.push(entrants.splice(idx, 1)[0]);
      }
      const mention = picked.map(id => `<@${id}>`).join(', ');
      const msg = picked.length > 1
        ? `🎊 Congratulations ${mention}! You all won the **${prize}**!! 🥳`
        : `🎊 Congratulations ${mention}! You won the **${prize}**!! 🥳`;

      await channel.send(msg);

      try {
        await channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          { SendMessages: false, ViewChannel: true }
        );
      } catch (err) {
        console.error('Failed to lock channel:', err);
      }
    }, duration * 60 * 1000);

  } else if (commandName === 'endevent') {
    if (!activeEvent) {
      return interaction.reply({ content: '⚠️ No active event to end.', ephemeral: true });
    }
    clearTimeout(activeEvent.timeout);
    const channel = activeEvent.channel;
    activeEvent = null;

    await interaction.reply({ content: '✅ Done! 🎉', ephemeral: true });
    channel.send('⚠️ The event was ended early by an administrator.');

    try {
      await channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: false, ViewChannel: true }
      );
    } catch (err) {
      console.error('Failed to lock channel:', err);
    }

  } else if (commandName === 'rerollwinner') {
    if (!activeEvent) {
      return interaction.reply({ content: '⚠️ No event data to reroll.', ephemeral: true });
    }
    const entrants = Array.from(activeEvent.participants);
    if (entrants.length === 0) {
      return interaction.reply({ content: '⚠️ No participants to reroll.', ephemeral: true });
    }
    const idx = Math.floor(Math.random() * entrants.length);
    const winnerId = entrants[idx];
    await interaction.reply({ content: `🎉 New winner: <@${winnerId}>!`, ephemeral: true });
  }
});

client.on('messageCreate', message => {
  if (
    activeEvent &&
    message.channel.id === activeEvent.channel.id &&
    !message.author.bot
  ) {
    activeEvent.participants.add(message.author.id);
  }
});

client.login(process.env.TOKEN);
