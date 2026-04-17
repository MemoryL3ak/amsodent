import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private client: SupabaseClient;

  constructor(private config: ConfigService) {
    this.client = createClient(
      this.config.get<string>('SUPABASE_URL')!,
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY')!,
    );
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  /** Client scoped to a user's JWT (for RLS) */
  getClientForUser(accessToken: string): SupabaseClient {
    return createClient(
      this.config.get<string>('SUPABASE_URL')!,
      this.config.get<string>('SUPABASE_ANON_KEY')!,
      {
        global: {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      },
    );
  }
}
