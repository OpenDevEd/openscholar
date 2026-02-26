"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmationVariant = "destructive" | "default";

interface ConfirmationOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmationVariant;
  onConfirm: () => void;
  onCancel?: () => void;
}

type ConfirmationRequest = Required<Pick<ConfirmationOptions, "confirmText" | "cancelText" | "variant">> &
  Omit<ConfirmationOptions, "confirmText" | "cancelText" | "variant">;

type ConfirmationListener = (request: ConfirmationRequest) => void;

const listeners = new Set<ConfirmationListener>();
const pendingQueue: ConfirmationRequest[] = [];

function toRequest(options: ConfirmationOptions): ConfirmationRequest {
  return {
    ...options,
    confirmText: options.confirmText ?? "Confirm",
    cancelText: options.cancelText ?? "Cancel",
    variant: options.variant ?? "destructive",
  };
}

function dispatchConfirmation(request: ConfirmationRequest) {
  if (listeners.size === 0) {
    pendingQueue.push(request);
    return;
  }

  for (const listener of listeners) {
    listener(request);
  }
}

export function showConfirmation(options: ConfirmationOptions) {
  dispatchConfirmation(toRequest(options));
}

export function ConfirmationHost() {
  const [current, setCurrent] = useState<ConfirmationRequest | null>(null);
  const handledByActionRef = useRef(false);

  const consumeNext = useCallback(() => {
    const next = pendingQueue.shift() ?? null;
    setCurrent(next);
  }, []);

  useEffect(() => {
    const listener: ConfirmationListener = (request) => {
      setCurrent((existing) => {
        if (existing) {
          pendingQueue.push(request);
          return existing;
        }

        return request;
      });
    };

    listeners.add(listener);

    if (!current && pendingQueue.length > 0) {
      consumeNext();
    }

    return () => {
      listeners.delete(listener);
    };
  }, [consumeNext, current]);

  const closeAsCancel = useCallback(() => {
    if (!current) {
      return;
    }

    current.onCancel?.();
    consumeNext();
  }, [consumeNext, current]);

  const closeAsConfirm = useCallback(() => {
    if (!current) {
      return;
    }

    current.onConfirm();
    consumeNext();
  }, [consumeNext, current]);

  return (
    <AlertDialog
      open={Boolean(current)}
      onOpenChange={(open) => {
        if (open) {
          return;
        }

        if (handledByActionRef.current) {
          handledByActionRef.current = false;
          return;
        }

        closeAsCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{current?.title ?? ""}</AlertDialogTitle>
          <AlertDialogDescription>{current?.message ?? ""}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              handledByActionRef.current = true;
              closeAsCancel();
            }}
          >
            {current?.cancelText ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={current?.variant === "destructive" ? "destructive" : "default"}
            onClick={() => {
              handledByActionRef.current = true;
              closeAsConfirm();
            }}
          >
            {current?.confirmText ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
