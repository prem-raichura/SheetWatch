-- AlterTable
ALTER TABLE "Sheet" ADD COLUMN     "alertColumns" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "snoozedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ChangeLog_sheetId_createdAt_idx" ON "ChangeLog"("sheetId", "createdAt");
