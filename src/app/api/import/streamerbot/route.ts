/**
 * API Route: Import Streamer.bot data
 * POST /api/import/streamerbot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { createAction, getAllActions } from '@/lib/actions-store';
import { createCommand, getAllCommands } from '@/lib/commands-store';
import { importStreamerbotActions, importStreamerbotCommands } from '@/lib/streamerbot-converter';

function normalizeCommandText(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.startsWith('!') ? text : `!${text.replace(/^!+/, '')}`;
}

function readActionsPayload(payload: any): any[] {
  if (!payload) return [];
  return importStreamerbotActions(payload);
}

function readCommandsPayload(payload: any): any[] {
  if (!payload) return [];
  return importStreamerbotCommands(payload);
}

async function importPayload(payload: any, tenantId?: string) {
  const existingActions = await getAllActions(tenantId);
  const existingCommands = await getAllCommands(tenantId);
  const existingActionIds = new Set(existingActions.map((action: any) => String(action.id || '')));
  const existingActionNames = new Set(existingActions.map((action: any) => `${String(action.name || '').trim().toLowerCase()}:${String(action.group || '').trim().toLowerCase()}`));
  const existingCommandIds = new Set(existingCommands.map((command: any) => String(command.id || '')));
  const existingCommandTexts = new Set(existingCommands.map((command: any) => normalizeCommandText(command.command).toLowerCase()));
  const actionIdMap = new Map<string, string>();
  const commandIdMap = new Map<string, string>();
  let importedActions = 0;
  let skippedActions = 0;
  let importedCommands = 0;
  let skippedCommands = 0;

  for (const raw of readActionsPayload(payload)) {
    const id = String(raw?.id || '');
    const name = String(raw?.name || 'Untitled Action').trim();
    if (!name) continue;
    const nameKey = `${name.toLowerCase()}:${String(raw?.group || '').trim().toLowerCase()}`;
    if ((id && existingActionIds.has(id)) || existingActionNames.has(nameKey)) {
      if (id) actionIdMap.set(id, id);
      skippedActions += 1;
      continue;
    }
    const created = await createAction({
      ...(raw as Record<string, any>),
      id: id || undefined,
      name,
      triggers: Array.isArray(raw?.triggers) ? raw.triggers : [],
      subActions: Array.isArray(raw?.subActions) ? raw.subActions : Array.isArray(raw?.subactions) ? raw.subactions : [],
      group: raw?.group,
      enabled: raw?.enabled ?? true,
      sourceFormat: payload?.format || 'streamerbot',
      sourceOriginalId: id || undefined,
    } as any, tenantId);
    if (id) actionIdMap.set(id, created.id);
    existingActionIds.add(created.id);
    existingActionNames.add(nameKey);
    importedActions += 1;
  }

  for (const raw of readCommandsPayload(payload)) {
    const id = String(raw?.id || '');
    const command = normalizeCommandText(raw?.command || raw?.trigger || raw?.name);
    if (!command) continue;
    if ((id && existingCommandIds.has(id)) || existingCommandTexts.has(command.toLowerCase())) {
      if (id) commandIdMap.set(id, id);
      skippedCommands += 1;
      continue;
    }
    const created = await createCommand({
      ...(raw as Record<string, any>),
      id: id || undefined,
      name: String(raw?.name || command),
      command,
      group: raw?.group,
      enabled: raw?.enabled ?? true,
      sourceFormat: payload?.format || 'streamerbot',
      sourceOriginalId: id || undefined,
    } as any, tenantId);
    if (id) commandIdMap.set(id, created.id);
    existingCommandIds.add(created.id);
    existingCommandTexts.add(command.toLowerCase());
    importedCommands += 1;
  }

  return {
    actions: { imported: importedActions, skipped: skippedActions, total: existingActionIds.size },
    commands: { imported: importedCommands, skipped: skippedCommands, total: existingCommandTexts.size },
  };
}

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    const formData = await request.formData();
    const actionsFile = formData.get('actionsFile') as File | null;
    const commandsFile = formData.get('commandsFile') as File | null;

    if (!actionsFile && !commandsFile) {
      return NextResponse.json(
        { success: false, message: 'No files provided' },
        { status: 400 }
      );
    }

    const results = {
      actions: { imported: 0, skipped: 0, total: 0 },
      commands: { imported: 0, skipped: 0, total: 0 },
    };

    for (const file of [actionsFile, commandsFile].filter(Boolean) as File[]) {
      const payload = JSON.parse(await file.text());
      const partial = await importPayload(payload, session.tenantId);
      results.actions.imported += partial.actions.imported;
      results.actions.skipped += partial.actions.skipped;
      results.actions.total = partial.actions.total;
      results.commands.imported += partial.commands.imported;
      results.commands.skipped += partial.commands.skipped;
      results.commands.total = partial.commands.total;
    }

    return NextResponse.json({
      success: true,
      message: 'Import completed successfully',
      results,
    });
  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Import failed',
      },
      { status: 500 }
    );
  }
}
