-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sheetsWrite" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ComparisonGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "masterSheetId" TEXT NOT NULL,
    "keyColumn" TEXT,
    "compareColumns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComparisonGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComparisonTarget" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,

    CONSTRAINT "ComparisonTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "targetSheetId" TEXT NOT NULL,
    "keyValue" TEXT NOT NULL,
    "rowRef" TEXT,
    "column" TEXT NOT NULL,
    "masterValue" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "conflict" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComparisonGroup_userId_idx" ON "ComparisonGroup"("userId");

-- CreateIndex
CREATE INDEX "ComparisonGroup_masterSheetId_idx" ON "ComparisonGroup"("masterSheetId");

-- CreateIndex
CREATE INDEX "ComparisonTarget_sheetId_idx" ON "ComparisonTarget"("sheetId");

-- CreateIndex
CREATE UNIQUE INDEX "ComparisonTarget_groupId_sheetId_key" ON "ComparisonTarget"("groupId", "sheetId");

-- CreateIndex
CREATE INDEX "Suggestion_groupId_status_idx" ON "Suggestion"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Suggestion_groupId_targetSheetId_keyValue_column_key" ON "Suggestion"("groupId", "targetSheetId", "keyValue", "column");

-- AddForeignKey
ALTER TABLE "ComparisonGroup" ADD CONSTRAINT "ComparisonGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonGroup" ADD CONSTRAINT "ComparisonGroup_masterSheetId_fkey" FOREIGN KEY ("masterSheetId") REFERENCES "Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonTarget" ADD CONSTRAINT "ComparisonTarget_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ComparisonGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonTarget" ADD CONSTRAINT "ComparisonTarget_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ComparisonGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_targetSheetId_fkey" FOREIGN KEY ("targetSheetId") REFERENCES "Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
