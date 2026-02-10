import { toast } from "sonner";

export type ToastKind = "success" | "error" | "warning" | "info";
export type ToastAction = { label: string; onClick: () => void; icon?: "settings" | "arrow-right" };

export interface AppToastPayload {
  title: string;
  description?: string;
  action?: ToastAction;
  id?: string;
  duration?: number;
}

export interface LoadingToastOptions<T> {
  loading: string;
  success?: (result: T) => AppToastPayload | null;
  error: (error: unknown) => AppToastPayload;
  run: () => Promise<T>;
}

function buildToastOptions(payload: AppToastPayload) {
  return {
    description: payload.description,
    action: payload.action,
    id: payload.id,
    duration: payload.duration,
  };
}

export function showToast(kind: ToastKind, payload: AppToastPayload) {
  const options = buildToastOptions(payload);

  if (kind === "success") {
    return toast.success(payload.title, options);
  }

  if (kind === "warning") {
    return toast.warning(payload.title, options);
  }

  if (kind === "info") {
    return toast.info(payload.title, options);
  }

  return toast.error(payload.title, options);
}

export function showLoadingToast(message: string) {
  return toast.loading(message);
}

export const customToast = toast.custom;
export const dismissToast = toast.dismiss;
