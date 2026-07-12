import { ButtonCaption, SharedButton, type SharedButtonProps } from "./barrel";

const primaryAction: SharedButtonProps = {
  label: ButtonCaption,
};

export function Dashboard() {
  return (
    <section>
      <SharedButton {...primaryAction}>Save changes</SharedButton>
    </section>
  );
}
