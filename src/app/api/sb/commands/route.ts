import { NextResponse } from 'next/server';
import { readStreamWeaverCommands } from '@/lib/streamweaver-store';
export async function GET() {
  try {
    const data = await readStreamWeaverCommands();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load commands.' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  return NextResponse.json(
    { error: 'Writing commands not supported - use individual command files' },
    { status: 405 }
  );
}
