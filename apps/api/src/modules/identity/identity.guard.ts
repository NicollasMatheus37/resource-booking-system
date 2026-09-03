import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../database/prisma.service';
import { IS_PUBLIC } from './public.decorator';
import type { AuthenticatedUser } from './current-user.decorator';

/**
 * Ponto ÚNICO de resolução de identidade (ADR 0008).
 *
 * No MVP lê o header `x-user-id` e valida contra a tabela `users`. Trocar por
 * JWT é mudar apenas esta classe — nenhum use-case é afetado.
 *
 * ATENÇÃO: isto NÃO é autenticação. Qualquer cliente pode se passar por
 * qualquer usuário trocando um header. É decisão de escopo declarada, não
 * descuido — ver README.
 */
@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, unknown>; user?: AuthenticatedUser }>();

    const raw = request.headers['x-user-id'];
    const userId = Array.isArray(raw) ? raw[0] : raw;

    if (typeof userId !== 'string' || userId.length === 0) {
      throw new UnauthorizedException('Header x-user-id ausente.');
    }

    const user = await this.prisma.user
      .findUnique({ where: { id: userId }, select: { id: true, name: true } })
      .catch(() => null);

    if (!user) {
      throw new UnauthorizedException('Usuário desconhecido.');
    }

    request.user = user;
    return true;
  }
}
