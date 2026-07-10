import type { SharedButtonProps } from "./shared-props";

export const ButtonCaption = "Save";

export default function SharedButton({ label, disabled, children }: SharedButtonProps) {
  return (
    <button aria-label={label} disabled={disabled}>
      {children}
    </button>
  );
}
