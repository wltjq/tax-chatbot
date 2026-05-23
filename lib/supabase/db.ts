import { supabase } from './client';
import { localDb } from './fallback';

let forceLocalDb = false;

// Check if Supabase keys exist and are functional
async function isSupabaseHealthy(): Promise<boolean> {
  if (forceLocalDb) {
    return false;
  }

  // If we don't have URL or keys at all
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')
  ) {
    return false;
  }
  
  // Quick ping check
  try {
    const { error } = await supabase.from('chat_sessions').select('id').limit(1);
    if (error) {
      if (
        error.message?.includes('Invalid API key') ||
        error.message?.includes('JWT') ||
        error.code === 'PGRST111' || // invalid api key
        error.message?.includes('API key')
      ) {
        return false;
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

export const db = {
  getSessions: async () => {
    try {
      if (await isSupabaseHealthy()) {
        const { data, error } = await supabase
          .from('chat_sessions')
          .select('*')
          .order('updated_at', { ascending: false });
        if (!error && data) return data;
      }
    } catch (e) {
      console.warn('Supabase getSessions failed, falling back to local DB:', e);
    }
    return localDb.getSessions();
  },

  deleteSession: async (id: string) => {
    try {
      if (await isSupabaseHealthy()) {
        const { error } = await supabase
          .from('chat_sessions')
          .delete()
          .eq('id', id);
        if (!error) return;
        console.warn('Supabase deleteSession failed, falling back to local DB:', error);
        forceLocalDb = true;
      }
    } catch (e) {
      console.warn('Supabase deleteSession failed, falling back to local DB:', e);
      forceLocalDb = true;
    }
    localDb.deleteSession(id);
  },

  getMessages: async (sessionId: string) => {
    try {
      if (await isSupabaseHealthy()) {
        const { data, error } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: true });
        if (!error && data) return data;
      }
    } catch (e) {
      console.warn('Supabase getMessages failed, falling back to local DB:', e);
    }
    return localDb.getMessages(sessionId);
  },

  saveChat: async (sessionId: string, userMessage: string, assistantMessage: string, citations: any) => {
    if (sessionId === 'benchmark-session') return;
    
    let savedToSupabase = false;
    try {
      if (await isSupabaseHealthy()) {
        const { data: sessionData, error: sessionErr } = await supabase
          .from('chat_sessions')
          .select('id')
          .eq('id', sessionId)
          .single();

        let sessionOk = !sessionErr && !!sessionData;
        if (!sessionOk) {
          const title = userMessage.length > 20 ? `${userMessage.substring(0, 20)}...` : userMessage;
          const { error: insertSessionErr } = await supabase
            .from('chat_sessions')
            .insert([{ id: sessionId, title }]);
          
          if (!insertSessionErr) {
            sessionOk = true;
          } else {
            console.warn('Supabase session insert error:', insertSessionErr);
            forceLocalDb = true;
          }
        }

        if (sessionOk && !forceLocalDb) {
          const { error: msgErr } = await supabase
            .from('chat_messages')
            .insert([
              { session_id: sessionId, role: 'user', content: userMessage, citations: [] },
              { session_id: sessionId, role: 'assistant', content: assistantMessage, citations }
            ]);
          
          if (!msgErr) {
            savedToSupabase = true;
            console.log(`Saved messages to Supabase for session ${sessionId}`);
          } else {
            console.warn('Supabase message insert error:', msgErr);
            forceLocalDb = true;
          }
        }
      }
    } catch (e) {
      console.warn('Supabase saveChat failed, falling back to local DB:', e);
      forceLocalDb = true;
    }

    if (!savedToSupabase) {
      const sessions = localDb.getSessions();
      if (!sessions.some(s => s.id === sessionId)) {
        const title = userMessage.length > 20 ? `${userMessage.substring(0, 20)}...` : userMessage;
        localDb.createSession(sessionId, title);
      }
      localDb.addMessage(sessionId, 'user', userMessage, []);
      localDb.addMessage(sessionId, 'assistant', assistantMessage, citations);
      console.log(`Saved messages locally for session ${sessionId}`);
    }
  }
};
