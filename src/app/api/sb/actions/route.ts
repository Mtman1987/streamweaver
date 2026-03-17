import { NextResponse } from 'next/server';
import { readStreamWeaverActions } from '@/lib/streamweaver-store';
export async function GET() {
  try {
    const data = await readStreamWeaverActions();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load actions.' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  return NextResponse.json(
    { error: 'Writing actions not supported - use individual action files' },
    { status: 405 }
  );
}
