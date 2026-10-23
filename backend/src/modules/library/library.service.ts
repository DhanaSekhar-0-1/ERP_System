import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { pageArgs, paged } from '../../common/http/pagination';
import {
  BookQueryDto,
  CreateBookDto,
  CreateCategoryDto,
  CreateFineDto,
  IssueBookDto,
  IssueQueryDto,
  ReturnBookDto,
  UpdateBookDto,
} from './library.dto';

const FINE_PER_DAY = 2;

@Injectable()
export class LibraryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async books(authUser: SupabaseUser, query: BookQueryDto) {
    const context = await this.access.schoolContext(authUser);
    const search = query.search?.trim();
    const where: Prisma.BookWhereInput = {
      schoolId: context.schoolId,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { author: { contains: search, mode: 'insensitive' } },
              { isbn: { contains: search } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.database.$transaction([
      this.database.book.findMany({
        where,
        orderBy: { title: 'asc' },
        include: { category: { select: { id: true, name: true } } },
        ...pageArgs(query),
      }),
      this.database.book.count({ where }),
    ]);
    return paged(items, total, query);
  }

  async book(authUser: SupabaseUser, bookId: string) {
    const context = await this.access.schoolContext(authUser);
    const book = await this.database.book.findFirst({
      where: { id: bookId, schoolId: context.schoolId },
      include: { category: true, issues: { where: { status: 'ISSUED' } } },
    });
    if (!book) throw new NotFoundException('Book not found');
    return book;
  }

  async createBook(authUser: SupabaseUser, input: CreateBookDto) {
    const context = await this.access.schoolContext(authUser);
    if (input.categoryId) await this.assertCategory(context.schoolId, input.categoryId);
    return this.database.book.create({
      data: {
        schoolId: context.schoolId,
        title: input.title.trim(),
        author: input.author?.trim() || null,
        isbn: input.isbn?.trim() || null,
        categoryId: input.categoryId ?? null,
        copies: input.copies,
        available: input.copies,
      },
    });
  }

  /** Changing the number of copies moves availability by the same amount. */
  async updateBook(authUser: SupabaseUser, bookId: string, input: UpdateBookDto) {
    const context = await this.access.schoolContext(authUser);
    const book = await this.book(authUser, bookId);
    if (input.categoryId) await this.assertCategory(context.schoolId, input.categoryId);
    let available = book.available;
    if (input.copies !== undefined) {
      const issued = book.copies - book.available;
      if (input.copies < issued) {
        throw new ConflictException(`${issued} copies are on loan; copies cannot go below that`);
      }
      available = input.copies - issued;
    }
    return this.database.book.update({
      where: { id: bookId },
      data: { ...input, available },
    });
  }

  async categories(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    return this.database.bookCategory.findMany({
      where: { schoolId: context.schoolId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { books: true } } },
    });
  }

  async createCategory(authUser: SupabaseUser, input: CreateCategoryDto) {
    const context = await this.access.schoolContext(authUser);
    return this.database.bookCategory.create({
      data: { schoolId: context.schoolId, name: input.name.trim() },
    });
  }

  async issue(authUser: SupabaseUser, input: IssueBookDto) {
    const context = await this.access.schoolContext(authUser);
    if (Boolean(input.studentId) === Boolean(input.staffId)) {
      throw new BadRequestException('Issue to exactly one student or staff member');
    }
    if (input.studentId) {
      const student = await this.database.student.findFirst({
        where: { id: input.studentId, schoolId: context.schoolId, isArchived: false },
      });
      if (!student) throw new NotFoundException('Student not found');
    }
    if (input.staffId) {
      const staff = await this.database.staffProfile.findFirst({
        where: { id: input.staffId, schoolId: context.schoolId },
      });
      if (!staff) throw new NotFoundException('Staff member not found');
    }
    return this.database.$transaction(async (transaction) => {
      const reserved = await transaction.book.updateMany({
        where: { id: input.bookId, schoolId: context.schoolId, available: { gt: 0 } },
        data: { available: { decrement: 1 } },
      });
      if (!reserved.count) throw new ConflictException('No copies of this book are available');
      return transaction.libraryIssue.create({
        data: {
          schoolId: context.schoolId,
          bookId: input.bookId,
          studentId: input.studentId ?? null,
          staffId: input.staffId ?? null,
          dueDate: new Date(input.dueDate.slice(0, 10)),
        },
        include: { book: { select: { id: true, title: true } } },
      });
    });
  }

  /** Returns a book; an overdue return creates a per-day fine automatically. */
  async returnBook(authUser: SupabaseUser, input: ReturnBookDto) {
    const context = await this.access.schoolContext(authUser);
    const issue = await this.database.libraryIssue.findFirst({
      where: { id: input.issueId, schoolId: context.schoolId },
      include: { book: true },
    });
    if (!issue) throw new NotFoundException('Issue record not found');
    if (issue.status !== 'ISSUED') throw new ConflictException('This book has already been returned');
    const now = new Date();
    const daysLate = Math.max(
      Math.floor((now.getTime() - issue.dueDate.getTime()) / 86_400_000),
      0,
    );
    return this.database.$transaction(async (transaction) => {
      const updated = await transaction.libraryIssue.update({
        where: { id: issue.id },
        data: { status: input.lost ? 'LOST' : 'RETURNED', returnedAt: now },
      });
      if (!input.lost) {
        await transaction.book.update({ where: { id: issue.bookId }, data: { available: { increment: 1 } } });
      } else {
        await transaction.book.update({ where: { id: issue.bookId }, data: { copies: { decrement: 1 } } });
      }
      let fine = null;
      if (daysLate > 0) {
        fine = await transaction.libraryFine.create({
          data: {
            schoolId: context.schoolId,
            issueId: issue.id,
            amount: daysLate * FINE_PER_DAY,
            reason: `${daysLate} day(s) late`,
          },
        });
      }
      return { issue: updated, daysLate, fine };
    });
  }

  async transactions(authUser: SupabaseUser, query: IssueQueryDto) {
    const context = await this.access.schoolContext(authUser);
    return this.database.libraryIssue.findMany({
      where: {
        schoolId: context.schoolId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.studentId ? { studentId: query.studentId } : {}),
        ...(query.overdue ? { status: 'ISSUED', dueDate: { lt: new Date() } } : {}),
      },
      orderBy: { issuedAt: 'desc' },
      include: {
        book: { select: { id: true, title: true } },
        student: { select: { id: true, firstName: true, lastName: true } },
        staff: { select: { id: true, user: { select: { displayName: true } } } },
        fines: true,
      },
      take: 1000,
    });
  }

  async studentHistory(authUser: SupabaseUser, studentId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, studentId);
    return this.database.libraryIssue.findMany({
      where: { studentId, schoolId: context.schoolId },
      orderBy: { issuedAt: 'desc' },
      include: { book: { select: { id: true, title: true, author: true } }, fines: true },
    });
  }

  async createFine(authUser: SupabaseUser, input: CreateFineDto) {
    const context = await this.access.schoolContext(authUser);
    const issue = await this.database.libraryIssue.findFirst({
      where: { id: input.issueId, schoolId: context.schoolId },
    });
    if (!issue) throw new NotFoundException('Issue record not found');
    return this.database.libraryFine.create({
      data: { schoolId: context.schoolId, issueId: issue.id, amount: input.amount, reason: input.reason.trim() },
    });
  }

  async waiveFine(authUser: SupabaseUser, fineId: string) {
    const context = await this.access.schoolContext(authUser);
    const fine = await this.database.libraryFine.findFirst({ where: { id: fineId, schoolId: context.schoolId } });
    if (!fine) throw new NotFoundException('Fine not found');
    if (fine.isWaived || fine.paidAt) throw new ConflictException('This fine is already settled');
    const waived = await this.database.libraryFine.update({
      where: { id: fineId },
      data: { isWaived: true, waivedById: context.userId },
    });
    await this.audit.record(context, {
      action: 'library.fine-waived',
      entityType: 'library-fine',
      entityId: fineId,
      oldValue: { amount: fine.amount },
    });
    return waived;
  }

  private async assertCategory(schoolId: string, categoryId: string) {
    const category = await this.database.bookCategory.findFirst({ where: { id: categoryId, schoolId } });
    if (!category) throw new NotFoundException('Category not found');
  }
}
