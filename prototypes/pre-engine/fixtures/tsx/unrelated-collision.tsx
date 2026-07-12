function SharedButton() {
  return <aside>Unrelated local component</aside>;
}

export function UnrelatedPanel() {
  return <SharedButton />;
}
