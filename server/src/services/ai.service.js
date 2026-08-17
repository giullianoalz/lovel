import Anthropic from '@anthropic-ai/sdk';

/*
 * AI provider for the Chat Hub assistant and the lesson-plan summaries.
 * Three backends, chosen with AI_PROVIDER:
 *   AI_PROVIDER=gemini  → Google Gemini API (free tier; needs GEMINI_API_KEY)
 *   AI_PROVIDER=ollama  → local Ollama server (free, but only while that PC is on)
 *   AI_PROVIDER=claude  → Anthropic API (needs ANTHROPIC_API_KEY)
 *
 * Ollama runs on localhost, so it cannot serve the deployed API — on Render there
 * is no Ollama at localhost:11434 and every call fails through to the plain-text
 * fallback. Gemini is the hosted, free option for production.
 *
 * Ollama config:
 *   OLLAMA_URL    (default http://localhost:11434)
 *   OLLAMA_MODEL  (default llama3.1:8b)
 * Gemini config:
 *   GEMINI_MODEL  (default gemini-3.5-flash-lite)
 *
 * Deliberately on a "-lite" model, not the flagship "-flash": the flagship
 * (gemini-3.6-flash, when this was written) reasons before answering, and on
 * this short-answer prompt that meant 5-60s replies and needing a 2000-token
 * ceiling just to out-spend its own thinking budget. Free-tier quota is also
 * per model, so a lite model leaves the flagship's daily allowance untouched
 * for anything else that might use it. Verified against real lesson plans
 * before landing: 4/4 clean, under 2s each, no ceiling needed.
 */

const PROVIDER = (process.env.AI_PROVIDER || 'claude').toLowerCase();
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

// Same placeholder guard as the Anthropic key: a .env still holding "your_key_here"
// must read as "not configured" rather than being sent to Google as a real key.
const geminiKey = process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('your_')
  ? process.env.GEMINI_API_KEY
  : null;

const anthropicKey = process.env.ANTHROPIC_API_KEY;
const anthropic = anthropicKey && !anthropicKey.includes('your_') ? new Anthropic({ apiKey: anthropicKey }) : null;

export const isAssistantEnabled = () => {
  if (PROVIDER === 'ollama') return true;
  if (PROVIDER === 'gemini') return !!geminiKey;
  return !!anthropic;
};
export const activeProvider = () => PROVIDER;

const SYSTEM_PROMPT = `You are the "Academy Assistant" for Love Learning (also known as Love Camp), a tutoring and academic-reinforcement center in Florida. It is NOT a traditional school. It offers: one-on-one and group classes in various subjects, reinforcement for students from other schools, support and guidance for homeschool families, virtual classes, IXL memberships, and "learning coves" (half-day group blocks organized by day type: Maker Studio, Life Skills Lab, Theme Day, etc.).

Your job is to help parents, students, and teachers with general questions:
- Schedules, classes, and how the coves work.
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
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    system,
    messages,
  });
  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock ? textBlock.text : "Sorry, I couldn't generate a response.";
};

const replyWithOllama = async (messages, system, options) => {
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
        ...(options ? { options } : {}),
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

/*
 * Gemini's REST shape differs from the other two in three ways that matter:
 *  - the system prompt is its own `systemInstruction` field, not a message;
 *  - the assistant role is called "model", not "assistant";
 *  - message text lives in `parts[]`, not `content`.
 */
const replyWithGemini = async (messages, system, generationConfig) => {
  if (!geminiKey) return '';

  // Two minutes, matching Ollama. Gemini 3.x thinks before it writes and that
  // latency swings hard on the same prompt — measured 3s to over 60s. Nothing
  // waits on this call (summaries are drafted in the background, and the chat
  // reply arrives over Socket.IO), so a slow answer beats a dropped one.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          ...(generationConfig ? { generationConfig } : {}),
        }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      // Surface Google's own message — a bad key and a hit rate limit are very
      // different problems and the status alone doesn't tell them apart.
      const detail = await res.text().catch(() => '');
      throw new Error(`Gemini HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    const data = await res.json();
    const candidate = data?.candidates?.[0];
    // Running out of budget mid-sentence is worse than producing nothing: the
    // caller would happily publish "Students will explore tectonic plates using".
    // Report it as empty so the caller falls back to the teacher's own words.
    if (candidate?.finishReason === 'MAX_TOKENS') {
      console.error('[ai] Gemini hit maxOutputTokens; discarding truncated text.');
      return '';
    }
    const parts = candidate?.content?.parts || [];
    return parts.map(p => p.text || '').join('').trim();
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
  if (PROVIDER === 'ollama') return replyWithOllama(messages, system);
  if (PROVIDER === 'gemini') {
    const text = await replyWithGemini(messages, system);
    return text || 'The AI assistant is not configured yet. Please contact the Love Learning team for help.';
  }
  return replyWithClaude(messages, system);
};

const LESSON_SUMMARY_SYSTEM = `You write short class previews for the families of Love Learning, a tutoring and academic-reinforcement center in Florida.

You are given a teacher's internal lesson plan. Rewrite it as a preview that parents and students will read in their portal before the class happens.

Rules:
- 2-3 sentences, maximum 60 words. Plain, warm, everyday language.
- Write about what the class WILL do, in the future tense.
- Open with the activity itself. Never start with filler like "In the future class", "In this upcoming lesson", or "In this week's class".
- The child attends the class; the family only reads this. Refer to the students as "your child" or "students", and never imply the reader takes part ("you'll discover", "together we will").
- The lesson plan is written in the teacher's own voice ("we will review..."). Never carry that voice into the summary — "we" and "you" must not appear at all.
- Only use what the lesson plan actually says. Never invent activities, dates, or outcomes.
- Never mention the lesson plan, the teacher's name, or that this was written by an assistant.
- Leave out anything internal: safety notes, differentiation strategies, supply/shopping lists, staffing.
- Output only the summary text. No preamble, no title, no quotes, no markdown.`;

// What families see when the assistant is unavailable or errors. Deliberately
// plain: it is better to show the teacher's own words than to publish nothing.
export const fallbackLessonPlanSummary = (lessonPlan) => {
  const lines = [`This week's activity: ${lessonPlan.mainActivity}`];
  if (lessonPlan.materials) lines.push(`Materials: ${lessonPlan.materials}`);
  if (lessonPlan.skillConnection) lines.push(`Skill connection: ${lessonPlan.skillConnection}`);
  return lines.join('\n\n');
};

// Teachers write plans in their own voice ("we will review..."), and the model
// reliably drags that into the summary as "together, you'll discover...", which
// tells a parent they are attending a class they are not. Prompt wording alone
// did not stop it, so the output is checked here and the offender is never
// returned.
//
// Only second person and first-person-plural *subjects* are rejected. "our"
// is allowed on purpose: "how this changed our oceans" is ordinary English and
// claims nothing about who attends, and blocking it sent five drafts in six to
// the fallback for no benefit.
const violatesFamilyVoice = (text) => /\b(we|we'll|we're|us|you|you'll|you're|your)\b/i.test(
  // "your child" is the wording the prompt asks for, so it must not self-trip.
  String(text || '').replace(/\byour child(ren)?\b/gi, '')
);

const draftSummary = async (content) => {
  const messages = [{ role: 'user', content }];
  if (PROVIDER === 'ollama') {
    return (await replyWithOllama(messages, LESSON_SUMMARY_SYSTEM))?.trim() || '';
  }
  if (PROVIDER === 'gemini') {
    // A cap, not a target — costs nothing when the answer finishes well under
    // it, which the lite model does (verified: ~35 words, under 2s). Kept
    // generous anyway: the flagship "-flash" models in this family reason
    // before writing and bill that against the same ceiling, so a low number
    // here silently truncates the reply if GEMINI_MODEL is ever pointed at one.
    return await replyWithGemini(messages, LESSON_SUMMARY_SYSTEM, { maxOutputTokens: 2000 });
  }
  if (!anthropic) return '';
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 300,
    system: LESSON_SUMMARY_SYSTEM,
    messages,
  });
  return response.content.find(b => b.type === 'text')?.text?.trim() || '';
};

/**
 * Draft the family-facing preview for a lesson plan. Never throws — on any
 * failure it returns the plain-text fallback, because a teacher submitting a
 * lesson plan must not be blocked by the assistant being down or unconfigured.
 *
 * @param {{ mainActivity: string, materials?: string|null, skillConnection?: string|null, type?: string, class?: { name?: string }|null }} lessonPlan
 * @returns {Promise<string>}
 */
export const generateLessonPlanSummary = async (lessonPlan) => {
  const details = [
    lessonPlan.class?.name ? `Class: ${lessonPlan.class.name}` : null,
    `Main activity: ${lessonPlan.mainActivity}`,
    lessonPlan.materials ? `Materials: ${lessonPlan.materials}` : null,
    lessonPlan.skillConnection ? `Skill connection: ${lessonPlan.skillConnection}` : null,
  ].filter(Boolean).join('\n');

  try {
    let text = await draftSummary(details);
    if (violatesFamilyVoice(text)) {
      // One corrective retry. Lowering temperature was tried and made this
      // worse, not better: the offending sentence is the model's single most
      // likely continuation when the teacher's plan says "we will...", so
      // less sampling locked it in. Naming the mistake works; sampling again
      // is what gives it a different path to take.
      text = await draftSummary(`${details}\n\nYour previous attempt wrongly addressed the reader as a participant. Rewrite it without the words "we" or "you".`);
      if (violatesFamilyVoice(text)) return fallbackLessonPlanSummary(lessonPlan);
    }
    return text?.trim() || fallbackLessonPlanSummary(lessonPlan);
  } catch (error) {
    console.error('[ai] Lesson plan summary failed, using fallback:', error.message);
    return fallbackLessonPlanSummary(lessonPlan);
  }
};
