import { CommandManager } from './CommandManager';
import { ActionManager } from './ActionManager';
import { SubActionExecutor, ExecutionContext } from './SubActionExecutor';
import { Action, Command, TriggerType, SubActionType } from './types';

export interface AutomationEvent {
  type: 'command' | 'follow' | 'cheer' | 'subscribe' | 'raid' | 'channelPointReward';
  platform: string;
  user?: string;
  message?: string;
  data?: any;
}

export class AutomationEngine {
  private commandManager = new CommandManager();
  private actionManager = new ActionManager();
  private subActionExecutor = new SubActionExecutor();
  private cooldowns = new Map<string, number>();
  private userCooldowns = new Map<string, Map<string, number>>();

  async processEvent(event: AutomationEvent): Promise<void> {
    try {
      if (event.type === 'command') {
        await this.processCommand(event);
      } else {
        await this.processStreamEvent(event);
      }
    } catch (error) {
      console.error('Error processing automation event:', error);
    }
  }

  private async processCommand(event: AutomationEvent): Promise<void> {
    if (!event.message) return;

    const platformBit = this.getPlatformBit(event.platform);
    console.log(`[AutomationEngine] Looking for command: "${event.message}" on platform bit: ${platformBit}`);
    
    const command = this.commandManager.findCommandByTrigger(event.message, platformBit);
    
    if (!command) {
      console.log(`[AutomationEngine] No command found for: "${event.message}"`);
      return;
    }

    console.log(`[AutomationEngine] Found command: ${command.name} (ID: ${command.id})`);

    // Check cooldowns
    if (!this.checkCooldowns(command, event.user || '')) {
      console.log(`[AutomationEngine] Command ${command.name} is on cooldown`);
      return;
    }

    // Find actions triggered by this command
    const actions = this.actionManager.findActionsByTrigger(TriggerType.COMMAND, {
      commandId: command.id
    });

    console.log(`[AutomationEngine] Found ${actions.length} actions for command ${command.name}`);

    // Execute all matching actions
    for (const action of actions) {
      await this.executeAction(action, event, command);
    }

    // Set cooldowns
    this.setCooldowns(command, event.user || '');
  }

  private async processStreamEvent(event: AutomationEvent): Promise<void> {
    const triggerType = this.getTriggerTypeFromEvent(event.type);
    if (!triggerType) return;

    const actions = this.actionManager.findActionsByTrigger(triggerType, event.data);

    for (const action of actions) {
      await this.executeAction(action, event);
    }
  }

  private async executeAction(action: Action, event: AutomationEvent, command?: Command): Promise<void> {
    if (!action.enabled) return;

    console.log(`Executing action: ${action.name}`);

    const rawInput = this.extractRawInput(event.message || '', command?.command || '');
    const context: ExecutionContext = {
      user: event.user,
      userName: event.user,
      message: event.message,
      rawInput,
      platform: event.platform,
      args: { ...event.data },
      variables: {
        user: event.user,
        userName: event.user,
        platform: event.platform,
        message: event.message,
        rawInput,
      },
      breakRequested: false,
      actionStack: [],
    };

    context.runActionById = async (actionId: string): Promise<boolean> => {
      const stack = context.actionStack || [];
      if (stack.includes(actionId)) {
        console.warn(`[Automation] Prevented recursive Run Action loop: ${actionId}`);
        return false;
      }
      const next = this.actionManager.getAction(actionId);
      if (!next) {
        console.warn(`[Automation] Run Action target not found: ${actionId}`);
        return false;
      }
      context.actionStack = [...stack, actionId];
      await this.executeActionWithContext(next, context);
      context.actionStack = stack;
      return true;
    };

    // Parse input arguments if it's a command
    if (command && event.message) {
      this.parseCommandArguments(context, event.message, command.command);
    }

    // Streamer.bot-style convenience vars
    const input0 = context.args?.input0;
    if (typeof input0 === 'string' && input0.trim()) {
      const normalized = input0.trim().replace(/^@/, '');
      context.variables = {
        ...context.variables,
        targetUser: normalized,
        targetUserName: normalized,
      };
    }

    await this.executeActionWithContext(action, context);
  }

  private async executeActionWithContext(action: Action, context: ExecutionContext): Promise<void> {
    // Execute sub-actions in order
    for (const subAction of action.subActions.sort((a, b) => a.index - b.index)) {
      if (!subAction.enabled) continue;

      const success = await this.subActionExecutor.executeSubAction(subAction, context);

      if (context.breakRequested) {
        break;
      }

      if (!success && !action.alwaysRun) {
        console.warn(`Sub-action failed, stopping execution of action: ${action.name}`);
        break;
      }
    }
  }

  private checkCooldowns(command: Command, user: string): boolean {
    const now = Date.now();

    // Check global cooldown
    if (command.globalCooldown > 0) {
      const lastUsed = this.cooldowns.get(command.id) || 0;
      if (now - lastUsed < command.globalCooldown * 1000) {
        return false;
      }
    }

    // Check user cooldown
    if (command.userCooldown > 0 && user) {
      const userCooldownMap = this.userCooldowns.get(command.id) || new Map();
      const lastUsed = userCooldownMap.get(user) || 0;
      if (now - lastUsed < command.userCooldown * 1000) {
        return false;
      }
    }

    return true;
  }

  private setCooldowns(command: Command, user: string): void {
    const now = Date.now();

    // Set global cooldown
    if (command.globalCooldown > 0) {
      this.cooldowns.set(command.id, now);
    }

    // Set user cooldown
    if (command.userCooldown > 0 && user) {
      let userCooldownMap = this.userCooldowns.get(command.id);
      if (!userCooldownMap) {
        userCooldownMap = new Map();
        this.userCooldowns.set(command.id, userCooldownMap);
      }
      userCooldownMap.set(user, now);
    }
  }

  private parseCommandArguments(context: ExecutionContext, message: string, commandTrigger: string): void {
    const args = message.slice(commandTrigger.length).trim().split(/\s+/);
    
    args.forEach((arg, index) => {
      if (context.args) {
        context.args[`input${index}`] = arg;
      }
    });

    if (context.args) {
      context.args.rawInput = args.join(' ');
    }
    context.rawInput = args.join(' ');
  }

  private extractRawInput(message: string, commandTrigger: string): string {
    return message.slice(commandTrigger.length).trim();
  }

  private getPlatformBit(platform: string): number {
    switch (platform.toLowerCase()) {
      case 'twitch': return 1;
      case 'discord': return 2;
      case 'youtube': return 4;
      case 'kick': return 8;
      default: return 1;
    }
  }

  private getTriggerTypeFromEvent(eventType: string): TriggerType | null {
    switch (eventType) {
      case 'follow': return TriggerType.FOLLOW;
      case 'cheer': return TriggerType.CHEER;
      case 'subscribe': return TriggerType.SUBSCRIBE;
      case 'raid': return TriggerType.RAID;
      case 'channelPointReward': return TriggerType.CHANNEL_POINT_REWARD;
      default: return null;
    }
  }

  // Public API methods
  getCommandManager(): CommandManager {
    return this.commandManager;
  }

  getActionManager(): ActionManager {
    return this.actionManager;
  }

  getSubActionExecutor(): SubActionExecutor {
    return this.subActionExecutor;
  }

  // Import/Export functionality
  exportConfiguration(): string {
    const config = {
      commands: this.commandManager.exportCommands(),
      actions: this.actionManager.exportActions(),
      version: 1,
      timestamp: new Date().toISOString()
    };
    return JSON.stringify(config, null, 2);
  }

  importConfiguration(jsonData: string): boolean {
    try {
      const config = JSON.parse(jsonData);
      
      if (config.commands) {
        this.commandManager.importCommands(config.commands);
      }
      
      if (config.actions) {
        this.actionManager.importActions(config.actions);
      }
      
      return true;
    } catch (error) {
      console.error('Failed to import configuration:', error);
      return false;
    }
  }
}