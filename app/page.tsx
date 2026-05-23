'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from '@/components/chat/Sidebar';
import ChatArea from '@/components/chat/ChatArea';
import { ChatMessage, ChatSession } from '@/types/chat';

// Browser-safe UUID helper fallback if crypto.randomUUID is not available
function generateUUID(): string {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function Home() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  // 1. Initial Load: Fetch Sessions & Set Up Active Session
  useEffect(() => {
    fetchSessions();
  }, []);

  // Fetch all sessions from the API
  const fetchSessions = async (targetActiveId: string | null = null, skipFetchMessages: boolean = false) => {
    setIsLoadingSessions(true);
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        const data: ChatSession[] = await res.json();
        setSessions(data);
        
        // Handle setting active session
        if (data.length > 0) {
          const nextActiveId = targetActiveId || data[0].id;
          setActiveSessionId(nextActiveId);
          if (!skipFetchMessages) {
            fetchMessages(nextActiveId);
          }
        } else {
          // No sessions exist yet, initialize a fresh one
          startNewSession();
        }
      } else {
        console.error('Failed to fetch sessions');
        startNewSession();
      }
    } catch (e) {
      console.error('Error fetching sessions:', e);
      startNewSession();
    } finally {
      setIsLoadingSessions(false);
    }
  };

  // Fetch message history for a specific session
  const fetchMessages = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/messages?sessionId=${sessionId}`);
      if (res.ok) {
        const data: ChatMessage[] = await res.json();
        setMessages(data);
      } else {
        console.error('Failed to fetch messages');
      }
    } catch (e) {
      console.error('Error fetching messages:', e);
    }
  };

  // Start a new empty session
  const startNewSession = () => {
    const newId = generateUUID();
    setActiveSessionId(newId);
    setMessages([]);
  };

  // Handle selecting a session from the sidebar
  const handleSelectSession = (id: string) => {
    if (isGenerating) return; // Prevent switching while generating response
    setActiveSessionId(id);
    fetchMessages(id);
  };

  // Handle clicking "New Chat" button
  const handleCreateSession = () => {
    if (isGenerating) return;
    startNewSession();
  };

  // Handle deleting a session
  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Stop click from selecting the session
    if (isGenerating) return;

    if (!confirm('이 대화 내용을 삭제하시겠습니까?')) return;

    try {
      const res = await fetch(`/api/sessions?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        // If we deleted the currently active session, we should select another one or start a new one
        if (activeSessionId === id) {
          const remainingSessions = sessions.filter(s => s.id !== id);
          if (remainingSessions.length > 0) {
            const nextActiveId = remainingSessions[0].id;
            setActiveSessionId(nextActiveId);
            setSessions(remainingSessions);
            fetchMessages(nextActiveId);
          } else {
            setSessions([]);
            startNewSession();
          }
        } else {
          // Just remove from list
          setSessions(sessions.filter(s => s.id !== id));
        }
      }
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  };

  // Handle sending a user message
  const handleSendMessage = async (text: string) => {
    if (!activeSessionId || isGenerating) return;

    const currentSessionId = activeSessionId;

    // 1. Construct temporary user message and append to state
    const userMsg: ChatMessage = {
      id: generateUUID(),
      sessionId: currentSessionId,
      role: 'user',
      content: text,
      citations: [],
      createdAt: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setIsGenerating(true);

    // Create a placeholder message for the assistant that we will update in real-time
    const assistantMsgId = generateUUID();
    const assistantPlaceholderMsg: ChatMessage = {
      id: assistantMsgId,
      sessionId: currentSessionId,
      role: 'assistant',
      content: '',
      citations: [],
      createdAt: new Date()
    };

    // Pre-append assistant placeholder
    setMessages(prev => [...prev, assistantPlaceholderMsg]);

    try {
      // Get conversation history to pass as context (excluding the new userMsg and placeholder)
      const chatHistory = messages.map(m => ({
        role: m.role,
        content: m.content,
        citations: m.citations
      }));

      // 2. Call the chat route API with stream: true
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: currentSessionId,
          history: chatHistory,
          stream: true
        })
      });

      if (!response.ok) {
        let errMsg = '상담 처리 중 오류가 발생했습니다.';
        try {
          const errorData = await response.json();
          errMsg = errorData.error || errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('스트림 리더를 초기화할 수 없습니다.');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';
      let citations: any[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split stream buffer by newline to parse JSON lines
        const lines = buffer.split('\n');
        // Keep the last partial line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed);
            if (data.type === 'content') {
              accumulatedText += data.delta;
              setMessages(prev =>
                prev.map(msg =>
                  msg.id === assistantMsgId
                    ? { ...msg, content: accumulatedText }
                    : msg
                )
              );
            } else if (data.type === 'citations') {
              citations = data.citations || [];
              setMessages(prev =>
                prev.map(msg =>
                  msg.id === assistantMsgId
                    ? { ...msg, citations }
                    : msg
                )
              );
            } else if (data.type === 'done') {
              if (data.citations) {
                citations = data.citations;
              }
              setMessages(prev =>
                prev.map(msg =>
                  msg.id === assistantMsgId
                    ? { ...msg, content: accumulatedText, citations }
                    : msg
                )
              );
            } else if (data.type === 'error') {
              throw new Error(data.message || '상담을 처리하지 못했습니다.');
            }
          } catch (e: any) {
            if (e.message && e.message.includes('JSON')) {
              // Ignore partial JSON parse errors
            } else {
              throw e;
            }
          }
        }
      }

      // 4. Reload sessions to update lists & titles (since a new session might have been saved in DB)
      fetchSessions(currentSessionId, true);

    } catch (error: any) {
      console.error('Send message error:', error);
      
      // Update assistant message with user-friendly error details
      const errorText = `오류: ${error.message || '상담을 처리하지 못했습니다. API 키 및 데이터베이스 환경 변수(.env.local) 설정을 확인해주세요.'}`;
      setMessages(prev =>
        prev.map(msg =>
          msg.id === assistantMsgId
            ? { ...msg, content: errorText, citations: [] }
            : msg
        )
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row h-screen w-screen overflow-hidden">
      {/* Sidebar - 25% width */}
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        isLoading={isLoadingSessions}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
      />
      
      {/* Chat Area - 75% width */}
      <ChatArea
        messages={messages}
        isGenerating={isGenerating}
        onSendMessage={handleSendMessage}
      />
    </div>
  );
}
