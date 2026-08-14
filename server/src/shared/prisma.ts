import { PrismaClient } from "@prisma/client";

// One client per process. On Vercel the module can be re-evaluated while the
// underlying Lambda container is reused, so cache on globalThis — otherwise
// each re-eval opens a fresh Neon pool and the connection cap is hit fast.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prisma = globalForPrisma.prisma ?? new PrismaClient();
globalForPrisma.prisma = prisma;

export default prisma;
