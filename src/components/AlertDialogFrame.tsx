import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { ReactNode } from "react";

type ModalFrameWidth = "compact" | "standard";

const backdropClassName =
  "fixed inset-0 z-20 bg-black/65 transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0";
const viewportClassName =
  "fixed inset-0 z-30 grid min-h-full place-items-center overflow-y-auto p-4";
const popupClassName =
  "w-full rounded-md border border-panel-border bg-panel-raised shadow-2xl ring-1 ring-white/5 transition duration-100 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0";

interface AlertDialogFrameProps {
  children: ReactNode;
  width?: ModalFrameWidth;
}

export function AlertDialogFrame({ children, width = "standard" }: AlertDialogFrameProps) {
  const widthClassName = width === "compact" ? "max-w-[24rem]" : "max-w-[26rem]";
  return (
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className={backdropClassName} />
      <AlertDialog.Viewport className={viewportClassName}>
        <AlertDialog.Popup className={`${popupClassName} ${widthClassName}`}>
          {children}
        </AlertDialog.Popup>
      </AlertDialog.Viewport>
    </AlertDialog.Portal>
  );
}
