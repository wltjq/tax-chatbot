export interface Citation {
  article: string;    // 예: "소득세법 제95조의2"
  content: string;    // 조문 원문 텍스트
  isExpanded?: boolean;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  createdAt: string | Date;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}
