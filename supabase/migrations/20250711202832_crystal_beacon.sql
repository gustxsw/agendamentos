/*
  # Create agenda_payments table

  1. New Tables
    - `agenda_payments`
      - `id` (uuid, primary key)
      - `professional_id` (integer, foreign key to users)
      - `amount` (numeric)
      - `status` (text)
      - `payment_date` (timestamptz)
      - `expiry_date` (timestamptz)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  2. Security
    - Enable RLS on `agenda_payments` table
    - Add policy for professionals to read their own payments
    - Add policy for admins to read all payments
*/

CREATE TABLE IF NOT EXISTS agenda_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id integer NOT NULL REFERENCES users(id),
  amount numeric NOT NULL DEFAULT 49.90,
  status text NOT NULL DEFAULT 'pending',
  payment_date timestamptz,
  expiry_date timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE agenda_payments ENABLE ROW LEVEL SECURITY;

-- Create policy for professionals to read their own payments
CREATE POLICY "Professionals can read their own payments"
  ON agenda_payments
  FOR SELECT
  TO authenticated
  USING (auth.uid()::integer = professional_id);

-- Create policy for admins to manage all payments
CREATE POLICY "Admins can manage all payments"
  ON agenda_payments
  FOR ALL
  TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS agenda_payments_professional_id_idx ON agenda_payments(professional_id);