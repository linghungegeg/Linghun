import type { Account, AccountId } from "./contracts";

const accounts: Account[] = [
  { id: "primary", displayName: "Primary account", active: true },
];

export function loadAccount(id: AccountId): Account | undefined {
  return accounts.find((account) => account.id === id);
}
