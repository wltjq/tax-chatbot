import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Scale, AlertCircle } from 'lucide-react';
import { ChatMessage } from '@/types/chat';
import ChatMessageItem from './ChatMessageItem';

interface ChatAreaProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  onSendMessage: (text: string) => void;
}

const QUICK_CHIPS = [
  "근로소득공제 계산법",
  "연말정산 공제 항목",
  "종합소득세 신고 방법",
  "세율 구간 확인"
];

export default function ChatArea({ messages, isGenerating, onSendMessage }: ChatAreaProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isGenerating) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleChipClick = (chipText: string) => {
    if (isGenerating) return;
    onSendMessage(chipText);
  };

  return (
    <div className="flex-1 flex flex-col h-screen bg-slate-50 relative overflow-hidden">
      {/* Top Header */}
      <header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center justify-between px-6 z-10 select-none">
        <div className="flex items-center space-x-2">
          <Scale className="h-5 w-5 text-amber-500" />
          <span className="font-bold text-slate-800 text-sm">세무 지식 데이터베이스 기반 답변</span>
        </div>
        <div className="text-xs text-slate-400 font-medium">소득세법 제21548호</div>
      </header>

      {/* Messages Scroll Feed */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 ? (
          // Welcome Screen
          <div className="h-full flex flex-col items-center justify-center max-w-xl mx-auto text-center space-y-8 select-none">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-400 flex items-center justify-center shadow-lg shadow-amber-500/10">
              <Sparkles className="h-8 w-8 text-slate-900 animate-pulse" />
            </div>
            
            <div className="space-y-3">
              <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">
                안녕하세요! AI 세무 챗봇입니다.
              </h2>
              <p className="text-sm text-slate-500 leading-relaxed">
                소득세법 법률에 근거한 RAG 기반 세무 상담 및 소득세 자동 계산을 지원합니다. 질문이나 계산을 입력해보세요.
              </p>
            </div>

            {/* Quick Start recommendation chips */}
            <div className="w-full space-y-3 pt-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                빠른 시작 추천 항목
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK_CHIPS.map((chip, index) => (
                  <button
                    key={index}
                    onClick={() => handleChipClick(chip)}
                    className="py-2.5 px-4 bg-white hover:bg-slate-100 hover:text-slate-900 text-slate-700 text-xs font-semibold border border-slate-200/80 rounded-xl transition-all shadow-sm active:scale-[0.98] cursor-pointer"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          // Message List
          <div className="max-w-4xl mx-auto space-y-4 pb-12">
            {messages.map((msg) => (
              <ChatMessageItem key={msg.id} message={msg} />
            ))}

            {/* Typing Indicator */}
            {isGenerating && (
              <div className="flex items-start space-x-3 mt-4 mr-auto justify-start max-w-[85%]">
                <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-400 flex items-center justify-center shadow-md shadow-amber-500/10">
                  <Sparkles className="h-5 w-5 text-slate-900" />
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center space-x-1.5 p-4 rounded-2xl bg-white border border-slate-100 shadow-sm max-w-[100px] rounded-tl-none">
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce"></div>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area & Footer */}
      <div className="bg-gradient-to-t from-slate-50 via-slate-50 to-transparent p-6 z-10">
        <div className="max-w-4xl mx-auto">
          {/* Main Input Form */}
          <form onSubmit={handleSubmit} className="flex items-center bg-white rounded-2xl border border-slate-200 shadow-md p-1.5 focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-400/20 transition-all">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="예시: '연봉 5000만원 근로소득공제 얼마야?' 또는 세무 관련 질문 입력..."
              disabled={isGenerating}
              className="flex-1 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none bg-transparent"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isGenerating}
              className="p-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 text-slate-100 disabled:text-slate-400 rounded-xl transition-all cursor-pointer flex-shrink-0"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>

          {/* Legal Disclaimer */}
          <div className="mt-3 flex items-center justify-center space-x-1.5 text-[11px] text-slate-400 select-none">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
            <p className="text-center font-medium">
              본 상담 결과는 참고용이며 실제 법적 효력은 세무사와 상담하시기 바랍니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
