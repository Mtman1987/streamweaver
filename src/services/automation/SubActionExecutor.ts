import { SubAction, SubActionType } from './types';
import { SubActionHandlers } from './subactions/SubActionHandlers';
import { TwitchHandlers } from './subactions/TwitchHandlers';
import { OBSHandlers } from './subactions/OBSHandlers';
import { DiscordHandlers, YouTubeHandlers, KickHandlers } from './subactions/PlatformHandlers';
import { getInternalAppUrl } from '@/lib/runtime-origin';
import { getActionById } from '@/lib/actions-store';
import { generateTTS } from '@/services/tts-provider';
import { sendChatMessage } from '@/services/twitch';
import { addPoints, getPoints, setPoints } from '@/services/points';
import {
  listGlobalVariables,
  listUserVariables,
  setGlobalVariable,
  setUserVariable,
} from '@/lib/automation-variables-store';

export interface ExecutionContext {
  user?: string;
  userName?: string;
  message?: string;
  rawInput?: string;
  platform?: string;
  tenantId?: string;
  args?: Record<string, any>;
  variables?: Record<string, any>;
  breakRequested?: boolean;
  runActionById?: (actionId: string) => Promise<boolean>;
  actionStack?: string[];
}

export class SubActionExecutor {
  private globalVariables: Map<string, any> = new Map();
  private executionArgs: Map<string, any> = new Map();

  async executeAction(action: { subActions?: SubAction[] }, context: ExecutionContext): Promise<boolean> {
    const subActions = Array.isArray(action.subActions) ? action.subActions : [];
    const ordered = [...subActions].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const hadRunActionById = typeof context.runActionById === 'function';
    const previousRunActionById = context.runActionById;
    const previousActionStack = context.actionStack;

    if (!hadRunActionById) {
      context.runActionById = async (actionId: string): Promise<boolean> => {
        const currentStack = Array.isArray(context.actionStack) ? context.actionStack : [];
        if (currentStack.includes(actionId)) {
          console.warn(`[Automation] Prevented recursive Run Action loop: ${actionId}`);
          return false;
        }

        const next = await getActionById(actionId, context.tenantId);
        if (!next) {
          console.warn(`[Automation] Run Action target not found: ${actionId}`);
          return false;
        }

        context.actionStack = [...currentStack, actionId];
        try {
          return await this.executeAction(next, context);
        } finally {
          context.actionStack = currentStack;
        }
      };
    }

    try {
      for (const subAction of ordered) {
        const ok = await this.executeSubAction(subAction, context);
        if (!ok || context.breakRequested) {
          return ok;
        }
      }

      return true;
    } finally {
      if (!hadRunActionById) {
        context.runActionById = previousRunActionById;
        context.actionStack = previousActionStack;
      }
    }
  }

  /**
   * Enhanced sub-action execution using the new handler system
   */
  async executeSubAction(subAction: SubAction, context: ExecutionContext): Promise<boolean> {
    if (!subAction.enabled) return true;

    try {
      // Route to appropriate handler based on sub-action type
      let result;

      // Core Logic Handlers
      if (subAction.type === SubActionType.WAIT) {
        result = await SubActionHandlers.Core.handleDelay(subAction, context);
      } else if (subAction.type === SubActionType.BREAK) {
        result = await SubActionHandlers.Core.handleBreak(subAction, context);
        if (result.breakExecution) {
          context.breakRequested = true;
        }
      } else if (subAction.type === SubActionType.COMMENT) {
        result = await SubActionHandlers.Core.handleComment(subAction, context);
      } else if (subAction.type === SubActionType.IF_ELSE) {
        result = await SubActionHandlers.Core.handleIfElse(subAction, context);

        const condition = Boolean(result?.variables?.conditionResult);
        const blocks = Array.isArray(subAction.subActions) ? subAction.subActions : [];
        const ifBlock = blocks.find(b => b.type === SubActionType.IF_BLOCK);
        const elseBlock = blocks.find(b => b.type === SubActionType.ELSE_BLOCK);
        const selected = condition ? ifBlock?.subActions : elseBlock?.subActions;

        if (Array.isArray(selected) && selected.length > 0) {
          const ordered = [...selected].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
          for (const child of ordered) {
            if (context.breakRequested) break;
            const ok = await this.executeSubAction(child, context);
            if (!ok) {
              // Treat nested failures as failures, but break is handled via context.breakRequested.
              return false;
            }
          }
        }
      } else if (subAction.type === SubActionType.RANDOM_NUMBER) {
        result = await SubActionHandlers.Core.handleRandomNumber(subAction, context);
      }
      
      // Variable Handlers
      else if (subAction.type === SubActionType.SET_GLOBAL_VAR) {
        result = await SubActionHandlers.Variables.handleSetGlobalVariable(subAction, context);
      } else if (subAction.type === SubActionType.GET_GLOBAL_VAR) {
        result = await SubActionHandlers.Variables.handleGetGlobalVariable(subAction, context);
      } else if (subAction.type === SubActionType.SET_ARGUMENT) {
        result = await SubActionHandlers.Variables.handleSetArgument(subAction, context);
      } else if (subAction.type === SubActionType.SET_USER_VAR) {
        result = await SubActionHandlers.Variables.handleSetUserVariable(subAction, context);
      } else if (subAction.type === SubActionType.GET_USER_VAR) {
        result = await SubActionHandlers.Variables.handleGetUserVariable(subAction, context);
      } else if (subAction.type === SubActionType.MATH_OPERATION) {
        result = await SubActionHandlers.Variables.handleMathOperation(subAction, context);
      } else if (subAction.type === SubActionType.STRING_OPERATION) {
        result = await SubActionHandlers.Variables.handleStringOperation(subAction, context);
      }
      
      // File Handlers
      else if (subAction.type === SubActionType.WRITE_TO_FILE) {
        result = await SubActionHandlers.File.handleWriteToFile(subAction, context);
      } else if (subAction.type === SubActionType.READ_FROM_FILE) {
        result = await SubActionHandlers.File.handleReadFromFile(subAction, context);
      }
      
      // Media Handlers
      else if (subAction.type === SubActionType.PLAY_SOUND) {
        result = await SubActionHandlers.Media.handlePlaySound(subAction, context);
      } else if (subAction.type === SubActionType.VOICE_REPLY_PROMPT) {
        result = await this.handleVoiceReplyPrompt(subAction, context);
      }
      
      // Network Handlers
      else if (subAction.type === SubActionType.HTTP_REQUEST) {
        result = await SubActionHandlers.Network.handleHTTPRequest(subAction, context);
      }
      else if (subAction.type === SubActionType.EXECUTE_CODE) {
        result = await this.handleExecuteCode(subAction, context);
      }
      
      // DateTime Handlers
      else if (subAction.type === SubActionType.GET_DATE_TIME) {
        result = await SubActionHandlers.DateTime.handleGetDateTime(subAction, context);
      }
      
      // Action Control Handlers
      else if (subAction.type === SubActionType.RUN_ACTION) {
        result = await SubActionHandlers.Actions.handleRunAction(subAction, context);
      } else if (subAction.type === SubActionType.ACTION_STATE) {
        result = await SubActionHandlers.Actions.handleSetActionState(subAction, context);
      }
      
      // Twitch Handlers
      else if (subAction.type === SubActionType.SEND_MESSAGE) {
        result = await TwitchHandlers.handleTwitchSendMessage(subAction, context);
      } else if (subAction.type === SubActionType.TWITCH_DELETE_MESSAGE) {
        result = await TwitchHandlers.handleTwitchDeleteMessage(subAction, context);
      } else if (subAction.type === SubActionType.TWITCH_CLEAR_CHAT) {
        result = await TwitchHandlers.handleTwitchClearChat(subAction, context);
      } else if (subAction.type === SubActionType.TWITCH_TIMEOUT_USER) {
        result = await TwitchHandlers.handleTwitchTimeoutUser(subAction, context);
      } else if (subAction.type === SubActionType.TWITCH_BAN_USER) {
        result = await TwitchHandlers.handleTwitchBanUser(subAction, context);
      } else if (subAction.type === SubActionType.TWITCH_UNBAN_USER) {
        result = await TwitchHandlers.handleTwitchUnbanUser(subAction, context);
      } else if (subAction.type === SubActionType.TWITCH_SLOW_MODE) {
        result = await TwitchHandlers.handleTwitchSlowMode(subAction, context);
      } else if (subAction.type === SubActionType.TWITCH_SET_TITLE) {
        result = await TwitchHandlers.handleTwitchSetTitle(subAction, context);
      } else if (subAction.type === SubActionType.TWITCH_SET_GAME) {
        result = await TwitchHandlers.handleTwitchSetGame(subAction, context);
      } else if (subAction.type === SubActionType.TWITCH_CREATE_MARKER) {
        result = await TwitchHandlers.handleTwitchCreateMarker(subAction, context);
      } else if (subAction.type === SubActionType.TWITCH_RUN_COMMERCIAL) {
        result = await TwitchHandlers.handleTwitchRunCommercial(subAction, context);
      } else if (subAction.type === SubActionType.GET_USER_INFO || subAction.type === SubActionType.GET_USER_INFO_BY_LOGIN) {
        result = await TwitchHandlers.handleTwitchGetUserInfo(subAction, context);
      }
      
      // OBS Handlers
      else if (subAction.type === SubActionType.OBS_SET_SCENE) {
        result = await OBSHandlers.handleOBSSetScene(subAction, context);
      } else if (subAction.type === SubActionType.OBS_GET_CURRENT_SCENE) {
        result = await OBSHandlers.handleOBSGetCurrentScene(subAction, context);
      } else if (subAction.type === SubActionType.OBS_TOGGLE_SOURCE) {
        result = await OBSHandlers.handleOBSSetSourceVisibility(subAction, context);
      } else if (subAction.type === SubActionType.OBS_SET_TEXT) {
        result = await OBSHandlers.handleOBSSetGDIText(subAction, context);
      } else if (subAction.type === SubActionType.OBS_SET_BROWSER_SOURCE) {
        result = await OBSHandlers.handleOBSSetBrowserSource(subAction, context);
      } else if (subAction.type === SubActionType.OBS_SET_MEDIA_SOURCE) {
        result = await OBSHandlers.handleOBSSetMediaSource(subAction, context);
      } else if (subAction.type === SubActionType.OBS_START_RECORDING) {
        result = await OBSHandlers.handleOBSStartRecording(subAction, context);
      } else if (subAction.type === SubActionType.OBS_STOP_RECORDING) {
        result = await OBSHandlers.handleOBSStopRecording(subAction, context);
      } else if (subAction.type === SubActionType.OBS_START_STREAMING) {
        result = await OBSHandlers.handleOBSStartStreaming(subAction, context);
      } else if (subAction.type === SubActionType.OBS_STOP_STREAMING) {
        result = await OBSHandlers.handleOBSStopStreaming(subAction, context);
      }
      
      // Discord Handlers
      else if (subAction.type === SubActionType.DISCORD_SEND_MESSAGE) {
        result = await DiscordHandlers.handleDiscordSendMessage(subAction, context);
      }
      
      // YouTube Handlers
      else if (subAction.type === SubActionType.YOUTUBE_SEND_MESSAGE) {
        result = await YouTubeHandlers.handleYouTubeSendMessage(subAction, context);
      }

      // Legacy handlers for backward compatibility
      else {
        const legacyType = subAction.type as unknown as string;
        if (legacyType === 'pokemon-pack-open') {
        result = await this.handlePokemonPackOpen(subAction, context);
        } else if (legacyType === 'pokemon-collection-view') {
        result = await this.handlePokemonCollectionView(subAction, context);
        } else {
        return await this.executeLegacySubAction(subAction, context);
        }
      }

      // Merge returned variables into context
      if (result && result.variables) {
        context.variables = { ...context.variables, ...result.variables };
      }

      return result ? result.success : false;

    } catch (error) {
      console.error(`Error executing sub-action ${subAction.id}:`, error);
      return false;
    }
  }

  /**
   * Legacy sub-action execution for backward compatibility
   */
  private async executeLegacySubAction(subAction: SubAction, context: ExecutionContext): Promise<boolean> {
    switch (subAction.type) {
      case SubActionType.SEND_MESSAGE:
        return await this.executeSendMessage(subAction, context);
      
      case SubActionType.PLAY_SOUND:
        return await this.executePlaySound(subAction, context);
      
      case SubActionType.WAIT:
        return await this.executeWait(subAction, context);
      
      case SubActionType.SET_ARGUMENT:
        return this.executeSetArgument(subAction, context);
      
      case SubActionType.SET_GLOBAL_VAR:
        return await this.executeSetGlobalVar(subAction, context);
      
      case SubActionType.GET_GLOBAL_VAR:
        return await this.executeGetGlobalVar(subAction, context);
      
      case SubActionType.HTTP_REQUEST:
        return await this.executeHttpRequest(subAction, context);
      
      case SubActionType.WRITE_TO_FILE:
        return await this.executeWriteToFile(subAction, context);
      
      case SubActionType.GET_USER_INFO:
        return await this.executeGetUserInfo(subAction, context);
      
      default:
        console.warn(`Unknown sub-action type: ${subAction.type}`);
        return true;
    }
  }

  private async executeSendMessage(subAction: SubAction, context: ExecutionContext): Promise<boolean> {
    const text = this.replaceVariables(subAction.text || '', context);
    const useBot = subAction.useBot ?? false;
    
    // Send message to appropriate platform
    if (context.platform === 'twitch') {
      // Send to Twitch chat
      console.log(`[Twitch${useBot ? ' Bot' : ''}] ${text}`);
    } else if (context.platform === 'discord') {
      // Send to Discord
      console.log(`[Discord${useBot ? ' Bot' : ''}] ${text}`);
    }
    
    return true;
  }

  private async executePlaySound(subAction: SubAction, context: ExecutionContext): Promise<boolean> {
    const soundFile = this.replaceVariables(subAction.soundFile || '', context);
    const volume = subAction.volume ?? 1.0;
    const finishBeforeContinuing = subAction.finishBeforeContinuing ?? false;
    
    // Play sound file
    console.log(`Playing sound: ${soundFile} at volume ${volume}`);
    
    if (finishBeforeContinuing) {
      // Wait for sound to finish
      await new Promise(resolve => setTimeout(resolve, 1000)); // Placeholder
    }
    
    return true;
  }

  private async executeWait(subAction: SubAction, context: ExecutionContext): Promise<boolean> {
    const value = parseInt(this.replaceVariables(subAction.value?.toString() || '1000', context));
    const maxValue = parseInt(this.replaceVariables(subAction.maxValue?.toString() || '0', context));
    const random = subAction.random ?? false;
    
    let waitTime = value;
    if (random && maxValue > value) {
      waitTime = Math.floor(Math.random() * (maxValue - value + 1)) + value;
    }
    
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return true;
  }

  private executeSetArgument(subAction: SubAction, context: ExecutionContext): boolean {
    const variableName = subAction.variableName || '';
    const value = this.replaceVariables(subAction.value?.toString() || '', context);
    
    this.executionArgs.set(variableName, value);
    if (context.args) {
      context.args[variableName] = value;
    }
    
    return true;
  }

  private async executeSetGlobalVar(subAction: SubAction, context: ExecutionContext): Promise<boolean> {
    const variableName = subAction.variableName || '';
    const value = this.replaceVariables(subAction.value?.toString() || '', context);
    const persisted = subAction.persisted ?? false;
    
    this.globalVariables.set(variableName, value);
    
    if (persisted) {
      await setGlobalVariable(variableName, value, context.tenantId);
    }
    
    return true;
  }

  private async executeGetGlobalVar(subAction: SubAction, context: ExecutionContext): Promise<boolean> {
    const variableName = subAction.variableName || '';
    const destinationVariable = subAction.destinationVariable || variableName;
    const defaultValue = subAction.defaultValue;
    
    let value = this.globalVariables.get(variableName);
    
    if (value === undefined && subAction.persisted) {
      const stored = await listGlobalVariables(context.tenantId);
      value = stored[variableName] ?? defaultValue;
      this.globalVariables.set(variableName, value);
    }
    
    if (value === undefined) {
      value = defaultValue;
    }
    
    this.executionArgs.set(destinationVariable, value);
    if (context.args) {
      context.args[destinationVariable] = value;
    }
    
    return true;
  }

  private async executeHttpRequest(subAction: SubAction, context: ExecutionContext): Promise<boolean> {
    const url = this.replaceVariables(subAction.url || '', context);
    const variableName = subAction.variableName || 'httpResponse';
    const headers = subAction.headers || {};
    const parseAsJson = subAction.parseAsJson ?? false;
    
    try {
      const response = await fetch(url, { headers });
      let result = await response.text();
      
      if (parseAsJson) {
        try {
          result = JSON.parse(result);
        } catch {
          // Keep as text if JSON parsing fails
        }
      }
      
      this.executionArgs.set(variableName, result);
      if (context.args) {
        context.args[variableName] = result;
      }
      
      return true;
    } catch (error) {
      console.error('HTTP request failed:', error);
      return false;
    }
  }

  private async executeWriteToFile(subAction: SubAction, context: ExecutionContext): Promise<boolean> {
    const file = this.replaceVariables(subAction.file || '', context);
    const text = this.replaceVariables(subAction.text || '', context);
    const append = subAction.append ?? false;
    
    // File operations would need to be implemented based on platform
    console.log(`${append ? 'Appending to' : 'Writing to'} file ${file}: ${text}`);
    
    return true;
  }

  private async executeGetUserInfo(subAction: SubAction, context: ExecutionContext): Promise<boolean> {
    const userLogin = this.replaceVariables(subAction.userLogin || context.user || '', context);
    
    // Fetch user info from appropriate platform
    console.log(`Getting user info for: ${userLogin}`);
    
    // Mock user data
    const userData = {
      targetUser: userLogin,
      targetUserDisplayName: userLogin,
      targetUserProfileImageUrl: `https://example.com/avatar/${userLogin}`,
      targetUserId: '12345'
    };
    
    Object.entries(userData).forEach(([key, value]) => {
      this.executionArgs.set(key, value);
      if (context.args) {
        context.args[key] = value;
      }
    });
    
    return true;
  }

  private replaceVariables(text: string, context: ExecutionContext): string {
    let result = text;
    
    // Replace execution arguments
    this.executionArgs.forEach((value, key) => {
      result = result.replace(new RegExp(`%${key}%`, 'g'), value?.toString() || '');
    });
    
    // Replace context variables
    if (context.args) {
      Object.entries(context.args).forEach(([key, value]) => {
        result = result.replace(new RegExp(`%${key}%`, 'g'), value?.toString() || '');
      });
    }
    
    // Replace built-in variables
    const builtInVars: Record<string, string> = {
      user: context.user || context.userName || '',
      userName: context.userName || context.user || '',
      message: context.message || '',
      rawInput: context.rawInput || '',
      platform: context.platform || '',
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString()
    };
    
    Object.entries(builtInVars).forEach(([key, value]) => {
      result = result.replace(new RegExp(`%${key}%`, 'g'), value);
    });
    
    return result;
  }

  private async handleExecuteCode(subAction: SubAction, context: ExecutionContext): Promise<{ success: boolean; variables?: Record<string, any>; error?: string }> {
    const language = String(subAction.language || 'javascript').toLowerCase();
    if (language !== 'javascript' && language !== 'js') {
      return { success: false, error: `Unsupported code language: ${language}` };
    }

    const code = String(subAction.code || subAction.value || '').trim();
    if (!code) {
      return { success: false, error: 'Missing code for programmable sub-action.' };
    }

    const timeoutMs = Math.max(100, Number(subAction.timeoutMs || 10000) || 10000);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...fnArgs: any[]) => Promise<any>;
    const varsCache = {
      global: await listGlobalVariables(context.tenantId),
      user: context.userName ? await listUserVariables(context.userName, context.tenantId) : {},
    };

    const reply = async (text: string, options?: { as?: 'bot' | 'broadcaster' }) => {
      const channel = String(context.variables?.channel || context.args?.channel || '');
      await sendChatMessage(String(text), options?.as || 'bot', channel || undefined, context.tenantId);
    };

    const runAction = async (actionId: string) => {
      if (!context.runActionById) return false;
      return context.runActionById(actionId);
    };

    const sleep = async (ms: number) => {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    };

    const http = async (request: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: any;
      json?: boolean;
    }) => {
      const response = await fetch(request.url, {
        method: request.method || 'GET',
        headers: request.headers,
        body: typeof request.body === 'string' ? request.body : request.body != null ? JSON.stringify(request.body) : undefined,
      });

      if (request.json) {
        return response.json();
      }
      return response.text();
    };

    const points = {
      get: async (userName?: string) => {
        const user = String(userName || context.userName || '').trim();
        if (!user) return null;
        return getPoints(user, context.tenantId ? { tenantId: context.tenantId, username: user } : undefined);
      },
      add: async (amount: number, userName?: string, reason?: string) => {
        const user = String(userName || context.userName || '').trim();
        if (!user) throw new Error('Missing user for points.add');
        return addPoints(user, BigInt(Math.trunc(Number(amount) || 0)), reason || 'programmable-subaction', context.tenantId ? { tenantId: context.tenantId, username: user } : undefined);
      },
      set: async (amount: number, userName?: string) => {
        const user = String(userName || context.userName || '').trim();
        if (!user) throw new Error('Missing user for points.set');
        return setPoints(user, BigInt(Math.trunc(Number(amount) || 0)), context.tenantId ? { tenantId: context.tenantId, username: user } : undefined);
      },
    };

    const vars = {
      global: {
        get: async (key: string) => {
          varsCache.global = await listGlobalVariables(context.tenantId);
          return varsCache.global[key];
        },
        set: async (key: string, value: unknown) => {
          await setGlobalVariable(key, value, context.tenantId);
          varsCache.global[key] = value;
          return value;
        },
      },
      user: {
        get: async (key: string, userName?: string) => {
          const user = String(userName || context.userName || '').trim();
          if (!user) return undefined;
          const values = await listUserVariables(user, context.tenantId);
          return values[key];
        },
        set: async (key: string, value: unknown, userName?: string) => {
          const user = String(userName || context.userName || '').trim();
          if (!user) throw new Error('Missing user for vars.user.set');
          await setUserVariable(user, key, value, context.tenantId);
          if (user === context.userName) {
            varsCache.user[key] = value;
          }
          return value;
        },
      },
    };

    const helpers = {
      context,
      args: context.args || {},
      variables: context.variables || {},
      reply,
      runAction,
      sleep,
      http,
      vars,
      points,
      fetch,
      console,
    };

    try {
      const fn = new AsyncFunction(...Object.keys(helpers), code);
      const execution = fn(...Object.values(helpers));
      const result = await Promise.race([
        execution,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Programmable sub-action timed out after ${timeoutMs}ms`)), timeoutMs)),
      ]);

      const nextVariables: Record<string, any> = {};
      if (subAction.saveResultToVariable && subAction.saveToVariable) {
        nextVariables[String(subAction.saveToVariable)] = result;
      } else if (subAction.saveToVariable && result !== undefined) {
        nextVariables[String(subAction.saveToVariable)] = result;
      } else if (result && typeof result === 'object' && !Array.isArray(result)) {
        Object.assign(nextVariables, result);
      }

      return { success: true, variables: nextVariables };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Programmable sub-action failed.' };
    }
  }

  private async handleVoiceReplyPrompt(subAction: SubAction, context: ExecutionContext): Promise<{ success: boolean; variables?: Record<string, any>; error?: string }> {
    const broadcast = (global as any).broadcast;
    if (typeof broadcast !== 'function') {
      return { success: false, error: 'WebSocket broadcast is not available.' };
    }

    const userName = context.userName || context.user || 'viewer';
    const chatMessage = context.message || context.rawInput || '';
    const readbackTemplate = String(subAction.readbackTemplate || '%userName% said %message%');
    const readbackText = this.replaceVariables(readbackTemplate, context)
      .replace(/%userName%/g, userName)
      .replace(/%user%/g, userName)
      .replace(/%message%/g, chatMessage);
    const voice = typeof subAction.voice === 'string' && subAction.voice.trim() ? subAction.voice.trim() : undefined;
    const waitMs = Number(subAction.waitMs ?? subAction.value ?? 5000);
    const recordMs = Number(subAction.recordMs ?? 10000);
    const autoSend = subAction.autoSend !== false;
    const sendAs = subAction.useBot === false ? 'broadcaster' : 'bot';

    let audioDataUri = '';
    try {
      audioDataUri = await generateTTS(readbackText, voice, context.tenantId, {
        requireActiveConsumer: true,
      });
    } catch (error) {
      console.error('[Voice Reply Prompt] Failed to generate private readback TTS:', error);
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    broadcast({
      type: 'voice-reply-request',
      payload: {
        requestId,
        tenantId: context.tenantId || '',
        userName,
        displayName: context.variables?.displayName || userName,
        message: chatMessage,
        readbackText,
        audioDataUri,
        waitMs: Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : 5000,
        recordMs: Number.isFinite(recordMs) && recordMs > 0 ? recordMs : 10000,
        autoSend,
        sendAs,
        targetChannel: context.args?.channel || '',
      },
    }, context.tenantId);

    return { success: true, variables: { voiceReplyRequestId: requestId } };
  }

  getGlobalVariable(name: string): any {
    return this.globalVariables.get(name);
  }

  async setGlobalVariable(name: string, value: any, persisted = false, tenantId?: string): Promise<void> {
    this.globalVariables.set(name, value);
    if (persisted) {
      await setGlobalVariable(name, value, tenantId);
    }
  }

  getExecutionArgument(name: string): any {
    return this.executionArgs.get(name);
  }

  setExecutionArgument(name: string, value: any): void {
    this.executionArgs.set(name, value);
  }

  clearExecutionArguments(): void {
    this.executionArgs.clear();
  }

  private async handlePokemonPackOpen(subAction: SubAction, context: ExecutionContext): Promise<{ success: boolean; variables?: Record<string, any> }> {
    const username = context.user || context.userName || '';
    
    try {
      const response = await fetch(`${getInternalAppUrl()}/api/pokemon/open-pack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      
      if (!response.ok) {
        const error = await response.json();
        console.error('[Pokemon] Pack open failed:', error);
        return { success: false };
      }
      
      const { cards } = await response.json();
      
      // Broadcast cards to WebSocket for overlay display
      if (typeof (global as any).broadcast === 'function') {
        (global as any).broadcast({
          type: 'pokemon-pack-opened',
          payload: { username, cards }
        });
      }
      
      return { success: true, variables: { pokemonCards: cards } };
    } catch (error) {
      console.error('[Pokemon] Pack open error:', error);
      return { success: false };
    }
  }

  private async handlePokemonCollectionView(subAction: SubAction, context: ExecutionContext): Promise<{ success: boolean; variables?: Record<string, any> }> {
    const username = context.user || context.userName || '';
    
    try {
      const response = await fetch(`${getInternalAppUrl()}/api/pokemon/collection?username=${encodeURIComponent(username)}`);
      
      if (!response.ok) {
        return { success: false };
      }
      
      const collection = await response.json();
      
      return { 
        success: true, 
        variables: { 
          pokemonCardCount: collection.cards.length,
          pokemonPackCount: collection.packs 
        } 
      };
    } catch (error) {
      console.error('[Pokemon] Collection view error:', error);
      return { success: false };
    }
  }
}

