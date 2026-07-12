export interface Account {
  id: string;
  displayName: string;
  active: boolean;
}

export type AccountId = Account["id"];
