export type ToastAction = {
  label: string;
  onClick: () => void;
  icon?: "settings" | "arrow-right";
  secondaryAction?: {
    label: string;
    onClick: () => void;
    icon?: "settings" | "arrow-right";
  };
};
