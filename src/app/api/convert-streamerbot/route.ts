import { NextRequest } from 'next/server';
import { uudecode, isUUEncoded } from '@/lib/uudecoder';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const convertStreamerbotSchema = z.object({
  exportData: z.string().trim().min(1, 'Export data is required').max(5_000_000),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = convertStreamerbotSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Export data is required', { status: 400, code: 'INVALID_BODY' });
    }

    const { exportData } = parsed.data;

    let jsonData: any;
    const changes: string[] = [];

    // Decode UUEncoded data if needed
    if (isUUEncoded(exportData)) {
      try {
        const decoded = uudecode(exportData);
        console.log('Decoded content preview:', decoded.substring(0, 500));
        
        // Clean and try to parse as JSON
        const cleanDecoded = decoded.trim().replace(/^\uFEFF/, ''); // Remove BOM
        
        try {
          jsonData = JSON.parse(cleanDecoded);
          changes.push("Decoded and decompressed UUEncoded Streamerbot export");
        } catch (jsonError) {
          // If not JSON, try to find and extract JSON from the content
          const jsonStart = cleanDecoded.indexOf('{');
          const jsonEnd = cleanDecoded.lastIndexOf('}');
          
          if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            const extractedJson = cleanDecoded.substring(jsonStart, jsonEnd + 1);
            try {
              jsonData = JSON.parse(extractedJson);
              changes.push("Extracted JSON from decoded Streamerbot export");
            } catch (extractError) {
              return apiError(
                `Failed to parse extracted JSON. Original error: ${jsonError instanceof Error ? jsonError.message : 'Unknown error'}. Content preview: ${cleanDecoded.substring(0, 200)}`,
                { status: 400, code: 'INVALID_BODY' }
              );
            }
          } else {
            return apiError(
              `No valid JSON found in decoded content. Content preview: ${cleanDecoded.substring(0, 200)}`,
              { status: 400, code: 'INVALID_BODY' }
            );
          }
        }
      } catch (error) {
        return apiError(`Failed to decode UUEncoded data: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 400, code: 'INVALID_BODY' });
      }
    } else {
      try {
        jsonData = JSON.parse(exportData);
      } catch (error) {
        return apiError('Invalid JSON format', { status: 400, code: 'INVALID_BODY' });
      }
    }

    const actions: any[] = [];
    const commands: any[] = [];

    // Convert Streamerbot actions to StreamWeave format
    const actionsArray = jsonData.actions || jsonData.data?.actions || [];
    if (actionsArray.length > 0) {
      for (const sbAction of actionsArray) {
        const action: any = {
          name: sbAction.name || "Untitled Action",
          trigger: sbAction.trigger || "manual",
          type: "Execute Code",
          status: sbAction.enabled ? "Active" : "Draft",
          language: "javascript",
          code: sbAction.code || "// Converted from Streamerbot\nconsole.log('Action executed');"
        };

        // Convert triggers
        if (sbAction.triggers) {
          const trigger = sbAction.triggers[0];
          if (trigger?.type === "Command") {
            action.trigger = trigger.command || action.trigger;
            changes.push(`Converted command trigger for action: ${action.name}`);
          }
        }

        actions.push(action);
      }
    }

    // Convert Streamerbot commands to StreamWeave format
    const commandsArray = jsonData.commands || jsonData.data?.commands || [];
    if (commandsArray.length > 0) {
      for (const sbCommand of commandsArray) {
        const command = {
          name: sbCommand.command || sbCommand.name || "Untitled Command",
          trigger: sbCommand.command || sbCommand.trigger,
          response: sbCommand.message || sbCommand.response || "No response configured",
          enabled: sbCommand.enabled !== false,
          cooldown: sbCommand.cooldown || 0,
        };

        commands.push(command);
      }
    }

    return apiOk({ actions, commands, changes });
  } catch (error: any) {
    console.error('Streamerbot conversion error:', error);
    return apiError('Failed to convert Streamerbot export', {
      status: 500,
      code: 'INTERNAL_ERROR',
      details: {
        message: error.message,
      },
    });
  }
}