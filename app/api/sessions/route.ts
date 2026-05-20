import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sessions = await db.getSessions();
    return NextResponse.json(sessions);
  } catch (error: any) {
    console.error('Failed to fetch sessions:', error);
    return NextResponse.json({ error: '대화 목록을 가져오지 못했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '세션 ID가 누락되었습니다.' }, { status: 400 });
    }

    await db.deleteSession(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete session:', error);
    return NextResponse.json({ error: '대화 삭제에 실패했습니다.' }, { status: 500 });
  }
}
