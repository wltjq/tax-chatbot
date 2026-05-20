import React, { useState } from 'react';
import { User, Sparkles, ChevronDown, ChevronUp, AlertCircle, FileText } from 'lucide-react';
import { ChatMessage, Citation } from '@/types/chat';

interface ChatMessageItemProps {
  message: ChatMessage;
}

export default function ChatMessageItem({ message }: ChatMessageItemProps) {
  const isUser = message.role === 'user';
  
  return (
    <div className={`flex w-full mt-4 space-x-3 max-w-4xl ${isUser ? 'ml-auto justify-end' : 'mr-auto justify-start'}`}>
      {/* Avatar Icon */}
      {!isUser && (
        <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-400 flex items-center justify-center shadow-md shadow-amber-500/10">
          <Sparkles className="h-5 w-5 text-slate-900" />
        </div>
      )}

      {/* Message Box */}
      <div className={`flex flex-col max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`p-4 rounded-2xl shadow-sm border ${
            isUser
              ? 'bg-slate-800 border-slate-700 text-slate-100 rounded-tr-none'
              : 'bg-white border-slate-100 text-slate-800 rounded-tl-none'
          }`}
        >
          {/* Content Text */}
          <div className="text-sm whitespace-pre-line leading-relaxed">
            {message.content.replace(/\\n/g, '\n')}
          </div>
        </div>

        {/* Citations block (only for assistant messages and if citations are present) */}
        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="mt-3 w-full space-y-2">
            <div className="text-[11px] font-bold text-slate-400 flex items-center space-x-1.5 px-1 uppercase tracking-wider">
              <FileText className="h-3 w-3 text-amber-500" />
              <span>소득세법 법령 근거</span>
            </div>
            
            <div className="grid grid-cols-1 gap-2">
              {message.citations.map((citation, index) => (
                <CitationCard key={index} citation={citation} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* User Avatar */}
      {isUser && (
        <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-slate-200 border border-slate-300 flex items-center justify-center">
          <User className="h-5 w-5 text-slate-600" />
        </div>
      )}
    </div>
  );
}

// Collapsible Citation Card Component
function CitationCard({ citation }: { citation: Citation }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border border-amber-200 rounded-xl bg-amber-50/70 overflow-hidden transition-all shadow-sm">
      {/* Header (Accordion trigger) */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full text-left p-3.5 flex items-center justify-between hover:bg-amber-100/40 transition-colors cursor-pointer select-none"
      >
        <span className="text-xs font-semibold text-amber-900 flex items-center space-x-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
          <span>{citation.article}</span>
        </span>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-amber-700 stroke-[2.5px]" />
        ) : (
          <ChevronDown className="h-4 w-4 text-amber-700 stroke-[2.5px]" />
        )}
      </button>

      {/* Content (Accordion body) */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 border-t border-amber-200/50 bg-amber-50/40">
          <div className="text-[12px] text-amber-950 leading-relaxed whitespace-pre-wrap font-mono font-medium">
            {citation.content.replace(/\\n/g, '\n')}
          </div>
        </div>
      )}
    </div>
  );
}
