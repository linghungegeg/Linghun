import type { Greeting } from "./types";

export function GreetingView({ message }: Greeting) {
  return <span>{message}</span>;
}
