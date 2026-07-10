import { Component, forwardRef, memo, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

export interface ButtonProps {
  label: string;
  children?: ReactNode;
}

export function Button({ label, children }: ButtonProps) {
  return <button aria-label={label}>{children}</button>;
}

export type CardProps = HTMLAttributes<HTMLElement> & {
  label: string;
  children?: ReactNode;
};

export const Card = ({ label, children, ...rest }: CardProps) => (
  <article {...rest}>
    <Button label={label}>{children}</Button>
  </article>
);

export class LegacyPanel extends Component<ButtonProps> {
  handleAction() {
    trackInteraction();
  }

  render() {
    return (
      <Menu.Item>
        <Button label={this.props.label}>{this.props.children}</Button>
      </Menu.Item>
    );
  }
}

function trackInteraction() {}

export const MemoButton = memo(Button);

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string };

export const ForwardInput = forwardRef<HTMLInputElement, InputProps>(
  ({ label, ...rest }, ref) => <input ref={ref} aria-label={label} {...rest} />,
);

export function Screen({ show, items }: { show: boolean; items: string[] }) {
  return (
    <>
      <main>{show && <MemoButton label="Primary" />}</main>
      {items.map((item) => (
        <Menu.Item key={item}>
          <Card label={item}>{item}</Card>
        </Menu.Item>
      ))}
      <ForwardInput label="Search" />
    </>
  );
}

export function Item() {
  return <span>Item</span>;
}

export function MixedComponents() {
  return (
    <>
      <Item />
      <Menu.Item />
      <Item />
      <Menu.Item />
    </>
  );
}
