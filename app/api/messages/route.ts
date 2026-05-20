import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: '세션 ID가 누락되었습니다.' }, { status: 400 });
    }

    const messages = await db.getMessages(sessionId);
    return NextResponse.json(messages);
  } catch (error: any) {
    console.error('Failed to fetch messages:', error);
    return NextResponse.json({ error: '대화 내용을 불러오지 못했습니다.' }, { status: 500 });
  }
}
