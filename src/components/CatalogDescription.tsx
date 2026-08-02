import { Collapsible } from "@base-ui/react/collapsible";
import { IconChevronRight } from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";

const richToken =
  /\[([^\]\r\n]{1,200})\]\(([^\s)]+)\)|<code>([^<\r\n]{1,1000})<\/code>|`([^`\r\n]{1,1000})`/giu;

function approvedMitreUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const mitreHost = url.hostname === "mitre.org" || url.hostname.endsWith(".mitre.org");
    if (url.protocol !== "https:" || !mitreHost || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function renderDescription(description: string) {
  const content: ReactNode[] = [];
  let cursor = 0;
  for (const match of description.matchAll(richToken)) {
    const index = match.index;
    if (index > cursor) content.push(description.slice(cursor, index));
    const label = match[1];
    const href = match[2] ? approvedMitreUrl(match[2]) : null;
    const code = match[3] ?? match[4];
    if (label && href) {
      content.push(
        <a
          className="select-none text-accent-hover underline decoration-accent/60 underline-offset-2 hover:text-[#87c2fd]"
          href={href}
          key={`${index}-${href}`}
          rel="noreferrer"
          onClick={(event) => {
            event.preventDefault();
            void openUrl(href).catch(() => undefined);
          }}
        >
          {label}
        </a>,
      );
    } else if (code) {
      content.push(
        <code
          className="rounded-sm border border-panel-border bg-panel-deep px-1 py-0.5 font-mono text-[11px] text-copy-secondary"
          key={`${index}-code`}
        >
          {code}
        </code>,
      );
    } else {
      content.push(match[0]);
    }
    cursor = index + match[0].length;
  }
  if (cursor < description.length) content.push(description.slice(cursor));
  return content;
}

export function CatalogDescription({ description }: { description: string }) {
  return (
    <Collapsible.Root className="rounded-sm border border-panel-border bg-panel-deep">
      <Collapsible.Trigger className="group flex w-full cursor-pointer select-none items-center gap-1.5 border-0 bg-transparent px-2 py-1.5 text-left text-[11px] font-medium text-copy-secondary hover:bg-panel-hover hover:text-copy-primary">
        <IconChevronRight
          className="shrink-0 transition-transform group-data-panel-open:rotate-90"
          size={12}
          stroke={1.8}
          aria-hidden="true"
        />
        Technique description
      </Collapsible.Trigger>
      <Collapsible.Panel className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-150 data-ending-style:h-0 data-starting-style:h-0">
        <p className="m-0 select-none whitespace-pre-wrap border-panel-border border-t px-2 py-2 text-xs text-copy-muted leading-5">
          {renderDescription(description)}
        </p>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
