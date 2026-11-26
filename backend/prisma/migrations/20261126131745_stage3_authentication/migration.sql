-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `csrfTokenHash` CHAR(64) NOT NULL,
    `csrfTokenEncrypted` VARCHAR(255) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auth_sessions_tokenHash_key`(`tokenHash`),
    INDEX `auth_sessions_userId_expiresAt_idx`(`userId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_tokens` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `type` ENUM('VERIFICACAO_EMAIL', 'REDEFINICAO_SENHA') NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auth_tokens_tokenHash_key`(`tokenHash`),
    INDEX `auth_tokens_userId_type_expiresAt_idx`(`userId`, `type`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_transactions` (
    `id` VARCHAR(30) NOT NULL,
    `provider` ENUM('PASSWORD', 'GOOGLE', 'APPLE') NOT NULL,
    `intent` ENUM('LOGIN', 'CADASTRO', 'VINCULO') NOT NULL,
    `stateHash` CHAR(64) NOT NULL,
    `nonce` VARCHAR(191) NOT NULL,
    `codeVerifierEncrypted` VARCHAR(512) NOT NULL,
    `userId` VARCHAR(30) NULL,
    `sessionId` VARCHAR(30) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `oauth_transactions_stateHash_key`(`stateHash`),
    INDEX `oauth_transactions_expiresAt_consumedAt_idx`(`expiresAt`, `consumedAt`),
    INDEX `oauth_transactions_userId_sessionId_idx`(`userId`, `sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pending_oauth_identities` (
    `id` VARCHAR(30) NOT NULL,
    `provider` ENUM('PASSWORD', 'GOOGLE', 'APPLE') NOT NULL,
    `providerSubject` VARCHAR(191) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `fullName` VARCHAR(160) NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pending_oauth_identities_tokenHash_key`(`tokenHash`),
    INDEX `pending_oauth_identities_expiresAt_consumedAt_idx`(`expiresAt`, `consumedAt`),
    UNIQUE INDEX `pending_oauth_identities_provider_providerSubject_key`(`provider`, `providerSubject`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_transactions` ADD CONSTRAINT `oauth_transactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
