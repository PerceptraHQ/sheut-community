import { ScrollArea } from "@base-ui/react/scroll-area";
import type { ReactNode } from "react";

interface ScrollAreaFrameProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  horizontal?: boolean;
  vertical?: boolean;
}

export function ScrollAreaFrame({
  children,
  className = "",
  contentClassName = "",
  horizontal = false,
  vertical = true,
}: ScrollAreaFrameProps) {
  return (
    <ScrollArea.Root className={`sheut-scroll-area ${className}`}>
      <ScrollArea.Viewport
        className="sheut-scroll-viewport"
        style={{
          overflowX: horizontal ? "scroll" : "hidden",
          overflowY: vertical ? "scroll" : "hidden",
          overscrollBehaviorX: horizontal ? "contain" : "auto",
          overscrollBehaviorY: vertical ? "contain" : "auto",
        }}
      >
        <ScrollArea.Content className={contentClassName}>{children}</ScrollArea.Content>
      </ScrollArea.Viewport>
      {vertical ? (
        <ScrollArea.Scrollbar className="sheut-scrollbar" orientation="vertical">
          <ScrollArea.Thumb className="sheut-scroll-thumb" />
        </ScrollArea.Scrollbar>
      ) : null}
      {horizontal ? (
        <ScrollArea.Scrollbar className="sheut-scrollbar" orientation="horizontal">
          <ScrollArea.Thumb className="sheut-scroll-thumb" />
        </ScrollArea.Scrollbar>
      ) : null}
      {vertical && horizontal ? <ScrollArea.Corner className="sheut-scroll-corner" /> : null}
    </ScrollArea.Root>
  );
}
