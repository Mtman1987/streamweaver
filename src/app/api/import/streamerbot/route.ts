/**
 * API Route: Import Streamer.bot data
 * POST /api/import/streamerbot
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  importActionsFromFile,
  importCommandsFromFile,
} from '@/services/streamerbot-importer';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';

export async function POST(request: NextRequest) {
  try {
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

    // Ensure tmp directory exists
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!existsSync(tmpDir)) {
      await mkdir(tmpDir, { recursive: true });
    }

    // Process actions file
    if (actionsFile) {
      const tempPath = path.join(tmpDir, 'actions-import.json');
      try {
        const buffer = await actionsFile.arrayBuffer();
        await writeFile(tempPath, Buffer.from(buffer));

        results.actions = await importActionsFromFile(tempPath, true);

        // Clean up temp file
        if (existsSync(tempPath)) {
          await unlink(tempPath);
        }
      } catch (error) {
        console.error('Error processing actions file:', error);
        throw new Error('Failed to process actions file');
      }
    }

    // Process commands file
    if (commandsFile) {
      const tempPath = path.join(tmpDir, 'commands-import.json');
      try {
        const buffer = await commandsFile.arrayBuffer();
        await writeFile(tempPath, Buffer.from(buffer));

        results.commands = await importCommandsFromFile(tempPath, true);

        // Clean up temp file
        if (existsSync(tempPath)) {
          await unlink(tempPath);
        }
      } catch (error) {
        console.error('Error processing commands file:', error);
        throw new Error('Failed to process commands file');
      }
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
