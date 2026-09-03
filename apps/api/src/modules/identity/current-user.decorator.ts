import {
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';

export interface AuthenticatedUser {
  readonly id: string;
  readonly name: string;
}

/**
 * Resolve o usuário da requisição.
 *
 * O `userId` vem SEMPRE daqui e NUNCA do corpo do request — a restrição que a
 * autenticação real imporia já vale (ADR 0008). Os use-cases recebem o id como
 * argumento e não sabem como ele foi obtido; trocar header simulado por JWT
 * não toca em regra de negócio.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new Error('IdentityGuard não populou request.user');
    }
    return request.user;
  },
);
