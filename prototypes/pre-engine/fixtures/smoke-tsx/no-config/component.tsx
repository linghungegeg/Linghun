declare namespace JSX {
  interface IntrinsicElements {
    div: { children?: unknown };
  }
}

export const NoConfigView = () => <div>Fallback</div>;
