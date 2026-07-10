import { SharedButton, type SharedButtonProps } from "./nested-barrel";

const nestedAction: SharedButtonProps = {
  label: "Archive",
};

export function NestedDashboard() {
  return <SharedButton {...nestedAction}>Archive changes</SharedButton>;
}
