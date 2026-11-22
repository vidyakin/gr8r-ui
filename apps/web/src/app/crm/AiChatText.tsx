/* Безопасный рендер Markdown в сообщениях ИИ-чата (без dangerouslySetInnerHTML): абзацы, списки, **жирный**, [ссылки](url). */
import * as React from 'react';

const isSafeHref = (url: string): boolean =>
  (url.startsWith('/') && !url.startsWith('//')) || url.startsWith('https://') || url.startsWith('http://');

function renderInline(line: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let idx = 0;
  for (const m of line.matchAll(pattern)) {
    const start = m.index ?? 0;
    if (start > last) nodes.push(line.slice(last, start));
    if (m[1]) {
      nodes.push(<strong key={`${keyPrefix}-b${idx++}`}>{m[1]}</strong>);
    } else if (m[2] && m[3] && isSafeHref(m[3])) {
      nodes.push(
        <a
          key={`${keyPrefix}-a${idx++}`}
          href={m[3]}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 2 }}
        >
          {m[2]}
        </a>,
      );
    } else {
      nodes.push(m[0]);
    }
    last = start + m[0].length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

export function AiChatText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div style={{ fontSize: 13, lineHeight: 1.5, wordBreak: 'break-word' }}>
      {blocks.map((block, bIdx) => {
        const lines = block.split('\n');
        const isList = lines.every(l => /^\s*[-*•]\s+/.test(l));
        if (isList) {
          return (
            <ul key={bIdx} style={{ margin: bIdx > 0 ? '6px 0 0' : 0, paddingLeft: 18 }}>
              {lines.map((l, lIdx) => (
                <li key={lIdx}>{renderInline(l.replace(/^\s*[-*•]\s+/, ''), `${bIdx}-${lIdx}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bIdx} style={{ margin: bIdx > 0 ? '6px 0 0' : 0 }}>
            {lines.map((line, lIdx) => (
              <React.Fragment key={lIdx}>
                {lIdx > 0 && <br />}
                {renderInline(line, `${bIdx}-${lIdx}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
