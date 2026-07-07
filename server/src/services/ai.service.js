import Anthropic from '@anthropic-ai/sdk';

/*
 * AI provider for the Chat Hub assistant. Supports two backends via env:
 *   AI_PROVIDER=claude  → Anthropic API (needs ANTHROPIC_API_KEY)
 *   AI_PROVIDER=ollama  → local Ollama server (free, runs on your own PC)
 *
 * Ollama config:
 *   OLLAMA_URL    (default http://localhost:11434)
 *   OLLAMA_MODEL  (default llama3.1:8b)
 */

const PROVIDER = (process.env.AI_PROVIDER || 'claude').toLowerCase();
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

const anthropicKey = process.env.ANTHROPIC_API_KEY;
const anthropic = anthropicKey && !anthropicKey.includes('your_') ? new Anthropic({ apiKey: anthropicKey }) : null;

export const isAssistantEnabled = () => (PROVIDER === 'ollama' ? true : !!anthropic);
export const activeProvider = () => PROVIDER;

const SYSTEM_PROMPT = `You are the "Academy Assistant" for Love Learning (also known as Love Camp), a tutoring and academic-reinforcement center in Florida. It is NOT a traditional school. It offers: one-on-one and group classes in various subjects, reinforcement for students from other schools, support and guidance for homeschool families, virtual classes, IXL memberships, and "learning pods" (half-day group blocks organized by day type: Maker Studio, Life Skills Lab, Theme Day, etc.).

Your job is to help parents, students, and teachers with general questions:
- Schedules, classes, and how the pods work.
- Registration: there are registration windows (guaranteed spot for returning students, then switching, then public) and parents register from the Family Portal.
- Payment methods: most families use the EMA Step Up for Students scholarship; Zelle, Venmo, and PayPal are also accepted (no fee), and credit card (+4% fee).
- IXL: the center pays for the membership and encourages students to use it.

Rules:
- Reply in the SAME language the user writes in (default to English).
- Be warm, brief, and clear. Use bullet points when helpful.
- For account-specific details (exact balances, invoices, personal data), do NOT make up numbers: tell them to check the "Cuenta & Pagos" (Account & Payments) tab in the portal, or to contact the Love Learning team.
- If you don't know something, say so and suggest contacting the team. Never invent policies.`;

const buildSystem = (userContext) => {
  const roleLabel = { ADMIN: 'an administrator', TEACHER: 'a teacher', PARENT: 'a parent', STUDENT: 'a student' }[userContext.role] || 'a user';
  return `${SYSTEM_PROMPT}\n\nYou are talking with ${roleLabel}${userContext.name ? ` named ${userContext.name}` : ''}.`;
};

// Normalize history into [{role:'user'|'assistant', content}], starting with a user turn.
const normalize = (history) => {
  const msgs = history
    .filter(m => m.text && m.text.trim())
    .map(m => ({ role: m.role, content: m.text }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
};

const replyWithClaude = async (messages, system) => {
  if (!anthropic) return 'The AI assistant is not configured yet. Please contact the Love Learning team for help.';
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    system,
    messages,
  });
  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock ? textBlock.text : "Sorry, I couldn't generate a response.";
};

const replyWithOllama = async (messages, system) => {
  // Ollama may be slow on CPU — allow up to 2 minutes.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return data?.message?.content?.trim() || "Sorry, I couldn't generate a response.";
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Generate an assistant reply for a bot chat thread.
 * @param {Array<{role:'user'|'assistant', text:string}>} history - oldest first
 * @param {{ role?: string, name?: string }} userContext
 * @returns {Promise<string>}
 */
export const generateAssistantReply = async (history, userContext = {}) => {
  const messages = normalize(history);
  if (messages.length === 0) return 'Hi! How can I help you today?';
  const system = buildSystem(userContext);
  return PROVIDER === 'ollama'
    ? replyWithOllama(messages, system)
    : replyWithClaude(messages, system);
};
