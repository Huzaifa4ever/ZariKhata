-- AlterTable
ALTER TABLE `Product` ADD COLUMN `createdByUserId` INTEGER NULL;

-- CreateTable
CREATE TABLE `EmployeeAdvance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `accountId` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `takenDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` VARCHAR(191) NULL,
    `settledBySalaryPaymentId` INTEGER NULL,
    `createdByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmployeeAdvance_businessId_userId_idx`(`businessId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeAdvance` ADD CONSTRAINT `EmployeeAdvance_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeAdvance` ADD CONSTRAINT `EmployeeAdvance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeAdvance` ADD CONSTRAINT `EmployeeAdvance_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeAdvance` ADD CONSTRAINT `EmployeeAdvance_settledBySalaryPaymentId_fkey` FOREIGN KEY (`settledBySalaryPaymentId`) REFERENCES `SalaryPayment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
