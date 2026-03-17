import { randomUUID } from 'crypto';
import { Action, Trigger, SubAction, TriggerType, SubActionType } from './types';

export class ActionManager {
  private actions: Map<string, Action> = new Map();
  private actionGroups: Set<string> = new Set();

  createAction(config: Partial<Action>): Action {
    const action: Action = {
      id: config.id || randomUUID(),
      name: config.name || 'New Action',
      enabled: config.enabled ?? true,
      group: config.group,
      alwaysRun: config.alwaysRun ?? false,
      randomAction: config.randomAction ?? false,
      concurrent: config.concurrent ?? false,
      excludeFromHistory: config.excludeFromHistory ?? false,
      excludeFromPending: config.excludeFromPending ?? false,
      queue: config.queue,
      triggers: config.triggers ?? [],
      subActions: config.subActions ?? []
    };

    this.actions.set(action.id, action);
    if (action.group) {
      this.actionGroups.add(action.group);
    }

    return action;
  }

  reset(): void {
    this.actions.clear();
    this.actionGroups.clear();
  }

  updateAction(id: string, updates: Partial<Action>): Action | null {
    const action = this.actions.get(id);
    if (!action) return null;

    const updated = { ...action, ...updates };
    this.actions.set(id, updated);
    
    if (updated.group) {
      this.actionGroups.add(updated.group);
    }

    return updated;
  }

  deleteAction(id: string): boolean {
    return this.actions.delete(id);
  }

  getAction(id: string): Action | null {
    return this.actions.get(id) || null;
  }

  getAllActions(): Action[] {
    return Array.from(this.actions.values());
  }

  getActionsByGroup(group: string): Action[] {
    return Array.from(this.actions.values()).filter(action => action.group === group);
  }

  getActionGroups(): string[] {
    return Array.from(this.actionGroups);
  }

  // Trigger management
  addTrigger(actionId: string, trigger: Partial<Trigger>): Trigger | null {
    const action = this.actions.get(actionId);
    if (!action) return null;

    const newTrigger: Trigger = {
      id: trigger.id || randomUUID(),
      type: trigger.type || TriggerType.COMMAND,
      enabled: trigger.enabled ?? true,
      exclusions: trigger.exclusions ?? [],
      ...trigger
    };

    action.triggers.push(newTrigger);
    return newTrigger;
  }

  updateTrigger(actionId: string, triggerId: string, updates: Partial<Trigger>): Trigger | null {
    const action = this.actions.get(actionId);
    if (!action) return null;

    const triggerIndex = action.triggers.findIndex(t => t.id === triggerId);
    if (triggerIndex === -1) return null;

    action.triggers[triggerIndex] = { ...action.triggers[triggerIndex], ...updates };
    return action.triggers[triggerIndex];
  }

  removeTrigger(actionId: string, triggerId: string): boolean {
    const action = this.actions.get(actionId);
    if (!action) return false;

    const triggerIndex = action.triggers.findIndex(t => t.id === triggerId);
    if (triggerIndex === -1) return false;

    action.triggers.splice(triggerIndex, 1);
    return true;
  }

  // SubAction management
  addSubAction(actionId: string, subAction: Partial<SubAction>): SubAction | null {
    const action = this.actions.get(actionId);
    if (!action) return null;

    const newSubAction: SubAction = {
      id: subAction.id || randomUUID(),
      type: subAction.type || SubActionType.SEND_MESSAGE,
      enabled: subAction.enabled ?? true,
      weight: subAction.weight ?? 0,
      parentId: subAction.parentId,
      index: subAction.index ?? action.subActions.length,
      ...subAction
    };

    action.subActions.push(newSubAction);
    this.reorderSubActions(actionId);
    return newSubAction;
  }

  updateSubAction(actionId: string, subActionId: string, updates: Partial<SubAction>): SubAction | null {
    const action = this.actions.get(actionId);
    if (!action) return null;

    const subActionIndex = action.subActions.findIndex(sa => sa.id === subActionId);
    if (subActionIndex === -1) return null;

    action.subActions[subActionIndex] = { ...action.subActions[subActionIndex], ...updates };
    return action.subActions[subActionIndex];
  }

  removeSubAction(actionId: string, subActionId: string): boolean {
    const action = this.actions.get(actionId);
    if (!action) return false;

    const subActionIndex = action.subActions.findIndex(sa => sa.id === subActionId);
    if (subActionIndex === -1) return false;

    action.subActions.splice(subActionIndex, 1);
    this.reorderSubActions(actionId);
    return true;
  }

  private reorderSubActions(actionId: string): void {
    const action = this.actions.get(actionId);
    if (!action) return;

    action.subActions.sort((a, b) => a.index - b.index);
  }

  moveSubAction(actionId: string, subActionId: string, newIndex: number): boolean {
    const action = this.actions.get(actionId);
    if (!action) return false;

    const subAction = action.subActions.find(sa => sa.id === subActionId);
    if (!subAction) return false;

    subAction.index = newIndex;
    this.reorderSubActions(actionId);
    return true;
  }

  findActionsByTrigger(triggerType: TriggerType, triggerData: any): Action[] {
    return Array.from(this.actions.values()).filter(action => {
      if (!action.enabled) return false;
      
      return action.triggers.some(trigger => {
        if (!trigger.enabled || trigger.type !== triggerType) return false;
        
        // Additional matching logic based on trigger type
        switch (triggerType) {
          case TriggerType.COMMAND:
            return trigger.commandId === triggerData.commandId;
          case TriggerType.CHANNEL_POINT_REWARD:
            return trigger.rewardId === triggerData.rewardId;
          default:
            return true;
        }
      });
    });
  }

  exportActions(): string {
    const exportData = {
      actions: Array.from(this.actions.values()),
      version: 1,
      timestamp: new Date().toISOString()
    };
    return JSON.stringify(exportData, null, 2);
  }

  importActions(jsonData: string): boolean {
    try {
      const data = JSON.parse(jsonData);
      if (!data.actions || !Array.isArray(data.actions)) return false;

      for (const actionData of data.actions) {
        this.createAction(actionData);
      }
      return true;
    } catch {
      return false;
    }
  }
}