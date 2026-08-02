import { ContextMenu } from "@base-ui/react/context-menu";
import type { ReactElement } from "react";

export interface WorkspaceContextAction {
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

interface WorkspaceContextMenuProps {
  trigger: ReactElement;
  items: WorkspaceContextAction[];
}

export function WorkspaceContextMenu({ trigger, items }: WorkspaceContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={trigger} />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="document-context-positioner">
          <ContextMenu.Popup className="document-context-popup">
            {items.map((item) => (
              <ContextAction key={item.label} item={item} />
            ))}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function ContextAction({ item }: { item: WorkspaceContextAction }) {
  return (
    <>
      {item.separatorBefore ? (
        <ContextMenu.Separator className="document-context-separator" />
      ) : null}
      <ContextMenu.Item
        className="document-context-item"
        data-danger={item.danger || undefined}
        disabled={item.disabled}
        onClick={item.onSelect}
      >
        <span>{item.label}</span>
        {item.shortcut ? <span className="document-context-shortcut">{item.shortcut}</span> : null}
      </ContextMenu.Item>
    </>
  );
}
