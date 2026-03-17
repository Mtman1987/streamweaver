import type { Action as AutomationAction, SubAction, Trigger } from '@/services/automation/types';
import { SubActionType, TriggerType } from '@/services/automation/types';

// UI-facing DTOs for actions. Runtime source-of-truth is actions/ directory,
// normalized by src/lib/actions-store.ts.

export type ActionDTO = AutomationAction & {
  createdAt?: string;
  updatedAt?: string;
};

export type CreateActionDTO = {
  name: string;
  group?: string;
  enabled?: boolean;
};

export type UpdateActionDTO = Partial<ActionDTO>;

export type TriggerConfig = Trigger;
export type SubActionDefinition = SubAction;

export { TriggerType, SubActionType };