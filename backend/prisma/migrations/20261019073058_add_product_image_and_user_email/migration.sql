-- AlterTable
ALTER TABLE `Category` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Product` ADD COLUMN `imageData` MEDIUMTEXT NULL;

-- AlterTable
ALTER TABLE `Task` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `email` VARCHAR(191) NULL;
