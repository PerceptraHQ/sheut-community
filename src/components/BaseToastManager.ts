import { Toast } from "@base-ui/react/toast";

export interface VaultToastData {
  actionLabel?: string;
}

export const vaultToastManager = Toast.createToastManager<VaultToastData>();
