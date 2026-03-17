/**
 * Twitch Sub-Action Handlers
 * Handles all Twitch-related sub-actions (100+ actions)
 */

import { SubAction } from '../types';
import { ExecutionContext } from '../SubActionExecutor';
import { SubActionHandlerResult } from './SubActionHandlers';

export class TwitchHandlers {
  private static twitchService: any; // Will be injected

  static setTwitchService(service: any) {
    this.twitchService = service;
  }

  /**
   * Chat Operations
   */
  static async handleTwitchSendMessage(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const message = replaceVariables(subAction.message || subAction.text || '', context);
    const useBot = subAction.useBot !== false;
    
    try {
      // TODO: Send via Twitch service
      console.log(`[Twitch Chat] ${message} (as bot: ${useBot})`);
      
      if (this.twitchService) {
        await this.twitchService.sendMessage(message, useBot);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to send Twitch message: ${error}` };
    }
  }

  static async handleTwitchDeleteMessage(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const messageId = replaceVariables(subAction.messageId || context.variables?.messageId || '', context);
    
    try {
      console.log(`[Twitch] Delete message: ${messageId}`);
      
      if (this.twitchService) {
        await this.twitchService.deleteMessage(messageId);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to delete message: ${error}` };
    }
  }

  static async handleTwitchClearChat(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    try {
      console.log(`[Twitch] Clear chat`);
      
      if (this.twitchService) {
        await this.twitchService.clearChat();
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to clear chat: ${error}` };
    }
  }

  /**
   * Moderation Operations
   */
  static async handleTwitchTimeoutUser(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userName = replaceVariables(subAction.userName || subAction.userLogin || context.userName || '', context);
    const duration = parseInt(replaceVariables(String(subAction.duration || 600), context));
    const reason = replaceVariables(subAction.reason || '', context);
    
    try {
      console.log(`[Twitch] Timeout ${userName} for ${duration}s: ${reason}`);
      
      if (this.twitchService) {
        await this.twitchService.timeoutUser(userName, duration, reason);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to timeout user: ${error}` };
    }
  }

  static async handleTwitchBanUser(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userName = replaceVariables(subAction.userName || subAction.userLogin || '', context);
    const reason = replaceVariables(subAction.reason || '', context);
    
    try {
      console.log(`[Twitch] Ban ${userName}: ${reason}`);
      
      if (this.twitchService) {
        await this.twitchService.banUser(userName, reason);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to ban user: ${error}` };
    }
  }

  static async handleTwitchUnbanUser(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userName = replaceVariables(subAction.userName || subAction.userLogin || '', context);
    
    try {
      console.log(`[Twitch] Unban ${userName}`);
      
      if (this.twitchService) {
        await this.twitchService.unbanUser(userName);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to unban user: ${error}` };
    }
  }

  static async handleTwitchSlowMode(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const enabled = subAction.enabled !== false;
    const duration = parseInt(String(subAction.duration || 30));
    
    try {
      console.log(`[Twitch] Slow mode: ${enabled} (${duration}s)`);
      
      if (this.twitchService) {
        await this.twitchService.setSlowMode(enabled, duration);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to set slow mode: ${error}` };
    }
  }

  /**
   * Channel Operations
   */
  static async handleTwitchSetTitle(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const title = replaceVariables(subAction.title || '', context);
    
    try {
      console.log(`[Twitch] Set title: ${title}`);
      
      if (this.twitchService) {
        await this.twitchService.setChannelTitle(title);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to set title: ${error}` };
    }
  }

  static async handleTwitchSetGame(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const game = replaceVariables(subAction.game || '', context);
    
    try {
      console.log(`[Twitch] Set game: ${game}`);
      
      if (this.twitchService) {
        await this.twitchService.setChannelCategory(game);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to set game: ${error}` };
    }
  }

  static async handleTwitchCreateMarker(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const description = replaceVariables(subAction.description || '', context);
    
    try {
      console.log(`[Twitch] Create marker: ${description}`);
      
      if (this.twitchService) {
        await this.twitchService.createStreamMarker(description);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to create marker: ${error}` };
    }
  }

  static async handleTwitchRunCommercial(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const duration = parseInt(String(subAction.duration || 30));
    
    try {
      console.log(`[Twitch] Run commercial: ${duration}s`);
      
      if (this.twitchService) {
        await this.twitchService.runCommercial(duration);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to run commercial: ${error}` };
    }
  }

  /**
   * User Information
   */
  static async handleTwitchGetUserInfo(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const raw = subAction.userLogin || subAction.userName || context.userName || '';
    const userName = replaceVariables(String(raw), context).replace(/^@/, '').trim();
    
    console.log(`[Twitch] Get user info: ${userName}`);
    
    // If no username provided, set empty variables and continue
    if (!userName) {
      console.log(`[Twitch] No username provided for Get User Info, setting empty variables`);
      return { 
        success: true, 
        variables: {
          targetUser: '',
          targetUserId: '',
          targetUserName: '',
          targetDisplayName: '',
          targetUserType: '',
          targetBroadcasterType: '',
          targetDescription: '',
          targetProfileImage: '',
          targetCreatedAt: '',
          accountCreated: ''
        }
      };
    }
    
    try {
      let userInfo: any = {};
      
      if (this.twitchService) {
        userInfo = await this.twitchService.getUserInfo(userName);
      }

      const createdAt = userInfo.created_at || userInfo.createdAt || userInfo.targetCreatedAt;
      
      return { 
        success: true, 
        variables: {
          // Streamer.bot common variables (best-effort)
          targetUser: userInfo.display_name || userInfo.displayName || userInfo.login || userName,
          accountCreated: createdAt,

          targetUserId: userInfo.id,
          targetUserName: userInfo.login,
          targetDisplayName: userInfo.display_name,
          targetUserType: userInfo.type,
          targetBroadcasterType: userInfo.broadcaster_type,
          targetDescription: userInfo.description,
          targetProfileImage: userInfo.profile_image_url,
          targetCreatedAt: createdAt
        }
      };
    } catch (error) {
      console.log(`[Twitch] Get User Info failed for '${userName}', setting empty variables`);
      return { 
        success: true, 
        variables: {
          targetUser: '',
          targetUserId: '',
          targetUserName: '',
          targetDisplayName: '',
          targetUserType: '',
          targetBroadcasterType: '',
          targetDescription: '',
          targetProfileImage: '',
          targetCreatedAt: '',
          accountCreated: ''
        }
      };
    }
  }

  static async handleTwitchGetUserInfoByLogin(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    return this.handleTwitchGetUserInfo(subAction, context);
  }

  /**
   * Shoutout
   */
  static async handleTwitchSendShoutout(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userName = replaceVariables(subAction.userName || '', context);
    
    try {
      console.log(`[Twitch] Send shoutout to: ${userName}`);
      
      if (this.twitchService) {
        await this.twitchService.sendShoutout(userName);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to send shoutout: ${error}` };
    }
  }

  /**
   * Raids
   */
  static async handleTwitchStartRaid(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userName = replaceVariables(subAction.userName || '', context);
    
    try {
      console.log(`[Twitch] Start raid to: ${userName}`);
      
      if (this.twitchService) {
        await this.twitchService.startRaid(userName);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to start raid: ${error}` };
    }
  }

  static async handleTwitchCancelRaid(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    try {
      console.log(`[Twitch] Cancel raid`);
      
      if (this.twitchService) {
        await this.twitchService.cancelRaid();
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to cancel raid: ${error}` };
    }
  }

  /**
   * Channel Points
   */
  static async handleTwitchUpdateReward(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const rewardId = replaceVariables(subAction.rewardId || '', context);
    const updates = subAction.updates || {};
    
    try {
      console.log(`[Twitch] Update reward: ${rewardId}`);
      
      if (this.twitchService) {
        await this.twitchService.updateChannelPointReward(rewardId, updates);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to update reward: ${error}` };
    }
  }

  static async handleTwitchPauseReward(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const rewardId = replaceVariables(subAction.rewardId || '', context);
    const paused = subAction.paused !== false;
    
    try {
      console.log(`[Twitch] ${paused ? 'Pause' : 'Unpause'} reward: ${rewardId}`);
      
      if (this.twitchService) {
        await this.twitchService.updateChannelPointReward(rewardId, { is_paused: paused });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to pause/unpause reward: ${error}` };
    }
  }

  /**
   * Polls & Predictions
   */
  static async handleTwitchCreatePoll(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const title = replaceVariables(subAction.title || '', context);
    const choices = subAction.choices || [];
    const duration = parseInt(String(subAction.duration || 60));
    
    try {
      console.log(`[Twitch] Create poll: ${title}`);
      
      if (this.twitchService) {
        await this.twitchService.createPoll(title, choices, duration);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to create poll: ${error}` };
    }
  }

  static async handleTwitchEndPoll(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const pollId = replaceVariables(subAction.pollId || '', context);
    const status = subAction.status || 'TERMINATED';
    
    try {
      console.log(`[Twitch] End poll: ${pollId} (${status})`);
      
      if (this.twitchService) {
        await this.twitchService.endPoll(pollId, status);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to end poll: ${error}` };
    }
  }

  /**
   * User Groups (Custom Streamer.bot feature)
   */
  static async handleTwitchAddUserToGroup(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userName = replaceVariables(subAction.userName || context.userName || '', context);
    const groupName = replaceVariables(subAction.groupName || '', context);
    
    try {
      console.log(`[Twitch] Add ${userName} to group: ${groupName}`);
      
      // TODO: Implement user groups in storage
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to add user to group: ${error}` };
    }
  }

  static async handleTwitchRemoveUserFromGroup(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userName = replaceVariables(subAction.userName || context.userName || '', context);
    const groupName = replaceVariables(subAction.groupName || '', context);
    
    try {
      console.log(`[Twitch] Remove ${userName} from group: ${groupName}`);
      
      // TODO: Implement user groups in storage
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to remove user from group: ${error}` };
    }
  }

  static async handleTwitchUserInGroup(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userName = replaceVariables(subAction.userName || context.userName || '', context);
    const groupName = replaceVariables(subAction.groupName || '', context);
    
    try {
      console.log(`[Twitch] Check if ${userName} in group: ${groupName}`);
      
      // TODO: Implement user groups in storage
      const inGroup = false; // Placeholder
      
      return { 
        success: true,
        variables: {
          userInGroup: inGroup
        }
      };
    } catch (error) {
      return { success: false, error: `Failed to check user group: ${error}` };
    }
  }
}

function replaceVariables(text: string, context: ExecutionContext): string {
  if (!text) return text;
  
  // Replace %variableName% with actual values from context
  let result = text.replace(/%(\w+)%/g, (match, varName) => {
    const value = context.variables?.[varName] ?? context.args?.[varName] ?? match;
    return String(value);
  });
  
  // Replace built-in variables
  const builtInVars: Record<string, string> = {
    user: context.user || context.userName || '',
    userName: context.userName || context.user || '',
    message: context.message || '',
    rawInput: context.rawInput || '',
    platform: context.platform || '',
    broadcastUser: 'Mtman1987', // TODO: Get from config
    broadcastUserName: 'Mtman1987', // TODO: Get from config
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString(),
    randomNumber: String(Math.floor(Math.random() * 100) + 1) // 1-100
  };
  
  Object.entries(builtInVars).forEach(([key, value]) => {
    result = result.replace(new RegExp(`%${key}%`, 'g'), value);
  });
  
  return result;
}
