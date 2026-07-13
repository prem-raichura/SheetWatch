import type { ReactNode } from "react";
import { Toaster, toast } from "sonner";

interface ToastApi {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

const api: ToastApi = {
  success: (m) => toast.success(m),
  error: (m) => toast.error(m),
  info: (m) => toast(m),
};

// Sonner behind the original ToastProvider/useToast API so call sites stay
// untouched. Colors ride the CSS variables, so theme + accent apply.
export function useToast(): ToastApi {
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        position="bottom-center"
        duration={3200}
        gap={8}
        toastOptions={{
          style: {
            background: "var(--card)",
            color: "var(--text-strong)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-pop-value)",
            borderRadius: "0.75rem",
            fontSize: "0.875rem",
            fontWeight: 500,
          },
        }}
      />
    </>
  );
}
