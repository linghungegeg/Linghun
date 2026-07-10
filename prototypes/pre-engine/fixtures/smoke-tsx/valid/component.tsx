type GreetingProps = { name: string };

export function Greeting(props: GreetingProps) {
  return <div className="greeting">Hello, {props.name}</div>;
}

export const renderedGreeting = <Greeting name="Linghun" />;
