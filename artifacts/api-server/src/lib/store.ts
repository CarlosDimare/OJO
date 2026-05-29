interface Conversation {
  id: number;
  title: string;
  sessionId: string | null;
  charlaMode: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface Message {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  createdAt: Date;
}

let nextConvId = 1;
let nextMsgId = 1;
const conversations: Conversation[] = [];
const messages: Message[] = [];

export const store = {
  createConversation(title: string, sessionId: string | null, charlaMode: boolean): Conversation {
    const conv: Conversation = {
      id: nextConvId++,
      title,
      sessionId,
      charlaMode,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    conversations.push(conv);
    return conv;
  },

  updateConversation(id: number, updates: Partial<Pick<Conversation, "title" | "sessionId" | "charlaMode" | "updatedAt">>): void {
    const conv = conversations.find((c) => c.id === id);
    if (conv) Object.assign(conv, updates);
  },

  getConversation(id: number): Conversation | undefined {
    return conversations.find((c) => c.id === id);
  },

  listConversations(limit = 50): (Conversation & { preview: string })[] {
    return conversations
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit)
      .map((c) => ({
        ...c,
        preview: messages.filter((m) => m.conversationId === c.id).pop()?.content?.slice(0, 100) || "",
      }));
  },

  deleteConversation(id: number): void {
    const idx = conversations.findIndex((c) => c.id === id);
    if (idx !== -1) conversations.splice(idx, 1);
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].conversationId === id) messages.splice(i, 1);
    }
  },

  createMessage(conversationId: number, role: string, content: string): Message {
    const msg: Message = {
      id: nextMsgId++,
      conversationId,
      role,
      content,
      createdAt: new Date(),
    };
    messages.push(msg);
    return msg;
  },

  getMessages(conversationId: number): Message[] {
    return messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.id - b.id);
  },
};
