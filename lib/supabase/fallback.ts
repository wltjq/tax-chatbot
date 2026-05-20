import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'db.json');

interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: any;
  created_at: string;
}

interface DB {
  sessions: ChatSession[];
  messages: ChatMessage[];
}

function readDb(): DB {
  try {
    // Ensure the data directory exists
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    if (!fs.existsSync(DB_PATH)) {
      return { sessions: [], messages: [] };
    }
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return { sessions: [], messages: [] };
  }
}

function writeDb(db: DB) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write local database:', e);
  }
}

export const localDb = {
  getSessions: (): ChatSession[] => {
    const db = readDb();
    return db.sessions.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  },
  
  createSession: (id: string, title: string): ChatSession => {
    const db = readDb();
    const now = new Date().toISOString();
    const newSession: ChatSession = { id, title, created_at: now, updated_at: now };
    db.sessions.push(newSession);
    writeDb(db);
    return newSession;
  },
  
  deleteSession: (id: string): void => {
    const db = readDb();
    db.sessions = db.sessions.filter(s => s.id !== id);
    db.messages = db.messages.filter(m => m.session_id !== id);
    writeDb(db);
  },
  
  getMessages: (sessionId: string): ChatMessage[] => {
    const db = readDb();
    return db.messages
      .filter(m => m.session_id === sessionId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  },
  
  addMessage: (sessionId: string, role: 'user' | 'assistant', content: string, citations: any): ChatMessage => {
    const db = readDb();
    const now = new Date().toISOString();
    const newMessage: ChatMessage = {
      id: Math.random().toString(36).substring(2),
      session_id: sessionId,
      role,
      content,
      citations,
      created_at: now
    };
    db.messages.push(newMessage);
    
    // Update session updated_at
    const session = db.sessions.find(s => s.id === sessionId);
    if (session) {
      session.updated_at = now;
    }
    
    writeDb(db);
    return newMessage;
  }
};
