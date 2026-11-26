-- AlterTable
ALTER TABLE `tickets`
    ADD COLUMN `categoryNameSnapshot` VARCHAR(100) NULL,
    ADD COLUMN `suggestedPriority` ENUM('BAIXA', 'MEDIA', 'ALTA', 'CRITICA') NULL;

-- Backfill historical tickets before enforcing the new required fields.
UPDATE `tickets` AS ticket
LEFT JOIN `ticket_categories` AS category ON category.`id` = ticket.`categoryId`
SET ticket.`suggestedPriority` = ticket.`priority`,
    ticket.`categoryNameSnapshot` = COALESCE(category.`name`, 'Categoria não identificada');

ALTER TABLE `tickets`
    MODIFY COLUMN `categoryNameSnapshot` VARCHAR(100) NOT NULL,
    MODIFY COLUMN `suggestedPriority` ENUM('BAIXA', 'MEDIA', 'ALTA', 'CRITICA') NOT NULL;

-- CreateTable
CREATE TABLE `ticket_protocol_counters` (
    `year` INTEGER NOT NULL,
    `lastNumber` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
