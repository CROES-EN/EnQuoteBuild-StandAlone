import React from "react";
import {useToast} from "@/components/ui/use-toast";
import {Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport,} from "@/components/ui/toast";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, open, onOpenChange, ...props }) {
        return (
          <Toast key={id} open={open} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose
              type="button"
              aria-label="Close notification"
              onClick={() => (onOpenChange ? onOpenChange(false) : dismiss(id))}
            />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
} 