-- Drop local<->cloud sync infrastructure: this deployment is now a single
-- offline desktop app with its own local MySQL database, no multi-device
-- sync, no cloud counterpart, no Oracle. See README.md / docs/.

-- DropForeignKey
ALTER TABLE `Installation` DROP FOREIGN KEY `Installation_businessId_fkey`;

-- DropTable
DROP TABLE `Installation`;

-- DropTable
DROP TABLE `AppliedMutation`;

-- DropTable
DROP TABLE `SyncQueue`;

-- DropTable
DROP TABLE `SyncCursor`;
