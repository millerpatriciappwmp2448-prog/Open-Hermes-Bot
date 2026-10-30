import type { Bot, Thread, Message } from '../data';

type DemoView = { bots: Bot[]; threads: Thread[]; messages: Record<string, Message[]> };

/** Only unchanged bundled examples are translated, never edited text or live data. */
export function localizeDemo(view: DemoView, sample: DemoView, translate: (key: string) => string): DemoView {
  const bots = view.bots.map((bot) => {
    const original = sample.bots.find((item) => item.id === bot.id);
    if (!original) return bot;
    return {
      ...bot,
      name: bot.name === original.name ? translate(bot.name) : bot.name,
      role: bot.role === original.role ? translate(bot.role) : bot.role,
    };
  });
  const threads = view.threads.map((thread) => {
    const original = sample.threads.find((item) => item.id === thread.id);
    if (!original) return thread;
    return {
      ...thread,
      name: thread.name === original.name ? translate(thread.name) : thread.name,
      preview: thread.preview === original.preview ? translate(thread.preview) : thread.preview,
      time: thread.time === original.time ? translate(thread.time) : thread.time,
      subtitle: thread.subtitle === original.subtitle && thread.subtitle ? translate(thread.subtitle) : thread.subtitle,
    };
  });
  const messages = Object.fromEntries(Object.entries(view.messages).map(([thread, rows]) => [
    thread,
    rows.map((message) => {
      const original = sample.messages[thread]?.find((item) => item.id === message.id);
      return original && original.text === message.text ? { ...message, text: translate(message.text) } : message;
    }),
  ]));
  return { bots, threads, messages };
}
