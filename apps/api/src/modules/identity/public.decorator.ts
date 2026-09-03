import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/**
 * Abre um endpoint. O guard é global e o padrão é FECHADO: abrir exige um ato
 * explícito e visível em code review. O inverso — proteger endpoint a endpoint
 * — falha por omissão (ADR 0008).
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
