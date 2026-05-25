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
      profiles: {
        Row: {
          ciudad_origen: string | null
          created_at: string
          email: string | null
          fecha_nacimiento: string | null
          full_name: string | null
          id: string
          pais_origen: string | null
          updated_at: string
        }
        Insert: {
          ciudad_origen?: string | null
          created_at?: string
          email?: string | null
          fecha_nacimiento?: string | null
          full_name?: string | null
          id: string
          pais_origen?: string | null
          updated_at?: string
        }
        Update: {
          ciudad_origen?: string | null
          created_at?: string
          email?: string | null
          fecha_nacimiento?: string | null
          full_name?: string | null
          id?: string
          pais_origen?: string | null
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
