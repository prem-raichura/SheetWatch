import { api } from "./api";
import { User } from "../types";

export async function getMe(): Promise<User | null> {
  try {
    return await api.get<User>("/auth/me");
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await api.post("/auth/logout");
}

// Irreversible. The server requires `confirm` to equal the account email, and
// revokes the Google grant before erasing the row.
export async function deleteAccount(confirm: string): Promise<void> {
  await api.delete("/auth/me", { confirm });
}
