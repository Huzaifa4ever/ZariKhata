-- AlterTable
ALTER TABLE `Expense` ADD COLUMN `deductFromSalary` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `forUserId` INTEGER NULL,
    ADD COLUMN `settledBySalaryPaymentId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Expense_businessId_forUserId_idx` ON `Expense`(`businessId`, `forUserId`);

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_forUserId_fkey` FOREIGN KEY (`forUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_settledBySalaryPaymentId_fkey` FOREIGN KEY (`settledBySalaryPaymentId`) REFERENCES `SalaryPayment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
