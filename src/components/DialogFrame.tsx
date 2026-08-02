import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

type ModalFrameWidth = "command" | "compact" | "publication" | "standard" | "wide";

const backdropClassName =
  "fixed inset-0 z-20 bg-black/65 transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0";
const viewportClassName =
  "fixed inset-0 z-30 grid min-h-full place-items-center overflow-y-auto p-4";
const popupClassName =
  "w-full rounded-md border border-panel-border bg-panel-raised shadow-2xl ring-1 ring-white/5 transition duration-100 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0";

interface DialogFrameProps {
  children: ReactNode;
  width?: ModalFrameWidth;
}

export function DialogFrame({ children, width = "standard" }: DialogFrameProps) {
  const widthClassName = {
    command: "max-w-[38rem]",
    compact: "max-w-[24rem]",
    publication: "max-w-[48rem]",
    standard: "max-w-[26rem]",
    wide: "max-w-[56rem]",
  }[width];
  return (
    <Dialog.Portal>
      <Dialog.Backdrop className={backdropClassName} />
      <Dialog.Viewport className={viewportClassName}>
        <Dialog.Popup className={`${popupClassName} ${widthClassName}`}>{children}</Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  );
}
