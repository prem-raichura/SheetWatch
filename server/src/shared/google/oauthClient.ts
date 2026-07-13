import { google } from "googleapis";
import { User } from "@prisma/client";
import { decrypt, encrypt } from "../crypto";
import prisma from "../prisma";

export function oauthClientFor(user: User) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  client.setCredentials({
    access_token: decrypt(user.accessToken),
    refresh_token: decrypt(user.refreshToken),
    expiry_date: user.tokenExpiry.getTime(),
  });

  client.on("tokens", async (tokens) => {
    const update: Record<string, unknown> = {};
    if (tokens.access_token) update.accessToken = encrypt(tokens.access_token);
    if (tokens.expiry_date) update.tokenExpiry = new Date(tokens.expiry_date);
    if (tokens.refresh_token) update.refreshToken = encrypt(tokens.refresh_token);
    if (Object.keys(update).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data: update }).catch(console.error);
    }
  });

  return client;
}
