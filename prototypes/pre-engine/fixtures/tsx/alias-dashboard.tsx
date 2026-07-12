import SharedButton from "@/shared-button";
import type { SharedButtonProps } from "@/shared-props";

const aliasAction: SharedButtonProps = {
  label: "Publish",
};

export function AliasDashboard() {
  return <SharedButton {...aliasAction}>Publish changes</SharedButton>;
}
