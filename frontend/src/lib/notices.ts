// THE THIRD-PARTY NOTICES, read from THIRD_PARTY_NOTICES.md (Go embeds it; tools/notices
// writes it). Only that file's own shape is understood: a "# " title, intro paragraphs,
// then a "## " section per licence, each holding one or more blocks of "- [name](url) rest"
// lines followed by the fenced licence text they share.

export type NoticeComponent = { name: string; url: string; detail: string };
export type NoticeText = { components: NoticeComponent[]; text: string };
export type NoticeLicence = { id: string; texts: NoticeText[] };
export type Notices = { intro: string[]; licences: NoticeLicence[] };

const ITEM = /^- \[([^\]]+)\]\(([^)]+)\)\s*(.*)$/;

export function parseNotices(md: string): Notices {
  const out: Notices = { intro: [], licences: [] };
  let para: string[] = [];
  let pending: NoticeComponent[] = [];
  let fence: string | null = null;
  let body: string[] = [];
  const flushPara = () => {
    if (para.length) out.intro.push(para.join(" ").replace(/`/g, ""));
    para = [];
  };
  for (const line of md.split("\n")) {
    const licence = out.licences[out.licences.length - 1];
    if (fence !== null) {
      if (line === fence) {
        licence?.texts.push({ components: pending, text: body.join("\n") });
        pending = [];
        body = [];
        fence = null;
      } else body.push(line);
      continue;
    }
    const open = line.match(/^(`{3,})\w*$/);
    if (open && licence) {
      fence = open[1];
      continue;
    }
    if (line.startsWith("## ")) {
      flushPara();
      out.licences.push({ id: line.slice(3).trim(), texts: [] });
      continue;
    }
    const item = line.match(ITEM);
    if (item && licence) {
      pending.push({ name: item[1], url: item[2], detail: item[3] });
      continue;
    }
    if (line.startsWith("# ") || licence) continue;
    if (line.trim() === "") flushPara();
    else para.push(line.trim());
  }
  flushPara();
  return out;
}
