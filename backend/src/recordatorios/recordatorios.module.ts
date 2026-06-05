import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { MailingsModule } from '../mailings/mailings.module';
import { RecordatoriosService } from './recordatorios.service';

@Module({
  imports: [SupabaseModule, MailingsModule],
  providers: [RecordatoriosService],
})
export class RecordatoriosModule {}
