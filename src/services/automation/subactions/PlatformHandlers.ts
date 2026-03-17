/**
 * Discord & YouTube Sub-Action Handlers
 */

import { SubAction } from '../types';
import { ExecutionContext } from '../SubActionExecutor';
import { SubActionHandlerResult } from './SubActionHandlers';

/**
 * Discord Handlers
 */
export class DiscordHandlers {
  private static discordService: any;

  static setDiscordService(service: any) {
    this.discordService = service;
  }

  static async handleDiscordSendMessage(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const channelId = replaceVariables(subAction.channelId || '', context);
    const message = replaceVariables(subAction.message || '', context);
    const embed = subAction.embed || false;
    
    try {
      console.log(`[Discord] Send message to channel ${channelId}: ${message}`);
      
      if (this.discordService) {
        if (embed) {
          await this.discordService.sendEmbed(channelId, {
            description: message,
            color: subAction.embedColor || 0x5865F2
          });
        } else {
          await this.discordService.sendMessage(channelId, message);
        }
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to send Discord message: ${error}` };
    }
  }

  static async handleDiscordSendDM(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userId = replaceVariables(subAction.userId || '', context);
    const message = replaceVariables(subAction.message || '', context);
    
    try {
      console.log(`[Discord] Send DM to user ${userId}: ${message}`);
      
      if (this.discordService) {
        await this.discordService.sendDirectMessage(userId, message);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to send Discord DM: ${error}` };
    }
  }

  static async handleDiscordAddRole(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const guildId = replaceVariables(subAction.guildId || '', context);
    const userId = replaceVariables(subAction.userId || '', context);
    const roleId = replaceVariables(subAction.roleId || '', context);
    
    try {
      console.log(`[Discord] Add role ${roleId} to user ${userId} in guild ${guildId}`);
      
      if (this.discordService) {
        await this.discordService.addRole(guildId, userId, roleId);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to add Discord role: ${error}` };
    }
  }

  static async handleDiscordRemoveRole(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const guildId = replaceVariables(subAction.guildId || '', context);
    const userId = replaceVariables(subAction.userId || '', context);
    const roleId = replaceVariables(subAction.roleId || '', context);
    
    try {
      console.log(`[Discord] Remove role ${roleId} from user ${userId} in guild ${guildId}`);
      
      if (this.discordService) {
        await this.discordService.removeRole(guildId, userId, roleId);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to remove Discord role: ${error}` };
    }
  }

  static async handleDiscordCreateChannel(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const guildId = replaceVariables(subAction.guildId || '', context);
    const channelName = replaceVariables(subAction.channelName || '', context);
    const channelType = subAction.channelType || 'GUILD_TEXT';
    
    try {
      console.log(`[Discord] Create channel ${channelName} in guild ${guildId}`);
      
      if (this.discordService) {
        await this.discordService.createChannel(guildId, channelName, channelType);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to create Discord channel: ${error}` };
    }
  }

  static async handleDiscordDeleteChannel(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const channelId = replaceVariables(subAction.channelId || '', context);
    
    try {
      console.log(`[Discord] Delete channel ${channelId}`);
      
      if (this.discordService) {
        await this.discordService.deleteChannel(channelId);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to delete Discord channel: ${error}` };
    }
  }

  static async handleDiscordReactToMessage(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const channelId = replaceVariables(subAction.channelId || '', context);
    const messageId = replaceVariables(subAction.messageId || '', context);
    const emoji = replaceVariables(subAction.emoji || '', context);
    
    try {
      console.log(`[Discord] React to message ${messageId} with ${emoji}`);
      
      if (this.discordService) {
        await this.discordService.addReaction(channelId, messageId, emoji);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to add Discord reaction: ${error}` };
    }
  }

  static async handleDiscordUpdatePresence(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const status = subAction.status || 'online'; // online, idle, dnd, invisible
    const activity = replaceVariables(subAction.activity || '', context);
    const activityType = subAction.activityType || 'PLAYING'; // PLAYING, STREAMING, LISTENING, WATCHING
    
    try {
      console.log(`[Discord] Update presence: ${status} - ${activityType} ${activity}`);
      
      if (this.discordService) {
        await this.discordService.updatePresence({
          status,
          activities: [{
            name: activity,
            type: activityType
          }]
        });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to update Discord presence: ${error}` };
    }
  }
}

/**
 * YouTube Handlers
 */
export class YouTubeHandlers {
  private static youtubeService: any;

  static setYouTubeService(service: any) {
    this.youtubeService = service;
  }

  static async handleYouTubeSendMessage(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const message = replaceVariables(subAction.message || '', context);
    
    try {
      console.log(`[YouTube] Send message: ${message}`);
      
      if (this.youtubeService) {
        await this.youtubeService.sendChatMessage(message);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to send YouTube message: ${error}` };
    }
  }

  static async handleYouTubeDeleteMessage(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const messageId = replaceVariables(subAction.messageId || '', context);
    
    try {
      console.log(`[YouTube] Delete message: ${messageId}`);
      
      if (this.youtubeService) {
        await this.youtubeService.deleteChatMessage(messageId);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to delete YouTube message: ${error}` };
    }
  }

  static async handleYouTubeTimeoutUser(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userId = replaceVariables(subAction.userId || context.args?.userId || '', context);
    const duration = parseInt(replaceVariables(String(subAction.duration || 300), context));
    
    try {
      console.log(`[YouTube] Timeout user ${userId} for ${duration}s`);
      
      if (this.youtubeService) {
        await this.youtubeService.timeoutUser(userId, duration);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to timeout YouTube user: ${error}` };
    }
  }

  static async handleYouTubeBanUser(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userId = replaceVariables(subAction.userId || context.args?.userId || '', context);
    
    try {
      console.log(`[YouTube] Ban user: ${userId}`);
      
      if (this.youtubeService) {
        await this.youtubeService.banUser(userId);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to ban YouTube user: ${error}` };
    }
  }

  static async handleYouTubeUnbanUser(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userId = replaceVariables(subAction.userId || '', context);
    
    try {
      console.log(`[YouTube] Unban user: ${userId}`);
      
      if (this.youtubeService) {
        await this.youtubeService.unbanUser(userId);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to unban YouTube user: ${error}` };
    }
  }

  static async handleYouTubeModUser(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userId = replaceVariables(subAction.userId || '', context);
    
    try {
      console.log(`[YouTube] Mod user: ${userId}`);
      
      if (this.youtubeService) {
        await this.youtubeService.modUser(userId);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to mod YouTube user: ${error}` };
    }
  }

  static async handleYouTubeUnmodUser(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userId = replaceVariables(subAction.userId || '', context);
    
    try {
      console.log(`[YouTube] Unmod user: ${userId}`);
      
      if (this.youtubeService) {
        await this.youtubeService.unmodUser(userId);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to unmod YouTube user: ${error}` };
    }
  }

  static async handleYouTubeSetBroadcastTitle(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const title = replaceVariables(subAction.title || '', context);
    
    try {
      console.log(`[YouTube] Set broadcast title: ${title}`);
      
      if (this.youtubeService) {
        await this.youtubeService.setBroadcastTitle(title);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to set YouTube broadcast title: ${error}` };
    }
  }

  static async handleYouTubeSetBroadcastDescription(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const description = replaceVariables(subAction.description || '', context);
    
    try {
      console.log(`[YouTube] Set broadcast description: ${description}`);
      
      if (this.youtubeService) {
        await this.youtubeService.setBroadcastDescription(description);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to set YouTube broadcast description: ${error}` };
    }
  }

  static async handleYouTubeGetViewerCount(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const variableName = subAction.variableName || 'youtubeViewerCount';
    
    try {
      console.log(`[YouTube] Get viewer count`);
      
      let viewerCount = 0;
      
      if (this.youtubeService) {
        viewerCount = await this.youtubeService.getViewerCount();
      }
      
      return {
        success: true,
        variables: {
          [variableName]: viewerCount,
          youtubeViewerCount: viewerCount
        }
      };
    } catch (error) {
      return { success: false, error: `Failed to get YouTube viewer count: ${error}` };
    }
  }

  static async handleYouTubeGetStreamInfo(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    try {
      console.log(`[YouTube] Get stream info`);
      
      let streamInfo: any = {};
      
      if (this.youtubeService) {
        streamInfo = await this.youtubeService.getStreamInfo();
      }
      
      return {
        success: true,
        variables: {
          youtubeStreamId: streamInfo.id,
          youtubeStreamTitle: streamInfo.title,
          youtubeStreamDescription: streamInfo.description,
          youtubeStreamStatus: streamInfo.status,
          youtubeViewerCount: streamInfo.viewerCount
        }
      };
    } catch (error) {
      return { success: false, error: `Failed to get YouTube stream info: ${error}` };
    }
  }
}

/**
 * Kick Handlers (Kick.com platform)
 */
export class KickHandlers {
  private static kickService: any;

  static setKickService(service: any) {
    this.kickService = service;
  }

  static async handleKickSendMessage(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const message = replaceVariables(subAction.message || '', context);
    
    try {
      console.log(`[Kick] Send message: ${message}`);
      
      if (this.kickService) {
        await this.kickService.sendMessage(message);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to send Kick message: ${error}` };
    }
  }

  static async handleKickTimeoutUser(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userName = replaceVariables(subAction.userName || '', context);
    const duration = parseInt(replaceVariables(String(subAction.duration || 600), context));
    
    try {
      console.log(`[Kick] Timeout user ${userName} for ${duration}s`);
      
      if (this.kickService) {
        await this.kickService.timeoutUser(userName, duration);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to timeout Kick user: ${error}` };
    }
  }

  static async handleKickBanUser(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const userName = replaceVariables(subAction.userName || '', context);
    
    try {
      console.log(`[Kick] Ban user: ${userName}`);
      
      if (this.kickService) {
        await this.kickService.banUser(userName);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to ban Kick user: ${error}` };
    }
  }
}

function replaceVariables(text: string, context: ExecutionContext): string {
  if (!text) return text;
  
  return text.replace(/%(\w+)%/g, (match, varName) => {
    const value = context.variables?.[varName] ?? context.args?.[varName] ?? match;
    return String(value);
  });
}
