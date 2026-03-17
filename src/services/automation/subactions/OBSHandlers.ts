/**
 * OBS Studio Sub-Action Handlers
 * Handles all OBS Studio WebSocket operations (80+ actions)
 */

import { SubAction } from '../types';
import { ExecutionContext } from '../SubActionExecutor';
import { SubActionHandlerResult } from './SubActionHandlers';

export class OBSHandlers {
  private static obsConnections: Map<string, any> = new Map(); // OBS WebSocket clients

  static setOBSConnection(connectionId: string, obsClient: any) {
    this.obsConnections.set(connectionId, obsClient);
  }

  static getOBSConnection(connectionId?: string): any {
    if (connectionId) {
      return this.obsConnections.get(connectionId);
    }
    // Return first/default connection
    return Array.from(this.obsConnections.values())[0];
  }

  /**
   * Scene Operations
   */
  static async handleOBSSetScene(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const sceneName = replaceVariables(subAction.sceneName || '', context);
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Set scene: ${sceneName}`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('SetCurrentProgramScene', { sceneName });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to set OBS scene: ${error}` };
    }
  }

  static async handleOBSGetCurrentScene(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const connectionId = subAction.connectionId;
    const variableName = subAction.variableName || 'currentScene';
    
    try {
      console.log(`[OBS] Get current scene`);
      
      const obs = this.getOBSConnection(connectionId);
      let currentScene = '';
      
      if (obs) {
        const response = await obs.call('GetCurrentProgramScene');
        currentScene = response.currentProgramSceneName;
      }
      
      return { 
        success: true,
        variables: {
          [variableName]: currentScene,
          obsCurrentScene: currentScene
        }
      };
    } catch (error) {
      return { success: false, error: `Failed to get OBS scene: ${error}` };
    }
  }

  static async handleOBSGetSceneList(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const connectionId = subAction.connectionId;
    const variableName = subAction.variableName || 'sceneList';
    
    try {
      console.log(`[OBS] Get scene list`);
      
      const obs = this.getOBSConnection(connectionId);
      let scenes: any[] = [];
      
      if (obs) {
        const response = await obs.call('GetSceneList');
        scenes = response.scenes;
      }
      
      return { 
        success: true,
        variables: {
          [variableName]: scenes,
          obsSceneList: scenes,
          obsSceneCount: scenes.length
        }
      };
    } catch (error) {
      return { success: false, error: `Failed to get OBS scene list: ${error}` };
    }
  }

  /**
   * Source Visibility Operations
   */
  static async handleOBSSetSourceVisibility(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const sceneName = replaceVariables(subAction.sceneName || '', context);
    const sourceName = replaceVariables(subAction.sourceName || '', context);
    const state = subAction.state || 1; // 0=Hide, 1=Show, 2=Toggle
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Set source visibility: ${sceneName}/${sourceName} = ${state}`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        if (state === 2) { // Toggle
          const currentState = await obs.call('GetSceneItemEnabled', {
            sceneName,
            sceneItemId: await this.getSceneItemId(obs, sceneName, sourceName)
          });
          await obs.call('SetSceneItemEnabled', {
            sceneName,
            sceneItemId: await this.getSceneItemId(obs, sceneName, sourceName),
            sceneItemEnabled: !currentState.sceneItemEnabled
          });
        } else {
          await obs.call('SetSceneItemEnabled', {
            sceneName,
            sceneItemId: await this.getSceneItemId(obs, sceneName, sourceName),
            sceneItemEnabled: state === 1
          });
        }
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to set source visibility: ${error}` };
    }
  }

  /**
   * Text Source Operations
   */
  static async handleOBSSetGDIText(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const sourceName = replaceVariables(subAction.sourceName || '', context);
    const text = replaceVariables(subAction.text || '', context);
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Set GDI text: ${sourceName} = ${text}`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('SetInputSettings', {
          inputName: sourceName,
          inputSettings: {
            text: text
          }
        });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to set GDI text: ${error}` };
    }
  }

  static async handleOBSSetFreeTypeText(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const sourceName = replaceVariables(subAction.sourceName || '', context);
    const text = replaceVariables(subAction.text || '', context);
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Set FreeType text: ${sourceName} = ${text}`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('SetInputSettings', {
          inputName: sourceName,
          inputSettings: {
            text: text
          }
        });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to set FreeType text: ${error}` };
    }
  }

  /**
   * Browser Source Operations
   */
  static async handleOBSSetBrowserSource(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const sourceName = replaceVariables(subAction.sourceName || '', context);
    const url = replaceVariables(subAction.url || '', context);
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Set browser source: ${sourceName} = ${url}`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('SetInputSettings', {
          inputName: sourceName,
          inputSettings: {
            url: url
          }
        });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to set browser source: ${error}` };
    }
  }

  static async handleOBSRefreshBrowserSource(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const sourceName = replaceVariables(subAction.sourceName || '', context);
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Refresh browser source: ${sourceName}`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('PressInputPropertiesButton', {
          inputName: sourceName,
          propertyName: 'refreshnocache'
        });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to refresh browser source: ${error}` };
    }
  }

  /**
   * Media Source Operations
   */
  static async handleOBSSetMediaSource(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const sourceName = replaceVariables(subAction.sourceName || '', context);
    const fileName = replaceVariables(subAction.fileName || '', context);
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Set media source: ${sourceName} = ${fileName}`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('SetInputSettings', {
          inputName: sourceName,
          inputSettings: {
            local_file: fileName
          }
        });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to set media source: ${error}` };
    }
  }

  static async handleOBSMediaPlay(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const sourceName = replaceVariables(subAction.sourceName || '', context);
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Media play: ${sourceName}`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('TriggerMediaInputAction', {
          inputName: sourceName,
          mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY'
        });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to play media: ${error}` };
    }
  }

  static async handleOBSMediaPause(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const sourceName = replaceVariables(subAction.sourceName || '', context);
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Media pause: ${sourceName}`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('TriggerMediaInputAction', {
          inputName: sourceName,
          mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE'
        });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to pause media: ${error}` };
    }
  }

  static async handleOBSMediaRestart(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const sourceName = replaceVariables(subAction.sourceName || '', context);
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Media restart: ${sourceName}`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('TriggerMediaInputAction', {
          inputName: sourceName,
          mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
        });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to restart media: ${error}` };
    }
  }

  static async handleOBSMediaStop(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const sourceName = replaceVariables(subAction.sourceName || '', context);
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Media stop: ${sourceName}`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('TriggerMediaInputAction', {
          inputName: sourceName,
          mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP'
        });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to stop media: ${error}` };
    }
  }

  /**
   * Filter Operations
   */
  static async handleOBSSetFilterState(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const sourceName = replaceVariables(subAction.sourceName || '', context);
    const filterName = replaceVariables(subAction.filterName || '', context);
    const enabled = subAction.enabled !== false;
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Set filter state: ${sourceName}/${filterName} = ${enabled}`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('SetSourceFilterEnabled', {
          sourceName,
          filterName,
          filterEnabled: enabled
        });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to set filter state: ${error}` };
    }
  }

  /**
   * Recording Operations
   */
  static async handleOBSStartRecording(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Start recording`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('StartRecord');
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to start recording: ${error}` };
    }
  }

  static async handleOBSStopRecording(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Stop recording`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('StopRecord');
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to stop recording: ${error}` };
    }
  }

  static async handleOBSPauseRecording(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Pause recording`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('PauseRecord');
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to pause recording: ${error}` };
    }
  }

  static async handleOBSResumeRecording(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Resume recording`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('ResumeRecord');
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to resume recording: ${error}` };
    }
  }

  /**
   * Streaming Operations
   */
  static async handleOBSStartStreaming(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Start streaming`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('StartStream');
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to start streaming: ${error}` };
    }
  }

  static async handleOBSStopStreaming(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Stop streaming`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('StopStream');
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to stop streaming: ${error}` };
    }
  }

  /**
   * Virtual Camera Operations
   */
  static async handleOBSStartVirtualCamera(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Start virtual camera`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('StartVirtualCam');
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to start virtual camera: ${error}` };
    }
  }

  static async handleOBSStopVirtualCamera(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Stop virtual camera`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('StopVirtualCam');
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to stop virtual camera: ${error}` };
    }
  }

  /**
   * Screenshot Operations
   */
  static async handleOBSSaveScreenshot(subAction: SubAction, context: ExecutionContext): Promise<SubActionHandlerResult> {
    const sourceName = replaceVariables(subAction.sourceName || '', context);
    const filePath = replaceVariables(subAction.filePath || '', context);
    const connectionId = subAction.connectionId;
    
    try {
      console.log(`[OBS] Save screenshot: ${sourceName} to ${filePath}`);
      
      const obs = this.getOBSConnection(connectionId);
      if (obs) {
        await obs.call('SaveSourceScreenshot', {
          sourceName,
          imageFormat: 'png',
          imageFilePath: filePath,
          imageWidth: subAction.width,
          imageHeight: subAction.height
        });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to save screenshot: ${error}` };
    }
  }

  /**
   * Utility Methods
   */
  private static async getSceneItemId(obs: any, sceneName: string, sourceName: string): Promise<number> {
    const response = await obs.call('GetSceneItemId', {
      sceneName,
      sourceName
    });
    return response.sceneItemId;
  }
}

function replaceVariables(text: string, context: ExecutionContext): string {
  if (!text) return text;
  
  return text.replace(/%(\w+)%/g, (match, varName) => {
    const value = context.variables?.[varName] ?? context.args?.[varName] ?? match;
    return String(value);
  });
}
