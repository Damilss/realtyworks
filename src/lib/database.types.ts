export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          created_at: string;
          full_name: string | null;
          id: string;
          phone: string | null;
          role: Database["public"]["Enums"]["app_role"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          full_name?: string | null;
          id: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Relationships: [];
      };
      properties: {
        Row: {
          address_line1: string;
          address_line2: string | null;
          city: string;
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          postal_code: string;
          state: string;
          updated_at: string;
        };
        Insert: {
          address_line1: string;
          address_line2?: string | null;
          city: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          name: string;
          postal_code: string;
          state: string;
          updated_at?: string;
        };
        Update: {
          address_line1?: string;
          address_line2?: string | null;
          city?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          postal_code?: string;
          state?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "properties_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      units: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          label: string;
          property_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          id?: string;
          label: string;
          property_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          label?: string;
          property_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "units_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "units_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      vendors: {
        Row: {
          created_at: string;
          created_by: string;
          email: string | null;
          id: string;
          name: string;
          phone: string | null;
          profile_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          email?: string | null;
          id?: string;
          name: string;
          phone?: string | null;
          profile_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          email?: string | null;
          id?: string;
          name?: string;
          phone?: string | null;
          profile_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendors_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendors_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      work_order_activity: {
        Row: {
          action: Database["public"]["Enums"]["activity_action"];
          actor_id: string | null;
          created_at: string;
          id: number;
          new_value: Json | null;
          note: string | null;
          old_value: Json | null;
          work_order_id: string;
        };
        Insert: {
          action?: Database["public"]["Enums"]["activity_action"];
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          new_value?: Json | null;
          note?: string | null;
          old_value?: Json | null;
          work_order_id: string;
        };
        Update: {
          action?: Database["public"]["Enums"]["activity_action"];
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          new_value?: Json | null;
          note?: string | null;
          old_value?: Json | null;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_activity_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_activity_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_order_attachments: {
        Row: {
          created_at: string;
          file_name: string;
          id: string;
          kind: Database["public"]["Enums"]["attachment_kind"];
          mime_type: string;
          size_bytes: number | null;
          storage_path: string;
          uploaded_by: string;
          work_order_id: string;
        };
        Insert: {
          created_at?: string;
          file_name: string;
          id?: string;
          kind?: Database["public"]["Enums"]["attachment_kind"];
          mime_type: string;
          size_bytes?: number | null;
          storage_path: string;
          uploaded_by?: string;
          work_order_id: string;
        };
        Update: {
          created_at?: string;
          file_name?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["attachment_kind"];
          mime_type?: string;
          size_bytes?: number | null;
          storage_path?: string;
          uploaded_by?: string;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_attachments_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_attachments_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_orders: {
        Row: {
          cost_cents: number | null;
          created_at: string;
          created_by: string;
          description: string | null;
          due_date: string | null;
          id: string;
          priority: Database["public"]["Enums"]["work_order_priority"];
          property_id: string;
          status: Database["public"]["Enums"]["work_order_status"];
          title: string;
          unit_id: string | null;
          updated_at: string;
          vendor_id: string | null;
        };
        Insert: {
          cost_cents?: number | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          priority?: Database["public"]["Enums"]["work_order_priority"];
          property_id: string;
          status?: Database["public"]["Enums"]["work_order_status"];
          title: string;
          unit_id?: string | null;
          updated_at?: string;
          vendor_id?: string | null;
        };
        Update: {
          cost_cents?: number | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          priority?: Database["public"]["Enums"]["work_order_priority"];
          property_id?: string;
          status?: Database["public"]["Enums"]["work_order_status"];
          title?: string;
          unit_id?: string | null;
          updated_at?: string;
          vendor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_orders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      can_access_work_order: {
        Args: { p_work_order_id: string };
        Returns: boolean;
      };
      current_app_role: {
        Args: never;
        Returns: Database["public"]["Enums"]["app_role"];
      };
      current_vendor_id: { Args: never; Returns: string };
      is_landlord: { Args: never; Returns: boolean };
      is_staff: { Args: never; Returns: boolean };
      set_user_role: {
        Args: {
          new_role: Database["public"]["Enums"]["app_role"];
          target_user_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      activity_action:
        | "created"
        | "status_changed"
        | "vendor_assigned"
        | "note_added"
        | "attachment_added";
      app_role: "landlord" | "manager" | "vendor";
      attachment_kind: "photo" | "receipt" | "invoice" | "document";
      work_order_priority: "low" | "medium" | "high" | "urgent";
      work_order_status:
        | "open"
        | "assigned"
        | "in_progress"
        | "completed"
        | "cancelled";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_action: [
        "created",
        "status_changed",
        "vendor_assigned",
        "note_added",
        "attachment_added",
      ],
      app_role: ["landlord", "manager", "vendor"],
      attachment_kind: ["photo", "receipt", "invoice", "document"],
      work_order_priority: ["low", "medium", "high", "urgent"],
      work_order_status: [
        "open",
        "assigned",
        "in_progress",
        "completed",
        "cancelled",
      ],
    },
  },
} as const;
