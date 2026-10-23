export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      _deploy_log: {
        Row: {
          applied_at: string | null
          bytes: number | null
          created_at: string | null
          error: string | null
          f: string
          req: number | null
          sha256: string | null
        }
        Insert: {
          applied_at?: string | null
          bytes?: number | null
          created_at?: string | null
          error?: string | null
          f: string
          req?: number | null
          sha256?: string | null
        }
        Update: {
          applied_at?: string | null
          bytes?: number | null
          created_at?: string | null
          error?: string | null
          f?: string
          req?: number | null
          sha256?: string | null
        }
        Relationships: []
      }
      action_idempotency: {
        Row: {
          created_at: string
          idem_key: string
          response: Json | null
          scope: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          idem_key: string
          response?: Json | null
          scope: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          idem_key?: string
          response?: Json | null
          scope?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      affiliate_clicks: {
        Row: {
          accion: string
          clicked_at: string
          id: string
          payload: Json | null
          proveedor: string
          trip_id: string | null
          url_final: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          accion: string
          clicked_at?: string
          id?: string
          payload?: Json | null
          proveedor: string
          trip_id?: string | null
          url_final?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          accion?: string
          clicked_at?: string
          id?: string
          payload?: Json | null
          proveedor?: string
          trip_id?: string | null
          url_final?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_clicks_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_reservation_decisions: {
        Row: {
          created_at: string
          decision: string
          id: number
          inbound_id: string
          log: Json | null
          model: string | null
          reservation_id: string
          rules_version: string | null
          why: string | null
        }
        Insert: {
          created_at?: string
          decision: string
          id?: never
          inbound_id: string
          log?: Json | null
          model?: string | null
          reservation_id: string
          rules_version?: string | null
          why?: string | null
        }
        Update: {
          created_at?: string
          decision?: string
          id?: never
          inbound_id?: string
          log?: Json | null
          model?: string | null
          reservation_id?: string
          rules_version?: string | null
          why?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_reservation_decisions_inbound_id_fkey"
            columns: ["inbound_id"]
            isOneToOne: false
            referencedRelation: "ai_reservation_inbound"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_reservation_decisions_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "ai_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_reservation_events: {
        Row: {
          actor: string
          created_at: string
          data: Json | null
          from_status: string | null
          id: number
          kind: string
          note: string | null
          reservation_id: string
          to_status: string | null
        }
        Insert: {
          actor: string
          created_at?: string
          data?: Json | null
          from_status?: string | null
          id?: never
          kind: string
          note?: string | null
          reservation_id: string
          to_status?: string | null
        }
        Update: {
          actor?: string
          created_at?: string
          data?: Json | null
          from_status?: string | null
          id?: never
          kind?: string
          note?: string | null
          reservation_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_reservation_events_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "ai_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_reservation_inbound: {
        Row: {
          attached_at: string | null
          attempts: number
          auth: Json | null
          body_sha256: string | null
          duplicate_of: string | null
          email_id: string
          from_address: string | null
          from_domain: string | null
          id: string
          linkage: Json | null
          message_id_hash: string | null
          outcome: string | null
          processed_at: string | null
          provider: string
          provider_event_id: string
          provider_received_at: string | null
          raw_pointer: string | null
          raw_sha256: string | null
          received_at: string
          reply_text: string | null
          reply_to: string | null
          reservation_id: string | null
          sender: Json | null
          status: string
        }
        Insert: {
          attached_at?: string | null
          attempts?: number
          auth?: Json | null
          body_sha256?: string | null
          duplicate_of?: string | null
          email_id: string
          from_address?: string | null
          from_domain?: string | null
          id?: string
          linkage?: Json | null
          message_id_hash?: string | null
          outcome?: string | null
          processed_at?: string | null
          provider?: string
          provider_event_id: string
          provider_received_at?: string | null
          raw_pointer?: string | null
          raw_sha256?: string | null
          received_at?: string
          reply_text?: string | null
          reply_to?: string | null
          reservation_id?: string | null
          sender?: Json | null
          status: string
        }
        Update: {
          attached_at?: string | null
          attempts?: number
          auth?: Json | null
          body_sha256?: string | null
          duplicate_of?: string | null
          email_id?: string
          from_address?: string | null
          from_domain?: string | null
          id?: string
          linkage?: Json | null
          message_id_hash?: string | null
          outcome?: string | null
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          provider_received_at?: string | null
          raw_pointer?: string | null
          raw_sha256?: string | null
          received_at?: string
          reply_text?: string | null
          reply_to?: string | null
          reservation_id?: string | null
          sender?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_reservation_inbound_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "ai_reservation_inbound"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_reservation_inbound_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "ai_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_reservations: {
        Row: {
          alternatives: Json | null
          attempts: number
          bridge_offer_id: string | null
          chosen_alternative: Json | null
          claude_calls: number
          closed_at: string | null
          confirmation: Json | null
          confirmation_code: string | null
          confirmed_at: string | null
          consent: Json | null
          created_at: string
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          evidence: Json
          expires_at: string | null
          id: string
          idempotency_key: string | null
          last_error: string | null
          notes: string | null
          party_size: number
          reason: string | null
          ref_code: string
          reminder_sent_at: string | null
          reply_token: string
          request_id: string | null
          requested_for: string
          requested_local: string
          send_lock_at: string | null
          sent_at: string | null
          source: string
          status: string
          status_changed_at: string
          trip_id: string | null
          updated_at: string
          user_id: string
          user_options: Json | null
          venue_address: string | null
          venue_booking_url: string | null
          venue_city: string | null
          venue_country: string | null
          venue_email: string | null
          venue_email_source: Json | null
          venue_experience_id: string | null
          venue_language: string
          venue_maps_url: string | null
          venue_name: string
          venue_phone: string | null
          venue_place_id: string | null
          venue_replied_at: string | null
          venue_reply_excerpt: string | null
          venue_timezone: string
          venue_website: string | null
        }
        Insert: {
          alternatives?: Json | null
          attempts?: number
          bridge_offer_id?: string | null
          chosen_alternative?: Json | null
          claude_calls?: number
          closed_at?: string | null
          confirmation?: Json | null
          confirmation_code?: string | null
          confirmed_at?: string | null
          consent?: Json | null
          created_at?: string
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          evidence?: Json
          expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          notes?: string | null
          party_size: number
          reason?: string | null
          ref_code: string
          reminder_sent_at?: string | null
          reply_token: string
          request_id?: string | null
          requested_for: string
          requested_local: string
          send_lock_at?: string | null
          sent_at?: string | null
          source?: string
          status?: string
          status_changed_at?: string
          trip_id?: string | null
          updated_at?: string
          user_id: string
          user_options?: Json | null
          venue_address?: string | null
          venue_booking_url?: string | null
          venue_city?: string | null
          venue_country?: string | null
          venue_email?: string | null
          venue_email_source?: Json | null
          venue_experience_id?: string | null
          venue_language?: string
          venue_maps_url?: string | null
          venue_name: string
          venue_phone?: string | null
          venue_place_id?: string | null
          venue_replied_at?: string | null
          venue_reply_excerpt?: string | null
          venue_timezone: string
          venue_website?: string | null
        }
        Update: {
          alternatives?: Json | null
          attempts?: number
          bridge_offer_id?: string | null
          chosen_alternative?: Json | null
          claude_calls?: number
          closed_at?: string | null
          confirmation?: Json | null
          confirmation_code?: string | null
          confirmed_at?: string | null
          consent?: Json | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          evidence?: Json
          expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          notes?: string | null
          party_size?: number
          reason?: string | null
          ref_code?: string
          reminder_sent_at?: string | null
          reply_token?: string
          request_id?: string | null
          requested_for?: string
          requested_local?: string
          send_lock_at?: string | null
          sent_at?: string | null
          source?: string
          status?: string
          status_changed_at?: string
          trip_id?: string | null
          updated_at?: string
          user_id?: string
          user_options?: Json | null
          venue_address?: string | null
          venue_booking_url?: string | null
          venue_city?: string | null
          venue_country?: string | null
          venue_email?: string | null
          venue_email_source?: Json | null
          venue_experience_id?: string | null
          venue_language?: string
          venue_maps_url?: string | null
          venue_name?: string
          venue_phone?: string | null
          venue_place_id?: string | null
          venue_replied_at?: string | null
          venue_reply_excerpt?: string | null
          venue_timezone?: string
          venue_website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_reservations_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "concierge_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_reservations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_reservations_venue_experience_id_fkey"
            columns: ["venue_experience_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_reservations_venue_experience_id_fkey"
            columns: ["venue_experience_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences_v"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_log: {
        Row: {
          cost_estimate_usd: number
          created_at: string
          function: string
          id: number
          input_tokens: number
          model: string | null
          output_tokens: number
          plan: string | null
          provider: string
          searches: number
          user_id: string | null
        }
        Insert: {
          cost_estimate_usd?: number
          created_at?: string
          function: string
          id?: never
          input_tokens?: number
          model?: string | null
          output_tokens?: number
          plan?: string | null
          provider: string
          searches?: number
          user_id?: string | null
        }
        Update: {
          cost_estimate_usd?: number
          created_at?: string
          function?: string
          id?: never
          input_tokens?: number
          model?: string | null
          output_tokens?: number
          plan?: string | null
          provider?: string
          searches?: number
          user_id?: string | null
        }
        Relationships: []
      }
      ai_user_preferences: {
        Row: {
          actividades_tarde: string[] | null
          companeros_viaje: string | null
          completado: boolean | null
          created_at: string
          deal_breakers: string[] | null
          dna_signal: Json | null
          dna_updated_at: string | null
          dna_version: number | null
          estilo_comida: string[] | null
          hospedaje_preferencias: string[] | null
          id: string
          mejor_viaje_descripcion: string | null
          nivel_planificacion: string | null
          nivel_presupuesto: string | null
          perfil_ia: Json | null
          proposito_viaje: string | null
          restricciones_alimentarias: string[] | null
          ritmo_viaje: string | null
          trip_count: number | null
          updated_at: string
          user_id: string
          visit_count: number | null
        }
        Insert: {
          actividades_tarde?: string[] | null
          companeros_viaje?: string | null
          completado?: boolean | null
          created_at?: string
          deal_breakers?: string[] | null
          dna_signal?: Json | null
          dna_updated_at?: string | null
          dna_version?: number | null
          estilo_comida?: string[] | null
          hospedaje_preferencias?: string[] | null
          id?: string
          mejor_viaje_descripcion?: string | null
          nivel_planificacion?: string | null
          nivel_presupuesto?: string | null
          perfil_ia?: Json | null
          proposito_viaje?: string | null
          restricciones_alimentarias?: string[] | null
          ritmo_viaje?: string | null
          trip_count?: number | null
          updated_at?: string
          user_id: string
          visit_count?: number | null
        }
        Update: {
          actividades_tarde?: string[] | null
          companeros_viaje?: string | null
          completado?: boolean | null
          created_at?: string
          deal_breakers?: string[] | null
          dna_signal?: Json | null
          dna_updated_at?: string | null
          dna_version?: number | null
          estilo_comida?: string[] | null
          hospedaje_preferencias?: string[] | null
          id?: string
          mejor_viaje_descripcion?: string | null
          nivel_planificacion?: string | null
          nivel_presupuesto?: string | null
          perfil_ia?: Json | null
          proposito_viaje?: string | null
          restricciones_alimentarias?: string[] | null
          ritmo_viaje?: string | null
          trip_count?: number | null
          updated_at?: string
          user_id?: string
          visit_count?: number | null
        }
        Relationships: []
      }
      app_flags: {
        Row: {
          key: string
          note: string | null
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          note?: string | null
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          note?: string | null
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      auth_email_changes: {
        Row: {
          changed_at: string
          user_id: string
        }
        Insert: {
          changed_at?: string
          user_id: string
        }
        Update: {
          changed_at?: string
          user_id?: string
        }
        Relationships: []
      }
      avatar_image_usage: {
        Row: {
          created_at: string
          id: number
          images: number
          kind: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          images: number
          kind: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: number
          images?: number
          kind?: string
          user_id?: string
        }
        Relationships: []
      }
      avatar_profiles: {
        Row: {
          base_path: string | null
          created_at: string
          current_path: string | null
          current_url: string | null
          likeness_score: number | null
          model: string | null
          updated_at: string
          user_id: string
          version: number
          visible_keys: string[]
        }
        Insert: {
          base_path?: string | null
          created_at?: string
          current_path?: string | null
          current_url?: string | null
          likeness_score?: number | null
          model?: string | null
          updated_at?: string
          user_id: string
          version?: number
          visible_keys?: string[]
        }
        Update: {
          base_path?: string | null
          created_at?: string
          current_path?: string | null
          current_url?: string | null
          likeness_score?: number | null
          model?: string | null
          updated_at?: string
          user_id?: string
          version?: number
          visible_keys?: string[]
        }
        Relationships: []
      }
      avatar_souvenirs: {
        Row: {
          attempts: number
          emoji: string
          error: string | null
          fuente: string
          id: string
          likeness_score: number | null
          lugar: string
          model: string | null
          nombre: string
          pais: string | null
          prompt: string
          slot: string
          souvenir_key: string
          status: string
          trip_end: string | null
          trip_id: string | null
          trip_key: string
          trip_label: string
          unlocked_at: string
          updated_at: string
          user_id: string
          visible: boolean
        }
        Insert: {
          attempts?: number
          emoji?: string
          error?: string | null
          fuente?: string
          id?: string
          likeness_score?: number | null
          lugar: string
          model?: string | null
          nombre: string
          pais?: string | null
          prompt?: string
          slot?: string
          souvenir_key: string
          status?: string
          trip_end?: string | null
          trip_id?: string | null
          trip_key: string
          trip_label?: string
          unlocked_at?: string
          updated_at?: string
          user_id: string
          visible?: boolean
        }
        Update: {
          attempts?: number
          emoji?: string
          error?: string | null
          fuente?: string
          id?: string
          likeness_score?: number | null
          lugar?: string
          model?: string | null
          nombre?: string
          pais?: string | null
          prompt?: string
          slot?: string
          souvenir_key?: string
          status?: string
          trip_end?: string | null
          trip_id?: string | null
          trip_key?: string
          trip_label?: string
          unlocked_at?: string
          updated_at?: string
          user_id?: string
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "avatar_souvenirs_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      avatar_variants: {
        Row: {
          created_at: string
          diferencias: string[]
          id: string
          likeness_score: number | null
          model: string | null
          origen: string
          status: string
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          diferencias?: string[]
          id?: string
          likeness_score?: number | null
          model?: string | null
          origen?: string
          status?: string
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          diferencias?: string[]
          id?: string
          likeness_score?: number | null
          model?: string | null
          origen?: string
          status?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: []
      }
      badges: {
        Row: {
          categoria: string | null
          descripcion: string | null
          icono: string | null
          id: string
          meta_tipo: string | null
          meta_valor: number | null
          nombre: string
        }
        Insert: {
          categoria?: string | null
          descripcion?: string | null
          icono?: string | null
          id: string
          meta_tipo?: string | null
          meta_valor?: number | null
          nombre: string
        }
        Update: {
          categoria?: string | null
          descripcion?: string | null
          icono?: string | null
          id?: string
          meta_tipo?: string | null
          meta_valor?: number | null
          nombre?: string
        }
        Relationships: []
      }
      behavioral_insights: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json | null
          target_label: string | null
          target_type: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json | null
          target_label?: string | null
          target_type?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          target_label?: string | null
          target_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      booking_intent_events: {
        Row: {
          actor: string
          actor_id: string | null
          created_at: string
          from_state: string | null
          id: number
          intent_id: string
          note: string | null
          to_state: string
        }
        Insert: {
          actor: string
          actor_id?: string | null
          created_at?: string
          from_state?: string | null
          id?: never
          intent_id: string
          note?: string | null
          to_state: string
        }
        Update: {
          actor?: string
          actor_id?: string | null
          created_at?: string
          from_state?: string | null
          id?: never
          intent_id?: string
          note?: string | null
          to_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_intent_events_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "booking_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_intents: {
        Row: {
          action_kind: string
          ai_reservation_id: string | null
          booking_id: string | null
          booking_mode: string
          channel: string
          concierge_request_id: string | null
          confirmation_evidence: Json | null
          consent_saved_at: string | null
          created_at: string
          currency: string | null
          id: string
          idempotency_key: string
          offer: Json
          offer_expires_at: string | null
          offer_id: string
          price: number | null
          price_checked_at: string | null
          processor: string | null
          product_type: string
          provider: string
          provider_offer_id: string | null
          redirect_count: number
          redirected_at: string | null
          state: string
          state_changed_at: string
          target_host: string | null
          target_url: string | null
          title: string
          trip_id: string | null
          updated_at: string
          user_id: string
          user_report: Json | null
          verification: string
        }
        Insert: {
          action_kind: string
          ai_reservation_id?: string | null
          booking_id?: string | null
          booking_mode: string
          channel?: string
          concierge_request_id?: string | null
          confirmation_evidence?: Json | null
          consent_saved_at?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          idempotency_key: string
          offer?: Json
          offer_expires_at?: string | null
          offer_id: string
          price?: number | null
          price_checked_at?: string | null
          processor?: string | null
          product_type: string
          provider: string
          provider_offer_id?: string | null
          redirect_count?: number
          redirected_at?: string | null
          state?: string
          state_changed_at?: string
          target_host?: string | null
          target_url?: string | null
          title: string
          trip_id?: string | null
          updated_at?: string
          user_id: string
          user_report?: Json | null
          verification?: string
        }
        Update: {
          action_kind?: string
          ai_reservation_id?: string | null
          booking_id?: string | null
          booking_mode?: string
          channel?: string
          concierge_request_id?: string | null
          confirmation_evidence?: Json | null
          consent_saved_at?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          idempotency_key?: string
          offer?: Json
          offer_expires_at?: string | null
          offer_id?: string
          price?: number | null
          price_checked_at?: string | null
          processor?: string | null
          product_type?: string
          provider?: string
          provider_offer_id?: string | null
          redirect_count?: number
          redirected_at?: string | null
          state?: string
          state_changed_at?: string
          target_host?: string | null
          target_url?: string | null
          title?: string
          trip_id?: string | null
          updated_at?: string
          user_id?: string
          user_report?: Json | null
          verification?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_intents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_intents_concierge_request_id_fkey"
            columns: ["concierge_request_id"]
            isOneToOne: false
            referencedRelation: "concierge_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_intents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_link_checks: {
        Row: {
          check_count: number
          checked_at: string | null
          created_at: string
          expires_at: string | null
          final_host: string | null
          findings: Json
          host: string
          http_status: number | null
          id: string
          kind: string
          last_error: string | null
          source: string
          status: string
          subject: string | null
          url: string
          url_hash: string
        }
        Insert: {
          check_count?: number
          checked_at?: string | null
          created_at?: string
          expires_at?: string | null
          final_host?: string | null
          findings?: Json
          host: string
          http_status?: number | null
          id?: string
          kind: string
          last_error?: string | null
          source: string
          status?: string
          subject?: string | null
          url: string
          url_hash: string
        }
        Update: {
          check_count?: number
          checked_at?: string | null
          created_at?: string
          expires_at?: string | null
          final_host?: string | null
          findings?: Json
          host?: string
          http_status?: number | null
          id?: string
          kind?: string
          last_error?: string | null
          source?: string
          status?: string
          subject?: string | null
          url?: string
          url_hash?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          booking_url: string | null
          category: string
          city: string | null
          commission_amount: number | null
          confirmation_code: string | null
          country: string | null
          created_at: string
          end_at: string | null
          id: string
          image_url: string | null
          partner_reference: string | null
          price_amount: number | null
          price_currency: string | null
          provider: string
          raw_payload: Json | null
          start_at: string | null
          status: string
          subtitle: string | null
          title: string
          trip_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          booking_url?: string | null
          category: string
          city?: string | null
          commission_amount?: number | null
          confirmation_code?: string | null
          country?: string | null
          created_at?: string
          end_at?: string | null
          id?: string
          image_url?: string | null
          partner_reference?: string | null
          price_amount?: number | null
          price_currency?: string | null
          provider: string
          raw_payload?: Json | null
          start_at?: string | null
          status?: string
          subtitle?: string | null
          title: string
          trip_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          booking_url?: string | null
          category?: string
          city?: string | null
          commission_amount?: number | null
          confirmation_code?: string | null
          country?: string | null
          created_at?: string
          end_at?: string | null
          id?: string
          image_url?: string | null
          partner_reference?: string | null
          price_amount?: number | null
          price_currency?: string | null
          provider?: string
          raw_payload?: Json | null
          start_at?: string | null
          status?: string
          subtitle?: string | null
          title?: string
          trip_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      comp_grants: {
        Row: {
          created_at: string
          email: string
        }
        Insert: {
          created_at?: string
          email: string
        }
        Update: {
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      concierge_conversations: {
        Row: {
          created_at: string
          id: string
          messages: Json
          resumen_actualizado_at: string | null
          resumen_historico: string | null
          trip_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          messages?: Json
          resumen_actualizado_at?: string | null
          resumen_historico?: string | null
          trip_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          messages?: Json
          resumen_actualizado_at?: string | null
          resumen_historico?: string | null
          trip_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "concierge_conversations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      concierge_request_events: {
        Row: {
          actor: string
          actor_id: string | null
          created_at: string
          from_status: string | null
          id: number
          note: string | null
          request_id: string
          to_status: string
        }
        Insert: {
          actor: string
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: never
          note?: string | null
          request_id: string
          to_status: string
        }
        Update: {
          actor?: string
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: never
          note?: string | null
          request_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "concierge_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "concierge_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      concierge_requests: {
        Row: {
          contact_method: string | null
          created_at: string
          experience_id: string | null
          external_confirmation: Json | null
          fixer_escalation_id: string | null
          id: string
          owner_admin_id: string | null
          party_size: number | null
          payload: Json
          plan_group: string | null
          preferences: string | null
          requested_for: string | null
          status: string
          status_changed_at: string
          title: string
          trip_id: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contact_method?: string | null
          created_at?: string
          experience_id?: string | null
          external_confirmation?: Json | null
          fixer_escalation_id?: string | null
          id?: string
          owner_admin_id?: string | null
          party_size?: number | null
          payload?: Json
          plan_group?: string | null
          preferences?: string | null
          requested_for?: string | null
          status?: string
          status_changed_at?: string
          title: string
          trip_id?: string | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contact_method?: string | null
          created_at?: string
          experience_id?: string | null
          external_confirmation?: Json | null
          fixer_escalation_id?: string | null
          id?: string
          owner_admin_id?: string | null
          party_size?: number | null
          payload?: Json
          plan_group?: string | null
          preferences?: string | null
          requested_for?: string | null
          status?: string
          status_changed_at?: string
          title?: string
          trip_id?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "concierge_requests_experience_id_fkey"
            columns: ["experience_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concierge_requests_experience_id_fkey"
            columns: ["experience_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concierge_requests_fixer_escalation_id_fkey"
            columns: ["fixer_escalation_id"]
            isOneToOne: false
            referencedRelation: "fixer_escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concierge_requests_trip_fk"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_request_steps: {
        Row: {
          attempts: number
          finished_at: string | null
          last_error: string | null
          request_id: string
          started_at: string | null
          status: string
          step: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          finished_at?: string | null
          last_error?: string | null
          request_id: string
          started_at?: string | null
          status?: string
          step: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          finished_at?: string | null
          last_error?: string | null
          request_id?: string
          started_at?: string | null
          status?: string
          step?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deletion_request_steps_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "deletion_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_requests: {
        Row: {
          account_id: string
          completed_at: string | null
          created_at: string
          id: string
          identity_deleted_at: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          identity_deleted_at?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          identity_deleted_at?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      destination_daily_costs: {
        Row: {
          city_name: string
          destination_code: string
          exp_standard_usd: number
          exp_vip_usd: number
          food_michelin_usd: number
          food_premium_usd: number
          food_standard_usd: number
          hotel_3_star_usd: number
          hotel_4_star_usd: number
          hotel_5_star_usd: number
          id: string
          transport_private_usd: number
          transport_public_usd: number
        }
        Insert: {
          city_name: string
          destination_code: string
          exp_standard_usd: number
          exp_vip_usd: number
          food_michelin_usd: number
          food_premium_usd: number
          food_standard_usd: number
          hotel_3_star_usd: number
          hotel_4_star_usd: number
          hotel_5_star_usd: number
          id?: string
          transport_private_usd: number
          transport_public_usd: number
        }
        Update: {
          city_name?: string
          destination_code?: string
          exp_standard_usd?: number
          exp_vip_usd?: number
          food_michelin_usd?: number
          food_premium_usd?: number
          food_standard_usd?: number
          hotel_3_star_usd?: number
          hotel_4_star_usd?: number
          hotel_5_star_usd?: number
          id?: string
          transport_private_usd?: number
          transport_public_usd?: number
        }
        Relationships: []
      }
      edition_article_sources: {
        Row: {
          article_id: string
          source_id: string
          used_for: string | null
        }
        Insert: {
          article_id: string
          source_id: string
          used_for?: string | null
        }
        Update: {
          article_id?: string
          source_id?: string
          used_for?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "edition_article_sources_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "edition_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edition_article_sources_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "edition_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      edition_articles: {
        Row: {
          actions: Json
          approved_at: string | null
          approved_by_label: string | null
          body: Json
          byline: Json
          corrected_at: string | null
          correction_note: string | null
          created_at: string
          dek: Json
          destinations: string[]
          drafted_by: string
          editor_notes: string | null
          fact_date: string | null
          fact_status: string
          format: string
          hero_image_id: string | null
          id: string
          issue_id: string
          kicker: Json
          published_at: string | null
          reading_minutes: number
          retracted_at: string | null
          retraction_note: string | null
          scheduled_for: string | null
          section: string
          sensitive: boolean
          slug: string
          sort_order: number
          status: string
          title: Json
          topics: string[]
          updated_at: string
          valid_until: string | null
          version: number
          word_count: number
        }
        Insert: {
          actions?: Json
          approved_at?: string | null
          approved_by_label?: string | null
          body: Json
          byline?: Json
          corrected_at?: string | null
          correction_note?: string | null
          created_at?: string
          dek?: Json
          destinations?: string[]
          drafted_by?: string
          editor_notes?: string | null
          fact_date?: string | null
          fact_status: string
          format: string
          hero_image_id?: string | null
          id?: string
          issue_id: string
          kicker?: Json
          published_at?: string | null
          reading_minutes?: number
          retracted_at?: string | null
          retraction_note?: string | null
          scheduled_for?: string | null
          section: string
          sensitive?: boolean
          slug: string
          sort_order?: number
          status?: string
          title: Json
          topics?: string[]
          updated_at?: string
          valid_until?: string | null
          version?: number
          word_count?: number
        }
        Update: {
          actions?: Json
          approved_at?: string | null
          approved_by_label?: string | null
          body?: Json
          byline?: Json
          corrected_at?: string | null
          correction_note?: string | null
          created_at?: string
          dek?: Json
          destinations?: string[]
          drafted_by?: string
          editor_notes?: string | null
          fact_date?: string | null
          fact_status?: string
          format?: string
          hero_image_id?: string | null
          id?: string
          issue_id?: string
          kicker?: Json
          published_at?: string | null
          reading_minutes?: number
          retracted_at?: string | null
          retraction_note?: string | null
          scheduled_for?: string | null
          section?: string
          sensitive?: boolean
          slug?: string
          sort_order?: number
          status?: string
          title?: Json
          topics?: string[]
          updated_at?: string
          valid_until?: string | null
          version?: number
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "edition_articles_hero_image_id_fkey"
            columns: ["hero_image_id"]
            isOneToOne: false
            referencedRelation: "edition_images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edition_articles_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "edition_issues"
            referencedColumns: ["id"]
          },
        ]
      }
      edition_downloads: {
        Row: {
          article_count: number
          bytes: number | null
          created_at: string
          duration_ms: number | null
          format: string
          id: number
          image_count: number
          issue_id: string | null
          kind: string
          language: string | null
          user_id: string
        }
        Insert: {
          article_count?: number
          bytes?: number | null
          created_at?: string
          duration_ms?: number | null
          format: string
          id?: never
          image_count?: number
          issue_id?: string | null
          kind: string
          language?: string | null
          user_id: string
        }
        Update: {
          article_count?: number
          bytes?: number | null
          created_at?: string
          duration_ms?: number | null
          format?: string
          id?: never
          image_count?: number
          issue_id?: string | null
          kind?: string
          language?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edition_downloads_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "edition_issues"
            referencedColumns: ["id"]
          },
        ]
      }
      edition_images: {
        Row: {
          allow_offline: boolean
          allow_pdf: boolean
          alt_en: string | null
          alt_es: string
          created_at: string
          depicts_en: string | null
          depicts_es: string
          focal: string | null
          id: string
          illustrative: boolean
          key: string
          license: string | null
          license_note: string | null
          license_reviewed_at: string | null
          license_status: string
          license_url: string | null
          page_url: string | null
          photographer: string | null
          photographer_url: string | null
          provider: string
          provider_id: string | null
          updated_at: string
          url: string
          verification: string | null
        }
        Insert: {
          allow_offline?: boolean
          allow_pdf?: boolean
          alt_en?: string | null
          alt_es: string
          created_at?: string
          depicts_en?: string | null
          depicts_es: string
          focal?: string | null
          id?: string
          illustrative: boolean
          key: string
          license?: string | null
          license_note?: string | null
          license_reviewed_at?: string | null
          license_status?: string
          license_url?: string | null
          page_url?: string | null
          photographer?: string | null
          photographer_url?: string | null
          provider: string
          provider_id?: string | null
          updated_at?: string
          url: string
          verification?: string | null
        }
        Update: {
          allow_offline?: boolean
          allow_pdf?: boolean
          alt_en?: string | null
          alt_es?: string
          created_at?: string
          depicts_en?: string | null
          depicts_es?: string
          focal?: string | null
          id?: string
          illustrative?: boolean
          key?: string
          license?: string | null
          license_note?: string | null
          license_reviewed_at?: string | null
          license_status?: string
          license_url?: string | null
          page_url?: string | null
          photographer?: string | null
          photographer_url?: string | null
          provider?: string
          provider_id?: string | null
          updated_at?: string
          url?: string
          verification?: string | null
        }
        Relationships: []
      }
      edition_issues: {
        Row: {
          approved_at: string | null
          approved_by_label: string | null
          cover_article_slug: string | null
          cover_image_id: string | null
          cover_line: Json
          created_at: string
          id: string
          number: number
          period_label: Json
          period_start: string
          plan: Json
          published_at: string | null
          research_closed_at: string | null
          retracted_at: string | null
          retraction_note: string | null
          scheduled_for: string | null
          slug: string
          status: string
          title: Json
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by_label?: string | null
          cover_article_slug?: string | null
          cover_image_id?: string | null
          cover_line?: Json
          created_at?: string
          id?: string
          number: number
          period_label: Json
          period_start: string
          plan?: Json
          published_at?: string | null
          research_closed_at?: string | null
          retracted_at?: string | null
          retraction_note?: string | null
          scheduled_for?: string | null
          slug: string
          status?: string
          title: Json
          updated_at?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by_label?: string | null
          cover_article_slug?: string | null
          cover_image_id?: string | null
          cover_line?: Json
          created_at?: string
          id?: string
          number?: number
          period_label?: Json
          period_start?: string
          plan?: Json
          published_at?: string | null
          research_closed_at?: string | null
          retracted_at?: string | null
          retraction_note?: string | null
          scheduled_for?: string | null
          slug?: string
          status?: string
          title?: Json
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "edition_issues_cover_image_id_fkey"
            columns: ["cover_image_id"]
            isOneToOne: false
            referencedRelation: "edition_images"
            referencedColumns: ["id"]
          },
        ]
      }
      edition_member_prefs: {
        Row: {
          consented_at: string | null
          edition_kind: string
          excluded: string[]
          interests: Json
          language: string
          personalization_consent: boolean
          reading_minutes: number
          section_order: string[]
          show_name_on_cover: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          consented_at?: string | null
          edition_kind?: string
          excluded?: string[]
          interests?: Json
          language?: string
          personalization_consent?: boolean
          reading_minutes?: number
          section_order?: string[]
          show_name_on_cover?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          consented_at?: string | null
          edition_kind?: string
          excluded?: string[]
          interests?: Json
          language?: string
          personalization_consent?: boolean
          reading_minutes?: number
          section_order?: string[]
          show_name_on_cover?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      edition_reviews: {
        Row: {
          action: string
          created_at: string
          diff: Json | null
          entity: string
          entity_key: string
          id: number
          note: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          diff?: Json | null
          entity: string
          entity_key: string
          id?: never
          note?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          diff?: Json | null
          entity?: string
          entity_key?: string
          id?: never
          note?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      edition_saves: {
        Row: {
          article_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          article_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          article_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edition_saves_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "edition_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      edition_sources: {
        Row: {
          attribution: string
          author: string | null
          consulted_at: string
          created_at: string
          data_used: string
          distribution_restrictions: string | null
          entity: string
          id: string
          key: string
          kind: string
          link_checked_at: string | null
          link_http: number | null
          link_status: string
          published_at: string | null
          reuse_rights: string
          title: string
          updated_at: string
          url: string
          verification: string
        }
        Insert: {
          attribution: string
          author?: string | null
          consulted_at: string
          created_at?: string
          data_used: string
          distribution_restrictions?: string | null
          entity: string
          id?: string
          key: string
          kind: string
          link_checked_at?: string | null
          link_http?: number | null
          link_status?: string
          published_at?: string | null
          reuse_rights: string
          title: string
          updated_at?: string
          url: string
          verification: string
        }
        Update: {
          attribution?: string
          author?: string | null
          consulted_at?: string
          created_at?: string
          data_used?: string
          distribution_restrictions?: string | null
          entity?: string
          id?: string
          key?: string
          kind?: string
          link_checked_at?: string | null
          link_http?: number | null
          link_status?: string
          published_at?: string | null
          reuse_rights?: string
          title?: string
          updated_at?: string
          url?: string
          verification?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          city: string | null
          created_at: string
          currency: string
          description: string | null
          expense_date: string
          id: string
          receipt_url: string | null
          trip_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category: string
          city?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          expense_date?: string
          id?: string
          receipt_url?: string | null
          trip_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          city?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          expense_date?: string
          id?: string
          receipt_url?: string | null
          trip_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      fixer_escalations: {
        Row: {
          contexto_chat: Json | null
          created_at: string
          id: string
          motivo: string | null
          status: string
          trip_id: string | null
          urgencia: string | null
          user_id: string
        }
        Insert: {
          contexto_chat?: Json | null
          created_at?: string
          id?: string
          motivo?: string | null
          status?: string
          trip_id?: string | null
          urgencia?: string | null
          user_id: string
        }
        Update: {
          contexto_chat?: Json | null
          created_at?: string
          id?: string
          motivo?: string | null
          status?: string
          trip_id?: string | null
          urgencia?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixer_escalations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          addressee_id: string
          created_at: string | null
          id: string
          requester_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          addressee_id: string
          created_at?: string | null
          id?: string
          requester_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          addressee_id?: string
          created_at?: string | null
          id?: string
          requester_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      health_checks: {
        Row: {
          email_error: string | null
          email_status: string | null
          id: number
          ok: boolean
          ran_at: string
          results: Json
        }
        Insert: {
          email_error?: string | null
          email_status?: string | null
          id?: number
          ok: boolean
          ran_at?: string
          results: Json
        }
        Update: {
          email_error?: string | null
          email_status?: string | null
          id?: number
          ok?: boolean
          ran_at?: string
          results?: Json
        }
        Relationships: []
      }
      historical_flight_prices: {
        Row: {
          avg_price_usd: number
          cheapest_months: string | null
          destination_city: string
          destination_code: string
          id: string
          origin_code: string | null
          region: string
          updated_at: string | null
        }
        Insert: {
          avg_price_usd: number
          cheapest_months?: string | null
          destination_city: string
          destination_code: string
          id?: string
          origin_code?: string | null
          region: string
          updated_at?: string | null
        }
        Update: {
          avg_price_usd?: number
          cheapest_months?: string | null
          destination_city?: string
          destination_code?: string
          id?: string
          origin_code?: string | null
          region?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      live_search_usage: {
        Row: {
          day: string
          plan: string
          searches: number
          updated_at: string
          user_id: string
        }
        Insert: {
          day: string
          plan: string
          searches?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          day?: string
          plan?: string
          searches?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      members_gate: {
        Row: {
          enabled: boolean
          expires_at: string | null
          id: boolean
          password_hash: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          expires_at?: string | null
          id?: boolean
          password_hash: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          expires_at?: string | null
          id?: boolean
          password_hash?: string
          updated_at?: string
        }
        Relationships: []
      }
      missions: {
        Row: {
          descripcion: string | null
          icono: string | null
          id: string
          meta_tipo: string | null
          meta_valor: number
          recompensa_badge_id: string | null
          titulo: string
          vigente: boolean | null
        }
        Insert: {
          descripcion?: string | null
          icono?: string | null
          id: string
          meta_tipo?: string | null
          meta_valor: number
          recompensa_badge_id?: string | null
          titulo: string
          vigente?: boolean | null
        }
        Update: {
          descripcion?: string | null
          icono?: string | null
          id?: string
          meta_tipo?: string | null
          meta_valor?: number
          recompensa_badge_id?: string | null
          titulo?: string
          vigente?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "missions_recompensa_badge_id_fkey"
            columns: ["recompensa_badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
        ]
      }
      nightlife_access: {
        Row: {
          confirmed_adult: boolean
          confirmed_adult_at: string | null
          created_at: string
          password_access_expires_at: string | null
          password_unlocked: boolean
          password_unlocked_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          confirmed_adult?: boolean
          confirmed_adult_at?: string | null
          created_at?: string
          password_access_expires_at?: string | null
          password_unlocked?: boolean
          password_unlocked_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          confirmed_adult?: boolean
          confirmed_adult_at?: string | null
          created_at?: string
          password_access_expires_at?: string | null
          password_unlocked?: boolean
          password_unlocked_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nightlife_premium: {
        Row: {
          active: boolean
          address: string | null
          categoria: string
          ciudad: string
          ciudad_display: string
          created_at: string
          descripcion: string | null
          dress_code: string | null
          emoji: string | null
          id: string
          lat: number | null
          lng: number | null
          nombre: string
          pais: string | null
          por_que: string | null
          precio_estimado: string | null
          reserva_requerida: boolean
          tags: string[] | null
          website: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          categoria: string
          ciudad: string
          ciudad_display: string
          created_at?: string
          descripcion?: string | null
          dress_code?: string | null
          emoji?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          nombre: string
          pais?: string | null
          por_que?: string | null
          precio_estimado?: string | null
          reserva_requerida?: boolean
          tags?: string[] | null
          website?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          categoria?: string
          ciudad?: string
          ciudad_display?: string
          created_at?: string
          descripcion?: string | null
          dress_code?: string | null
          emoji?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          nombre?: string
          pais?: string | null
          por_que?: string | null
          precio_estimado?: string | null
          reserva_requerida?: boolean
          tags?: string[] | null
          website?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          dedup_key: string | null
          id: string
          read: boolean
          related_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedup_key?: string | null
          id?: string
          read?: boolean
          related_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedup_key?: string | null
          id?: string
          read?: boolean
          related_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      packing_lists: {
        Row: {
          estado_checkboxes: Json
          generated_at: string
          id: string
          lista_json: Json
          trip_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          estado_checkboxes?: Json
          generated_at?: string
          id?: string
          lista_json: Json
          trip_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          estado_checkboxes?: Json
          generated_at?: string
          id?: string
          lista_json?: Json
          trip_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "packing_lists_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: true
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_limits: {
        Row: {
          daily_limit: number | null
          kind: string
          limit_value: number | null
          note: string | null
          period: string
          plan: string
          soft: boolean
          updated_at: string
        }
        Insert: {
          daily_limit?: number | null
          kind: string
          limit_value?: number | null
          note?: string | null
          period: string
          plan: string
          soft?: boolean
          updated_at?: string
        }
        Update: {
          daily_limit?: number | null
          kind?: string
          limit_value?: number | null
          note?: string | null
          period?: string
          plan?: string
          soft?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      price_watch_checks: {
        Row: {
          amount_original: number | null
          approximate_dates: boolean
          checked_at: string
          currency: string | null
          fx_rate: number | null
          id: string
          price_mxn: number
          source: string
          user_id: string
          watch_id: string
        }
        Insert: {
          amount_original?: number | null
          approximate_dates?: boolean
          checked_at?: string
          currency?: string | null
          fx_rate?: number | null
          id?: string
          price_mxn: number
          source?: string
          user_id: string
          watch_id: string
        }
        Update: {
          amount_original?: number | null
          approximate_dates?: boolean
          checked_at?: string
          currency?: string | null
          fx_rate?: number | null
          id?: string
          price_mxn?: number
          source?: string
          user_id?: string
          watch_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_watch_checks_watch_id_fkey"
            columns: ["watch_id"]
            isOneToOne: false
            referencedRelation: "price_watches"
            referencedColumns: ["id"]
          },
        ]
      }
      price_watches: {
        Row: {
          active: boolean
          adults: number
          alerts_sent: number
          baseline_amount_original: number | null
          baseline_approximate: boolean
          baseline_currency: string | null
          baseline_price_mxn: number
          baseline_source: string
          booking_link: string | null
          claimed_at: string | null
          created_at: string
          departure_date: string
          destination_iata: string
          id: string
          last_alert_amount_original: number | null
          last_alert_at: string | null
          last_alert_price_mxn: number | null
          last_amount_original: number | null
          last_checked_at: string | null
          last_price_mxn: number | null
          lowest_price_mxn: number | null
          origin_iata: string
          return_date: string | null
          trip_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          adults?: number
          alerts_sent?: number
          baseline_amount_original?: number | null
          baseline_approximate?: boolean
          baseline_currency?: string | null
          baseline_price_mxn: number
          baseline_source?: string
          booking_link?: string | null
          claimed_at?: string | null
          created_at?: string
          departure_date: string
          destination_iata: string
          id?: string
          last_alert_amount_original?: number | null
          last_alert_at?: string | null
          last_alert_price_mxn?: number | null
          last_amount_original?: number | null
          last_checked_at?: string | null
          last_price_mxn?: number | null
          lowest_price_mxn?: number | null
          origin_iata: string
          return_date?: string | null
          trip_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          adults?: number
          alerts_sent?: number
          baseline_amount_original?: number | null
          baseline_approximate?: boolean
          baseline_currency?: string | null
          baseline_price_mxn?: number
          baseline_source?: string
          booking_link?: string | null
          claimed_at?: string | null
          created_at?: string
          departure_date?: string
          destination_iata?: string
          id?: string
          last_alert_amount_original?: number | null
          last_alert_at?: string | null
          last_alert_price_mxn?: number | null
          last_amount_original?: number | null
          last_checked_at?: string | null
          last_price_mxn?: number | null
          lowest_price_mxn?: number | null
          origin_iata?: string
          return_date?: string | null
          trip_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_watches_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: true
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_age_confirmations: {
        Row: {
          confirmed_at: string
          terms_version: string
          user_id: string
        }
        Insert: {
          confirmed_at?: string
          terms_version: string
          user_id: string
        }
        Update: {
          confirmed_at?: string
          terms_version?: string
          user_id?: string
        }
        Relationships: []
      }
      prive_auth_attempts: {
        Row: {
          at: string
          id: number
          ip_hash: string | null
          kind: string
          reason: string | null
          success: boolean
          user_id: string | null
        }
        Insert: {
          at?: string
          id?: never
          ip_hash?: string | null
          kind: string
          reason?: string | null
          success: boolean
          user_id?: string | null
        }
        Update: {
          at?: string
          id?: never
          ip_hash?: string | null
          kind?: string
          reason?: string | null
          success?: boolean
          user_id?: string | null
        }
        Relationships: []
      }
      prive_credentials: {
        Row: {
          breach_check: string | null
          changed_at: string | null
          failed_count: number
          hard_locked: boolean
          last_failed_at: string | null
          locked_until: string | null
          password_hash: string
          set_at: string
          status: string
          user_id: string
          version: number
        }
        Insert: {
          breach_check?: string | null
          changed_at?: string | null
          failed_count?: number
          hard_locked?: boolean
          last_failed_at?: string | null
          locked_until?: string | null
          password_hash: string
          set_at?: string
          status?: string
          user_id: string
          version?: number
        }
        Update: {
          breach_check?: string | null
          changed_at?: string | null
          failed_count?: number
          hard_locked?: boolean
          last_failed_at?: string | null
          locked_until?: string | null
          password_hash?: string
          set_at?: string
          status?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      prive_dedupe_candidates: {
        Row: {
          a_id: string
          b_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          rule: string
        }
        Insert: {
          a_id: string
          b_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          rule: string
        }
        Update: {
          a_id?: string
          b_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          rule?: string
        }
        Relationships: [
          {
            foreignKeyName: "prive_dedupe_candidates_a_id_fkey"
            columns: ["a_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_dedupe_candidates_a_id_fkey"
            columns: ["a_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_dedupe_candidates_b_id_fkey"
            columns: ["b_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_dedupe_candidates_b_id_fkey"
            columns: ["b_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences_v"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_destination_aliases: {
        Row: {
          alias_norm: string
          destination_id: string
          is_misspelling: boolean
        }
        Insert: {
          alias_norm: string
          destination_id: string
          is_misspelling?: boolean
        }
        Update: {
          alias_norm?: string
          destination_id?: string
          is_misspelling?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "prive_destination_aliases_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_destination_members: {
        Row: {
          area_id: string
          destination_id: string
        }
        Insert: {
          area_id: string
          destination_id: string
        }
        Update: {
          area_id?: string
          destination_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prive_destination_members_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_destination_members_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_destinations: {
        Row: {
          active: boolean
          admin_area: string | null
          coord_note: string | null
          coord_source: string | null
          cover_image_query: string | null
          created_at: string
          currency: string | null
          editor_intro_en: string | null
          editor_intro_es: string | null
          id: string
          is_destination: boolean
          iso_country: string
          kind: string
          lat: number | null
          legacy_ciudad_key: string | null
          lng: number | null
          name_en: string
          name_es: string
          parent_id: string | null
          region_group: string | null
          slug: string
          sort_order: number
          timezone: string | null
          updated_at: string
          wikidata_qid: string | null
        }
        Insert: {
          active?: boolean
          admin_area?: string | null
          coord_note?: string | null
          coord_source?: string | null
          cover_image_query?: string | null
          created_at?: string
          currency?: string | null
          editor_intro_en?: string | null
          editor_intro_es?: string | null
          id?: string
          is_destination?: boolean
          iso_country: string
          kind: string
          lat?: number | null
          legacy_ciudad_key?: string | null
          lng?: number | null
          name_en: string
          name_es: string
          parent_id?: string | null
          region_group?: string | null
          slug: string
          sort_order?: number
          timezone?: string | null
          updated_at?: string
          wikidata_qid?: string | null
        }
        Update: {
          active?: boolean
          admin_area?: string | null
          coord_note?: string | null
          coord_source?: string | null
          cover_image_query?: string | null
          created_at?: string
          currency?: string | null
          editor_intro_en?: string | null
          editor_intro_es?: string | null
          id?: string
          is_destination?: boolean
          iso_country?: string
          kind?: string
          lat?: number | null
          legacy_ciudad_key?: string | null
          lng?: number | null
          name_en?: string
          name_es?: string
          parent_id?: string | null
          region_group?: string | null
          slug?: string
          sort_order?: number
          timezone?: string | null
          updated_at?: string
          wikidata_qid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prive_destinations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_drops: {
        Row: {
          benefit_en: string | null
          benefit_es: string
          commercial_relationship: string
          conditions_en: string | null
          conditions_es: string | null
          created_at: string
          curation_notes: string | null
          curation_status: string
          destination_id: string | null
          discount_pct: number | null
          drop_type: string
          eligibility_en: string | null
          eligibility_es: string | null
          id: string
          import_batch: string | null
          interests: string[]
          last_verified_at: string
          link_url: string
          offer_price: number | null
          partner_benefit_id: string | null
          price_currency: string | null
          price_source_url: string | null
          program_match: string[]
          provider_name: string
          provider_url: string | null
          reference_price: number | null
          restrictions_en: string | null
          restrictions_es: string | null
          slug: string
          source_name: string | null
          source_url: string
          title_en: string | null
          title_es: string
          universes: string[]
          updated_at: string
          valid_from: string | null
          valid_until: string | null
          verified_by: string
        }
        Insert: {
          benefit_en?: string | null
          benefit_es: string
          commercial_relationship?: string
          conditions_en?: string | null
          conditions_es?: string | null
          created_at?: string
          curation_notes?: string | null
          curation_status?: string
          destination_id?: string | null
          discount_pct?: number | null
          drop_type: string
          eligibility_en?: string | null
          eligibility_es?: string | null
          id?: string
          import_batch?: string | null
          interests?: string[]
          last_verified_at: string
          link_url: string
          offer_price?: number | null
          partner_benefit_id?: string | null
          price_currency?: string | null
          price_source_url?: string | null
          program_match?: string[]
          provider_name: string
          provider_url?: string | null
          reference_price?: number | null
          restrictions_en?: string | null
          restrictions_es?: string | null
          slug: string
          source_name?: string | null
          source_url: string
          title_en?: string | null
          title_es: string
          universes?: string[]
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
          verified_by: string
        }
        Update: {
          benefit_en?: string | null
          benefit_es?: string
          commercial_relationship?: string
          conditions_en?: string | null
          conditions_es?: string | null
          created_at?: string
          curation_notes?: string | null
          curation_status?: string
          destination_id?: string | null
          discount_pct?: number | null
          drop_type?: string
          eligibility_en?: string | null
          eligibility_es?: string | null
          id?: string
          import_batch?: string | null
          interests?: string[]
          last_verified_at?: string
          link_url?: string
          offer_price?: number | null
          partner_benefit_id?: string | null
          price_currency?: string | null
          price_source_url?: string | null
          program_match?: string[]
          provider_name?: string
          provider_url?: string | null
          reference_price?: number | null
          restrictions_en?: string | null
          restrictions_es?: string | null
          slug?: string
          source_name?: string | null
          source_url?: string
          title_en?: string | null
          title_es?: string
          universes?: string[]
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
          verified_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "prive_drops_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_drops_partner_benefit_id_fkey"
            columns: ["partner_benefit_id"]
            isOneToOne: false
            referencedRelation: "prive_partner_benefits"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_events: {
        Row: {
          created_at: string
          destination_id: string | null
          event: string
          experience_id: string | null
          id: number
          plan: string | null
          surface: string | null
          trip_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          destination_id?: string | null
          event: string
          experience_id?: string | null
          id?: never
          plan?: string | null
          surface?: string | null
          trip_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          destination_id?: string | null
          event?: string
          experience_id?: string | null
          id?: never
          plan?: string | null
          surface?: string | null
          trip_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      prive_experiences: {
        Row: {
          accolades: Json
          active: boolean
          address: string | null
          age_policy: string
          age_policy_source: string | null
          availability_checked_at: string | null
          availability_for: unknown
          availability_source: string | null
          availability_state: string
          benefit_id: string | null
          booking_method: string
          booking_policy_en: string | null
          booking_policy_es: string | null
          booking_url: string | null
          cancellation_en: string | null
          cancellation_es: string | null
          commercial_label: string
          created_at: string
          curation_notes: string | null
          data_state: string
          dedupe_key: string | null
          description_en: string | null
          description_es: string | null
          destination_id: string
          dress_code_en: string | null
          dress_code_es: string | null
          dress_code_source: string | null
          duration_source: string | null
          event_end: string | null
          event_start: string | null
          geo_precision: string | null
          geo_source: string | null
          google_place_id: string | null
          id: string
          image_alt_en: string | null
          image_alt_es: string | null
          image_checked_at: string | null
          image_is_illustrative: boolean
          image_page_url: string | null
          image_photographer: string | null
          image_photographer_url: string | null
          image_query: string | null
          image_source: string
          image_url: string | null
          import_batch: string | null
          is_members_only_venue: boolean
          lat: number | null
          legacy_nightlife_id: string | null
          license_authority: string | null
          license_ref: string | null
          license_source: string | null
          lng: number | null
          members_only_source: string | null
          merged_legacy_ids: string[]
          name: string
          neighborhood_id: string | null
          opening_hours: Json | null
          opening_hours_checked_at: string | null
          opening_hours_source: string | null
          operating_checked_at: string | null
          operating_status: string
          operator_license: string | null
          operator_name: string | null
          operator_url: string | null
          partner_agreement_id: string | null
          partner_id: string | null
          price_basis: string | null
          price_checked_at: string | null
          price_currency: string | null
          price_level: number | null
          price_max: number | null
          price_min: number | null
          price_note_en: string | null
          price_note_es: string | null
          price_source_url: string | null
          private_conditions_es: string | null
          replaced_by_id: string | null
          reservation_required: boolean | null
          restrictions_en: string | null
          restrictions_es: string | null
          safety_requirements_es: string | null
          season_closes_on: string | null
          season_months: number[] | null
          season_note_es: string | null
          season_reopens_on: string | null
          season_source: string | null
          slug: string
          sources: Json
          subcategory: string
          tags: string[]
          typical_duration_min: number | null
          universe: string
          updated_at: string
          valid_from: string | null
          valid_to: string | null
          verified_at: string | null
          verified_by: string | null
          verified_image: boolean
          website: string | null
          why_fact_en: string | null
          why_fact_es: string | null
        }
        Insert: {
          accolades?: Json
          active?: boolean
          address?: string | null
          age_policy?: string
          age_policy_source?: string | null
          availability_checked_at?: string | null
          availability_for?: unknown
          availability_source?: string | null
          availability_state?: string
          benefit_id?: string | null
          booking_method?: string
          booking_policy_en?: string | null
          booking_policy_es?: string | null
          booking_url?: string | null
          cancellation_en?: string | null
          cancellation_es?: string | null
          commercial_label?: string
          created_at?: string
          curation_notes?: string | null
          data_state?: string
          dedupe_key?: string | null
          description_en?: string | null
          description_es?: string | null
          destination_id: string
          dress_code_en?: string | null
          dress_code_es?: string | null
          dress_code_source?: string | null
          duration_source?: string | null
          event_end?: string | null
          event_start?: string | null
          geo_precision?: string | null
          geo_source?: string | null
          google_place_id?: string | null
          id?: string
          image_alt_en?: string | null
          image_alt_es?: string | null
          image_checked_at?: string | null
          image_is_illustrative?: boolean
          image_page_url?: string | null
          image_photographer?: string | null
          image_photographer_url?: string | null
          image_query?: string | null
          image_source?: string
          image_url?: string | null
          import_batch?: string | null
          is_members_only_venue?: boolean
          lat?: number | null
          legacy_nightlife_id?: string | null
          license_authority?: string | null
          license_ref?: string | null
          license_source?: string | null
          lng?: number | null
          members_only_source?: string | null
          merged_legacy_ids?: string[]
          name: string
          neighborhood_id?: string | null
          opening_hours?: Json | null
          opening_hours_checked_at?: string | null
          opening_hours_source?: string | null
          operating_checked_at?: string | null
          operating_status?: string
          operator_license?: string | null
          operator_name?: string | null
          operator_url?: string | null
          partner_agreement_id?: string | null
          partner_id?: string | null
          price_basis?: string | null
          price_checked_at?: string | null
          price_currency?: string | null
          price_level?: number | null
          price_max?: number | null
          price_min?: number | null
          price_note_en?: string | null
          price_note_es?: string | null
          price_source_url?: string | null
          private_conditions_es?: string | null
          replaced_by_id?: string | null
          reservation_required?: boolean | null
          restrictions_en?: string | null
          restrictions_es?: string | null
          safety_requirements_es?: string | null
          season_closes_on?: string | null
          season_months?: number[] | null
          season_note_es?: string | null
          season_reopens_on?: string | null
          season_source?: string | null
          slug: string
          sources?: Json
          subcategory: string
          tags?: string[]
          typical_duration_min?: number | null
          universe: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
          verified_at?: string | null
          verified_by?: string | null
          verified_image?: boolean
          website?: string | null
          why_fact_en?: string | null
          why_fact_es?: string | null
        }
        Update: {
          accolades?: Json
          active?: boolean
          address?: string | null
          age_policy?: string
          age_policy_source?: string | null
          availability_checked_at?: string | null
          availability_for?: unknown
          availability_source?: string | null
          availability_state?: string
          benefit_id?: string | null
          booking_method?: string
          booking_policy_en?: string | null
          booking_policy_es?: string | null
          booking_url?: string | null
          cancellation_en?: string | null
          cancellation_es?: string | null
          commercial_label?: string
          created_at?: string
          curation_notes?: string | null
          data_state?: string
          dedupe_key?: string | null
          description_en?: string | null
          description_es?: string | null
          destination_id?: string
          dress_code_en?: string | null
          dress_code_es?: string | null
          dress_code_source?: string | null
          duration_source?: string | null
          event_end?: string | null
          event_start?: string | null
          geo_precision?: string | null
          geo_source?: string | null
          google_place_id?: string | null
          id?: string
          image_alt_en?: string | null
          image_alt_es?: string | null
          image_checked_at?: string | null
          image_is_illustrative?: boolean
          image_page_url?: string | null
          image_photographer?: string | null
          image_photographer_url?: string | null
          image_query?: string | null
          image_source?: string
          image_url?: string | null
          import_batch?: string | null
          is_members_only_venue?: boolean
          lat?: number | null
          legacy_nightlife_id?: string | null
          license_authority?: string | null
          license_ref?: string | null
          license_source?: string | null
          lng?: number | null
          members_only_source?: string | null
          merged_legacy_ids?: string[]
          name?: string
          neighborhood_id?: string | null
          opening_hours?: Json | null
          opening_hours_checked_at?: string | null
          opening_hours_source?: string | null
          operating_checked_at?: string | null
          operating_status?: string
          operator_license?: string | null
          operator_name?: string | null
          operator_url?: string | null
          partner_agreement_id?: string | null
          partner_id?: string | null
          price_basis?: string | null
          price_checked_at?: string | null
          price_currency?: string | null
          price_level?: number | null
          price_max?: number | null
          price_min?: number | null
          price_note_en?: string | null
          price_note_es?: string | null
          price_source_url?: string | null
          private_conditions_es?: string | null
          replaced_by_id?: string | null
          reservation_required?: boolean | null
          restrictions_en?: string | null
          restrictions_es?: string | null
          safety_requirements_es?: string | null
          season_closes_on?: string | null
          season_months?: number[] | null
          season_note_es?: string | null
          season_reopens_on?: string | null
          season_source?: string | null
          slug?: string
          sources?: Json
          subcategory?: string
          tags?: string[]
          typical_duration_min?: number | null
          universe?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
          verified_at?: string | null
          verified_by?: string | null
          verified_image?: boolean
          website?: string | null
          why_fact_en?: string | null
          why_fact_es?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prive_benefit_fk"
            columns: ["benefit_id", "partner_agreement_id"]
            isOneToOne: false
            referencedRelation: "prive_partner_benefits"
            referencedColumns: ["id", "agreement_id"]
          },
          {
            foreignKeyName: "prive_experiences_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_experiences_neighborhood_id_fkey"
            columns: ["neighborhood_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_experiences_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_experiences_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_partner_fk"
            columns: ["partner_agreement_id", "partner_id"]
            isOneToOne: false
            referencedRelation: "prive_partner_agreements"
            referencedColumns: ["id", "partner_id"]
          },
        ]
      }
      prive_grants: {
        Row: {
          created_at: string
          email: string
          granted_by: string
          id: string
          reason: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          user_id: string | null
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          email: string
          granted_by: string
          id?: string
          reason: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string | null
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          granted_by?: string
          id?: string
          reason?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string | null
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      prive_insider_tips: {
        Row: {
          before_you_go: boolean
          body_en: string | null
          body_es: string
          category: string
          created_at: string
          destination_id: string
          id: string
          import_batch: string | null
          months: number[] | null
          rank: number
          slug: string
          source_checked_at: string
          source_name: string
          source_url: string
          status: string
          title_en: string | null
          title_es: string
          traveler_types: string[]
          updated_at: string
          valid_until: string | null
          verified_by: string
        }
        Insert: {
          before_you_go?: boolean
          body_en?: string | null
          body_es: string
          category: string
          created_at?: string
          destination_id: string
          id?: string
          import_batch?: string | null
          months?: number[] | null
          rank?: number
          slug: string
          source_checked_at: string
          source_name: string
          source_url: string
          status?: string
          title_en?: string | null
          title_es: string
          traveler_types?: string[]
          updated_at?: string
          valid_until?: string | null
          verified_by: string
        }
        Update: {
          before_you_go?: boolean
          body_en?: string | null
          body_es?: string
          category?: string
          created_at?: string
          destination_id?: string
          id?: string
          import_batch?: string | null
          months?: number[] | null
          rank?: number
          slug?: string
          source_checked_at?: string
          source_name?: string
          source_url?: string
          status?: string
          title_en?: string | null
          title_es?: string
          traveler_types?: string[]
          updated_at?: string
          valid_until?: string | null
          verified_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "prive_insider_tips_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email_attempts: number
          email_last_error: string | null
          email_next_attempt_at: string | null
          email_sent_at: string | null
          email_status: string
          expires_at: string
          id: string
          provider_message_id: string | null
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email_attempts?: number
          email_last_error?: string | null
          email_next_attempt_at?: string | null
          email_sent_at?: string | null
          email_status?: string
          expires_at?: string
          id?: string
          provider_message_id?: string | null
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email_attempts?: number
          email_last_error?: string | null
          email_next_attempt_at?: string | null
          email_sent_at?: string | null
          email_status?: string
          expires_at?: string
          id?: string
          provider_message_id?: string | null
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      prive_ip_blocks: {
        Row: {
          blocked_until: string
          created_at: string
          ip_hash: string
        }
        Insert: {
          blocked_until: string
          created_at?: string
          ip_hash: string
        }
        Update: {
          blocked_until?: string
          created_at?: string
          ip_hash?: string
        }
        Relationships: []
      }
      prive_key_events: {
        Row: {
          created_at: string
          destination_slug: string | null
          event: string
          id: number
          mode: string | null
          ms: number | null
          plan_id: string | null
          tier: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          destination_slug?: string | null
          event: string
          id?: never
          mode?: string | null
          ms?: number | null
          plan_id?: string | null
          tier?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          destination_slug?: string | null
          event?: string
          id?: never
          mode?: string | null
          ms?: number | null
          plan_id?: string | null
          tier?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      prive_key_plans: {
        Row: {
          budget: Json | null
          created_at: string
          destination_slug: string | null
          id: string
          mode: string
          party_size: number | null
          plan_group: string | null
          status: string
          steps: Json
          tier: string
          trip_id: string | null
          updated_at: string
          user_id: string
          wish: string | null
        }
        Insert: {
          budget?: Json | null
          created_at?: string
          destination_slug?: string | null
          id?: string
          mode: string
          party_size?: number | null
          plan_group?: string | null
          status?: string
          steps: Json
          tier: string
          trip_id?: string | null
          updated_at?: string
          user_id: string
          wish?: string | null
        }
        Update: {
          budget?: Json | null
          created_at?: string
          destination_slug?: string | null
          id?: string
          mode?: string
          party_size?: number | null
          plan_group?: string | null
          status?: string
          steps?: Json
          tier?: string
          trip_id?: string | null
          updated_at?: string
          user_id?: string
          wish?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prive_key_plans_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_membership_events: {
        Row: {
          actor: string
          at: string
          details: Json
          event: string
          id: number
          user_id: string | null
        }
        Insert: {
          actor?: string
          at?: string
          details?: Json
          event: string
          id?: never
          user_id?: string | null
        }
        Update: {
          actor?: string
          at?: string
          details?: Json
          event?: string
          id?: never
          user_id?: string | null
        }
        Relationships: []
      }
      prive_memberships: {
        Row: {
          activated_at: string | null
          basis: string
          created_at: string
          eligible_at: string | null
          invited_at: string | null
          member_code: string | null
          onboarding: Json
          revoke_kind: string | null
          revoke_reason: string | null
          revoked_at: string | null
          status: string
          updated_at: string
          user_id: string
          welcome_version_seen: number
        }
        Insert: {
          activated_at?: string | null
          basis: string
          created_at?: string
          eligible_at?: string | null
          invited_at?: string | null
          member_code?: string | null
          onboarding?: Json
          revoke_kind?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          status: string
          updated_at?: string
          user_id: string
          welcome_version_seen?: number
        }
        Update: {
          activated_at?: string | null
          basis?: string
          created_at?: string
          eligible_at?: string | null
          invited_at?: string | null
          member_code?: string | null
          onboarding?: Json
          revoke_kind?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          welcome_version_seen?: number
        }
        Relationships: []
      }
      prive_partner_agreements: {
        Row: {
          availability_rules: string | null
          brand_use: string | null
          cancellation_terms: string | null
          conditions_es: string | null
          created_at: string
          data_sharing: string | null
          evidence_document_path: string | null
          iatos_owner_admin_id: string | null
          id: string
          partner_id: string
          partner_signatory: string | null
          privacy_notice_url: string | null
          signed_at: string | null
          status: string
          tier: string
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          availability_rules?: string | null
          brand_use?: string | null
          cancellation_terms?: string | null
          conditions_es?: string | null
          created_at?: string
          data_sharing?: string | null
          evidence_document_path?: string | null
          iatos_owner_admin_id?: string | null
          id?: string
          partner_id: string
          partner_signatory?: string | null
          privacy_notice_url?: string | null
          signed_at?: string | null
          status?: string
          tier: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          availability_rules?: string | null
          brand_use?: string | null
          cancellation_terms?: string | null
          conditions_es?: string | null
          created_at?: string
          data_sharing?: string | null
          evidence_document_path?: string | null
          iatos_owner_admin_id?: string | null
          id?: string
          partner_id?: string
          partner_signatory?: string | null
          privacy_notice_url?: string | null
          signed_at?: string | null
          status?: string
          tier?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prive_partner_agreements_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "prive_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_partner_benefits: {
        Row: {
          active: boolean
          agreement_id: string
          benefit_en: string | null
          benefit_es: string
          clause_ref: string
          conditions_es: string
          created_at: string
          id: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          active?: boolean
          agreement_id: string
          benefit_en?: string | null
          benefit_es: string
          clause_ref: string
          conditions_es: string
          created_at?: string
          id?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          active?: boolean
          agreement_id?: string
          benefit_en?: string | null
          benefit_es?: string
          clause_ref?: string
          conditions_es?: string
          created_at?: string
          id?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prive_partner_benefits_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "prive_partner_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_partners: {
        Row: {
          created_at: string
          iatos_owner_admin_id: string
          id: string
          iso_country: string | null
          legal_name: string
          notes: string | null
          partner_contact: string | null
          tax_id: string | null
          trade_name: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          created_at?: string
          iatos_owner_admin_id: string
          id?: string
          iso_country?: string | null
          legal_name: string
          notes?: string | null
          partner_contact?: string | null
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          iatos_owner_admin_id?: string
          id?: string
          iso_country?: string | null
          legal_name?: string
          notes?: string | null
          partner_contact?: string | null
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      prive_passport_entries: {
        Row: {
          created_at: string
          destination_id: string | null
          experience_id: string | null
          happened_on: string | null
          id: string
          kind: string
          note: string | null
          place_label: string | null
          title: string
          trip_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          destination_id?: string | null
          experience_id?: string | null
          happened_on?: string | null
          id?: string
          kind: string
          note?: string | null
          place_label?: string | null
          title: string
          trip_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          destination_id?: string | null
          experience_id?: string | null
          happened_on?: string | null
          id?: string
          kind?: string
          note?: string | null
          place_label?: string | null
          title?: string
          trip_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prive_passport_entries_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_passport_entries_experience_id_fkey"
            columns: ["experience_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_passport_entries_experience_id_fkey"
            columns: ["experience_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences_v"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_password_resets: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      prive_radar_items: {
        Row: {
          benefit_es: string
          conditions_note: string | null
          created_at: string
          drop_id: string | null
          id: string
          program_label: string
          source_url: string | null
          state: string
          trip_id: string | null
          updated_at: string
          used_at: string | null
          user_id: string
          verification_note: string | null
          verified_at: string | null
        }
        Insert: {
          benefit_es: string
          conditions_note?: string | null
          created_at?: string
          drop_id?: string | null
          id?: string
          program_label: string
          source_url?: string | null
          state?: string
          trip_id?: string | null
          updated_at?: string
          used_at?: string | null
          user_id: string
          verification_note?: string | null
          verified_at?: string | null
        }
        Update: {
          benefit_es?: string
          conditions_note?: string | null
          created_at?: string
          drop_id?: string | null
          id?: string
          program_label?: string
          source_url?: string | null
          state?: string
          trip_id?: string | null
          updated_at?: string
          used_at?: string | null
          user_id?: string
          verification_note?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prive_radar_items_drop_id_fkey"
            columns: ["drop_id"]
            isOneToOne: false
            referencedRelation: "prive_drops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_radar_items_drop_id_fkey"
            columns: ["drop_id"]
            isOneToOne: false
            referencedRelation: "prive_drops_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_radar_items_drop_id_fkey"
            columns: ["drop_id"]
            isOneToOne: false
            referencedRelation: "prive_drops_v"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_saved_tips: {
        Row: {
          added_to_trip_at: string | null
          created_at: string
          tip_id: string
          trip_id: string | null
          user_id: string
        }
        Insert: {
          added_to_trip_at?: string | null
          created_at?: string
          tip_id: string
          trip_id?: string | null
          user_id: string
        }
        Update: {
          added_to_trip_at?: string | null
          created_at?: string
          tip_id?: string
          trip_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prive_saved_tips_tip_id_fkey"
            columns: ["tip_id"]
            isOneToOne: false
            referencedRelation: "prive_insider_tips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_saved_tips_tip_id_fkey"
            columns: ["tip_id"]
            isOneToOne: false
            referencedRelation: "prive_insider_tips_v"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_sessions: {
        Row: {
          auth_session_id: string | null
          created_at: string
          credential_version: number
          expires_at: string
          id: string
          last_seen_at: string
          remember: boolean
          revoke_reason: string | null
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          auth_session_id?: string | null
          created_at?: string
          credential_version: number
          expires_at: string
          id?: string
          last_seen_at?: string
          remember?: boolean
          revoke_reason?: string | null
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          auth_session_id?: string | null
          created_at?: string
          credential_version?: number
          expires_at?: string
          id?: string
          last_seen_at?: string
          remember?: boolean
          revoke_reason?: string | null
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      prive_value_entries: {
        Row: {
          created_at: string
          currency: string | null
          drop_id: string | null
          evidence_note: string | null
          id: string
          kind: string
          non_monetary_note: string | null
          occurred_on: string | null
          paid_amount: number | null
          radar_item_id: string | null
          reference_amount: number | null
          reference_source: string | null
          savings_amount: number | null
          title: string
          trip_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string | null
          drop_id?: string | null
          evidence_note?: string | null
          id?: string
          kind: string
          non_monetary_note?: string | null
          occurred_on?: string | null
          paid_amount?: number | null
          radar_item_id?: string | null
          reference_amount?: number | null
          reference_source?: string | null
          savings_amount?: number | null
          title: string
          trip_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string | null
          drop_id?: string | null
          evidence_note?: string | null
          id?: string
          kind?: string
          non_monetary_note?: string | null
          occurred_on?: string | null
          paid_amount?: number | null
          radar_item_id?: string | null
          reference_amount?: number | null
          reference_source?: string | null
          savings_amount?: number | null
          title?: string
          trip_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prive_value_entries_drop_id_fkey"
            columns: ["drop_id"]
            isOneToOne: false
            referencedRelation: "prive_drops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_value_entries_drop_id_fkey"
            columns: ["drop_id"]
            isOneToOne: false
            referencedRelation: "prive_drops_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_value_entries_drop_id_fkey"
            columns: ["drop_id"]
            isOneToOne: false
            referencedRelation: "prive_drops_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_value_entries_radar_item_id_fkey"
            columns: ["radar_item_id"]
            isOneToOne: false
            referencedRelation: "prive_radar_items"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_value_events: {
        Row: {
          created_at: string
          destination_id: string | null
          event: string
          id: number
          ref_id: string | null
          state: string | null
          surface: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          destination_id?: string | null
          event: string
          id?: never
          ref_id?: string | null
          state?: string | null
          surface?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          destination_id?: string | null
          event?: string
          id?: never
          ref_id?: string | null
          state?: string | null
          surface?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      pro_paid_periods: {
        Row: {
          amount_paid: number | null
          amount_refunded: number
          created_at: string
          currency: string | null
          id: string
          period: unknown
          source: string
          status: string
          status_before_dispute: string | null
          stripe_customer_id: string | null
          stripe_invoice_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_paid?: number | null
          amount_refunded?: number
          created_at?: string
          currency?: string | null
          id?: string
          period: unknown
          source: string
          status?: string
          status_before_dispute?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_paid?: number | null
          amount_refunded?: number
          created_at?: string
          currency?: string | null
          id?: string
          period?: unknown
          source?: string
          status?: string
          status_before_dispute?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_trip_id: string | null
          avatar_url: string | null
          ciudad_origen: string | null
          created_at: string
          currency_preference: string | null
          email: string | null
          fecha_nacimiento: string | null
          food_dna: Json
          full_name: string | null
          id: string
          invite_code: string | null
          loyalty_programs: Json | null
          nationality: string | null
          pais_origen: string | null
          tier: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          active_trip_id?: string | null
          avatar_url?: string | null
          ciudad_origen?: string | null
          created_at?: string
          currency_preference?: string | null
          email?: string | null
          fecha_nacimiento?: string | null
          food_dna?: Json
          full_name?: string | null
          id: string
          invite_code?: string | null
          loyalty_programs?: Json | null
          nationality?: string | null
          pais_origen?: string | null
          tier?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          active_trip_id?: string | null
          avatar_url?: string | null
          ciudad_origen?: string | null
          created_at?: string
          currency_preference?: string | null
          email?: string | null
          fecha_nacimiento?: string | null
          food_dna?: Json
          full_name?: string | null
          id?: string
          invite_code?: string | null
          loyalty_programs?: Json | null
          nationality?: string | null
          pais_origen?: string | null
          tier?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_trip_fk"
            columns: ["active_trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles_tier_audit: {
        Row: {
          batch_id: string
          changed_at: string
          id: number
          is_pro_at_change: boolean
          new_tier: string | null
          old_tier: string | null
          profile_id: string
          reason: string
          reverted_at: string | null
        }
        Insert: {
          batch_id: string
          changed_at?: string
          id?: never
          is_pro_at_change: boolean
          new_tier?: string | null
          old_tier?: string | null
          profile_id: string
          reason: string
          reverted_at?: string | null
        }
        Update: {
          batch_id?: string
          changed_at?: string
          id?: never
          is_pro_at_change?: boolean
          new_tier?: string | null
          old_tier?: string | null
          profile_id?: string
          reason?: string
          reverted_at?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      quota_reservations: {
        Row: {
          attempts: number
          committed_at: string | null
          counted: boolean
          created_at: string
          expires_at: string
          id: string
          kind: string
          plan: string
          release_reason: string | null
          request_key: string
          result: Json | null
          status: string
          trip_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          committed_at?: string | null
          counted?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          kind: string
          plan?: string
          release_reason?: string | null
          request_key: string
          result?: Json | null
          status?: string
          trip_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          committed_at?: string | null
          counted?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          plan?: string
          release_reason?: string | null
          request_key?: string
          result?: Json | null
          status?: string
          trip_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          created_at: string
          id: string
          subject: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: string
          subject: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: string
          subject?: string
        }
        Relationships: []
      }
      recomendaciones: {
        Row: {
          created_at: string
          descripcion: string | null
          experience_id: string | null
          guardado: boolean | null
          id: string
          imagen_url: string | null
          match_score: number | null
          metadata: Json | null
          tipo: string | null
          titulo: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          descripcion?: string | null
          experience_id?: string | null
          guardado?: boolean | null
          id?: string
          imagen_url?: string | null
          match_score?: number | null
          metadata?: Json | null
          tipo?: string | null
          titulo?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          descripcion?: string | null
          experience_id?: string | null
          guardado?: boolean | null
          id?: string
          imagen_url?: string | null
          match_score?: number | null
          metadata?: Json | null
          tipo?: string | null
          titulo?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recomendaciones_experience_id_fkey"
            columns: ["experience_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recomendaciones_experience_id_fkey"
            columns: ["experience_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences_v"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          code: string
          created_at: string
          id: string
          referrer_id: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          referrer_id: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          referrer_id?: string
          user_id?: string
        }
        Relationships: []
      }
      serp_cache: {
        Row: {
          engine: string
          fetched_at: string
          hits: number
          key_hash: string
          last_hit_at: string | null
          response: Json
          ttl_seconds: number
        }
        Insert: {
          engine: string
          fetched_at?: string
          hits?: number
          key_hash: string
          last_hit_at?: string | null
          response: Json
          ttl_seconds: number
        }
        Update: {
          engine?: string
          fetched_at?: string
          hits?: number
          key_hash?: string
          last_hit_at?: string | null
          response?: Json
          ttl_seconds?: number
        }
        Relationships: []
      }
      social_pokes: {
        Row: {
          created_at: string
          friend_id: string
          gesto: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          friend_id: string
          gesto?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          friend_id?: string
          gesto?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      storage_purge_queue: {
        Row: {
          bucket_id: string
          id: number
          name: string
          queued_at: string
          reason: string
          user_id: string | null
        }
        Insert: {
          bucket_id: string
          id?: number
          name: string
          queued_at?: string
          reason?: string
          user_id?: string | null
        }
        Update: {
          bucket_id?: string
          id?: number
          name?: string
          queued_at?: string
          reason?: string
          user_id?: string | null
        }
        Relationships: []
      }
      stripe_payment_events: {
        Row: {
          account_id: string | null
          action: string
          after_state: Json | null
          alert_status: string | null
          amount: number | null
          amount_refunded: number | null
          before_state: Json | null
          charge_id: string | null
          created_at: string
          currency: string | null
          customer_id: string | null
          dispute_id: string | null
          dispute_reason: string | null
          dispute_status: string | null
          event_created: string | null
          event_id: string
          invoice_id: string | null
          subscription_id: string | null
          type: string
        }
        Insert: {
          account_id?: string | null
          action: string
          after_state?: Json | null
          alert_status?: string | null
          amount?: number | null
          amount_refunded?: number | null
          before_state?: Json | null
          charge_id?: string | null
          created_at?: string
          currency?: string | null
          customer_id?: string | null
          dispute_id?: string | null
          dispute_reason?: string | null
          dispute_status?: string | null
          event_created?: string | null
          event_id: string
          invoice_id?: string | null
          subscription_id?: string | null
          type: string
        }
        Update: {
          account_id?: string | null
          action?: string
          after_state?: Json | null
          alert_status?: string | null
          amount?: number | null
          amount_refunded?: number | null
          before_state?: Json | null
          charge_id?: string | null
          created_at?: string
          currency?: string | null
          customer_id?: string | null
          dispute_id?: string | null
          dispute_reason?: string | null
          dispute_status?: string | null
          event_created?: string | null
          event_id?: string
          invoice_id?: string | null
          subscription_id?: string | null
          type?: string
        }
        Relationships: []
      }
      stripe_pro_prices: {
        Row: {
          created_at: string
          note: string | null
          price_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          price_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          price_id?: string
        }
        Relationships: []
      }
      stripe_trial_fingerprints: {
        Row: {
          customer_id: string | null
          fingerprint: string
          first_seen_at: string
          subscription_id: string
        }
        Insert: {
          customer_id?: string | null
          fingerprint: string
          first_seen_at?: string
          subscription_id: string
        }
        Update: {
          customer_id?: string | null
          fingerprint?: string
          first_seen_at?: string
          subscription_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          currency: string
          current_period_end: string | null
          id: string
          plan: string
          price_id: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_event_created: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          currency?: string
          current_period_end?: string | null
          id?: string
          plan?: string
          price_id?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_event_created?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          currency?: string
          current_period_end?: string | null
          id?: string
          plan?: string
          price_id?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_event_created?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tracked_flights: {
        Row: {
          active: boolean
          arrival_at: string | null
          check_error: string | null
          consecutive_failures: number
          created_at: string
          departure_at: string | null
          flight: string
          flight_date: string | null
          id: string
          last_attempt_at: string | null
          last_checked_at: string | null
          last_estimated: string | null
          last_gate: string | null
          last_notified_estimated: string | null
          last_notified_fingerprint: string | null
          last_provider_status: string | null
          last_status: string | null
          last_successful_check_at: string | null
          last_terminal: string | null
          route: string | null
          trip_id: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          arrival_at?: string | null
          check_error?: string | null
          consecutive_failures?: number
          created_at?: string
          departure_at?: string | null
          flight: string
          flight_date?: string | null
          id?: string
          last_attempt_at?: string | null
          last_checked_at?: string | null
          last_estimated?: string | null
          last_gate?: string | null
          last_notified_estimated?: string | null
          last_notified_fingerprint?: string | null
          last_provider_status?: string | null
          last_status?: string | null
          last_successful_check_at?: string | null
          last_terminal?: string | null
          route?: string | null
          trip_id?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          arrival_at?: string | null
          check_error?: string | null
          consecutive_failures?: number
          created_at?: string
          departure_at?: string | null
          flight?: string
          flight_date?: string | null
          id?: string
          last_attempt_at?: string | null
          last_checked_at?: string | null
          last_estimated?: string | null
          last_gate?: string | null
          last_notified_estimated?: string | null
          last_notified_fingerprint?: string | null
          last_provider_status?: string | null
          last_status?: string | null
          last_successful_check_at?: string | null
          last_terminal?: string | null
          route?: string | null
          trip_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracked_flights_trip_fk"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      travel_moments: {
        Row: {
          ai_tag_status: string
          ai_tagged_at: string | null
          ai_tags: Json | null
          caption: string | null
          created_at: string
          destino: string | null
          id: string
          image_path: string | null
          image_url: string | null
          place_name: string | null
          tags: string[]
          trip_id: string | null
          trip_name: string | null
          user_id: string
        }
        Insert: {
          ai_tag_status?: string
          ai_tagged_at?: string | null
          ai_tags?: Json | null
          caption?: string | null
          created_at?: string
          destino?: string | null
          id?: string
          image_path?: string | null
          image_url?: string | null
          place_name?: string | null
          tags?: string[]
          trip_id?: string | null
          trip_name?: string | null
          user_id: string
        }
        Update: {
          ai_tag_status?: string
          ai_tagged_at?: string | null
          ai_tags?: Json | null
          caption?: string | null
          created_at?: string
          destino?: string | null
          id?: string
          image_path?: string | null
          image_url?: string | null
          place_name?: string | null
          tags?: string[]
          trip_id?: string | null
          trip_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "travel_moments_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      travel_profiles: {
        Row: {
          acompanantes_tipico: string | null
          alergias_restricciones: string[] | null
          completado: boolean | null
          created_at: string
          descripcion_personal: string | null
          destinos_pendientes: string[] | null
          destinos_visitados: string[] | null
          duracion_viaje_ideal: string | null
          estilo_viaje: string[] | null
          id: string
          idiomas_hablados: string[] | null
          intereses: string[] | null
          llegada_estilo: string[] | null
          movilidad_especial: boolean | null
          notas_adicionales: string | null
          perfil_ia: Json | null
          preferencias_comida: string[] | null
          presupuesto_rango: string | null
          ritmo_viaje: string | null
          tipo_alojamiento_preferido: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          acompanantes_tipico?: string | null
          alergias_restricciones?: string[] | null
          completado?: boolean | null
          created_at?: string
          descripcion_personal?: string | null
          destinos_pendientes?: string[] | null
          destinos_visitados?: string[] | null
          duracion_viaje_ideal?: string | null
          estilo_viaje?: string[] | null
          id?: string
          idiomas_hablados?: string[] | null
          intereses?: string[] | null
          llegada_estilo?: string[] | null
          movilidad_especial?: boolean | null
          notas_adicionales?: string | null
          perfil_ia?: Json | null
          preferencias_comida?: string[] | null
          presupuesto_rango?: string | null
          ritmo_viaje?: string | null
          tipo_alojamiento_preferido?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          acompanantes_tipico?: string | null
          alergias_restricciones?: string[] | null
          completado?: boolean | null
          created_at?: string
          descripcion_personal?: string | null
          destinos_pendientes?: string[] | null
          destinos_visitados?: string[] | null
          duracion_viaje_ideal?: string | null
          estilo_viaje?: string[] | null
          id?: string
          idiomas_hablados?: string[] | null
          intereses?: string[] | null
          llegada_estilo?: string[] | null
          movilidad_especial?: boolean | null
          notas_adicionales?: string | null
          perfil_ia?: Json | null
          preferencias_comida?: string[] | null
          presupuesto_rango?: string | null
          ritmo_viaje?: string | null
          tipo_alojamiento_preferido?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trial_grants: {
        Row: {
          email_hash: string
          granted_at: string
          source: string
          trial_end: string
          user_id: string | null
        }
        Insert: {
          email_hash: string
          granted_at?: string
          source?: string
          trial_end: string
          user_id?: string | null
        }
        Update: {
          email_hash?: string
          granted_at?: string
          source?: string
          trial_end?: string
          user_id?: string | null
        }
        Relationships: []
      }
      trip_collaborators: {
        Row: {
          created_at: string
          id: string
          invited_by: string
          role: string
          status: string
          trip_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by: string
          role?: string
          status?: string
          trip_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string
          role?: string
          status?: string
          trip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_collaborators_trip_fk"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_documents: {
        Row: {
          created_at: string
          filename: string
          id: string
          kind: string
          mime: string
          size: number
          storage_path: string
          trip_id: string
          uploaded_by: string
          visibility: string
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          kind: string
          mime: string
          size: number
          storage_path: string
          trip_id: string
          uploaded_by: string
          visibility: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          kind?: string
          mime?: string
          size?: number
          storage_path?: string
          trip_id?: string
          uploaded_by?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_documents_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_import_refs: {
        Row: {
          created_at: string
          id: string
          ref: string
          trip_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ref: string
          trip_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ref?: string
          trip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_import_refs_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_journal_entries: {
        Row: {
          author_id: string
          created_at: string
          id: string
          photo_path: string | null
          photo_url: string | null
          text: string
          trip_id: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          photo_path?: string | null
          photo_url?: string | null
          text: string
          trip_id: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          photo_path?: string | null
          photo_url?: string | null
          text?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_journal_entries_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_packing_items: {
        Row: {
          category: string
          created_at: string
          done: boolean
          id: string
          sort_order: number
          text: string
          trip_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          done?: boolean
          id?: string
          sort_order?: number
          text: string
          trip_id: string
        }
        Update: {
          category?: string
          created_at?: string
          done?: boolean
          id?: string
          sort_order?: number
          text?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_packing_items_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_purchase_marks: {
        Row: {
          category: string | null
          id: string
          item_key: string
          marked_at: string
          marked_by: string | null
          marked_by_name: string | null
          trip_id: string
        }
        Insert: {
          category?: string | null
          id?: string
          item_key: string
          marked_at?: string
          marked_by?: string | null
          marked_by_name?: string | null
          trip_id: string
        }
        Update: {
          category?: string | null
          id?: string
          item_key?: string
          marked_at?: string
          marked_by?: string | null
          marked_by_name?: string | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_purchase_marks_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_quotes: {
        Row: {
          breakdown: Json
          created_at: string
          currency: string
          date_from: string | null
          date_to: string | null
          fx_at: string
          fx_is_fallback: boolean
          fx_rate: number
          fx_source: string
          id: string
          line_items: Json
          nights: number
          origin: string
          rooms: number
          sources: Json
          total: number
          travelers: number
          trip_id: string
          user_id: string
          valid_until: string
          version: number
        }
        Insert: {
          breakdown?: Json
          created_at?: string
          currency?: string
          date_from?: string | null
          date_to?: string | null
          fx_at: string
          fx_is_fallback?: boolean
          fx_rate: number
          fx_source: string
          id?: string
          line_items?: Json
          nights: number
          origin: string
          rooms?: number
          sources?: Json
          total: number
          travelers: number
          trip_id: string
          user_id: string
          valid_until: string
          version?: number
        }
        Update: {
          breakdown?: Json
          created_at?: string
          currency?: string
          date_from?: string | null
          date_to?: string | null
          fx_at?: string
          fx_is_fallback?: boolean
          fx_rate?: number
          fx_source?: string
          id?: string
          line_items?: Json
          nights?: number
          origin?: string
          rooms?: number
          sources?: Json
          total?: number
          travelers?: number
          trip_id?: string
          user_id?: string
          valid_until?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "trip_quotes_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_split_expenses: {
        Row: {
          amount: number
          category: string | null
          city: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string
          expense_date: string | null
          id: string
          merchant: string | null
          payer_id: string
          receipt_path: string | null
          scan: Json | null
          split_mode: string
          tax: number | null
          tip: number | null
          trip_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          expense_date?: string | null
          id?: string
          merchant?: string | null
          payer_id: string
          receipt_path?: string | null
          scan?: Json | null
          split_mode?: string
          tax?: number | null
          tip?: number | null
          trip_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          expense_date?: string | null
          id?: string
          merchant?: string | null
          payer_id?: string
          receipt_path?: string | null
          scan?: Json | null
          split_mode?: string
          tax?: number | null
          tip?: number | null
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_split_expenses_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "trip_split_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_split_expenses_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_split_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          currency: string
          from_person: string
          id: string
          note: string | null
          paid_on: string
          to_person: string
          trip_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          currency?: string
          from_person: string
          id?: string
          note?: string | null
          paid_on?: string
          to_person: string
          trip_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          from_person?: string
          id?: string
          note?: string | null
          paid_on?: string
          to_person?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_split_payments_from_person_fkey"
            columns: ["from_person"]
            isOneToOne: false
            referencedRelation: "trip_split_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_split_payments_to_person_fkey"
            columns: ["to_person"]
            isOneToOne: false
            referencedRelation: "trip_split_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_split_payments_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_split_people: {
        Row: {
          autolink_blocked: boolean
          created_at: string
          created_by: string | null
          id: string
          linked_by_name: boolean
          member_id: string | null
          name: string
          trip_id: string
        }
        Insert: {
          autolink_blocked?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          linked_by_name?: boolean
          member_id?: string | null
          name: string
          trip_id: string
        }
        Update: {
          autolink_blocked?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          linked_by_name?: boolean
          member_id?: string | null
          name?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_split_people_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_split_shares: {
        Row: {
          amount: number
          created_at: string
          expense_id: string
          id: string
          percent: number | null
          person_id: string
          trip_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          expense_id: string
          id?: string
          percent?: number | null
          person_id: string
          trip_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          expense_id?: string
          id?: string
          percent?: number | null
          person_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_split_shares_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "trip_split_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_split_shares_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "trip_split_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_split_shares_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          analisis_ai: string | null
          ciudad_origen: string | null
          cover_image_url: string | null
          created_at: string
          cruceros_json: Json | null
          current_quote_id: string | null
          dates_optimization_meta: Json | null
          dates_optimized: boolean
          desglose_presupuesto: Json | null
          destino: string
          fecha_regreso: string | null
          fecha_salida: string | null
          fuente: string
          hospedaje_json: Json | null
          id: string
          itinerario_json: Json | null
          match_score: number | null
          moneda: string | null
          num_viajeros: number | null
          pagado_moneda: string | null
          pagado_total: number | null
          pais_destino: string | null
          presupuesto_objetivo: number | null
          quote_basis: Json | null
          quote_needs_update: boolean
          realizado: boolean
          restaurantes_json: Json | null
          selections: Json | null
          status: string | null
          tips_personalizados: Json | null
          total_estimado: number | null
          tours_json: Json | null
          updated_at: string
          user_id: string
          vuelos_json: Json | null
        }
        Insert: {
          analisis_ai?: string | null
          ciudad_origen?: string | null
          cover_image_url?: string | null
          created_at?: string
          cruceros_json?: Json | null
          current_quote_id?: string | null
          dates_optimization_meta?: Json | null
          dates_optimized?: boolean
          desglose_presupuesto?: Json | null
          destino: string
          fecha_regreso?: string | null
          fecha_salida?: string | null
          fuente?: string
          hospedaje_json?: Json | null
          id?: string
          itinerario_json?: Json | null
          match_score?: number | null
          moneda?: string | null
          num_viajeros?: number | null
          pagado_moneda?: string | null
          pagado_total?: number | null
          pais_destino?: string | null
          presupuesto_objetivo?: number | null
          quote_basis?: Json | null
          quote_needs_update?: boolean
          realizado?: boolean
          restaurantes_json?: Json | null
          selections?: Json | null
          status?: string | null
          tips_personalizados?: Json | null
          total_estimado?: number | null
          tours_json?: Json | null
          updated_at?: string
          user_id: string
          vuelos_json?: Json | null
        }
        Update: {
          analisis_ai?: string | null
          ciudad_origen?: string | null
          cover_image_url?: string | null
          created_at?: string
          cruceros_json?: Json | null
          current_quote_id?: string | null
          dates_optimization_meta?: Json | null
          dates_optimized?: boolean
          desglose_presupuesto?: Json | null
          destino?: string
          fecha_regreso?: string | null
          fecha_salida?: string | null
          fuente?: string
          hospedaje_json?: Json | null
          id?: string
          itinerario_json?: Json | null
          match_score?: number | null
          moneda?: string | null
          num_viajeros?: number | null
          pagado_moneda?: string | null
          pagado_total?: number | null
          pais_destino?: string | null
          presupuesto_objetivo?: number | null
          quote_basis?: Json | null
          quote_needs_update?: boolean
          realizado?: boolean
          restaurantes_json?: Json | null
          selections?: Json | null
          status?: string | null
          tips_personalizados?: Json | null
          total_estimado?: number | null
          tours_json?: Json | null
          updated_at?: string
          user_id?: string
          vuelos_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "trips_current_quote_id_fkey"
            columns: ["current_quote_id"]
            isOneToOne: false
            referencedRelation: "trip_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_limits: {
        Row: {
          concierge_messages_used: number
          concierge_period: string
          created_at: string
          trips_analyzed_used: number
          updated_at: string
          user_id: string
        }
        Insert: {
          concierge_messages_used?: number
          concierge_period?: string
          created_at?: string
          trips_analyzed_used?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          concierge_messages_used?: number
          concierge_period?: string
          created_at?: string
          trips_analyzed_used?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_badges: {
        Row: {
          badge_id: string
          id: string
          unlocked_at: string | null
          user_id: string
        }
        Insert: {
          badge_id: string
          id?: string
          unlocked_at?: string | null
          user_id: string
        }
        Update: {
          badge_id?: string
          id?: string
          unlocked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
        ]
      }
      user_missions: {
        Row: {
          completada: boolean | null
          completed_at: string | null
          id: string
          mission_id: string
          progreso: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          completada?: boolean | null
          completed_at?: string | null
          id?: string
          mission_id: string
          progreso?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          completada?: boolean | null
          completed_at?: string | null
          id?: string
          mission_id?: string
          progreso?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_missions_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_onboarding_state: {
        Row: {
          completed_at: string | null
          completed_onboarding: boolean
          created_at: string
          current_step: number
          selected_cards: Json
          selected_loyalty_airlines: Json
          selected_loyalty_hotels: Json
          tooltips_shown: Json
          travel_dna_seed: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_onboarding?: boolean
          created_at?: string
          current_step?: number
          selected_cards?: Json
          selected_loyalty_airlines?: Json
          selected_loyalty_hotels?: Json
          tooltips_shown?: Json
          travel_dna_seed?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          completed_onboarding?: boolean
          created_at?: string
          current_step?: number
          selected_cards?: Json
          selected_loyalty_airlines?: Json
          selected_loyalty_hotels?: Json
          tooltips_shown?: Json
          travel_dna_seed?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_taste_profiles: {
        Row: {
          computed_at: string | null
          computed_for: string | null
          computed_rev: number | null
          hash: string | null
          profile: Json | null
          rev: number
          updated_at: string
          user_id: string
          version: number | null
        }
        Insert: {
          computed_at?: string | null
          computed_for?: string | null
          computed_rev?: number | null
          hash?: string | null
          profile?: Json | null
          rev?: number
          updated_at?: string
          user_id: string
          version?: number | null
        }
        Update: {
          computed_at?: string | null
          computed_for?: string | null
          computed_rev?: number | null
          hash?: string | null
          profile?: Json | null
          rev?: number
          updated_at?: string
          user_id?: string
          version?: number | null
        }
        Relationships: []
      }
      user_vault_benefits: {
        Row: {
          airline_alliances: Json
          car_rentals: Json
          created_at: string
          credit_cards: Json
          hotel_loyalty: Json
          id: string
          travel_documents: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          airline_alliances?: Json
          car_rentals?: Json
          created_at?: string
          credit_cards?: Json
          hotel_loyalty?: Json
          id?: string
          travel_documents?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          airline_alliances?: Json
          car_rentals?: Json
          created_at?: string
          credit_cards?: Json
          hotel_loyalty?: Json
          id?: string
          travel_documents?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_visits: {
        Row: {
          category: string | null
          created_at: string
          id: string
          lat: number | null
          lng: number | null
          notes: string | null
          place_id: string | null
          place_name: string
          trip_id: string | null
          user_id: string
          visited_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          place_id?: string | null
          place_name: string
          trip_id?: string | null
          user_id: string
          visited_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          place_id?: string | null
          place_name?: string
          trip_id?: string | null
          user_id?: string
          visited_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_visits_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_files: {
        Row: {
          created_at: string
          id: string
          item_id: string
          mime: string
          side: string
          size: number
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          mime: string
          side: string
          size: number
          storage_path: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          mime?: string
          side?: string
          size?: number
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_files_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "vault_items"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_items: {
        Row: {
          benefits: string[]
          benefits_unverified: boolean
          contact_phone: string | null
          country_code: string | null
          created_at: string
          entries: string | null
          expires_on: string | null
          holder_name: string | null
          id: string
          issuer: string | null
          kind: string
          notes: string | null
          number: string | null
          program_id: string | null
          section: string
          tier: string | null
          tier_id: string | null
          title: string
          updated_at: string
          user_id: string
          valid_from: string | null
          visa_type: string | null
        }
        Insert: {
          benefits?: string[]
          benefits_unverified?: boolean
          contact_phone?: string | null
          country_code?: string | null
          created_at?: string
          entries?: string | null
          expires_on?: string | null
          holder_name?: string | null
          id?: string
          issuer?: string | null
          kind: string
          notes?: string | null
          number?: string | null
          program_id?: string | null
          section: string
          tier?: string | null
          tier_id?: string | null
          title: string
          updated_at?: string
          user_id?: string
          valid_from?: string | null
          visa_type?: string | null
        }
        Update: {
          benefits?: string[]
          benefits_unverified?: boolean
          contact_phone?: string | null
          country_code?: string | null
          created_at?: string
          entries?: string | null
          expires_on?: string | null
          holder_name?: string | null
          id?: string
          issuer?: string | null
          kind?: string
          notes?: string | null
          number?: string | null
          program_id?: string | null
          section?: string
          tier?: string | null
          tier_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          valid_from?: string | null
          visa_type?: string | null
        }
        Relationships: []
      }
      visited_places: {
        Row: {
          address: string | null
          created_at: string
          cuisine: string | null
          id: string
          lat: number | null
          lng: number | null
          maps_url: string | null
          name: string
          notes: string | null
          photo_ref: string | null
          place_id: string
          price_level: string | null
          primary_type: string | null
          rating: number | null
          ratings_count: number | null
          raw: Json | null
          status: string
          types: string[] | null
          updated_at: string
          user_id: string
          visited_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          cuisine?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          name: string
          notes?: string | null
          photo_ref?: string | null
          place_id: string
          price_level?: string | null
          primary_type?: string | null
          rating?: number | null
          ratings_count?: number | null
          raw?: Json | null
          status?: string
          types?: string[] | null
          updated_at?: string
          user_id: string
          visited_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          cuisine?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          name?: string
          notes?: string | null
          photo_ref?: string | null
          place_id?: string
          price_level?: string | null
          primary_type?: string | null
          rating?: number | null
          ratings_count?: number | null
          raw?: Json | null
          status?: string
          types?: string[] | null
          updated_at?: string
          user_id?: string
          visited_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      mis_amigos: {
        Row: {
          amigo_id: string | null
          created_at: string | null
          status: string | null
        }
        Insert: {
          amigo_id?: never
          created_at?: string | null
          status?: string | null
        }
        Update: {
          amigo_id?: never
          created_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      prive_drops_live: {
        Row: {
          benefit_en: string | null
          benefit_es: string | null
          commercial_relationship: string | null
          conditions_en: string | null
          conditions_es: string | null
          destination_id: string | null
          destination_name_en: string | null
          destination_name_es: string | null
          destination_slug: string | null
          discount_pct: number | null
          drop_type: string | null
          effective_status: string | null
          eligibility_en: string | null
          eligibility_es: string | null
          id: string | null
          interests: string[] | null
          last_verified_at: string | null
          link_url: string | null
          offer_price: number | null
          price_currency: string | null
          price_source_url: string | null
          program_match: string[] | null
          provider_name: string | null
          provider_url: string | null
          reference_price: number | null
          restrictions_en: string | null
          restrictions_es: string | null
          slug: string | null
          source_name: string | null
          source_url: string | null
          title_en: string | null
          title_es: string | null
          universes: string[] | null
          valid_from: string | null
          valid_until: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prive_drops_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_drops_v: {
        Row: {
          benefit_en: string | null
          benefit_es: string | null
          commercial_relationship: string | null
          conditions_en: string | null
          conditions_es: string | null
          created_at: string | null
          curation_notes: string | null
          curation_status: string | null
          destination_id: string | null
          destination_name_en: string | null
          destination_name_es: string | null
          destination_slug: string | null
          discount_pct: number | null
          drop_type: string | null
          effective_status: string | null
          eligibility_en: string | null
          eligibility_es: string | null
          id: string | null
          import_batch: string | null
          interests: string[] | null
          last_verified_at: string | null
          link_url: string | null
          local_today: string | null
          local_tz: string | null
          offer_price: number | null
          partner_benefit_id: string | null
          price_currency: string | null
          price_source_url: string | null
          program_match: string[] | null
          provider_name: string | null
          provider_url: string | null
          reference_price: number | null
          restrictions_en: string | null
          restrictions_es: string | null
          slug: string | null
          source_name: string | null
          source_url: string | null
          title_en: string | null
          title_es: string | null
          universes: string[] | null
          updated_at: string | null
          valid_from: string | null
          valid_until: string | null
          verified_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prive_drops_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_drops_partner_benefit_id_fkey"
            columns: ["partner_benefit_id"]
            isOneToOne: false
            referencedRelation: "prive_partner_benefits"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_experiences_v: {
        Row: {
          accolades: Json | null
          active: boolean | null
          address: string | null
          age_policy: string | null
          age_policy_source: string | null
          availability_checked_at: string | null
          availability_for: unknown
          availability_source: string | null
          availability_state: string | null
          benefit_id: string | null
          booking_method: string | null
          booking_policy_en: string | null
          booking_policy_es: string | null
          booking_url: string | null
          cancellation_en: string | null
          cancellation_es: string | null
          commercial_label: string | null
          created_at: string | null
          curation_notes: string | null
          data_state: string | null
          dedupe_key: string | null
          description_en: string | null
          description_es: string | null
          destination_id: string | null
          dress_code_en: string | null
          dress_code_es: string | null
          dress_code_source: string | null
          duration_source: string | null
          effective_label: string | null
          effective_state: string | null
          event_end: string | null
          event_start: string | null
          geo_precision: string | null
          geo_source: string | null
          google_place_id: string | null
          id: string | null
          image_alt_en: string | null
          image_alt_es: string | null
          image_checked_at: string | null
          image_is_illustrative: boolean | null
          image_page_url: string | null
          image_photographer: string | null
          image_photographer_url: string | null
          image_query: string | null
          image_source: string | null
          image_url: string | null
          import_batch: string | null
          is_members_only_venue: boolean | null
          lat: number | null
          legacy_nightlife_id: string | null
          license_authority: string | null
          license_ref: string | null
          license_source: string | null
          lng: number | null
          members_only_source: string | null
          merged_legacy_ids: string[] | null
          name: string | null
          neighborhood_id: string | null
          opening_hours: Json | null
          opening_hours_checked_at: string | null
          opening_hours_source: string | null
          operating_checked_at: string | null
          operating_status: string | null
          operator_license: string | null
          operator_name: string | null
          operator_url: string | null
          partner_agreement_id: string | null
          partner_id: string | null
          price_basis: string | null
          price_checked_at: string | null
          price_currency: string | null
          price_level: number | null
          price_max: number | null
          price_min: number | null
          price_note_en: string | null
          price_note_es: string | null
          price_source_url: string | null
          price_stale: boolean | null
          private_conditions_es: string | null
          replaced_by_id: string | null
          reservation_required: boolean | null
          restrictions_en: string | null
          restrictions_es: string | null
          safety_requirements_es: string | null
          season_closes_on: string | null
          season_months: number[] | null
          season_note_es: string | null
          season_reopens_on: string | null
          season_source: string | null
          season_state: string | null
          slug: string | null
          sources: Json | null
          subcategory: string | null
          tags: string[] | null
          typical_duration_min: number | null
          universe: string | null
          updated_at: string | null
          valid_from: string | null
          valid_to: string | null
          verified_at: string | null
          verified_by: string | null
          verified_image: boolean | null
          website: string | null
          why_fact_en: string | null
          why_fact_es: string | null
        }
        Insert: {
          accolades?: Json | null
          active?: boolean | null
          address?: string | null
          age_policy?: string | null
          age_policy_source?: string | null
          availability_checked_at?: string | null
          availability_for?: unknown
          availability_source?: string | null
          availability_state?: string | null
          benefit_id?: string | null
          booking_method?: string | null
          booking_policy_en?: string | null
          booking_policy_es?: string | null
          booking_url?: string | null
          cancellation_en?: string | null
          cancellation_es?: string | null
          commercial_label?: string | null
          created_at?: string | null
          curation_notes?: string | null
          data_state?: string | null
          dedupe_key?: string | null
          description_en?: string | null
          description_es?: string | null
          destination_id?: string | null
          dress_code_en?: string | null
          dress_code_es?: string | null
          dress_code_source?: string | null
          duration_source?: string | null
          effective_label?: never
          effective_state?: never
          event_end?: string | null
          event_start?: string | null
          geo_precision?: string | null
          geo_source?: string | null
          google_place_id?: string | null
          id?: string | null
          image_alt_en?: string | null
          image_alt_es?: string | null
          image_checked_at?: string | null
          image_is_illustrative?: boolean | null
          image_page_url?: string | null
          image_photographer?: string | null
          image_photographer_url?: string | null
          image_query?: string | null
          image_source?: string | null
          image_url?: string | null
          import_batch?: string | null
          is_members_only_venue?: boolean | null
          lat?: number | null
          legacy_nightlife_id?: string | null
          license_authority?: string | null
          license_ref?: string | null
          license_source?: string | null
          lng?: number | null
          members_only_source?: string | null
          merged_legacy_ids?: string[] | null
          name?: string | null
          neighborhood_id?: string | null
          opening_hours?: Json | null
          opening_hours_checked_at?: string | null
          opening_hours_source?: string | null
          operating_checked_at?: string | null
          operating_status?: string | null
          operator_license?: string | null
          operator_name?: string | null
          operator_url?: string | null
          partner_agreement_id?: string | null
          partner_id?: string | null
          price_basis?: string | null
          price_checked_at?: string | null
          price_currency?: string | null
          price_level?: number | null
          price_max?: number | null
          price_min?: number | null
          price_note_en?: string | null
          price_note_es?: string | null
          price_source_url?: string | null
          price_stale?: never
          private_conditions_es?: string | null
          replaced_by_id?: string | null
          reservation_required?: boolean | null
          restrictions_en?: string | null
          restrictions_es?: string | null
          safety_requirements_es?: string | null
          season_closes_on?: string | null
          season_months?: number[] | null
          season_note_es?: string | null
          season_reopens_on?: string | null
          season_source?: string | null
          season_state?: never
          slug?: string | null
          sources?: Json | null
          subcategory?: string | null
          tags?: string[] | null
          typical_duration_min?: number | null
          universe?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
          verified_at?: string | null
          verified_by?: string | null
          verified_image?: boolean | null
          website?: string | null
          why_fact_en?: string | null
          why_fact_es?: string | null
        }
        Update: {
          accolades?: Json | null
          active?: boolean | null
          address?: string | null
          age_policy?: string | null
          age_policy_source?: string | null
          availability_checked_at?: string | null
          availability_for?: unknown
          availability_source?: string | null
          availability_state?: string | null
          benefit_id?: string | null
          booking_method?: string | null
          booking_policy_en?: string | null
          booking_policy_es?: string | null
          booking_url?: string | null
          cancellation_en?: string | null
          cancellation_es?: string | null
          commercial_label?: string | null
          created_at?: string | null
          curation_notes?: string | null
          data_state?: string | null
          dedupe_key?: string | null
          description_en?: string | null
          description_es?: string | null
          destination_id?: string | null
          dress_code_en?: string | null
          dress_code_es?: string | null
          dress_code_source?: string | null
          duration_source?: string | null
          effective_label?: never
          effective_state?: never
          event_end?: string | null
          event_start?: string | null
          geo_precision?: string | null
          geo_source?: string | null
          google_place_id?: string | null
          id?: string | null
          image_alt_en?: string | null
          image_alt_es?: string | null
          image_checked_at?: string | null
          image_is_illustrative?: boolean | null
          image_page_url?: string | null
          image_photographer?: string | null
          image_photographer_url?: string | null
          image_query?: string | null
          image_source?: string | null
          image_url?: string | null
          import_batch?: string | null
          is_members_only_venue?: boolean | null
          lat?: number | null
          legacy_nightlife_id?: string | null
          license_authority?: string | null
          license_ref?: string | null
          license_source?: string | null
          lng?: number | null
          members_only_source?: string | null
          merged_legacy_ids?: string[] | null
          name?: string | null
          neighborhood_id?: string | null
          opening_hours?: Json | null
          opening_hours_checked_at?: string | null
          opening_hours_source?: string | null
          operating_checked_at?: string | null
          operating_status?: string | null
          operator_license?: string | null
          operator_name?: string | null
          operator_url?: string | null
          partner_agreement_id?: string | null
          partner_id?: string | null
          price_basis?: string | null
          price_checked_at?: string | null
          price_currency?: string | null
          price_level?: number | null
          price_max?: number | null
          price_min?: number | null
          price_note_en?: string | null
          price_note_es?: string | null
          price_source_url?: string | null
          price_stale?: never
          private_conditions_es?: string | null
          replaced_by_id?: string | null
          reservation_required?: boolean | null
          restrictions_en?: string | null
          restrictions_es?: string | null
          safety_requirements_es?: string | null
          season_closes_on?: string | null
          season_months?: number[] | null
          season_note_es?: string | null
          season_reopens_on?: string | null
          season_source?: string | null
          season_state?: never
          slug?: string | null
          sources?: Json | null
          subcategory?: string | null
          tags?: string[] | null
          typical_duration_min?: number | null
          universe?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
          verified_at?: string | null
          verified_by?: string | null
          verified_image?: boolean | null
          website?: string | null
          why_fact_en?: string | null
          why_fact_es?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prive_benefit_fk"
            columns: ["benefit_id", "partner_agreement_id"]
            isOneToOne: false
            referencedRelation: "prive_partner_benefits"
            referencedColumns: ["id", "agreement_id"]
          },
          {
            foreignKeyName: "prive_experiences_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_experiences_neighborhood_id_fkey"
            columns: ["neighborhood_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_experiences_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_experiences_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "prive_experiences_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prive_partner_fk"
            columns: ["partner_agreement_id", "partner_id"]
            isOneToOne: false
            referencedRelation: "prive_partner_agreements"
            referencedColumns: ["id", "partner_id"]
          },
        ]
      }
      prive_insider_tips_v: {
        Row: {
          before_you_go: boolean | null
          body_en: string | null
          body_es: string | null
          category: string | null
          created_at: string | null
          destination_id: string | null
          destination_name_en: string | null
          destination_name_es: string | null
          destination_slug: string | null
          id: string | null
          import_batch: string | null
          months: number[] | null
          rank: number | null
          root_id: string | null
          slug: string | null
          source_checked_at: string | null
          source_name: string | null
          source_url: string | null
          stale: boolean | null
          status: string | null
          title_en: string | null
          title_es: string | null
          traveler_types: string[] | null
          updated_at: string | null
          valid_until: string | null
          verified_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prive_insider_tips_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "prive_destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      prive_nightlife_compat: {
        Row: {
          active: boolean | null
          address: string | null
          categoria: string | null
          ciudad: string | null
          ciudad_display: string | null
          created_at: string | null
          descripcion: string | null
          dress_code: string | null
          effective_label: string | null
          effective_state: string | null
          emoji: string | null
          id: string | null
          lat: number | null
          lng: number | null
          nombre: string | null
          pais: string | null
          por_que: string | null
          precio_estimado: string | null
          reserva_requerida: boolean | null
          tags: string[] | null
          website: string | null
        }
        Relationships: []
      }
      user_autonomy: {
        Row: {
          dna_version: number | null
          nivel: string | null
          trip_count: number | null
          user_id: string | null
          visit_count: number | null
        }
        Insert: {
          dna_version?: number | null
          nivel?: never
          trip_count?: number | null
          user_id?: string | null
          visit_count?: number | null
        }
        Update: {
          dna_version?: number | null
          nivel?: never
          trip_count?: number | null
          user_id?: string | null
          visit_count?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _ai_res_actor: {
        Args: { _actor: string; _note: string }
        Returns: undefined
      }
      _ai_res_alt_confirmation: {
        Args: {
          _alt: Json
          r: Database["public"]["Tables"]["ai_reservations"]["Row"]
        }
        Returns: Json
      }
      _ai_res_booking: {
        Args: { r: Database["public"]["Tables"]["ai_reservations"]["Row"] }
        Returns: undefined
      }
      _ai_res_enabled: { Args: never; Returns: boolean }
      _deploy_apply: { Args: { p_from: string; p_to: string }; Returns: string }
      _social_clean: { Args: { p: string[] }; Returns: string[] }
      _social_en_comun: { Args: { a: string; b: string }; Returns: Json }
      _social_inter: { Args: { a: string[]; b: string[] }; Returns: string[] }
      _social_is_prive: { Args: { p_user: string }; Returns: boolean }
      _social_jaccard: { Args: { a: string[]; b: string[] }; Returns: number }
      _social_lock_pair: { Args: { a: string; b: string }; Returns: undefined }
      _social_lugares: {
        Args: { p_user: string }
        Returns: {
          ciudad: string
          pais: string
        }[]
      }
      _social_nombre_seguro: { Args: { p_user: string }; Returns: string }
      _social_saludos: {
        Args: { p_amigo: string; p_me: string }
        Returns: Json
      }
      _social_shared_trip_ids: {
        Args: { a: string; b: string }
        Returns: {
          trip_id: string
        }[]
      }
      _social_son_amigos: { Args: { a: string; b: string }; Returns: boolean }
      _social_trip_ids: {
        Args: { p_user: string }
        Returns: {
          trip_id: string
        }[]
      }
      _trip_check_is_foreign: { Args: { p_user: string }; Returns: boolean }
      access_snapshot: { Args: { _user_id: string }; Returns: Json }
      account_deletion_files: {
        Args: { p_user_id: string }
        Returns: {
          bucket_id: string
          name: string
        }[]
      }
      aceptar_invitacion_viaje: { Args: { p_trip_id: string }; Returns: Json }
      action_idem_claim: {
        Args: { _key: string; _scope: string; _user_id: string }
        Returns: Json
      }
      action_idem_finish: {
        Args: {
          _key: string
          _response: Json
          _scope: string
          _user_id: string
        }
        Returns: undefined
      }
      admin_cost_metrics: { Args: { _days?: number }; Returns: Json }
      admin_grant_prive: {
        Args: {
          _email: string
          _granted_by: string
          _reason: string
          _valid_until: string
        }
        Returns: Json
      }
      admin_metrics: { Args: never; Returns: Json }
      admin_prive_key_metrics: { Args: { _days?: number }; Returns: Json }
      admin_prive_metrics: { Args: { _days?: number }; Returns: Json }
      admin_prive_product_metrics: { Args: { _days?: number }; Returns: Json }
      admin_prive_requests: { Args: { _status?: string }; Returns: Json }
      admin_restore_prive: {
        Args: { _actor: string; _reason: string; _user: string }
        Returns: Json
      }
      admin_revoke_prive: {
        Args: { _actor: string; _kind: string; _reason: string; _user: string }
        Returns: Json
      }
      admin_revoke_prive_grant: {
        Args: { _actor: string; _grant_id: string; _reason: string }
        Returns: Json
      }
      agregar_amigo_por_codigo: { Args: { p_codigo: string }; Returns: Json }
      ai_res_confirmation_failures: {
        Args: {
          _c: Json
          _code: string
          _local: string
          _party: number
          _res_id: string
          _venue_email: string
        }
        Returns: string[]
      }
      ai_res_fold: { Args: { _t: string }; Returns: string }
      ai_res_freemail_domains: { Args: never; Returns: string[] }
      ai_res_norm: { Args: { _t: string }; Returns: string }
      ai_res_reply_vetoes: { Args: { _t: string }; Returns: string[] }
      ai_res_rules_versions: { Args: never; Returns: string[] }
      ai_res_sender_strong: {
        Args: {
          _auth: Json
          _from: string
          _venue: string
          _venue_website?: string
        }
        Returns: boolean
      }
      ai_res_site_host: { Args: { _url: string }; Returns: string }
      ai_res_trusted_writer: { Args: { _rel: unknown }; Returns: boolean }
      ai_res_venue_owns_domain: {
        Args: { _venue: string; _venue_website: string }
        Returns: boolean
      }
      ai_reservation_apply_reply: {
        Args: { _d: Json; _id: string; _inbound_id: string }
        Returns: Json
      }
      ai_reservation_claim_alternative: {
        Args: { _id: string; _index: number; _user_id: string }
        Returns: Json
      }
      ai_reservation_claim_reminder: { Args: { _id: string }; Returns: Json }
      ai_reservation_claim_send: {
        Args: { _consent: Json; _id: string; _user_id: string }
        Returns: Json
      }
      ai_reservation_create_intent: {
        Args: { _p: Json; _user_id: string }
        Returns: Json
      }
      ai_reservation_due: { Args: { _limit?: number }; Returns: Json }
      ai_reservation_inbound_attach: {
        Args: { _e: Json; _inbound_id: string }
        Returns: Json
      }
      ai_reservation_inbound_claim: {
        Args: {
          _email_id: string
          _event_id: string
          _from_address?: string
          _from_domain: string
          _ref_code?: string
          _token: string
        }
        Returns: Json
      }
      ai_reservation_inbound_finish: {
        Args: { _inbound_id: string; _outcome?: string; _status: string }
        Returns: undefined
      }
      ai_reservation_json: {
        Args: { _r: Database["public"]["Tables"]["ai_reservations"]["Row"] }
        Returns: Json
      }
      ai_reservation_json_internal: {
        Args: { _r: Database["public"]["Tables"]["ai_reservations"]["Row"] }
        Returns: Json
      }
      ai_reservation_limits: { Args: never; Returns: Json }
      ai_reservation_list_for_user: {
        Args: { _id?: string; _user_id: string }
        Returns: Json
      }
      ai_reservation_mark_sent: {
        Args: {
          _error?: string
          _id: string
          _kind: string
          _ok: boolean
          _provider_id?: string
        }
        Returns: Json
      }
      ai_reservation_notice: {
        Args: {
          _code: string
          _local: string
          _party: number
          _reason: string
          _status: string
          _venue: string
        }
        Returns: string[]
      }
      ai_reservation_transition: {
        Args: {
          _actor: string
          _confirmation?: Json
          _id: string
          _note?: string
          _to: string
          _user_id?: string
        }
        Returns: Json
      }
      ai_reservation_transition_ok: {
        Args: { _from: string; _to: string }
        Returns: boolean
      }
      amigo_perfil: { Args: { p_amigo: string }; Returns: Json }
      amigos_resumen: { Args: never; Returns: Json }
      app_flag: { Args: { _key: string }; Returns: boolean }
      apply_comp_grants_now: {
        Args: never
        Returns: {
          email: string
          result: string
        }[]
      }
      apply_stripe_subscription: {
        Args: {
          _cancel_at_period_end: boolean
          _currency: string
          _current_period_end: string
          _customer_id: string
          _event_created: string
          _price_id: string
          _status: string
          _subscription_id: string
          _trial_end: string
          _user_id: string
        }
        Returns: Json
      }
      auth_email_proven: { Args: { _user_id: string }; Returns: boolean }
      auth_email_proven_parts: {
        Args: {
          _changed_at: string
          _confirmed_at: string
          _created_at: string
          _email: string
          _provider: string
        }
        Returns: boolean
      }
      avatar_claim_trip: {
        Args: {
          p_fuente: string
          p_souvenir: Json
          p_trip: string
          p_user: string
        }
        Returns: string
      }
      avatar_take_images: {
        Args: { p_kind: string; p_max: number; p_n: number; p_user: string }
        Returns: number
      }
      avatar_trips_due: {
        Args: { p_limit?: number }
        Returns: {
          trip_id: string
          user_id: string
        }[]
      }
      bloquear_usuario: { Args: { p_otro: string }; Returns: Json }
      booking_intent_apply_external: {
        Args: {
          _evidence?: Json
          _id: string
          _source: string
          _status: string
        }
        Returns: Json
      }
      booking_intent_confirm: {
        Args: { _evidence: Json; _id: string }
        Returns: Json
      }
      booking_intent_json: {
        Args: { i: Database["public"]["Tables"]["booking_intents"]["Row"] }
        Returns: Json
      }
      booking_intent_mark_redirected: {
        Args: { _id: string; _user: string }
        Returns: Json
      }
      booking_intent_start: { Args: { _p: Json; _user: string }; Returns: Json }
      booking_intent_transition: {
        Args: {
          _actor: string
          _id: string
          _note?: string
          _patch?: Json
          _to: string
          _user: string
        }
        Returns: Json
      }
      booking_intent_transition_ok: {
        Args: { _from: string; _to: string }
        Returns: boolean
      }
      booking_intents_expire: { Args: never; Returns: number }
      booking_reservas_status_to_intent: {
        Args: { _s: string }
        Returns: string
      }
      booking_set_actor: {
        Args: { _actor: string; _actor_id: string; _note: string }
        Returns: undefined
      }
      booking_venue_lookup: {
        Args: { _city: string; _name: string }
        Returns: Json
      }
      cancelar_solicitud_amistad: { Args: { p_otro: string }; Returns: Json }
      check_rate_limit: {
        Args: {
          _bucket: string
          _limit: number
          _subject: string
          _window_seconds: number
        }
        Returns: Json
      }
      claim_price_watches: {
        Args: { p_limit?: number; p_min_gap?: string }
        Returns: {
          active: boolean
          adults: number
          alerts_sent: number
          baseline_amount_original: number | null
          baseline_approximate: boolean
          baseline_currency: string | null
          baseline_price_mxn: number
          baseline_source: string
          booking_link: string | null
          claimed_at: string | null
          created_at: string
          departure_date: string
          destination_iata: string
          id: string
          last_alert_amount_original: number | null
          last_alert_at: string | null
          last_alert_price_mxn: number | null
          last_amount_original: number | null
          last_checked_at: string | null
          last_price_mxn: number | null
          lowest_price_mxn: number | null
          origin_iata: string
          return_date: string | null
          trip_id: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "price_watches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_referral: { Args: { p_code: string }; Returns: boolean }
      claim_tracked_flights: {
        Args: { p_limit?: number; p_min_gap?: string }
        Returns: {
          active: boolean
          arrival_at: string | null
          check_error: string | null
          consecutive_failures: number
          created_at: string
          departure_at: string | null
          flight: string
          flight_date: string | null
          id: string
          last_attempt_at: string | null
          last_checked_at: string | null
          last_estimated: string | null
          last_gate: string | null
          last_notified_estimated: string | null
          last_notified_fingerprint: string | null
          last_provider_status: string | null
          last_status: string | null
          last_successful_check_at: string | null
          last_terminal: string | null
          route: string | null
          trip_id: string | null
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tracked_flights"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_trial_fingerprint: {
        Args: {
          _customer_id: string
          _fingerprint: string
          _subscription_id: string
        }
        Returns: Json
      }
      commit_quota: {
        Args: { _reservation_id: string; _result?: Json; _trip_id?: string }
        Returns: Json
      }
      compatibilidad_viaje: { Args: { p_otro: string }; Returns: Json }
      concierge_runtime_config: { Args: { _user_id: string }; Returns: Json }
      consume_free_quota: {
        Args: { _kind: string; _user_id: string }
        Returns: Json
      }
      cron_health: { Args: { p_http_window?: string }; Returns: Json }
      desbloquear_usuario: { Args: { p_otro: string }; Returns: Json }
      disable_members_password: {
        Args: { p_revoke_unlocks?: boolean }
        Returns: Json
      }
      edition_admin_article_correct: {
        Args: { _note: string; _patch: Json; _slug: string }
        Returns: Json
      }
      edition_admin_article_transition: {
        Args: {
          _action: string
          _label?: string
          _note?: string
          _slug: string
          _when?: string
        }
        Returns: Json
      }
      edition_admin_article_update: {
        Args: { _note?: string; _patch: Json; _slug: string }
        Returns: Json
      }
      edition_admin_image_license: {
        Args: { _decision: string; _key: string; _note?: string }
        Returns: Json
      }
      edition_admin_issue_transition: {
        Args: {
          _action: string
          _label?: string
          _note?: string
          _slug: string
          _when?: string
        }
        Returns: Json
      }
      edition_admin_overview: { Args: never; Returns: Json }
      edition_admin_preview: { Args: { _issue_slug?: string }; Returns: Json }
      edition_admin_require: { Args: never; Returns: string }
      edition_article_checks: { Args: { _article_id: string }; Returns: Json }
      edition_article_image_keys: {
        Args: { _body: Json; _hero: string }
        Returns: string[]
      }
      edition_article_json: {
        Args: {
          _admin?: boolean
          _full?: boolean
          a: Database["public"]["Tables"]["edition_articles"]["Row"]
        }
        Returns: Json
      }
      edition_body_words: { Args: { _body: Json }; Returns: number }
      edition_image_json: {
        Args: {
          _admin?: boolean
          i: Database["public"]["Tables"]["edition_images"]["Row"]
        }
        Returns: Json
      }
      edition_images_map: {
        Args: { _admin?: boolean; _keys: string[] }
        Returns: Json
      }
      edition_interest_keys: { Args: never; Returns: string[] }
      edition_is_admin: { Args: never; Returns: boolean }
      edition_is_live: {
        Args: { _scheduled_for: string; _status: string }
        Returns: boolean
      }
      edition_issue_checks: { Args: { _issue_id: string }; Returns: Json }
      edition_issue_json: {
        Args: {
          _admin?: boolean
          i: Database["public"]["Tables"]["edition_issues"]["Row"]
        }
        Returns: Json
      }
      edition_log_review: {
        Args: {
          _action: string
          _actor: string
          _diff?: Json
          _entity: string
          _key: string
          _note: string
        }
        Returns: undefined
      }
      edition_raise: {
        Args: { _code: string; _detail?: string }
        Returns: undefined
      }
      edition_reader_body: { Args: { _body: Json }; Returns: Json }
      edition_record_link_check: {
        Args: { _http?: number; _key: string; _status: string }
        Returns: boolean
      }
      edition_section_keys: { Args: never; Returns: string[] }
      edition_source_json: {
        Args: {
          _admin?: boolean
          _used_for?: string
          s: Database["public"]["Tables"]["edition_sources"]["Row"]
        }
        Returns: Json
      }
      edition_sources_to_check: {
        Args: { _limit?: number }
        Returns: {
          key: string
          url: string
        }[]
      }
      edition_today: { Args: never; Returns: string }
      effective_plan: { Args: { _user_id: string }; Returns: string }
      email_trial_hash: { Args: { _email: string }; Returns: string }
      ensure_ai_prefs: { Args: { p_user: string }; Returns: undefined }
      free_quota_limit: { Args: { _kind: string }; Returns: number }
      friend_profiles: {
        Args: { p_ids?: string[] }
        Returns: {
          avatar_url: string
          full_name: string
          id: string
          username: string
        }[]
      }
      my_split_shares: {
        Args: { p_trip?: string }
        Returns: {
          amount: number
          category: string
          city: string
          currency: string
          description: string
          expense_date: string
          expense_id: string
          paid_by_me: boolean
          payer_name: string
          share_id: string
          total: number
          trip_id: string
        }[]
      }
      gen_invite_code: { Args: never; Returns: string }
      get_access_state: { Args: { _user_id: string }; Returns: Json }
      has_comp_grant: { Args: { _user_id: string }; Returns: boolean }
      has_trip_access: {
        Args: { p_trip: string; p_user: string }
        Returns: boolean
      }
      import_past_trip: {
        Args: { p_refs: string[]; p_trip: Json }
        Returns: Json
      }
      invitar_amigo_viaje: {
        Args: { p_friend_id: string; p_trip_id: string }
        Returns: Json
      }
      is_deleted_stripe_customer: {
        Args: { _customer_id: string }
        Returns: boolean
      }
      is_pro: { Args: { _user_id: string }; Returns: boolean }
      is_trip_collaborator: {
        Args: { p_trip: string; p_user: string }
        Returns: boolean
      }
      is_trip_owner: {
        Args: { p_trip: string; p_user: string }
        Returns: boolean
      }
      journal_photo_visible: {
        Args: { p_name: string; p_uid: string }
        Returns: boolean
      }
      live_search_refund: {
        Args: { _plan: string; _units?: number; _user_id: string }
        Returns: undefined
      }
      live_search_take: {
        Args: { _units?: number; _user_id: string }
        Returns: Json
      }
      live_search_used: {
        Args: { _period: string; _plan: string; _user_id: string }
        Returns: number
      }
      mark_subscription_cancel_at_period_end: {
        Args: { _subscription_id: string }
        Returns: Json
      }
      members_access: { Args: never; Returns: boolean }
      members_access_state: { Args: never; Returns: Json }
      members_category: { Args: { _sub: string }; Returns: string }
      members_cities: {
        Args: never
        Returns: {
          ciudad: string
          ciudad_display: string
          pais: string
          venues: number
        }[]
      }
      members_scope: {
        Args: { p_ciudad: string }
        Returns: {
          city_ids: string[]
          neighborhood_id: string
          q: string
          root_id: string
        }[]
      }
      members_teaser: {
        Args: { p_ciudad?: string }
        Returns: {
          categoria: string
          ciudad: string
          ciudad_display: string
          pais: string
          venues: number
        }[]
      }
      members_venue_pool: {
        Args: never
        Returns: {
          address: string
          age_policy: string
          categoria: string
          city_id: string
          city_key: string
          ciudad_display: string
          descripcion: string
          dress_code: string
          effective_label: string
          effective_state: string
          emoji: string
          fuente: string
          id: string
          neighborhood: string
          neighborhood_id: string
          nombre: string
          pais: string
          por_que: string
          precio_estimado: string
          reserva_requerida: boolean
          season_state: string
          source_url: string
          tags: string[]
          verified_at: string
          website: string
        }[]
      }
      members_venues: {
        Args: { p_ciudad: string }
        Returns: {
          address: string
          age_policy: string
          categoria: string
          ciudad: string
          ciudad_display: string
          descripcion: string
          dress_code: string
          effective_label: string
          effective_state: string
          emoji: string
          fuente: string
          id: string
          neighborhood: string
          nombre: string
          pais: string
          por_que: string
          precio_estimado: string
          reserva_requerida: boolean
          season_state: string
          source_url: string
          tags: string[]
          verified_at: string
          website: string
        }[]
      }
      normalize_email: { Args: { _email: string }; Returns: string }
      notify_admins: {
        Args: { _body: string; _dedup_key: string; _title: string }
        Returns: number
      }
      notify_once: {
        Args: {
          p_body: string
          p_dedup_key: string
          p_related_id: string
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: string
      }
      plan_limit: { Args: { _kind: string; _user_id: string }; Returns: Json }
      prive_accept_invitation: {
        Args: { _token_hash: string; _user: string }
        Returns: Json
      }
      prive_access_code: { Args: { _user: string }; Returns: string }
      prive_accolades_ok: { Args: { _a: Json }; Returns: boolean }
      prive_add_to_trip: {
        Args: { _items: Json; _ps: string; _trip_id: string }
        Returns: Json
      }
      prive_agreement_active: { Args: { _id: string }; Returns: boolean }
      prive_audit: {
        Args: { _actor: string; _details: Json; _event: string; _user: string }
        Returns: undefined
      }
      prive_auth_session_alive: {
        Args: { _sid: string; _user: string }
        Returns: boolean
      }
      prive_auth_session_lookup: {
        Args: { _sid: string; _user: string }
        Returns: boolean
      }
      prive_auth_sessions_checkable: { Args: never; Returns: boolean }
      prive_before_you_go: {
        Args: { _ps: string; _trip?: string }
        Returns: Json
      }
      prive_benefit_active: { Args: { _id: string }; Returns: boolean }
      prive_booking_category: { Args: { _universe: string }; Returns: string }
      prive_change_password: {
        Args: {
          _breach_check: string
          _new: string
          _old: string
          _user: string
        }
        Returns: Json
      }
      prive_claim_invitation_emails: {
        Args: { _limit: number; _only_user?: string }
        Returns: {
          attempt: number
          basis: string
          email: string
          first_name: string
          invitation_id: string
          token: string
          user_id: string
        }[]
      }
      prive_clean_ip: { Args: { _ip_hash: string }; Returns: string }
      prive_complete_reset: {
        Args: {
          _breach_check: string
          _new: string
          _token: string
          _user: string
        }
        Returns: Json
      }
      prive_confirm_adult: {
        Args: { _ps: string; _terms_version: string }
        Returns: boolean
      }
      prive_dedupe_key: { Args: { _name: string }; Returns: string }
      prive_destination: { Args: { _ps: string; _slug: string }; Returns: Json }
      prive_destination_coverage: { Args: { _dest: string }; Returns: Json }
      prive_destination_root: { Args: { _id: string }; Returns: string }
      prive_drop: { Args: { _ps: string; _slug: string }; Returns: Json }
      prive_drop_json: {
        Args: {
          _reasons?: string[]
          d: Database["public"]["Views"]["prive_drops_v"]["Row"]
        }
        Returns: Json
      }
      prive_drops: {
        Args: {
          _destination?: string
          _interests?: string[]
          _limit?: number
          _ps: string
          _types?: string[]
        }
        Returns: Json
      }
      prive_drops_import_batch: {
        Args: { p_batch: string; p_dry_run?: boolean; p_rows: Json }
        Returns: Json
      }
      prive_edition_article: {
        Args: { _ps: string; _slug: string }
        Returns: Json
      }
      prive_edition_issue: {
        Args: { _ps: string; _slug?: string }
        Returns: Json
      }
      prive_edition_library: { Args: { _ps: string }; Returns: Json }
      prive_edition_log_download: {
        Args: {
          _article_count?: number
          _bytes?: number
          _duration_ms?: number
          _format: string
          _image_count?: number
          _issue: string
          _kind: string
          _language?: string
          _ps: string
        }
        Returns: boolean
      }
      prive_edition_prefs: { Args: { _ps: string }; Returns: Json }
      prive_edition_prefs_save: {
        Args: { _prefs: Json; _ps: string }
        Returns: Json
      }
      prive_edition_save: {
        Args: { _ps: string; _saved?: boolean; _slug: string }
        Returns: Json
      }
      prive_edition_saved: { Args: { _ps: string }; Returns: Json }
      prive_edition_status: { Args: { _ps: string }; Returns: Json }
      prive_edition_world_brief: { Args: { _ps: string }; Returns: Json }
      prive_entitled: { Args: { _user: string }; Returns: boolean }
      prive_evaluate_eligibility: {
        Args: { _limit: number }
        Returns: {
          action: string
          user_id: string
        }[]
      }
      prive_exp_json: {
        Args: {
          _full?: boolean
          e: Database["public"]["Views"]["prive_experiences_v"]["Row"]
        }
        Returns: Json
      }
      prive_experience: {
        Args: { _id_or_slug: string; _ps: string }
        Returns: Json
      }
      prive_first_name: { Args: { _user: string }; Returns: string }
      prive_flag_int: {
        Args: { _default: number; _key: string }
        Returns: number
      }
      prive_for_you: {
        Args: {
          _destination: string
          _from?: string
          _limit?: number
          _ps: string
          _to?: string
        }
        Returns: Json
      }
      prive_founding_cutoff: { Args: never; Returns: string }
      prive_has_card_number: { Args: { _t: string }; Returns: boolean }
      prive_has_fake_urgency: { Args: { _t: string }; Returns: boolean }
      prive_has_grant: { Args: { _user: string }; Returns: boolean }
      prive_has_percent: { Args: { _t: string }; Returns: boolean }
      prive_hash_password: { Args: { _pw: string }; Returns: string }
      prive_home: { Args: { _ps: string }; Returns: Json }
      prive_hours_ok: { Args: { _h: Json }; Returns: boolean }
      prive_import_batch: {
        Args: { p_batch: string; p_dry_run?: boolean; p_rows: Json }
        Returns: Json
      }
      prive_insider: {
        Args: { _destination: string; _ps: string }
        Returns: Json
      }
      prive_insider_import_batch: {
        Args: { p_batch: string; p_dry_run?: boolean; p_rows: Json }
        Returns: Json
      }
      prive_insider_index: { Args: { _ps: string }; Returns: Json }
      prive_invite_user: {
        Args: { _actor: string; _basis: string; _user: string }
        Returns: string
      }
      prive_is_adult: { Args: { _uid: string }; Returns: boolean }
      prive_is_eligible: { Args: { _user: string }; Returns: boolean }
      prive_key_add_to_trip: {
        Args: { _plan_id: string; _ps: string; _trip_id: string }
        Returns: Json
      }
      prive_key_archive: {
        Args: { _plan_id: string; _ps: string }
        Returns: Json
      }
      prive_key_plans: { Args: { _ps: string }; Returns: Json }
      prive_key_save: { Args: { _plan: Json; _ps: string }; Returns: Json }
      prive_key_taste_save: {
        Args: { _consent: boolean; _ps: string; _taste: Json }
        Returns: Json
      }
      prive_key_track: {
        Args: { _event: string; _props?: Json; _ps: string }
        Returns: boolean
      }
      prive_legacy_https: { Args: { _w: string }; Returns: string }
      prive_lock_session: {
        Args: { _token_hash: string; _user: string }
        Returns: Json
      }
      prive_log_event: {
        Args: { _event: string; _props: Json; _user: string }
        Returns: boolean
      }
      prive_mark_invitation_email: {
        Args: {
          _error: string
          _invitation_id: string
          _ok: boolean
          _provider_id: string
        }
        Returns: Json
      }
      prive_mark_paid_period: {
        Args: { _amount_refunded: number; _event: string; _invoice_id: string }
        Returns: Json
      }
      prive_member_destinations: {
        Args: { _uid: string }
        Returns: {
          destination_id: string
          why: string
        }[]
      }
      prive_member_trips: { Args: { _uid: string }; Returns: Json }
      prive_my_requests: { Args: never; Returns: Json }
      prive_new_member_code: { Args: never; Returns: string }
      prive_norm: { Args: { t: string }; Returns: string }
      prive_passport: { Args: { _ps: string }; Returns: Json }
      prive_passport_delete: {
        Args: { _id: string; _ps: string }
        Returns: Json
      }
      prive_passport_json: {
        Args: {
          p: Database["public"]["Tables"]["prive_passport_entries"]["Row"]
        }
        Returns: Json
      }
      prive_passport_save: {
        Args: { _entry: Json; _ps: string }
        Returns: Json
      }
      prive_password_matches: {
        Args: { _hash: string; _pw: string }
        Returns: boolean
      }
      prive_password_problem: {
        Args: { _breach_check: string; _pw: string }
        Returns: string
      }
      prive_precheck: {
        Args: {
          _c: Database["public"]["Tables"]["prive_credentials"]["Row"]
          _ip_hash: string
          _kind: string
        }
        Returns: Json
      }
      prive_preview_track: { Args: { _event: string }; Returns: boolean }
      prive_program_matches: {
        Args: { _match: string[]; _norm: string }
        Returns: boolean
      }
      prive_radar: {
        Args: { _destination?: string; _ps: string }
        Returns: Json
      }
      prive_radar_delete: { Args: { _id: string; _ps: string }; Returns: Json }
      prive_radar_json: {
        Args: { i: Database["public"]["Tables"]["prive_radar_items"]["Row"] }
        Returns: Json
      }
      prive_radar_save: { Args: { _item: Json; _ps: string }; Returns: Json }
      prive_random_token: { Args: never; Returns: string }
      prive_record_attempt: {
        Args: {
          _ip_hash: string
          _kind: string
          _reason: string
          _success: boolean
          _user: string
        }
        Returns: undefined
      }
      prive_record_paid_period: {
        Args: {
          _amount_paid: number
          _currency: string
          _customer_id: string
          _invoice_id: string
          _period_end: string
          _period_start: string
          _source: string
          _subscription_id: string
          _user: string
        }
        Returns: Json
      }
      prive_register_failure: {
        Args: { _ip_hash: string; _kind: string; _user: string }
        Returns: Json
      }
      prive_remember_session: {
        Args: { _session_id: string; _user: string }
        Returns: Json
      }
      prive_report_compromised: { Args: { _user: string }; Returns: Json }
      prive_request_cancel: {
        Args: { _id: string; _note?: string }
        Returns: Json
      }
      prive_request_create: {
        Args: {
          _contact_method?: string
          _experience_id: string
          _party_size?: number
          _plan_group?: string
          _preferences?: string
          _ps: string
          _requested_for?: string
          _trip_id?: string
        }
        Returns: Json
      }
      prive_request_reset: { Args: { _user: string }; Returns: string }
      prive_request_transition: {
        Args: {
          _confirmation?: Json
          _fixer_escalation_id?: string
          _id: string
          _note?: string
          _owner_admin_id?: string
          _to: string
        }
        Returns: Json
      }
      prive_request_transition_ok: {
        Args: { _from: string; _to: string }
        Returns: boolean
      }
      prive_require: { Args: { _ps: string }; Returns: string }
      prive_resend_invitation: { Args: { _user: string }; Returns: Json }
      prive_resolve_destination: { Args: { _q: string }; Returns: string }
      prive_revoke_sessions: {
        Args: { _reason: string; _user: string }
        Returns: number
      }
      prive_save: {
        Args: { _experience_id: string; _ps: string; _saved?: boolean }
        Returns: Json
      }
      prive_save_progress: {
        Args: { _onboarding: Json; _user: string; _welcome_version: number }
        Returns: Json
      }
      prive_saved: { Args: { _ps: string }; Returns: Json }
      prive_score: {
        Args: {
          _budget: number
          _from: string
          _sig: Json
          _to: string
          _trip_dest: string
          e: Database["public"]["Views"]["prive_experiences_v"]["Row"]
        }
        Returns: Json
      }
      prive_search: {
        Args: {
          _budget?: number
          _cities: string[]
          _date_from?: string
          _date_to?: string
          _keywords?: string[]
          _party?: number
          _per_universe?: number
          _ps: string
          _universes?: string[]
        }
        Returns: Json
      }
      prive_session_idle_limit: {
        Args: { _remember: boolean }
        Returns: string
      }
      prive_set_password: {
        Args: { _breach_check: string; _password: string; _user: string }
        Returns: Json
      }
      prive_sha256_hex: { Args: { _t: string }; Returns: string }
      prive_site_label: { Args: { _url: string }; Returns: string }
      prive_sources_ok: { Args: { _s: Json }; Returns: boolean }
      prive_status: { Args: never; Returns: Json }
      prive_sweep: { Args: never; Returns: Json }
      prive_teaser: { Args: never; Returns: Json }
      prive_tenure_days: { Args: { _user: string }; Returns: number }
      prive_tip_add_to_trip: {
        Args: { _ps: string; _tip: string; _trip: string }
        Returns: Json
      }
      prive_tip_json: {
        Args: {
          _uid: string
          t: Database["public"]["Views"]["prive_insider_tips_v"]["Row"]
        }
        Returns: Json
      }
      prive_tip_save: {
        Args: { _ps: string; _saved?: boolean; _tip: string }
        Returns: Json
      }
      prive_track: {
        Args: {
          _destination?: string
          _event: string
          _experience?: string
          _ps: string
          _surface?: string
          _trip?: string
        }
        Returns: boolean
      }
      prive_trip_destination: { Args: { _destino: string }; Returns: string }
      prive_universe: {
        Args: {
          _destination?: string
          _limit?: number
          _ps: string
          _universe: string
        }
        Returns: Json
      }
      prive_unlock: {
        Args: {
          _auth_session_id: string
          _ip_hash: string
          _password: string
          _user: string
        }
        Returns: Json
      }
      prive_user_signals: { Args: { _uid: string }; Returns: Json }
      prive_value_delete: { Args: { _id: string; _ps: string }; Returns: Json }
      prive_value_json: {
        Args: { v: Database["public"]["Tables"]["prive_value_entries"]["Row"] }
        Returns: Json
      }
      prive_value_log: {
        Args: {
          _dest?: string
          _event: string
          _ref?: string
          _state?: string
          _surface?: string
          _uid: string
        }
        Returns: undefined
      }
      prive_value_save: { Args: { _entry: Json; _ps: string }; Returns: Json }
      prive_value_summary: { Args: { _ps: string }; Returns: Json }
      prive_value_track: {
        Args: {
          _destination?: string
          _event: string
          _ps: string
          _ref?: string
          _surface?: string
        }
        Returns: boolean
      }
      prive_vault_programs: {
        Args: { _uid: string }
        Returns: {
          kind: string
          label: string
          norm: string
          tier: string
        }[]
      }
      prive_withdraw_invitation: {
        Args: { _actor: string; _reason: string; _user: string }
        Returns: boolean
      }
      pro_paid_period_lock: {
        Args: { _invoice_id: string }
        Returns: undefined
      }
      pro_price_ok: {
        Args: { _currency: string; _price_id: string }
        Returns: boolean
      }
      public_plan_config: { Args: never; Returns: Json }
      purge_account_data: { Args: { p_user_id: string }; Returns: Json }
      quitar_amigo: {
        Args: { p_bloquear?: boolean; p_otro: string }
        Returns: Json
      }
      quota_rule: {
        Args: { _kind: string; _user_id: string }
        Returns: {
          daily_limit: number
          enforced: boolean
          limit_value: number
          period: string
          plan: string
          soft: boolean
        }[]
      }
      quota_used: {
        Args: {
          _kind: string
          _period: string
          _plan: string
          _user_id: string
        }
        Returns: number
      }
      rechazar_invitacion_viaje: { Args: { p_trip_id: string }; Returns: Json }
      regenerar_codigo_invitacion: { Args: never; Returns: Json }
      release_quota: {
        Args: { _reason?: string; _reservation_id: string }
        Returns: Json
      }
      reserve_quota: {
        Args: { _kind: string; _request_key: string; _user_id: string }
        Returns: Json
      }
      responder_solicitud_amistad: {
        Args: { p_aceptar: boolean; p_otro: string }
        Returns: Json
      }
      revert_profile_tier: { Args: { _batch_id: string }; Returns: number }
      revoke_comp: { Args: { p_email: string }; Returns: Json }
      revoke_paid_access: {
        Args: {
          _customer_id: string
          _event_created: string
          _reason: string
          _subscription_id: string
        }
        Returns: Json
      }
      saludar_amigo: {
        Args: { p_amigo: string; p_gesto?: string }
        Returns: Json
      }
      serp_burn_rate: { Args: { _days?: number }; Returns: Json }
      serp_cache_get: { Args: { _key_hash: string }; Returns: Json }
      serp_cache_put: {
        Args: {
          _engine: string
          _key_hash: string
          _response: Json
          _ttl_seconds: number
        }
        Returns: undefined
      }
      serp_global_used: { Args: { _period?: string }; Returns: number }
      set_members_password: {
        Args: { p_expires_at: string; p_password: string }
        Returns: undefined
      }
      set_members_password_hash: {
        Args: { p_expires_at: string; p_hash: string }
        Returns: undefined
      }
      set_trip_document_visibility: {
        Args: { p_id: string; p_visibility: string }
        Returns: Json
      }
      solicitudes_amistad: { Args: never; Returns: Json }
      start_account_deletion: { Args: { _account_id: string }; Returns: string }
      stripe_commit_payment_event: {
        Args: { _amount_refunded: number; _row: Json; _tenure_event: string }
        Returns: Json
      }
      stripe_payment_tenure_event: {
        Args: { _action: string; _dispute_status: string; _type: string }
        Returns: string
      }
      stripe_sub_is_live: {
        Args: { _period_end: string; _status: string; _subscription_id: string }
        Returns: boolean
      }
      sync_profile_tier: {
        Args: { _dry_run?: boolean }
        Returns: {
          batch_id: string
          is_pro: boolean
          new_tier: string
          old_tier: string
          profile_id: string
        }[]
      }
      tracked_flight_gap: {
        Args: {
          p_departure_at?: string
          p_failures: number
          p_flight_date: string
          p_min_gap: string
          p_now?: string
          p_today: string
        }
        Returns: string
      }
      trip_document_object_visible: {
        Args: { p_name: string; p_uid: string }
        Returns: boolean
      }
      trip_document_path_trip: { Args: { p_name: string }; Returns: string }
      trip_receipt_path_trip: { Args: { p_name: string }; Returns: string }
      trip_split_claim_guest: { Args: { p_guest: string }; Returns: string }
      trip_split_members: {
        Args: { p_trip: string }
        Returns: {
          avatar_url: string
          is_owner: boolean
          name: string
          user_id: string
        }[]
      }
      trip_split_save_expense: {
        Args: { p_expense: Json; p_id?: string; p_shares: Json; p_trip: string }
        Returns: string
      }
      trip_split_sync_members: { Args: { p_trip: string }; Returns: number }
      trip_split_unlink: { Args: { p_person: string }; Returns: undefined }
      trip_quotes_line_items_valid: { Args: { items: Json }; Returns: boolean }
      unlock_members_access: { Args: { p_password: string }; Returns: Json }
      vault_benefits_ok: { Args: { p: string[] }; Returns: boolean }
      vault_path_item: { Args: { p_name: string }; Returns: string }
      vault_path_owner: { Args: { p_name: string }; Returns: string }
      vault_sync_legacy: { Args: { p_user_id: string }; Returns: undefined }
      vault_try_date: { Args: { p: string }; Returns: string }
      verify_cron_secret: { Args: { p_secret: string }; Returns: boolean }
      wrapped_companions: {
        Args: { p_year: number }
        Returns: {
          name: string
          shared_trips: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
