export type ToastAction = {
  label: string;
  onClick: () => void;
  icon?: "settings" | "arrow-right";
};
