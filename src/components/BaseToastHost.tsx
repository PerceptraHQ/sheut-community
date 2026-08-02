import { Toast } from "@base-ui/react/toast";
import { useEffect } from "react";
import { type VaultToastData, vaultToastManager } from "./BaseToastManager";

interface BaseToastHostProps {
  onReady: () => void;
}

function ToastList() {
  const { toasts } = Toast.useToastManager<VaultToastData>();

  return toasts.map((toast) => (
    <Toast.Root className="vault-notice" key={toast.id} toast={toast} swipeDirection="right">
      <Toast.Content className="vault-notice-content">
        <div className="min-w-0 flex-1">
          <Toast.Title className="vault-notice-title" />
          <Toast.Description className="vault-notice-description" />
        </div>
        {toast.data?.actionLabel ? (
          <Toast.Action className="vault-notice-action" {...toast.actionProps}>
            {toast.data.actionLabel}
          </Toast.Action>
        ) : null}
        <Toast.Close className="vault-notice-close" aria-label="Dismiss notification">
          Dismiss
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ));
}

export function BaseToastHost({ onReady }: BaseToastHostProps) {
  useEffect(() => onReady(), [onReady]);

  return (
    <Toast.Provider limit={3} timeout={4500} toastManager={vaultToastManager}>
      <Toast.Portal>
        <Toast.Viewport className="vault-notice-viewport">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
