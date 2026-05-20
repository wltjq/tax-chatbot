import React from 'react';
import { Plus, MessageSquare, Trash2, Loader2, Landmark } from 'lucide-react';
import { ChatSession } from '@/types/chat';

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  isLoading: boolean;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
}

export default function Sidebar({
  sessions,
  activeSessionId,
  isLoading,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
}: SidebarProps) {
  return (
    <aside className="w-full md:w-[25%] bg-slate-900 text-slate-100 flex flex-col border-r border-slate-800 h-screen md:h-auto select-none">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800 flex items-center space-x-3">
        <div className="p-2 bg-gradient-to-tr from-amber-500 to-yellow-400 rounded-lg shadow-md">
          <Landmark className="h-5 w-5 text-slate-900" />
        </div>
        <div>
          <h1 className="font-bold text-sm bg-gradient-to-r from-amber-400 via-amber-200 to-yellow-400 bg-clip-text text-transparent">
            소득세법 세무 RAG
          </h1>
          <p className="text-[10px] text-slate-400">AI Tax Assistant</p>
        </div>
      </div>

      {/* Action Button */}
      <div className="p-4">
        <button
          onClick={onCreateSession}
          className="w-full flex items-center justify-center space-x-2 py-3 px-4 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 active:scale-[0.98] text-slate-950 font-semibold rounded-xl transition-all shadow-lg hover:shadow-amber-500/10 cursor-pointer"
        >
          <Plus className="h-4 w-4 stroke-[3px]" />
          <span className="text-sm">새 대화 시작</span>
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto px-3 space-y-1.5 pb-4 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
        <div className="px-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
          대화 이력
        </div>
        
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-8 space-y-2 text-slate-400 text-xs">
            <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
            <span>불러오는 중...</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-xs px-4">
            이전 대화가 없습니다.<br />새 대화를 시작해보세요.
          </div>
        ) : (
          sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                  isActive
                    ? 'bg-slate-800 text-amber-400 border border-slate-700/50 shadow-inner'
                    : 'text-slate-300 hover:bg-slate-800/50 hover:text-slate-100'
                }`}
              >
                <div className="flex items-center space-x-3 overflow-hidden flex-1">
                  <MessageSquare className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-amber-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                  <span className="text-xs truncate font-medium">{session.title}</span>
                </div>
                <button
                  onClick={(e) => onDeleteSession(session.id, e)}
                  className="p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-slate-700/50 opacity-0 group-hover:opacity-100 transition-opacity ml-2 focus:opacity-100 cursor-pointer"
                  title="대화 삭제"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
