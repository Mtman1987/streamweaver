import { randomUUID } from 'crypto';
import { Command, CommandMode, CommandLocation, GrantType } from './types';
import { getAIConfig } from '@/services/ai-provider';

export class CommandManager {
  private commands: Map<string, Command> = new Map();
  private commandGroups: Set<string> = new Set();

  createCommand(config: Partial<Command>): Command {
    const command: Command = {
      id: config.id || randomUUID(),
      name: config.name || 'New Command',
      enabled: config.enabled ?? true,
      command: config.command || '!newcommand',
      mode: config.mode ?? CommandMode.EXACT,
      regexExplicitCapture: config.regexExplicitCapture ?? false,
      location: config.location ?? CommandLocation.START,
      ignoreBotAccount: config.ignoreBotAccount ?? true,
      ignoreInternal: config.ignoreInternal ?? true,
      sources: config.sources ?? 1, // Default to Twitch
      persistCounter: config.persistCounter ?? false,
      persistUserCounter: config.persistUserCounter ?? false,
      caseSensitive: config.caseSensitive ?? false,
      globalCooldown: config.globalCooldown ?? 0,
      userCooldown: config.userCooldown ?? 0,
      group: config.group,
      grantType: config.grantType ?? GrantType.EVERYONE,
      permittedUsers: config.permittedUsers ?? [],
      permittedGroups: config.permittedGroups ?? []
    };

    this.commands.set(command.id, command);
    if (command.group) {
      this.commandGroups.add(command.group);
    }

    return command;
  }

  reset(): void {
    this.commands.clear();
    this.commandGroups.clear();
  }

  updateCommand(id: string, updates: Partial<Command>): Command | null {
    const command = this.commands.get(id);
    if (!command) return null;

    const updated = { ...command, ...updates };
    this.commands.set(id, updated);
    
    if (updated.group) {
      this.commandGroups.add(updated.group);
    }

    return updated;
  }

  deleteCommand(id: string): boolean {
    return this.commands.delete(id);
  }

  getCommand(id: string): Command | null {
    return this.commands.get(id) || null;
  }

  getAllCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  getCommandsByGroup(group: string): Command[] {
    return Array.from(this.commands.values()).filter(cmd => cmd.group === group);
  }

  getCommandGroups(): string[] {
    return Array.from(this.commandGroups);
  }

  findCommandByTrigger(message: string, platform: number): Command | null {
    console.log(`[CommandManager] Searching for command in message: "${message}" on platform: ${platform}`);
    console.log(`[CommandManager] Total commands loaded: ${this.commands.size}`);
    
    for (const command of this.commands.values()) {
      console.log(`[CommandManager] Checking command: ${command.command} (enabled: ${command.enabled}, sources: ${command.sources})`);
      
      if (!command.enabled) {
        console.log(`[CommandManager] Skipping disabled command: ${command.command}`);
        continue;
      }
      if (!(command.sources & platform)) {
        console.log(`[CommandManager] Skipping command ${command.command} - platform mismatch (${command.sources} & ${platform})`);
        continue;
      }

      const matches = this.matchesCommand(command, message);
      console.log(`[CommandManager] Command ${command.command} matches: ${matches}`);
      if (matches) {
        console.log(`[CommandManager] Found matching command: ${command.command}`);
        return command;
      }
    }
    console.log(`[CommandManager] No matching command found for: "${message}"`);
    return null;
  }

  private matchesCommand(command: Command, message: string): boolean {
    const text = command.caseSensitive ? message : message.toLowerCase();
    let trigger = command.caseSensitive ? command.command : command.command.toLowerCase();

    // Replace {{BOT_NAME}} placeholder with actual bot name from config
    if (trigger.includes('{{bot_name}}')) {
      const aiConfig = getAIConfig();
      const botName = aiConfig.botName || 'AI Bot';
      trigger = trigger.replace(/\{\{bot_name\}\}/gi, botName);
    }

    if (command.mode === CommandMode.REGEX) {
      try {
        const regex = new RegExp(trigger, command.regexExplicitCapture ? 'g' : 'gi');
        return regex.test(text);
      } catch {
        return false;
      }
    }

    if (command.location === CommandLocation.START) {
      return text.startsWith(trigger);
    } else {
      return text.includes(trigger);
    }
  }

  exportCommands(): string {
    const exportData = {
      commands: Array.from(this.commands.values()),
      version: 1,
      timestamp: new Date().toISOString()
    };
    return JSON.stringify(exportData, null, 2);
  }

  importCommands(jsonData: string): boolean {
    try {
      const data = JSON.parse(jsonData);
      if (!data.commands || !Array.isArray(data.commands)) return false;

      for (const cmdData of data.commands) {
        this.createCommand(cmdData);
      }
      return true;
    } catch {
      return false;
    }
  }
}