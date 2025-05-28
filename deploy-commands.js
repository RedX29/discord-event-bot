// deploy-commands.js
const { REST, Routes, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
require('dotenv').config();

const commands = [
  new SlashCommandBuilder()
    .setName('startevent')
    .setDescription('Start an event')
    .addIntegerOption(opt =>
      opt.setName('duration')
         .setDescription('Duration in minutes')
         .setRequired(true))
    .addChannelOption(opt =>
      opt.setName('channel')
         .setDescription('Channel where the event will be hosted')
         .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('winners')
         .setDescription('Number of winners')
         .setRequired(true))
    .addStringOption(opt =>
      opt.setName('prize')
         .setDescription('What is the prize?')
         .setRequired(true))
    // Only members who can manage channels can use this
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('endevent')
    .setDescription('Ends the current event early')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('rerollwinner')
    .setDescription('Reroll a winner from the last event')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
    .setDMPermission(false)
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('🚀 Registering slash commands to guild…');

    // For instant updates in your test server
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('✅ Slash commands registered!');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
})();
