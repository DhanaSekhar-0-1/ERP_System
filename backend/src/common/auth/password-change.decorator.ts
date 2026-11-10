import { SetMetadata } from '@nestjs/common';

export const ALLOW_BEFORE_PASSWORD_CHANGE_KEY = 'allowBeforePasswordChange';

/**
 * Marks a route a user may call while still on a generated first password (for example
 * reading who they are, changing the password, or signing out). Every other route is refused
 * until the password is changed.
 */
export const AllowBeforePasswordChange = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_BEFORE_PASSWORD_CHANGE_KEY, true);
