-- AlterTable
ALTER TABLE `Purchase` ADD COLUMN `arrivalStatus` ENUM('PENDING', 'PARTIAL', 'RECEIVED') NOT NULL DEFAULT 'RECEIVED',
    ADD COLUMN `expectedArrivalDate` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `PurchaseItem` ADD COLUMN `quantityCancelled` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    ADD COLUMN `quantityReceived` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    ADD COLUMN `quantityRejected` DECIMAL(12, 3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `PurchaseReceipt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL,
    `purchaseId` INTEGER NOT NULL,
    `receivedDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` VARCHAR(191) NULL,
    `closedOrder` BOOLEAN NOT NULL DEFAULT false,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PurchaseReceipt_businessId_purchaseId_idx`(`businessId`, `purchaseId`),
    UNIQUE INDEX `PurchaseReceipt_businessId_idempotencyKey_key`(`businessId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseReceiptItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiptId` INTEGER NOT NULL,
    `purchaseItemId` INTEGER NOT NULL,
    `quantityAccepted` DECIMAL(12, 3) NOT NULL,
    `quantityRejected` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    `quantityCancelled` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    `notes` VARCHAR(191) NULL,

    INDEX `PurchaseReceiptItem_receiptId_idx`(`receiptId`),
    INDEX `PurchaseReceiptItem_purchaseItemId_idx`(`purchaseItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Purchase_businessId_arrivalStatus_idx` ON `Purchase`(`businessId`, `arrivalStatus`);

-- AddForeignKey
ALTER TABLE `PurchaseReceipt` ADD CONSTRAINT `PurchaseReceipt_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReceipt` ADD CONSTRAINT `PurchaseReceipt_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReceiptItem` ADD CONSTRAINT `PurchaseReceiptItem_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `PurchaseReceipt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReceiptItem` ADD CONSTRAINT `PurchaseReceiptItem_purchaseItemId_fkey` FOREIGN KEY (`purchaseItemId`) REFERENCES `PurchaseItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every purchase recorded before this migration was entered when the
-- goods were already on the shelf, so its stock has long since been added.
-- Mark the items fully received to match, or they would look pending forever.
UPDATE `PurchaseItem` SET `quantityReceived` = `quantity`;
