-- DropForeignKey
ALTER TABLE "ComparisonGroup" DROP CONSTRAINT "ComparisonGroup_masterSheetId_fkey";

-- DropForeignKey
ALTER TABLE "ComparisonTarget" DROP CONSTRAINT "ComparisonTarget_sheetId_fkey";

-- DropForeignKey
ALTER TABLE "Suggestion" DROP CONSTRAINT "Suggestion_targetSheetId_fkey";

-- DropIndex
DROP INDEX "ComparisonGroup_masterSheetId_idx";

-- DropIndex
DROP INDEX "ComparisonTarget_groupId_sheetId_key";

-- DropIndex
DROP INDEX "ComparisonTarget_sheetId_idx";

-- DropIndex
DROP INDEX "Suggestion_groupId_targetSheetId_keyValue_column_key";

-- AlterTable
ALTER TABLE "ComparisonGroup" DROP COLUMN "masterSheetId",
ADD COLUMN     "masterLabel" TEXT NOT NULL,
ADD COLUMN     "masterRange" TEXT NOT NULL DEFAULT 'A1:Z1000',
ADD COLUMN     "masterSpreadsheetId" TEXT NOT NULL,
ADD COLUMN     "masterTab" TEXT;

-- AlterTable
ALTER TABLE "ComparisonTarget" DROP COLUMN "sheetId",
ADD COLUMN     "label" TEXT NOT NULL,
ADD COLUMN     "range" TEXT NOT NULL DEFAULT 'A1:Z1000',
ADD COLUMN     "spreadsheetId" TEXT NOT NULL,
ADD COLUMN     "tab" TEXT;

-- AlterTable
ALTER TABLE "Suggestion" DROP COLUMN "targetSheetId",
ADD COLUMN     "targetId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "ComparisonTarget_groupId_idx" ON "ComparisonTarget"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Suggestion_targetId_keyValue_column_key" ON "Suggestion"("targetId", "keyValue", "column");

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "ComparisonTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

