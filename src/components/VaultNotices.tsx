import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface VaultNoticeInput {
  title: string;
  description?: string;
  type?: "success" | "info";
  action?: {
    label: string;
    onClick: () => void | Promise<void>;
  };
  timeout?: number;
}

export interface VaultPromiseNoticeOptions<T> {
  loading: VaultNoticeInput;
  success: VaultNoticeInput | ((result: T) => VaultNoticeInput);
  error: VaultNoticeInput | ((error: unknown) => VaultNoticeInput);
}

interface VaultNoticeManager {
  add: (notice: VaultNoticeInput) => string;
  promise: <T>(operation: () => Promise<T>, options: VaultPromiseNoticeOptions<T>) => Promise<T>;
}

interface VaultNoticeProviderProps {
  children: ReactNode;
}

const BaseToastHost = lazy(async () => {
  const module = await import("./BaseToastHost");
  return { default: module.BaseToastHost };
});

const VaultNoticeContext = createContext<VaultNoticeManager | null>(null);

export function VaultNoticeProvider({ children }: VaultNoticeProviderProps) {
  const [hostActive, setHostActive] = useState(false);
  const nextId = useRef(0);
  const hostReady = useRef(false);
  const queuedOperations = useRef<Array<() => void>>([]);

  const runWhenHostReady = useCallback((operation: () => void) => {
    setHostActive(true);
    if (hostReady.current) {
      operation();
    } else {
      queuedOperations.current.push(operation);
    }
  }, []);

  const handleHostReady = useCallback(() => {
    hostReady.current = true;
    const operations = queuedOperations.current;
    queuedOperations.current = [];
    for (const operation of operations) operation();
  }, []);

  const add = useCallback(
    (input: VaultNoticeInput) => {
      nextId.current += 1;
      const id = `vault-notice-${nextId.current}`;
      runWhenHostReady(() => {
        void import("./BaseToastManager").then(({ vaultToastManager }) => {
          vaultToastManager.add(toToastOptions(input, id, vaultToastManager.close));
        });
      });
      return id;
    },
    [runWhenHostReady],
  );

  const promise = useCallback(
    <T,>(operation: () => Promise<T>, options: VaultPromiseNoticeOptions<T>): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        runWhenHostReady(() => {
          void import("./BaseToastManager")
            .then(({ vaultToastManager }) =>
              vaultToastManager.promise(operation(), {
                loading: toToastOptions(options.loading),
                success: mapPromiseNotice(options.success),
                error: mapPromiseNotice(options.error),
              }),
            )
            .then(resolve, reject);
        });
      });
    },
    [runWhenHostReady],
  );

  const manager = useMemo(() => ({ add, promise }), [add, promise]);

  useEffect(
    () => () => {
      hostReady.current = false;
      queuedOperations.current = [];
      void import("./BaseToastManager").then(({ vaultToastManager }) => {
        vaultToastManager.close();
      });
    },
    [],
  );

  return (
    <VaultNoticeContext.Provider value={manager}>
      {children}
      {hostActive ? (
        <Suspense fallback={null}>
          <BaseToastHost onReady={handleHostReady} />
        </Suspense>
      ) : null}
    </VaultNoticeContext.Provider>
  );
}

export function useVaultNotices() {
  const manager = useContext(VaultNoticeContext);
  if (!manager) throw new Error("useVaultNotices must be used inside VaultNoticeProvider");
  return manager;
}

function mapPromiseNotice<T>(notice: VaultNoticeInput | ((value: T) => VaultNoticeInput)) {
  return typeof notice === "function"
    ? (value: T) => toToastOptions(notice(value))
    : toToastOptions(notice);
}

function toToastOptions(input: VaultNoticeInput, id?: string, close?: (toastId?: string) => void) {
  const action = input.action;
  return {
    ...(id ? { id } : {}),
    title: input.title,
    description: input.description,
    type: input.type,
    timeout: input.timeout,
    data: action ? { actionLabel: action.label } : undefined,
    actionProps: action
      ? {
          onClick: () => {
            void Promise.resolve(action.onClick()).finally(() => close?.(id));
          },
        }
      : undefined,
  };
}
