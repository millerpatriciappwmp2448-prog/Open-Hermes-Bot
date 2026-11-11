'use strict';

// Codex read_thread returns turns newest first; items inside a turn are in
// chronological order. The phone only needs what the model wrote, so tool
// calls, command output, file changes and reasoning are deliberately skipped.
const MAX_MESSAGES = 8;
const MAX_CHARS = 4000;

function extractMessages(thread, { limit = MAX_MESSAGES, maxChars = MAX_CHARS } = {}) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const newestFirst = thread?.page?.order !== 'oldest_first';
  const ordered = newestFirst ? [...turns].reverse() : turns;
  const messages = [];
  for (const turn of ordered) {
    if (!turn || !Array.isArray(turn.items)) continue;
    for (const item of turn.items) {
      if (!item || item.type !== 'agentMessage' || typeof item.text !== 'string') continue;
      const text = item.text.trim();
      if (!text) continue;
      messages.push({
        role: 'assistant',
        phase: item.phase === 'final_answer' ? 'final' : 'progress',
        content: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text,
      });
    }
  }
  return messages.slice(-limit);
}

function projectName(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return '';
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

module.exports = { extractMessages, projectName, MAX_MESSAGES };
