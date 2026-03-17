/**
 * SubAction Handlers - Implementation of all sub-action execution logic
 * Organized by category matching Streamer.bot structure
 */

import { SubAction } from '../types';
import { ExecutionContext } from '../SubActionExecutor';
import { applySavedSink } from '@/services/audio-sink';

export interface SubActionHandlerResult {
  success: boolean;
  breakExecution?: boolean;
  error?: string;
  variables?: Record<string, any>;
}

/**
 * Core Logic Handlers
 */
export class CoreLogicHandlers {
  static async handleDelay(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const minDelay = subAction.minValue || subAction.min || 1000;
    const maxDelay = subAction.maxValue || subAction.max || minDelay;
    
    const delay = minDelay === maxDelay 
      ? minDelay 
      : Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    return { success: true, variables: { delayUsed: delay } };
  }

  static async handleBreak(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    return { success: true, breakExecution: true };
  }

  static async handleComment(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    // Comments do nothing - just return success
    return { success: true };
  }

  static async handleIfElse(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const inputField = subAction.input || '';
    const compareValue = replaceVariables(subAction.value || '', context);
    const operation = subAction.operation || 0;
    
    // Get the actual value to check - could be from variables or args
    let input = replaceVariables(inputField, context);
    
    // If input field matches a variable name, use the variable value
    if (context.variables?.[inputField]) {
      input = String(context.variables[inputField]);
    } else if (context.args?.[inputField]) {
      input = String(context.args[inputField]);
    }
    
    let condition = false;
    
    switch (operation) {
      case 0: // Equals
        condition = input === compareValue;
        break;
      case 1: // Not Equals
        condition = input !== compareValue;
        break;
      case 2: // Contains
        condition = input.includes(compareValue);
        break;
      case 3: // Does Not Contain
        condition = !input.includes(compareValue);
        break;
      case 4: // Starts With
        condition = input.startsWith(compareValue);
        break;
      case 5: // Ends With
        condition = input.endsWith(compareValue);
        break;
      case 6: // Is Empty
        condition = !input || input.trim() === '' || input === inputField; // Also true if variable wasn't replaced
        break;
      case 7: // Is Not Empty
        condition = input.trim() !== '' && input !== inputField; // False if variable wasn't replaced
        break;
      case 8: // Greater Than
        condition = parseFloat(input) > parseFloat(compareValue);
        break;
      case 9: // Greater Than or Equal
        condition = parseFloat(input) >= parseFloat(compareValue);
        break;
      case 10: // Less Than
        condition = parseFloat(input) < parseFloat(compareValue);
        break;
      case 11: // Less Than or Equal
        condition = parseFloat(input) <= parseFloat(compareValue);
        break;
      case 12: // Regex Match
        try {
          const regex = new RegExp(compareValue);
          condition = regex.test(input);
        } catch (e) {
          return { success: false, error: `Invalid regex: ${compareValue}` };
        }
        break;
    }
    
    console.log(`[If/Else] Checking "${inputField}" (value: "${input}") operation ${operation} against "${compareValue}" = ${condition}`);
    
    return { 
      success: true, 
      variables: { 
        conditionResult: condition,
        _executeIfBlock: condition,
        _executeElseBlock: !condition
      } 
    };
  }

  static async handleRandomNumber(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const min = parseInt(replaceVariables(String(subAction.min || 1), context));
    const max = parseInt(replaceVariables(String(subAction.max || 100), context));
    
    const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;
    const variableName = subAction.variableName || 'randomNumber';
    
    return { 
      success: true, 
      variables: { [variableName]: randomNumber } 
    };
  }
}

/**
 * Variable Handlers
 */
export class VariableHandlers {
  private static globalVariables: Map<string, any> = new Map();
  private static userVariables: Map<string, Map<string, any>> = new Map();

  private static storeLoaded = false;

  private static async ensureStoreLoaded(): Promise<void> {
    if (this.storeLoaded) return;
    if (typeof window !== 'undefined') {
      // Browser/editor environment: keep variables in-memory only.
      this.storeLoaded = true;
      return;
    }
    try {
      const { listGlobalVariables, readAutomationVariables } = await import('@/lib/automation-variables-store');
      const data = await readAutomationVariables();
      this.globalVariables = new Map(Object.entries(await listGlobalVariables()));
      this.userVariables = new Map(
        Object.entries(data.users || {}).map(([user, vars]) => [user, new Map(Object.entries(vars || {}))])
      );
      this.storeLoaded = true;
    } catch (error) {
      console.warn('[VariableHandlers] Failed to load persisted variables:', error);
      this.storeLoaded = true;
    }
  }
  
  static async handleSetGlobalVariable(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    await this.ensureStoreLoaded();
    const variableName = subAction.variableName!;
    const value = replaceVariables(subAction.value || '', context);
    
    this.globalVariables.set(variableName, value);

    // Persist by default (local dev state). We can refine semantics later.
    if (typeof window === 'undefined') {
      const { setGlobalVariable } = await import('@/lib/automation-variables-store');
      await setGlobalVariable(variableName, value);
    }
    
    return { success: true };
  }

  static async handleGetGlobalVariable(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    await this.ensureStoreLoaded();
    const variableName = subAction.variableName!;
    const defaultValue = subAction.defaultValue;
    const destinationVariable = subAction.destinationVariable || variableName;
    
    const value = this.globalVariables.get(variableName) ?? defaultValue;
    
    return { 
      success: true, 
      variables: { [destinationVariable]: value } 
    };
  }

  static async handleSetArgument(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const variableName = subAction.variableName!;
    const value = replaceVariables(subAction.value || '', context);
    
    return { 
      success: true, 
      variables: { [variableName]: value } 
    };
  }

  static async handleSetUserVariable(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    await this.ensureStoreLoaded();
    const userName = replaceVariables(subAction.userName || context.userName || '', context);
    const variableName = subAction.variableName!;
    const value = replaceVariables(subAction.value || '', context);
    
    if (!this.userVariables.has(userName)) {
      this.userVariables.set(userName, new Map());
    }
    
    this.userVariables.get(userName)!.set(variableName, value);

    if (typeof window === 'undefined') {
      const { setUserVariable } = await import('@/lib/automation-variables-store');
      await setUserVariable(userName, variableName, value);
    }
    
    return { success: true };
  }

  static async handleGetUserVariable(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    await this.ensureStoreLoaded();
    const userName = replaceVariables(subAction.userName || context.userName || '', context);
    const variableName = subAction.variableName!;
    const defaultValue = subAction.defaultValue;
    const destinationVariable = subAction.destinationVariable || variableName;
    
    const userVars = this.userVariables.get(userName);
    const value = userVars?.get(variableName) ?? defaultValue;
    
    return { 
      success: true, 
      variables: { [destinationVariable]: value } 
    };
  }

  static async handleMathOperation(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const operand1 = parseFloat(replaceVariables(String(subAction.operand1 || 0), context));
    const operand2 = parseFloat(replaceVariables(String(subAction.operand2 || 0), context));
    const opRaw = (subAction as any).operation;
    const operation = typeof opRaw === 'number'
      ? ({
          0: 'add',
          1: 'subtract',
          2: 'multiply',
          3: 'divide',
          4: 'modulo',
          5: 'power',
        } as Record<number, string>)[opRaw] || String(opRaw)
      : String(opRaw || 'add');
    const variableName = subAction.variableName || 'mathResult';
    
    let result: number;
    
    switch (operation) {
      case 'add':
        result = operand1 + operand2;
        break;
      case 'subtract':
        result = operand1 - operand2;
        break;
      case 'multiply':
        result = operand1 * operand2;
        break;
      case 'divide':
        result = operand2 !== 0 ? operand1 / operand2 : 0;
        break;
      case 'modulo':
        result = operand1 % operand2;
        break;
      case 'power':
        result = Math.pow(operand1, operand2);
        break;
      default:
        return { success: false, error: `Unknown operation: ${operation}` };
    }
    
    return { 
      success: true, 
      variables: { [variableName]: result } 
    };
  }

  static async handleStringOperation(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const input = replaceVariables(subAction.input || '', context);
    const opRaw = (subAction as any).operation;
    const operation = typeof opRaw === 'number'
      ? ({
          0: 'uppercase',
          1: 'lowercase',
          2: 'trim',
          3: 'length',
          4: 'replace',
          5: 'substring',
          6: 'split',
        } as Record<number, string>)[opRaw] || String(opRaw)
      : String(opRaw || 'trim');
    const param1 = replaceVariables(subAction.param1 || '', context);
    const param2 = replaceVariables(subAction.param2 || '', context);
    const variableName = subAction.variableName || 'stringResult';
    
    let result: any;
    
    switch (operation) {
      case 'uppercase':
        result = input.toUpperCase();
        break;
      case 'lowercase':
        result = input.toLowerCase();
        break;
      case 'trim':
        result = input.trim();
        break;
      case 'length':
        result = input.length;
        break;
      case 'replace':
        result = input.replaceAll(param1, param2);
        break;
      case 'substring':
        const start = parseInt(param1);
        const end = param2 ? parseInt(param2) : undefined;
        result = input.substring(start, end);
        break;
      case 'split':
        result = input.split(param1);
        break;
      default:
        return { success: false, error: `Unknown operation: ${operation}` };
    }
    
    return { 
      success: true, 
      variables: { [variableName]: result } 
    };
  }

  static getGlobalVariables(): Map<string, any> {
    return this.globalVariables;
  }

  static getUserVariables(): Map<string, Map<string, any>> {
    return this.userVariables;
  }
}

/**
 * File Operation Handlers
 */
export class FileHandlers {
  static async handleWriteToFile(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const filePath = replaceVariables(subAction.file || '', context);
    const text = replaceVariables(subAction.text || '', context);
    const append = subAction.append || false;
    
    try {
      // In browser environment, we can't directly write to files
      // This would need to be sent to the backend
      console.log(`[File Write] ${filePath}: ${text} (append: ${append})`);
      
      // TODO: Send to backend via WebSocket
      // await sendToBackend('writeFile', { filePath, text, append });
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to write to file: ${error}` };
    }
  }

  static async handleReadFromFile(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const filePath = replaceVariables(subAction.file || '', context);
    const variableName = subAction.variableName || 'fileContent';
    
    try {
      // TODO: Request from backend via WebSocket
      // const content = await requestFromBackend('readFile', { filePath });
      const content = `[File content from ${filePath}]`;
      
      return { 
        success: true, 
        variables: { [variableName]: content } 
      };
    } catch (error) {
      return { success: false, error: `Failed to read from file: ${error}` };
    }
  }
}

/**
 * Media Handlers
 */
export class MediaHandlers {
  static async handlePlaySound(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const soundFile = replaceVariables(subAction.soundFile || '', context);
    const volume = (subAction.volume || 100) / 100;
    const finishBeforeContinuing = subAction.finishBeforeContinuing || false;
    
    try {
      // In browser, we can use the Audio API
      const audio = new Audio(soundFile);
      audio.volume = volume;

      try {
        await applySavedSink(audio);
      } catch (e) {
        console.warn('applySavedSink failed', e);
      }

      if (finishBeforeContinuing) {
        await new Promise((resolve, reject) => {
          audio.onended = resolve;
          audio.onerror = reject;
          audio.play();
        });
      } else {
        audio.play();
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to play sound: ${error}` };
    }
  }
}

/**
 * Network Handlers
 */
export class NetworkHandlers {
  static async handleHTTPRequest(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const url = replaceVariables(subAction.url || '', context);
    const method = (subAction.method || 'GET') as string;
    const body = replaceVariables(subAction.body || '', context);
    const parseAsJson = subAction.parseAsJson !== false;
    const variableName = subAction.variableName || 'httpResponse';
    
    try {
      const headers: Record<string, string> = {};
      
      if (subAction.headers) {
        for (const [key, value] of Object.entries(subAction.headers)) {
          headers[key] = replaceVariables(value, context);
        }
      }
      
      const options: RequestInit = {
        method,
        headers
      };
      
      if (body && method !== 'GET') {
        options.body = body;
      }
      
      const response = await fetch(url, options);
      const responseData = parseAsJson ? await response.json() : await response.text();
      
      return { 
        success: true, 
        variables: { 
          [variableName]: responseData,
          httpStatus: response.status,
          httpStatusText: response.statusText
        } 
      };
    } catch (error) {
      return { success: false, error: `HTTP request failed: ${error}` };
    }
  }
}

/**
 * DateTime Handlers
 */
export class DateTimeHandlers {
  static async handleGetDateTime(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const format = subAction.format || 'YYYY-MM-DD HH:mm:ss';
    const variableName = subAction.variableName || 'dateTime';
    
    const now = new Date();
    
    // Simple date formatting (in production, use a library like date-fns)
    let formatted = format
      .replace('YYYY', String(now.getFullYear()))
      .replace('MM', String(now.getMonth() + 1).padStart(2, '0'))
      .replace('DD', String(now.getDate()).padStart(2, '0'))
      .replace('HH', String(now.getHours()).padStart(2, '0'))
      .replace('mm', String(now.getMinutes()).padStart(2, '0'))
      .replace('ss', String(now.getSeconds()).padStart(2, '0'));
    
    return { 
      success: true, 
      variables: { 
        [variableName]: formatted,
        timestamp: now.getTime(),
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds()
      } 
    };
  }
}

/**
 * Action Control Handlers
 */
export class ActionControlHandlers {
  static async handleRunAction(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const actionId = subAction.actionId;
    const runImmediately = Boolean((subAction as any).runImmediately ?? (subAction as any).runImmedately ?? false);

    console.log(`[Run Action] Attempting to run action ID: ${actionId}, Immediate: ${runImmediately}`);

    if (!actionId) {
      console.log(`[Run Action] No action ID provided`);
      return { success: true };
    }

    if (!context.runActionById) {
      console.error(`[Run Action] RunAction not available in execution context`);
      return { success: false, error: 'RunAction not available in this execution context' };
    }

    const ok = await context.runActionById(actionId);
    console.log(`[Run Action] Result for ${actionId}: ${ok}`);
    return { success: ok };
  }

  static async handleSetActionState(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const actionId = subAction.actionId;
    const raw = (subAction as any).state;
    const state: 'enable' | 'disable' | 'toggle' =
      raw === 'enable' || raw === 'disable' || raw === 'toggle'
        ? raw
        : raw === 0
          ? 'disable'
          : raw === 1
            ? 'enable'
            : 'toggle';
    
    // TODO: Update action state via ActionManager
    console.log(`[Set Action State] Action ID: ${actionId}, State: ${state}`);
    
    return { success: true };
  }
}

/**
 * Utility Functions
 */
function replaceVariables(text: string, context: ExecutionContext): string {
  if (!text) return text;
  
  // Replace %variableName% with actual values from context
  let result = text.replace(/%(\w+)%/g, (match, varName) => {
    const value = context.variables?.[varName] ?? context.args?.[varName] ?? match;
    return String(value);
  });
  
  // Handle common user variables that might not be set
  if (result.includes('%targetUser%') && !context.variables?.targetUser && !context.args?.targetUser) {
    // Try to use targetUserDisplayName or targetUserName as fallback
    const fallback = context.variables?.targetUserDisplayName || context.variables?.targetUserName || context.args?.input0 || 'someone';
    result = result.replace(/%targetUser%/g, fallback);
  }
  
  return result;
}

/**
 * Export all handlers
 */
export const SubActionHandlers = {
  Core: CoreLogicHandlers,
  Variables: VariableHandlers,
  File: FileHandlers,
  Media: MediaHandlers,
  Network: NetworkHandlers,
  DateTime: DateTimeHandlers,
  Actions: ActionControlHandlers
};
