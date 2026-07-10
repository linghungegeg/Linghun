type GreetingProps = { name: string };

export function Greeting(props: GreetingProps) {
  return <div>{props.name}</div>;
}

export const invalidCount: number = "wrong";
