-- CreateTable
CREATE TABLE `units` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `units_name_key`(`name`),
    UNIQUE INDEX `units_code_key`(`code`),
    INDEX `units_isActive_name_idx`(`isActive`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `unitId` VARCHAR(30) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `departments_unitId_isActive_name_idx`(`unitId`, `isActive`, `name`),
    UNIQUE INDEX `departments_unitId_code_key`(`unitId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(30) NOT NULL,
    `fullName` VARCHAR(160) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `emailVerifiedAt` DATETIME(3) NULL,
    `role` ENUM('FUNCIONARIO', 'TI') NOT NULL DEFAULT 'FUNCIONARIO',
    `tiSlot` INTEGER NULL,
    `unitId` VARCHAR(30) NOT NULL,
    `departmentId` VARCHAR(30) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_tiSlot_key`(`tiSlot`),
    INDEX `users_role_isActive_idx`(`role`, `isActive`),
    INDEX `users_unitId_departmentId_idx`(`unitId`, `departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_accounts` (
    `slot` INTEGER NOT NULL DEFAULT 1,
    `userId` VARCHAR(30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `admin_accounts_userId_key`(`userId`),
    PRIMARY KEY (`slot`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_accounts` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `provider` ENUM('PASSWORD', 'GOOGLE', 'APPLE') NOT NULL,
    `providerSubject` VARCHAR(191) NULL,
    `providerEmail` VARCHAR(254) NULL,
    `passwordHash` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `auth_accounts_userId_idx`(`userId`),
    UNIQUE INDEX `auth_accounts_provider_providerSubject_key`(`provider`, `providerSubject`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_categories` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ticket_categories_name_key`(`name`),
    UNIQUE INDEX `ticket_categories_code_key`(`code`),
    INDEX `ticket_categories_isActive_name_idx`(`isActive`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tickets` (
    `id` VARCHAR(30) NOT NULL,
    `number` VARCHAR(24) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `status` ENUM('ABERTO', 'EM_TRIAGEM', 'EM_ATENDIMENTO', 'AGUARDANDO_FUNCIONARIO', 'RESOLVIDO', 'FECHADO', 'REABERTO', 'CANCELADO') NOT NULL DEFAULT 'ABERTO',
    `priority` ENUM('BAIXA', 'MEDIA', 'ALTA', 'CRITICA') NOT NULL DEFAULT 'MEDIA',
    `requesterUserId` VARCHAR(30) NULL,
    `requesterNameSnapshot` VARCHAR(160) NOT NULL,
    `requesterEmailSnapshot` VARCHAR(254) NOT NULL,
    `departmentId` VARCHAR(30) NULL,
    `departmentNameSnapshot` VARCHAR(100) NOT NULL,
    `unitId` VARCHAR(30) NULL,
    `unitNameSnapshot` VARCHAR(100) NOT NULL,
    `categoryId` VARCHAR(30) NULL,
    `resolution` TEXT NULL,
    `resolvedAt` DATETIME(3) NULL,
    `autoCloseAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tickets_number_key`(`number`),
    INDEX `tickets_status_priority_createdAt_idx`(`status`, `priority`, `createdAt`),
    INDEX `tickets_requesterUserId_createdAt_idx`(`requesterUserId`, `createdAt`),
    INDEX `tickets_unitId_departmentId_createdAt_idx`(`unitId`, `departmentId`, `createdAt`),
    INDEX `tickets_autoCloseAt_status_idx`(`autoCloseAt`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_comments` (
    `id` VARCHAR(30) NOT NULL,
    `ticketId` VARCHAR(30) NOT NULL,
    `authorUserId` VARCHAR(30) NULL,
    `authorNameSnapshot` VARCHAR(160) NOT NULL,
    `visibility` ENUM('PUBLICA', 'INTERNA') NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ticket_comments_ticketId_createdAt_idx`(`ticketId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_history` (
    `id` VARCHAR(30) NOT NULL,
    `ticketId` VARCHAR(30) NOT NULL,
    `actorUserId` VARCHAR(30) NULL,
    `actorNameSnapshot` VARCHAR(160) NOT NULL,
    `eventType` ENUM('ABERTURA', 'ALTERACAO_STATUS', 'ALTERACAO_PRIORIDADE', 'MENSAGEM', 'NOTA_INTERNA', 'SOLUCAO', 'REABERTURA', 'ENCERRAMENTO', 'CANCELAMENTO', 'ANEXO', 'FECHAMENTO_AUTOMATICO') NOT NULL,
    `previousValue` VARCHAR(100) NULL,
    `newValue` VARCHAR(100) NULL,
    `reason` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ticket_history_ticketId_createdAt_idx`(`ticketId`, `createdAt`),
    INDEX `ticket_history_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_attachments` (
    `id` VARCHAR(30) NOT NULL,
    `ticketId` VARCHAR(30) NOT NULL,
    `uploadedByUserId` VARCHAR(30) NULL,
    `uploaderNameSnapshot` VARCHAR(160) NOT NULL,
    `storageKey` VARCHAR(255) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `byteSize` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ticket_attachments_storageKey_key`(`storageKey`),
    INDEX `ticket_attachments_ticketId_createdAt_idx`(`ticketId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_settings` (
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(30) NOT NULL,
    `actorUserId` VARCHAR(30) NULL,
    `actorNameSnapshot` VARCHAR(160) NOT NULL,
    `action` VARCHAR(100) NOT NULL,
    `entityType` VARCHAR(100) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `changes` JSON NULL,
    `requestId` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    INDEX `audit_logs_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
    INDEX `audit_logs_entityType_entityId_createdAt_idx`(`entityType`, `entityId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(30) NOT NULL,
    `ticketId` VARCHAR(30) NULL,
    `recipientEmail` VARCHAR(254) NOT NULL,
    `eventKey` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDENTE', 'ENVIADA', 'FALHA') NOT NULL DEFAULT 'PENDENTE',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `notifications_eventKey_key`(`eventKey`),
    INDEX `notifications_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_accounts` ADD CONSTRAINT `admin_accounts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_accounts` ADD CONSTRAINT `auth_accounts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_requesterUserId_fkey` FOREIGN KEY (`requesterUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ticket_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_comments` ADD CONSTRAINT `ticket_comments_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `tickets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_comments` ADD CONSTRAINT `ticket_comments_authorUserId_fkey` FOREIGN KEY (`authorUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_history` ADD CONSTRAINT `ticket_history_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `tickets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_history` ADD CONSTRAINT `ticket_history_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_attachments` ADD CONSTRAINT `ticket_attachments_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `tickets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_attachments` ADD CONSTRAINT `ticket_attachments_uploadedByUserId_fkey` FOREIGN KEY (`uploadedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `tickets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
