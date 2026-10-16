import type { ComponentChild } from 'preact';
import changelog from '../../../../CHANGELOG.md?raw';

/** Inline markdown: **bold**, *italic*, `code`, <kbd>key</kbd> and [links](url). */
function inline(text: string): ComponentChild[] {
  const out: ComponentChild[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|<kbd>(.+?)<\/kbd>|\[(.+?)\]\((.+?)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<b>{inline(m[1])}</b>);
    else if (m[2] !== undefined) out.push(<i>{inline(m[2])}</i>);
    else if (m[3] !== undefined) out.push(<code>{m[3]}</code>);
    else if (m[4] !== undefined) out.push(<kbd>{m[4]}</kbd>);
    else
      out.push(
        <a href={m[6]} target="_blank" rel="noopener">
          {m[5]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The small markdown subset CHANGELOG.md uses: headings, bullet lists, tables and paragraphs. */
function renderMarkdown(md: string): ComponentChild[] {
  const blocks: ComponentChild[] = [];
  let list: string[] = [];
  let para: string[] = [];
  let table: string[][] = [];
  const cells = (line: string) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const flush = () => {
    if (list.length) blocks.push(<ul>{list.map((l) => <li>{inline(l)}</li>)}</ul>);
    if (para.length) blocks.push(<p>{inline(para.join(' '))}</p>);
    if (table.length) {
      const [head, ...body] = table;
      blocks.push(
        <table class="md-table">
          <thead>
            <tr>{head!.map((c) => <th>{inline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r) => (
              <tr>{r.map((c) => <td>{inline(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
    }
    list = [];
    para = [];
    table = [];
  };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (line.startsWith('|')) {
      if (!table.length) flush();
      if (!/^\|[\s|:-]+\|$/.test(line)) table.push(cells(line));
    } else if (h) {
      flush();
      // The file's own title is the dialog's title.
      if (h[1] === '##') blocks.push(<h2>{inline(h[2]!)}</h2>);
      else if (h[1] === '###') blocks.push(<h3>{inline(h[2]!)}</h3>);
    } else if (line.startsWith('- ')) {
      if (para.length) flush();
      list.push(line.slice(2));
    } else if (list.length && raw.startsWith('  ')) list[list.length - 1] += ` ${line}`;
    else para.push(line);
  }
  flush();
  return blocks;
}

/** "What's new": the rolling change notes from CHANGELOG.md. */
export function Changes({ onClose }: { onClose: () => void }) {
  return (
    <div class="codex-overlay" data-testid="changes" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="codex changes-dialog">
        <header class="codex-head">
          <h1>What's new</h1>
          <button class="close" onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </header>
        <div class="codex-body prose changes">{renderMarkdown(changelog)}</div>
      </div>
    </div>
  );
}
