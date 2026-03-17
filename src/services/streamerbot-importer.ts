/**
 * Streamer.bot Importer Service
 * Handles importing and converting Streamer.bot data files
 */

import fs from 'fs';
import path from 'path';
import {
  importStreamerbotActions,
  importStreamerbotCommands,
  mergeActions,
  mergeCommands,
  type StreamWeaverAction,
  type StreamWeaverCommand,
} from '@/lib/streamerbot-converter';

const DATA_DIR = path.join(process.cwd(), 'src', 'data');
const ACTIONS_FILE = path.join(DATA_DIR, 'actions.json');
const COMMANDS_FILE = path.join(DATA_DIR, 'commands.json');

/**
 * Load existing actions from file
 */
export async function loadExistingActions(): Promise<StreamWeaverAction[]> {
  try {
    if (!fs.existsSync(ACTIONS_FILE)) {
      return [];
    }
    const data = fs.readFileSync(ACTIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading existing actions:', error);
    return [];
  }
}

/**
 * Load existing commands from file
 */
export async function loadExistingCommands(): Promise<StreamWeaverCommand[]> {
  try {
    if (!fs.existsSync(COMMANDS_FILE)) {
      return [];
    }
    const data = fs.readFileSync(COMMANDS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading existing commands:', error);
    return [];
  }
}

/**
 * Save actions to file
 */
export async function saveActions(actions: StreamWeaverAction[]): Promise<void> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(ACTIONS_FILE, JSON.stringify(actions, null, 2), 'utf-8');
    console.log(`✅ Saved ${actions.length} actions to ${ACTIONS_FILE}`);
  } catch (error) {
    console.error('Error saving actions:', error);
    throw error;
  }
}

/**
 * Save commands to file
 */
export async function saveCommands(commands: StreamWeaverCommand[]): Promise<void> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(COMMANDS_FILE, JSON.stringify(commands, null, 2), 'utf-8');
    console.log(`✅ Saved ${commands.length} commands to ${COMMANDS_FILE}`);
  } catch (error) {
    console.error('Error saving commands:', error);
    throw error;
  }
}

/**
 * Import Streamer.bot actions from a file
 */
export async function importActionsFromFile(
  filePath: string,
  mergeWithExisting = true
): Promise<{
  imported: number;
  skipped: number;
  total: number;
}> {
  try {
    // Read the Streamer.bot actions file
    const fileData = fs.readFileSync(filePath, 'utf-8');
    const streamerbotData = JSON.parse(fileData);

    // Convert to StreamWeaver format
    const importedActions = importStreamerbotActions(streamerbotData);
    console.log(`📥 Converted ${importedActions.length} actions from Streamer.bot format`);

    // Load existing actions
    const existingActions = mergeWithExisting ? await loadExistingActions() : [];
    const existingCount = existingActions.length;

    // Merge with existing
    const mergedActions = mergeActions(existingActions, importedActions);
    const newCount = mergedActions.length - existingCount;

    // Save to file
    await saveActions(mergedActions);

    return {
      imported: newCount,
      skipped: importedActions.length - newCount,
      total: mergedActions.length,
    };
  } catch (error) {
    console.error('Error importing actions:', error);
    throw error;
  }
}

/**
 * Import Streamer.bot commands from a file
 */
export async function importCommandsFromFile(
  filePath: string,
  mergeWithExisting = true
): Promise<{
  imported: number;
  skipped: number;
  total: number;
}> {
  try {
    // Read the Streamer.bot commands file
    const fileData = fs.readFileSync(filePath, 'utf-8');
    const streamerbotData = JSON.parse(fileData);

    // Convert to StreamWeaver format
    const importedCommands = importStreamerbotCommands(streamerbotData);
    console.log(`📥 Converted ${importedCommands.length} commands from Streamer.bot format`);

    // Load existing commands
    const existingCommands = mergeWithExisting ? await loadExistingCommands() : [];
    const existingCount = existingCommands.length;

    // Merge with existing
    const mergedCommands = mergeCommands(existingCommands, importedCommands);
    const newCount = mergedCommands.length - existingCount;

    // Save to file
    await saveCommands(mergedCommands);

    return {
      imported: newCount,
      skipped: importedCommands.length - newCount,
      total: mergedCommands.length,
    };
  } catch (error) {
    console.error('Error importing commands:', error);
    throw error;
  }
}

/**
 * Import both actions and commands from Streamer.bot export files
 */
export async function importStreamerbotData(
  actionsFilePath?: string,
  commandsFilePath?: string
): Promise<{
  actions: { imported: number; skipped: number; total: number };
  commands: { imported: number; skipped: number; total: number };
}> {
  const results = {
    actions: { imported: 0, skipped: 0, total: 0 },
    commands: { imported: 0, skipped: 0, total: 0 },
  };

  if (actionsFilePath && fs.existsSync(actionsFilePath)) {
    results.actions = await importActionsFromFile(actionsFilePath);
  }

  if (commandsFilePath && fs.existsSync(commandsFilePath)) {
    results.commands = await importCommandsFromFile(commandsFilePath);
  }

  return results;
}

/**
 * CLI function to import from Desktop files
 */
export async function importFromDesktop(): Promise<void> {
  const desktopPath = 'C:\\Users\\mtman\\Desktop';
  const actionsPath = path.join(desktopPath, 'actions.json');
  const commandsPath = path.join(desktopPath, 'commands.json');

  console.log('\n🚀 Starting Streamer.bot import from Desktop...\n');

  try {
    const results = await importStreamerbotData(
      fs.existsSync(actionsPath) ? actionsPath : undefined,
      fs.existsSync(commandsPath) ? commandsPath : undefined
    );

    console.log('\n✅ Import completed successfully!\n');
    console.log('📊 Actions:');
    console.log(`   - Imported: ${results.actions.imported}`);
    console.log(`   - Skipped (duplicates): ${results.actions.skipped}`);
    console.log(`   - Total: ${results.actions.total}`);
    console.log('\n📊 Commands:');
    console.log(`   - Imported: ${results.commands.imported}`);
    console.log(`   - Skipped (duplicates): ${results.commands.skipped}`);
    console.log(`   - Total: ${results.commands.total}\n`);
  } catch (error) {
    console.error('\n❌ Import failed:', error);
    throw error;
  }
}
