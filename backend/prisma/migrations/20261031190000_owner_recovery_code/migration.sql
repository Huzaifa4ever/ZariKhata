-- Owner-only password recovery. A one-time code the owner generates and keeps
-- somewhere safe; it is stored only as a bcrypt hash, exactly like a password.
ALTER TABLE `User` ADD COLUMN `recoveryCodeHash` VARCHAR(191) NULL;
ALTER TABLE `User` ADD COLUMN `recoveryCodeSetAt` DATETIME(3) NULL;
