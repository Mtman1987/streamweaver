import { promises as fsp } from 'fs';
import * as path from 'path';

export const ACTIONS_DIR_PATH = path.resolve(process.cwd(), 'actions');
export const COMMANDS_DIR_PATH = path.resolve(process.cwd(), 'commands');

export type StreamWeaverCommandsFile = Record<string, any> & { commands?: any[] };
export type StreamWeaverActionsFile = Record<string, any> & { actions?: any[] };

export async function readStreamWeaverCommands(): Promise<StreamWeaverCommandsFile> {
  const commands: any[] = [];
  
  try {
    const files = await fsp.readdir(COMMANDS_DIR_PATH);
    const jsonFiles = files.filter(f => f.endsWith('.json') && f !== '_metadata.json');
    
    for (const file of jsonFiles) {
      const filePath = path.join(COMMANDS_DIR_PATH, file);
      const content = await fsp.readFile(filePath, 'utf-8');
      const command = JSON.parse(content);
      commands.push(command);
    }
  } catch (error) {
    console.warn('Failed to read commands directory:', error);
  }
  
  return { version: 1, commands };
}

export async function readStreamWeaverActions(): Promise<StreamWeaverActionsFile> {
  const actions: any[] = [];
  
  try {
    const files = await fsp.readdir(ACTIONS_DIR_PATH);
    const jsonFiles = files.filter(f => f.endsWith('.json') && f !== '_metadata.json');
    
    for (const file of jsonFiles) {
      const filePath = path.join(ACTIONS_DIR_PATH, file);
      const content = await fsp.readFile(filePath, 'utf-8');
      const action = JSON.parse(content);
      actions.push(action);
    }
  } catch (error) {
    console.warn('Failed to read actions directory:', error);
  }
  
  return { version: 1, actions, queues: [] };
}