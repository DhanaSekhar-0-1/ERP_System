import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Columns left out of every query result unless a query asks for them with
 * `omit: { column: false }`. Keeps the encrypted Aadhaar and its hash out of API responses,
 * logs and audit entries by default.
 *
 * The client keeps the plain `PrismaClient` type so it still fits `Prisma.TransactionClient`
 * everywhere; the types therefore still list these columns, but at runtime they are absent
 * unless asked for. Only `common/identity` code reads them.
 */
const OMITTED = {
  student: { aadhaarEncrypted: true, aadhaarHash: true },
};

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({ omit: OMITTED } as Prisma.PrismaClientOptions);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
