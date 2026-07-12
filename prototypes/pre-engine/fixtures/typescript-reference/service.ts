import type { Account, AccountId } from "./contracts";
import { loadAccount } from "./repository";

export interface AccountSummary {
  id: AccountId;
  label: string;
}

export function describeAccount(id: AccountId): AccountSummary {
  const account: Account | undefined = loadAccount(id);
  return {
    id,
    label: account?.displayName ?? "Unknown account",
  };
}
