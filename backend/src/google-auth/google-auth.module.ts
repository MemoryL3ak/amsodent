import { Module } from '@nestjs/common';
import { GoogleAuthController } from './google-auth.controller';
import { GoogleAuthService } from './google-auth.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [GoogleAuthController],
  providers: [GoogleAuthService],
  // Lo exportamos para que el futuro módulo Comunicaciones pueda inyectarlo
  // y obtener access_tokens vivos antes de enviar correos via Gmail API.
  exports: [GoogleAuthService],
})
export class GoogleAuthModule {}
