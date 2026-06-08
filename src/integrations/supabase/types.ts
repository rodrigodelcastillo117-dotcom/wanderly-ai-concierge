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
      concierge_requests: {
        Row: {
          created_at: string
          id: string
          payload: Json
          status: string
          title: string
          trip_id: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          status?: string
          title: string
          trip_id?: string | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          status?: string
          title?: string
          trip_id?: string | null
          type?: string
          updated_at?: string
          user_id?: string
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
      expenses: {
        Row: {
          amount: number
          category: string
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
          password_unlocked: boolean
          password_unlocked_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          confirmed_adult?: boolean
          confirmed_adult_at?: string | null
          created_at?: string
          password_unlocked?: boolean
          password_unlocked_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          confirmed_adult?: boolean
          confirmed_adult_at?: string | null
          created_at?: string
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
          id?: string
          read?: boolean
          related_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
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
      recomendaciones: {
        Row: {
          created_at: string
          descripcion: string | null
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
          guardado?: boolean | null
          id?: string
          imagen_url?: string | null
          match_score?: number | null
          metadata?: Json | null
          tipo?: string | null
          titulo?: string | null
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          status?: string | null
          stripe_customer_id?: string | null
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
          created_at: string
          flight: string
          flight_date: string | null
          id: string
          last_checked_at: string | null
          last_estimated: string | null
          last_gate: string | null
          last_status: string | null
          last_terminal: string | null
          route: string | null
          trip_id: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          flight: string
          flight_date?: string | null
          id?: string
          last_checked_at?: string | null
          last_estimated?: string | null
          last_gate?: string | null
          last_status?: string | null
          last_terminal?: string | null
          route?: string | null
          trip_id?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          flight?: string
          flight_date?: string | null
          id?: string
          last_checked_at?: string | null
          last_estimated?: string | null
          last_gate?: string | null
          last_status?: string | null
          last_terminal?: string | null
          route?: string | null
          trip_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      travel_moments: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          image_url: string
          trip_name: string | null
          user_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          image_url: string
          trip_name?: string | null
          user_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          image_url?: string
          trip_name?: string | null
          user_id?: string
        }
        Relationships: []
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
        Relationships: []
      }
      trip_journal_entries: {
        Row: {
          author_id: string
          created_at: string
          id: string
          photo_url: string | null
          text: string
          trip_id: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          photo_url?: string | null
          text: string
          trip_id: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
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
      trip_split_expenses: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          payer_id: string
          trip_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          payer_id: string
          trip_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          payer_id?: string
          trip_id?: string
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
      trip_split_people: {
        Row: {
          created_at: string
          id: string
          name: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          trip_id: string
        }
        Update: {
          created_at?: string
          id?: string
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
      trips: {
        Row: {
          analisis_ai: string | null
          ciudad_origen: string | null
          cover_image_url: string | null
          created_at: string
          cruceros_json: Json | null
          dates_optimization_meta: Json | null
          dates_optimized: boolean
          desglose_presupuesto: Json | null
          destino: string
          fecha_regreso: string | null
          fecha_salida: string | null
          hospedaje_json: Json | null
          id: string
          itinerario_json: Json | null
          match_score: number | null
          moneda: string | null
          num_viajeros: number | null
          pais_destino: string | null
          presupuesto_objetivo: number | null
          restaurantes_json: Json | null
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
          dates_optimization_meta?: Json | null
          dates_optimized?: boolean
          desglose_presupuesto?: Json | null
          destino: string
          fecha_regreso?: string | null
          fecha_salida?: string | null
          hospedaje_json?: Json | null
          id?: string
          itinerario_json?: Json | null
          match_score?: number | null
          moneda?: string | null
          num_viajeros?: number | null
          pais_destino?: string | null
          presupuesto_objetivo?: number | null
          restaurantes_json?: Json | null
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
          dates_optimization_meta?: Json | null
          dates_optimized?: boolean
          desglose_presupuesto?: Json | null
          destino?: string
          fecha_regreso?: string | null
          fecha_salida?: string | null
          hospedaje_json?: Json | null
          id?: string
          itinerario_json?: Json | null
          match_score?: number | null
          moneda?: string | null
          num_viajeros?: number | null
          pais_destino?: string | null
          presupuesto_objetivo?: number | null
          restaurantes_json?: Json | null
          status?: string | null
          tips_personalizados?: Json | null
          total_estimado?: number | null
          tours_json?: Json | null
          updated_at?: string
          user_id?: string
          vuelos_json?: Json | null
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
      aceptar_invitacion_viaje: { Args: { p_trip_id: string }; Returns: Json }
      agregar_amigo_por_codigo: { Args: { p_codigo: string }; Returns: Json }
      compatibilidad_viaje: { Args: { p_otro: string }; Returns: Json }
      ensure_ai_prefs: { Args: { p_user: string }; Returns: undefined }
      gen_invite_code: { Args: never; Returns: string }
      has_trip_access: {
        Args: { p_trip: string; p_user: string }
        Returns: boolean
      }
      invitar_amigo_viaje: {
        Args: { p_friend_id: string; p_trip_id: string }
        Returns: Json
      }
      is_trip_collaborator: {
        Args: { p_trip: string; p_user: string }
        Returns: boolean
      }
      is_trip_owner: {
        Args: { p_trip: string; p_user: string }
        Returns: boolean
      }
      rechazar_invitacion_viaje: { Args: { p_trip_id: string }; Returns: Json }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
