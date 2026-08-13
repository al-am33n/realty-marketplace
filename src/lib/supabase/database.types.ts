/**
 * TypeScript types describing the database schema.
 *
 * These make queries type-safe: misspell a column and the editor flags it
 * before the code ever runs, and `listing.price_kobo` autocompletes.
 *
 * KEEP IN SYNC WITH supabase/migrations/. Once the Supabase project exists you
 * can regenerate this file authoritatively rather than editing it by hand:
 *
 *   npx supabase gen types typescript --project-id <your-project-id> \
 *     > src/lib/supabase/database.types.ts
 *
 * This hand-written version mirrors the two Phase 1 migrations exactly so the
 * app is type-safe from the first line of code.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "renter_buyer" | "landlord" | "agent" | "admin";
export type ListingType = "rent" | "sale";
export type PropertyType =
  | "apartment"
  | "house"
  | "duplex"
  | "bungalow"
  | "self_contain"
  | "room_and_parlour"
  | "land"
  | "commercial";
export type ListingStatus =
  | "draft"
  | "pending_review"
  | "live"
  | "rejected"
  | "closed";
export type BookingStatus = "requested" | "confirmed" | "completed" | "cancelled";
export type DealStatus =
  | "negotiating"
  | "agreed"
  | "payment"
  | "closed_won"
  | "closed_lost";
export type DealType = "sale" | "rental";
export type PaymentPurpose = "listing_fee" | "commission";
export type PaymentStatus = "pending" | "success" | "failed" | "abandoned";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          user_id: string;
          role: UserRole;
          full_name: string;
          phone: string | null;
          verified: boolean;
          verified_at: string | null;
          banned: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          role?: UserRole;
          full_name?: string;
          phone?: string | null;
          verified?: boolean;
          verified_at?: string | null;
          banned?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          role?: UserRole;
          full_name?: string;
          phone?: string | null;
          verified?: boolean;
          verified_at?: string | null;
          banned?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      agents: {
        Row: {
          id: string;
          profile_id: string;
          coverage_area: string;
          active: boolean;
          rating: number | null;
          viewings_assigned: number;
          viewings_completed: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          coverage_area?: string;
          active?: boolean;
          rating?: number | null;
          viewings_assigned?: number;
          viewings_completed?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          coverage_area?: string;
          active?: boolean;
          rating?: number | null;
          viewings_assigned?: number;
          viewings_completed?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      listings: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          type: ListingType;
          property_type: PropertyType;
          price_kobo: number;
          location_text: string;
          lat: number | null;
          lng: number | null;
          bedrooms: number | null;
          bathrooms: number | null;
          description: string;
          images: string[];
          status: ListingStatus;
          rejection_reason: string | null;
          listing_fee_paid: boolean;
          fee_waived: boolean;
          commission_clause_agreed_at: string | null;
          commission_clause_version: string | null;
          booking_locked_at: string | null;
          booking_locked_by: string | null;
          published_at: string | null;
          closed_at: string | null;
          view_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title: string;
          type: ListingType;
          property_type: PropertyType;
          price_kobo: number;
          location_text: string;
          lat?: number | null;
          lng?: number | null;
          bedrooms?: number | null;
          bathrooms?: number | null;
          description?: string;
          images?: string[];
          status?: ListingStatus;
          rejection_reason?: string | null;
          listing_fee_paid?: boolean;
          fee_waived?: boolean;
          commission_clause_agreed_at?: string | null;
          commission_clause_version?: string | null;
          booking_locked_at?: string | null;
          booking_locked_by?: string | null;
          published_at?: string | null;
          closed_at?: string | null;
          view_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["listings"]["Insert"]>;
        Relationships: [];
      };

      bookings: {
        Row: {
          id: string;
          listing_id: string;
          requester_id: string;
          agent_id: string | null;
          proposed_slots: string[];
          scheduled_at: string | null;
          status: BookingStatus;
          notes: string | null;
          outcome_note: string | null;
          cancel_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          listing_id: string;
          requester_id: string;
          agent_id?: string | null;
          proposed_slots: string[];
          scheduled_at?: string | null;
          status?: BookingStatus;
          notes?: string | null;
          outcome_note?: string | null;
          cancel_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["bookings"]["Insert"]>;
        Relationships: [];
      };

      deals: {
        Row: {
          id: string;
          listing_id: string;
          booking_id: string | null;
          buyer_renter_id: string;
          agent_id: string | null;
          deal_type: DealType;
          agreed_price_kobo: number | null;
          commission_pct: number | null;
          commission_kobo: number | null;
          status: DealStatus;
          closed_lost_reason: string | null;
          closed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          listing_id: string;
          booking_id?: string | null;
          buyer_renter_id: string;
          agent_id?: string | null;
          deal_type: DealType;
          agreed_price_kobo?: number | null;
          commission_pct?: number | null;
          commission_kobo?: number | null;
          status?: DealStatus;
          closed_lost_reason?: string | null;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["deals"]["Insert"]>;
        Relationships: [];
      };

      payments: {
        Row: {
          id: string;
          user_id: string;
          purpose: PaymentPurpose;
          listing_id: string | null;
          deal_id: string | null;
          amount_kobo: number;
          currency: string;
          paystack_ref: string;
          status: PaymentStatus;
          paid_at: string | null;
          raw_payload: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          purpose: PaymentPurpose;
          listing_id?: string | null;
          deal_id?: string | null;
          amount_kobo: number;
          currency?: string;
          paystack_ref: string;
          status?: PaymentStatus;
          paid_at?: string | null;
          raw_payload?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["payments"]["Insert"]>;
        Relationships: [];
      };
    };

    Views: Record<never, never>;
    Functions: {
      check_rate_limit: {
        Args: {
          p_key: string;
          p_max_attempts: number;
          /** Postgres interval as a string, e.g. "15 minutes". */
          p_window: string;
        };
        /** true = still under the limit, false = blocked. */
        Returns: boolean;
      };
      prune_auth_throttle: {
        Args: Record<never, never>;
        Returns: number;
      };
      /**
       * Atomically claims a first-50 listing fee waiver.
       * TABLE-returning, so Supabase hands back an array with one row.
       */
      claim_listing_fee_waiver: {
        Args: { p_listing_id: string };
        Returns: Array<{
          granted: boolean;
          waivers_used: number;
          waiver_cap: number;
          reason:
            | "granted"
            | "already_waived"
            | "pool_exhausted"
            | "owner_has_open_waiver"
            | "not_owner"
            | "not_editable"
            | "not_found";
        }>;
      };
      /** Read-only pool state, safe to call without consuming a waiver. */
      listing_fee_waiver_status: {
        Args: Record<never, never>;
        Returns: Array<{
          waivers_used: number;
          waiver_cap: number;
          waivers_left: number;
        }>;
      };
    };
    Enums: {
      user_role: UserRole;
      listing_type: ListingType;
      property_type: PropertyType;
      listing_status: ListingStatus;
      booking_status: BookingStatus;
      deal_status: DealStatus;
      deal_type: DealType;
      payment_purpose: PaymentPurpose;
      payment_status: PaymentStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};

/** Convenience aliases so screens can write `Listing` instead of the long path. */
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Agent = Database["public"]["Tables"]["agents"]["Row"];
export type Listing = Database["public"]["Tables"]["listings"]["Row"];
export type Booking = Database["public"]["Tables"]["bookings"]["Row"];
export type Deal = Database["public"]["Tables"]["deals"]["Row"];
export type Payment = Database["public"]["Tables"]["payments"]["Row"];
