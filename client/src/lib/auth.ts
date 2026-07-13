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
