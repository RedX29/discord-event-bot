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
         .setDescription('Text channel for the event')
         .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('winners')
         .setDescription('Number of winners')
         .setRequired(true))
    .addStringOption(opt =>
      opt.setName('prize')
         .setDescription('What is the prize?')
         .setRequired(true))
    // NEW: role whose members get extra entries
    .addRoleOption(opt =>
      opt.setName('multiplierrole')
         .setDescription('Role whose members get extra entries')
         .setRequired(false))
    // NEW: how many entries those role-holders get
    .addIntegerOption(opt =>
      opt.setName('multiplier')
         .setDescription('How many entries those members get')
         .setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('endevent')
    .setDescription('Ends the current event early')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('rerollwinner')
    .setDescription('Reroll a winner from the last event')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
    .setDMPermission(false)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('eventinfo')
    .setDescription('Show how many people have participated and time left')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
    .setDMPermission(false)
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('🚀 Registering slash commands to guild…');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered!');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
})();
