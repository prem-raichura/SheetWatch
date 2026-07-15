-- DropIndex
DROP INDEX "Sheet_projectId_idx";

-- AlterTable
ALTER TABLE "Sheet" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Sheet_projectId_sortOrder_idx" ON "Sheet"("projectId", "sortOrder");
