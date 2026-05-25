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
          updated_at: string
          user_id: string
        }
        Insert: {
          actividades_tarde?: string[] | null
          companeros_viaje?: string | null
          completado?: boolean | null
          created_at?: string
          deal_breakers?: string[] | null
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
          updated_at?: string
          user_id: string
        }
        Update: {
          actividades_tarde?: string[] | null
          companeros_viaje?: string | null
          completado?: boolean | null
          created_at?: string
          deal_breakers?: string[] | null
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
          updated_at?: string
          user_id?: string
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
          full_name: string | null
          id: string
          loyalty_programs: Json | null
          nationality: string | null
          pais_origen: string | null
          tier: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          ciudad_origen?: string | null
          created_at?: string
          currency_preference?: string | null
          email?: string | null
          fecha_nacimiento?: string | null
          full_name?: string | null
          id: string
          loyalty_programs?: Json | null
          nationality?: string | null
          pais_origen?: string | null
          tier?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          ciudad_origen?: string | null
          created_at?: string
          currency_preference?: string | null
          email?: string | null
          fecha_nacimiento?: string | null
          full_name?: string | null
          id?: string
          loyalty_programs?: Json | null
          nationality?: string | null
          pais_origen?: string | null
          tier?: string | null
          updated_at?: string
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
      trips: {
        Row: {
          analisis_ai: string | null
          ciudad_origen: string | null
          cover_image_url: string | null
          created_at: string
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
      user_vault_benefits: {
        Row: {
          airline_alliances: Json
          car_rentals: Json
          created_at: string
          credit_cards: Json
          hotel_loyalty: Json
          id: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
