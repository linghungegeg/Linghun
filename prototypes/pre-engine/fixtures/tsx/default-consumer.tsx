import { RenamedFoo as LocalFoo } from "./default-barrel";

export function DefaultConsumer() {
  return <LocalFoo />;
}
