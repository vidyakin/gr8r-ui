import { z } from 'zod';
import { defineNode } from '../types';

const params = z.object({
  chatId: z.string().min(1).max(200).meta({ title: 'Chat ID', placeholder: '-1001234567890', description: 'Chat, group or channel ID (or @channelname). The bot must be added there.' }),
  text: z.string().min(1).max(4096).default('{{trigger.record.title}}').meta({ title: 'Message', ui: 'textarea' }),
  parseMode: z.enum(['none', 'HTML']).default('none').meta({ title: 'Format' }),
});

export default defineNode({
  type: 'action.telegram_send',
  category: 'action',
  label: 'Send to Telegram',
  description: 'Sends a message to a Telegram chat with the bot whose token is stored in Settings → Integrations (telegram.bot_token).',
  icon: 'send',
  params,
  execute: async (p, rt) => {
    const chatId = p.chatId.trim();
    if (!chatId) throw new Error('Chat ID is empty');
    if (!p.text.trim()) throw new Error('Message is empty');
    const r = await rt.telegramSend({ chatId, text: p.text, parseMode: p.parseMode === 'HTML' ? 'HTML' : undefined });
    return { output: { chatId, messageId: r.messageId } };
  },
});
