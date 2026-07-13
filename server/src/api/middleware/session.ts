import cookieSession from "cookie-session";

const isProd = process.env.NODE_ENV === "production";

export const sessionMiddleware = cookieSession({
  name: "sw_session",
  keys: [process.env.SESSION_SECRET!],
  maxAge: 30 * 24 * 60 * 60 * 1000,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  httpOnly: true,
});
