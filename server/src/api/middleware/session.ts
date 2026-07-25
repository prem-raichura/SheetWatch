import cookieSession from "cookie-session";

const isProd = process.env.NODE_ENV === "production";

export const sessionMiddleware = cookieSession({
  name: "sw_session",
  // First key signs new cookies; extra keys still validate old ones, so
  // SESSION_SECRET can rotate (set SESSION_SECRET_OLD during the overlap)
  // without logging everyone out.
  keys: [process.env.SESSION_SECRET!, process.env.SESSION_SECRET_OLD].filter(Boolean) as string[],
  maxAge: 30 * 24 * 60 * 60 * 1000,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  httpOnly: true,
});
