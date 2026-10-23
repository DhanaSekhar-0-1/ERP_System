import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
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
import { LibraryService } from './library.service';

@Controller('library')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get('books')
  @RequirePermissions('library:read')
  books(@CurrentUser() user: SupabaseUser, @Query() query: BookQueryDto) {
    return this.library.books(user, query);
  }

  @Post('books')
  @RequirePermissions('library:manage')
  createBook(@CurrentUser() user: SupabaseUser, @Body() input: CreateBookDto) {
    return this.library.createBook(user, input);
  }

  @Get('books/:bookId')
  @RequirePermissions('library:read')
  book(@CurrentUser() user: SupabaseUser, @Param('bookId', ParseUUIDPipe) id: string) {
    return this.library.book(user, id);
  }

  @Patch('books/:bookId')
  @RequirePermissions('library:manage')
  updateBook(
    @CurrentUser() user: SupabaseUser,
    @Param('bookId', ParseUUIDPipe) id: string,
    @Body() input: UpdateBookDto,
  ) {
    return this.library.updateBook(user, id, input);
  }

  @Get('categories')
  @RequirePermissions('library:read')
  categories(@CurrentUser() user: SupabaseUser) {
    return this.library.categories(user);
  }

  @Post('categories')
  @RequirePermissions('library:manage')
  createCategory(@CurrentUser() user: SupabaseUser, @Body() input: CreateCategoryDto) {
    return this.library.createCategory(user, input);
  }

  @Post('issues')
  @RequirePermissions('library:manage')
  issue(@CurrentUser() user: SupabaseUser, @Body() input: IssueBookDto) {
    return this.library.issue(user, input);
  }

  @Post('returns')
  @RequirePermissions('library:manage')
  returnBook(@CurrentUser() user: SupabaseUser, @Body() input: ReturnBookDto) {
    return this.library.returnBook(user, input);
  }

  @Get('transactions')
  @RequirePermissions('library:manage')
  transactions(@CurrentUser() user: SupabaseUser, @Query() query: IssueQueryDto) {
    return this.library.transactions(user, query);
  }

  @Post('fines')
  @RequirePermissions('library:manage')
  fine(@CurrentUser() user: SupabaseUser, @Body() input: CreateFineDto) {
    return this.library.createFine(user, input);
  }

  @Post('fines/:fineId/waive')
  @RequirePermissions('library:manage')
  waive(@CurrentUser() user: SupabaseUser, @Param('fineId', ParseUUIDPipe) id: string) {
    return this.library.waiveFine(user, id);
  }
}

@Controller('students/:studentId/library-history')
export class StudentLibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get()
  @RequirePermissions('library:read')
  history(@CurrentUser() user: SupabaseUser, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.library.studentHistory(user, studentId);
  }
}
